// blocked.js
// 차단 화면의 버튼 동작을 담당한다.
// 계산이나 판정은 하지 않는다. 전부 background.js에게 물어보고 결과만 그린다.


// HTML에서 다룰 요소들을 미리 찾아둔다
const probEl = document.getElementById('prob');
const infoEl = document.getElementById('info');
const attemptBtn = document.getElementById('attemptBtn');
const resultEl = document.getElementById('result');
const durationsEl = document.getElementById('durations');
const chanceBtn = document.getElementById('chanceBtn');
const chanceInfoEl = document.getElementById('chanceInfo');
const chanceResultEl = document.getElementById('chanceResult');


// 어느 사이트에서 막혀 왔는지. 차단 규칙이 주소 뒤에 ?site=naver.com 처럼 붙여 준다.
//
// 사이트 목록은 사용자가 바꿀 수 있어서 이제 config.js에 다 있지 않다.
// 그래서 여기서는 '도메인 모양인지'만 본다. 목록에 있는지는 background가 모든 요청마다
// 확인(checkSite)하고, 없으면 판정·통과를 거절한다. 그래서 주소창에
// blocked.html?site=아무사이트 를 직접 쳐도 통과해서 엉뚱한 곳으로 가는 일은 없다.
// 없거나 모양이 이상하면 처음 목록의 첫 번째를 쓴다.
function getCurrentSite() {
  const fromAddress = new URLSearchParams(location.search).get('site') || '';
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(fromAddress)) return fromAddress;
  return CONFIG.blockedSites[0];
}

const currentSite = getCurrentSite();   // 이 화면이 떠 있는 동안은 바뀌지 않는 값
const returnUrl = 'https://' + currentSite;   // 통과한 뒤 돌아갈 곳

document.getElementById('siteTitle').textContent = `${currentSite} 접속 제한`;
document.title = `차단됨 — ${currentSite}`;

// 1초마다 화면을 새로 그리는 타이머.
// 이게 없으면 화면을 연 순간의 확률이 그대로 멈춰 있게 된다.
let ticker = null;

// 아래 두 주기는 config.js에서 정한다 (askEverySec, resyncEverySec).
//
// ASK_EVERY_SEC: background에 실제로 물어보는 주기(초). 로컬 사본만 보므로 네트워크 없음.
// 화면은 1초마다 다시 그리지만, 물어보는 건 이만큼에 한 번만 한다.
// 경과 시간은 아래에서 스스로 세므로 초 표시는 그대로 부드럽다.
const ASK_EVERY_SEC = CONFIG.askEverySec;

// RESYNC_EVERY_SEC: 공유 서버와 다시 맞추는 주기(초). 여기만 네트워크를 탄다.
//
// 차단 화면은 열릴 때 딱 한 번만 서버를 읽는다. 화면을 오래 열어둔 채
// 다른 기기가 거부당하거나 세션을 끝내면, 이 화면은 그 사실을 모른 채
// 낡은 값으로 계속 표시하게 된다. 그래서 이 주기로 가끔 다시 맞춘다.
// (판정 자체는 attempt() 직전에 항상 다시 맞추므로, 이 값은 화면 표시가
//  얼마나 빨리 따라잡는지에만 영향을 준다. 판정 정확성과는 무관하다)
//
// 진짜 실시간(웹소켓 구독)으로 만들 수도 있지만, 그러려면 shared_state
// 표의 읽기를 열어야 해서 "코드를 아는 사람이 남의 표를 훔쳐볼 수 없게"
// 막아둔 지금 구조를 다시 짜야 한다. 2초 간격이면 사람 눈에는 사실상
// 즉각이면서 그 복잡함 없이 같은 체감을 준다.
const RESYNC_EVERY_SEC = CONFIG.resyncEverySec;

let tickCount = 0;
let asking = false;       // background에 묻는 중인지. 답이 오기 전에 또 묻지 않으려고
let lastStatus = null;    // 마지막으로 받아온 값
let lastStatusAt = 0;     // 그걸 받아온 시각(ms)


// background.js에게 말을 거는 함수.
// 답장이 올 때까지 기다렸다가 결과를 돌려준다.
// 모든 요청에 '이 화면이 어느 사이트 것인지'(currentSite)를 붙여 보낸다.
// 상태·설정·통과가 사이트마다 따로라서, background가 어느 사이트 칸을 볼지 알아야 한다.
// 요청마다 따로 붙이면 하나쯤 빼먹기 쉬워서 여기 한 곳에서 붙인다.
function ask(message) {
  return chrome.runtime.sendMessage({ ...message, site: currentSite });
}


// ─────────────────────────────────────────────────────────────
// 캐릭터 (새싹이)
//
// 여기서는 '어떤 상태 class를 붙일지'와 '어떤 그림을 쓸지'만 정한다.
// 움직임은 전부 extension.css에 있다. 확률은 계산하지 않고 GET_STATUS의 prob만 본다.
//
// 상태는 두 종류다.
//   평소(base)   : 확률로 정해지고 계속 반복된다. a-wait / a-calm / a-perk
//   반응(reaction): 일이 생겼을 때 한 번만 돈다. a-pass / a-fail / a-shrug / a-no
//                  동작이 끝나면(animationend) 바로 평소로 가지 않고 '여운'을 둔다.
//   여운(hold)    : 반응의 마지막 모습을 이어받아 잠시 더 머문다. a-happy / a-down
//                  머무는 시간은 config.js의 toonHoldMs. 통과는 -1이라 들어갈 때까지 계속.
// ─────────────────────────────────────────────────────────────

const toonEl = document.getElementById('toon');
const toonBodyEl = document.getElementById('toonBody');
const toonSproutEl = document.getElementById('toonSprout');

// 상태 class → 그림 번호 (images/navy-07-body.png 의 07)
const TOON_PICTURE = {
  'a-wait': '07', 'a-calm': '02', 'a-perk': '04',
  'a-pass': '06', 'a-fail': '01', 'a-shrug': '08', 'a-no': '03',
  // 여운은 앞 동작의 그림을 그대로 이어받는다 (그림이 안 바뀌어야 안 깜빡인다)
  'a-happy': '06', 'a-down': '01'
};

// 반응 동작이 끝난 뒤 이어서 보여줄 '여운'.
//   hold: 이어서 붙일 class. null이면 마지막 자세로 멈춰 있는다(both 덕분)
//   ms  : 그 상태로 머무는 시간. -1이면 다음 일이 생길 때까지 계속
const TOON_AFTER = {
  'a-pass':  { hold: 'a-happy', ms: CONFIG.toonHoldMs.pass },
  'a-fail':  { hold: 'a-down',  ms: CONFIG.toonHoldMs.fail },
  'a-shrug': { hold: null,      ms: CONFIG.toonHoldMs.shrug },
  'a-no':    { hold: null,      ms: CONFIG.toonHoldMs.no }
};

let toonBase = null;        // 확률로 정해지는 평소 상태
let toonReaction = null;    // 지금 반응 중인가 (여운까지 포함). 없으면 null
let toonHolding = false;    // 동작은 끝나고 여운만 남은 상태인가
let toonShown = null;       // 지금 #toon에 실제로 붙어 있는 class
let toonEndedParts = new Set();   // 반응 중 움직임이 끝난 부분 (몸 / 새싹)
let toonStillTimer = null;  // 움직임 줄이기 모드에서 반응을 끝낼 타이머
let toonHoldTimer = null;   // 여운을 끝낼 타이머
let wasOutOfLimit = false;  // 직전에 남은 한도가 0이었는지 (0이 '되는 순간'만 고개를 젓게)


// 지금 그림 묶음(navy / cream). CSS 변수 --toon-tone에서 읽는다.
// 다크 모드면 extension.css가 cream으로 바꿔 둔다. 색을 JS에 적지 않는 것과 같은 방식.
function getToonTone() {
  const tone = getComputedStyle(document.documentElement).getPropertyValue('--toon-tone').trim();
  return tone || 'navy';
}


// 지금 상태와 다크 모드에 맞는 그림을 넣는다. 이미 같은 그림이면 건드리지 않는다.
function setToonPictures() {
  if (!toonShown) return;

  const prefix = `images/${getToonTone()}-${TOON_PICTURE[toonShown]}`;
  const bodySrc = prefix + '-body.png';
  const sproutSrc = prefix + '-sprout.png';

  if (toonBodyEl.getAttribute('src') !== bodySrc) toonBodyEl.src = bodySrc;
  if (toonSproutEl.getAttribute('src') !== sproutSrc) toonSproutEl.src = sproutSrc;
}


// #toon의 상태 class를 바꾼다.
//
// ★ 같은 class면 아무것도 하지 않는다. render()가 1초마다 불리는데, 그때마다
//   class를 다시 쓰면 반복 애니메이션이 매번 처음으로 되돌아가 덜컥거린다.
//
// restart: 같은 반응을 연달아 보여줄 때(실패 두 번 등) 처음부터 다시 돌게 한다.
function showToon(name, restart = false) {
  if (name === toonShown && !restart) return;

  if (toonShown) toonEl.classList.remove(toonShown);
  // class를 뗀 걸 브라우저가 알아차리게 레이아웃을 한 번 읽는다.
  // 이게 없으면 같은 class를 바로 다시 붙였을 때 애니메이션이 다시 안 돈다.
  if (restart) void toonEl.offsetWidth;
  toonEl.classList.add(name);
  toonShown = name;

  setToonPictures();
}


// 확률로 평소 상태를 고른다. 경계 숫자는 config.js.
function pickToonBase(prob) {
  if (prob < CONFIG.toonCalmFromProb) return 'a-wait';
  if (prob < CONFIG.toonPerkFromProb) return 'a-calm';
  return 'a-perk';
}


// render()가 부른다. 평소 상태를 갱신하고, 한도가 막 0이 됐으면 고개를 젓는다.
function updateToon(status) {
  toonBase = pickToonBase(status.prob);

  const outOfLimit = status.remainingMin <= 0;
  if (outOfLimit && !wasOutOfLimit) playToonReaction('a-no');
  wasOutOfLimit = outOfLimit;

  // 반응이 도는 중이면 평소 상태로 덮지 않는다. 반응이 끝나면 그때 돌아간다.
  if (!toonReaction) showToon(toonBase);
}


// 한 번만 도는 반응을 시작한다.
function playToonReaction(name) {
  toonReaction = name;
  toonHolding = false;
  toonEndedParts.clear();
  clearTimeout(toonStillTimer);
  clearTimeout(toonHoldTimer);   // 앞 반응의 여운이 남아 있으면 끊는다
  showToon(name, true);

  // 움직임 줄이기를 켠 사람은 애니메이션이 없어서 animationend가 오지 않는다.
  // 그대로 두면 반응 그림에서 영영 안 돌아오므로, 잠깐 보여주고 직접 넘어간다.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    toonStillTimer = setTimeout(startToonHold, CONFIG.toonStillReactionMs);
  }
}


// 반응 동작이 끝났다. 바로 평소로 돌아가지 않고 여운을 둔다.
// 통과는 여기서 멈춰 있다가, 시간을 고르고 사이트로 넘어가면서 화면째 사라진다.
function startToonHold() {
  clearTimeout(toonStillTimer);
  if (toonHolding) return;
  toonHolding = true;

  const plan = TOON_AFTER[toonReaction];
  if (!plan) { endToonReaction(); return; }

  // 여운 class로 바꾼다. 그림 번호가 같아서 그림은 안 바뀌고 움직임만 바뀐다
  if (plan.hold) showToon(plan.hold);

  if (plan.ms < 0) return;   // 계속 머문다
  toonHoldTimer = setTimeout(endToonReaction, plan.ms);
}


function endToonReaction() {
  clearTimeout(toonStillTimer);
  clearTimeout(toonHoldTimer);
  toonReaction = null;
  toonHolding = false;
  if (toonBase) showToon(toonBase);
}


// 반응이 끝났는지 본다.
//
// 몸(.toon-move)과 새싹(.toon-sprout)이 따로 animationend를 보내고, 길이가 다를 수 있다
// (실패: 몸 1.2초, 새싹 1.4초). 먼저 끝난 쪽에서 돌아가면 새싹이 중간에 뚝 끊기므로
// 둘 다 끝났을 때 돌아간다. (반복 애니메이션은 끝나지 않아 여기 오지 않는다)
toonEl.addEventListener('animationend', (event) => {
  if (!toonReaction || toonHolding) return;   // 여운은 반복이라 여기 걸리면 안 된다

  const part = event.target.classList.contains('toon-move') ? 'move'
             : event.target.classList.contains('toon-sprout') ? 'sprout'
             : null;
  if (!part) return;

  toonEndedParts.add(part);
  if (toonEndedParts.size === 2) startToonHold();
});


// 화면을 연 채로 다크 모드가 바뀌면 그림만 바꾼다 (class는 그대로라 움직임은 안 끊긴다)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setToonPictures);


// ─────────────────────────────────────────────────────────────
// 화면 그리기
// ─────────────────────────────────────────────────────────────

function render(status) {
  // 확률은 소수점 한 자리까지
  probEl.textContent = status.prob.toFixed(1) + '%';

  // 기다린 시간을 "3분 42초"로 보여준다.
  // 분만 보여주면 첫 1분 동안 계속 "0분"이라 멈춘 것처럼 느껴진다.
  const totalSec = Math.floor(status.elapsedMin * 60);
  const waitMin = Math.floor(totalSec / 60);
  const waitSec = totalSec % 60;

  infoEl.textContent =
    `기다린 시간 ${waitMin}분 ${waitSec}초` +
    ` · 오늘 ${status.usedTodayMin}분 사용` +
    ` · ${status.remainingMin}분 남음`;

  renderSyncInfo(status);
  renderChance(status);
  updateToon(status);   // 확률이 구간을 넘을 때만 실제로 바뀐다

  if (status.remainingMin <= 0) {
    // 한도를 다 썼으면 판정 자체를 안 한다
    attemptBtn.disabled = true;
    attemptBtn.textContent = '오늘 한도를 다 썼습니다';

  } else if (status.inSession) {
    // 다른 탭이나 다른 기기에서 이미 이용 중이다.
    // 이때 또 통과하면 세션이 겹쳐 앞의 것이 덮어써지므로 background도 막는다.
    attemptBtn.disabled = true;
    attemptBtn.textContent = '이용 중입니다';

  } else {
    attemptBtn.disabled = false;
    attemptBtn.textContent = '시도하기';
  }
}


// 오늘의 찬스 칸. 누를 수 있는지는 background가 정한 canChance를 그대로 따른다.
function renderChance(status) {
  // background가 예전 코드면 찬스 값이 안 온다. 확장 ↻ 없이 차단 화면만 F5 했을 때.
  if (status.chanceProb === undefined) {
    chanceInfoEl.textContent = '확장을 새로고침(↻)해 주세요';
    chanceBtn.disabled = true;
    return;
  }

  chanceInfoEl.textContent =
    `하루 한 번, 기다린 시간과 상관없이 ${status.chanceProb}% 확률로 ${status.chanceMinutes}분`;

  // 통과해서 시간을 고르는 중이면 잠근다. 늦게 도착한 동기화 응답이 render()를 불러도
  // 다시 켜지지 않게. (켜지면 통과권을 찬스가 먼저 써버릴 수 있다)
  chanceBtn.disabled = !status.canChance || !durationsEl.hidden;

  if (status.chanceUsed)          chanceBtn.textContent = '오늘은 이미 썼습니다';
  else if (status.inSession)      chanceBtn.textContent = '이용 중입니다';
  else if (status.remainingMin <= 0) chanceBtn.textContent = '오늘 한도를 다 썼습니다';
  else                            chanceBtn.textContent = '찬스 쓰기';
}


// 공유가 켜져 있으면 마지막으로 서버와 맞춘 시각을 작게 보여준다.
//
// 와이파이를 꺼서 한도를 되돌리는 건 여전히 막을 수 없다.
// 다만 '몇 시간 전'이 눈에 보이면 스스로 알아차리게 된다.
function renderSyncInfo(status) {
  const box = document.getElementById('syncInfo');

  if (!status.sharing) {
    box.textContent = '';
    return;
  }

  if (!status.lastSyncAt) {
    box.textContent = '아직 다른 기기와 맞추지 못했습니다';
    return;
  }

  const agoMin = Math.floor((Date.now() - status.lastSyncAt) / 60000);

  if (agoMin < 1)       box.textContent = '방금 다른 기기와 맞춤';
  else if (agoMin < 60) box.textContent = `마지막 동기화: ${agoMin}분 전`;
  else                  box.textContent = `마지막 동기화: ${Math.floor(agoMin / 60)}시간 전`;
}


// background.js에서 최신 상태를 받아와 화면을 새로 그린다
async function refresh() {
  const status = await ask({ type: 'GET_STATUS' });
  lastStatus = status;
  lastStatusAt = Date.now();
  render(status);
}


// 마지막으로 받아온 값에 '그 뒤로 흐른 시간'을 더한다.
//
// 이러면 5초에 한 번만 물어봐도 초 표시가 1초마다 부드럽게 움직인다.
// 확률은 마지막에 받아온 값 그대로인데, 초반 상승이 분당 0.2% 수준이라
// 5초면 0.02%도 안 되는 차이라서 눈에 보이지 않는다.
function withElapsedSinceFetch(status) {
  const passedMin = (Date.now() - lastStatusAt) / 60000;
  return { ...status, elapsedMin: status.elapsedMin + passedMin };
}


// 1초마다 화면을 다시 그리되, background에는 ASK_EVERY_SEC마다 한 번만 묻는다.
function startTicking() {
  if (ticker) return;

  ticker = setInterval(async () => {
    tickCount++;

    // 인터넷이 느리면 동기화가 2초를 넘길 수 있다.
    // 그 사이 또 보내면 요청이 쌓이고, 늦게 온 옛 답이 새 답을 덮어쓴다.
    // 그래서 답이 오기 전에는 묻지 않고 화면만 다시 그린다.
    const shouldSync = tickCount % RESYNC_EVERY_SEC === 0;
    const shouldAsk = tickCount % ASK_EVERY_SEC === 0 || !lastStatus;

    if (!asking && (shouldSync || shouldAsk)) {
      asking = true;
      try {
        if (shouldSync) await syncAndRefresh();
        else            await refresh();
      } catch (e) {
        console.warn('[차단화면] 상태를 못 받아옴:', e.message);
      } finally {
        asking = false;
      }
    } else if (lastStatus) {
      render(withElapsedSinceFetch(lastStatus));
    }
  }, 1000);
}

function stopTicking() {
  clearInterval(ticker);
  ticker = null;
}


// ─────────────────────────────────────────────────────────────
// 버튼 동작
// ─────────────────────────────────────────────────────────────

attemptBtn.addEventListener('click', async () => {
  // 연타로 여러 번 판정되는 걸 막는다.
  // 갱신도 잠깐 멈춘다. 안 그러면 판정을 기다리는 사이 render()가
  // 버튼을 다시 켜서, 그 틈에 한 번 더 누를 수 있다.
  attemptBtn.disabled = true;
  chanceBtn.disabled = true;   // 판정이 두 개 동시에 돌지 않게
  stopTicking();

  let outcome;
  try {
    outcome = await ask({ type: 'ATTEMPT' });
  } catch (e) {
    outcome = null;   // 확장을 새로고침한 직후 등, background와 연결이 끊긴 경우
  }

  if (!outcome || outcome.ok === false) {
    // background에서 오류가 났다. 판정이 됐는지 알 수 없으므로 결과는 안 보여준다.
    resultEl.textContent = (outcome && outcome.error) || '판정하지 못했습니다. 화면을 새로고침(F5) 해주세요';
    resultEl.className = 'fail';
    attemptBtn.disabled = false;
    startTicking();

  } else if (outcome.blocked) {
    // 누르는 순간 한도에 걸렸거나 이용 중이라 판정 자체를 못 한 경우.
    // 주사위를 굴리지도 않았으므로 결과를 표시하지 않는다.
    resultEl.textContent = '';
    resultEl.className = '';
    render(outcome.status);
    startTicking();

  } else if (outcome.passed) {
    // 주사위가 확률보다 작게 나오면 통과다.
    // 예: 확률 71.8%일 때 0~71.8 사이가 나오면 통과 → 100번 중 약 72번
    resultEl.textContent =
      `통과!`;
    resultEl.className = 'pass';
    playToonReaction('a-pass');

    attemptBtn.hidden = true;
    chanceBtn.disabled = true;   // 시간을 고르는 중에는 찬스도 못 쓴다
    stopTicking();   // 시간 선택 화면에서는 갱신을 멈춘다
    showDurationPicker(outcome.status.remainingMin);
    loadTodayStats();

  } else {
    resultEl.textContent =
      `실패`;
    resultEl.className = 'fail';

    // 반응을 render()보다 먼저 건다. 반대로 하면 render가 평소 그림(확률 0% → a-wait)을
    // 잠깐 붙였다가 실패 그림으로 바뀌어 한 번 깜빡인다.
    playToonReaction('a-fail');

    // 경과 시간이 0으로 초기화된 최신 상태를 받아 다시 그린다
    render(outcome.status);
    startTicking();
    loadTodayStats();
  }
});


// [찬스 쓰기]. 판정은 background가 하고, 여기서는 결과만 보여준다.
chanceBtn.addEventListener('click', async () => {
  chanceBtn.disabled = true;
  attemptBtn.disabled = true;   // 판정이 두 개 동시에 돌지 않게
  stopTicking();

  let outcome;
  try {
    outcome = await ask({ type: 'CHANCE' });
  } catch (e) {
    outcome = null;
  }

  if (!outcome || outcome.ok === false) {
    chanceResultEl.textContent = (outcome && outcome.error) || '찬스를 쓰지 못했습니다. 화면을 새로고침(F5) 해주세요';
    chanceResultEl.className = 'fail';
    if (outcome && outcome.status) render(outcome.status);
    startTicking();

  } else if (outcome.passed) {
    // 당첨이면 background가 이미 차단을 풀었다. 결과를 잠깐 보여주고 원래 사이트로 보낸다
    chanceResultEl.textContent = `당첨! ${outcome.minutes}분이 열렸습니다`;
    chanceResultEl.className = 'pass';
    playToonReaction('a-pass');   // 1.25초 뛰고 나서(1.5초 뒤) 사이트로 넘어간다
    attemptBtn.hidden = true;
    setTimeout(() => { location.href = returnUrl; }, 1500);

  } else {
    chanceResultEl.textContent = '꽝! 기다린 시간은 그대로입니다';
    chanceResultEl.className = 'fail';
    playToonReaction('a-shrug');   // 실패와 같은 이유로 render()보다 먼저
    render(outcome.status);
    startTicking();
    loadTodayStats();
  }
});


// [설정]: 이 사이트의 설정이 바로 열리게 주소에 ?site=를 붙여 연다.
//
// 예전에는 chrome.runtime.openOptionsPage()를 썼는데, 그 함수는 주소 뒤에
// ?site=를 붙일 수 없다. 그래서 주소를 직접 만들어 연다.
// (getURL은 확장 ID가 바뀌어도 알아서 맞춰준다)
document.getElementById('settingsBtn').addEventListener('click', () => {
  window.open(chrome.runtime.getURL('options.html?site=' + encodeURIComponent(currentSite)));
});


// ─────────────────────────────────────────────────────────────
// 이용 시간 정하기
// ─────────────────────────────────────────────────────────────

// 이번에 고를 수 있는 최대 분. showDurationPicker에서 정해진다.
let maxMinutes = 0;


// 통과했을 때 시간 정하는 부분을 보여준다.
// 정해진 버튼 목록 대신 1분 ~ 남은 한도 사이에서 자유롭게 고른다.
function showDurationPicker(remainingMin) {
  maxMinutes = remainingMin;

  const input = document.getElementById('minutesInput');
  input.max = remainingMin;

  // 처음 값은 config.js의 defaultSessionMin. 남은 한도가 그보다 적으면 남은 만큼만.
  input.value = Math.min(CONFIG.defaultSessionMin, remainingMin);

  durationsEl.hidden = false;
  updateMinutesHint();
}


// 지금 적힌 값이 쓸 수 있는 값인지 보고, 안내 문구와 시작 버튼을 갱신한다.
//
// 값을 강제로 고쳐 쓰지는 않는다. 타이핑 도중에 숫자가 멋대로 바뀌면
// 지우고 다시 치기가 어려워지기 때문이다. 대신 범위를 벗어나면
// 시작 버튼을 잠가서 넘어가지 못하게 한다.
function updateMinutesHint() {
  const input = document.getElementById('minutesInput');
  const hint = document.getElementById('minutesHint');
  const startBtn = document.getElementById('startBtn');

  const text = input.value.trim();
  const value = Math.floor(Number(text));
  const usable = text !== '' && Number.isFinite(value)
              && value >= 1 && value <= maxMinutes;

  startBtn.disabled = !usable;

  if (!usable) {
    hint.textContent = `1 ~ ${maxMinutes}분 사이로 정해주세요`;
  } else if (value === maxMinutes) {
    hint.textContent = `남은 한도 ${maxMinutes}분을 전부 씁니다`;
  } else {
    hint.textContent = `남은 한도 ${maxMinutes}분 중 ${value}분`;
  }

  // 더 올리거나 내릴 수 없는 버튼은 아예 잠근다.
  //
  // 이게 없으면 한도에 닿았을 때 [+5]를 눌러도 숫자가 그대로라서
  // 버튼이 고장 난 것처럼 보인다. 잠가두면 "더 못 올린다"는 게 눈에 보인다.
  for (const button of document.querySelectorAll('#stepper [data-step]')) {
    if (!usable) {
      button.disabled = false;   // 값이 이상할 땐 버튼으로 고칠 수 있어야 한다
      continue;
    }
    const delta = Number(button.dataset.step);
    const next = Math.min(Math.max(value + delta, 1), maxMinutes);
    button.disabled = (next === value);
  }
}


// +/- 버튼. 여기서는 범위 안으로 바로잡아 준다.
function stepMinutes(delta) {
  const input = document.getElementById('minutesInput');
  const current = Math.floor(Number(input.value)) || 0;

  input.value = Math.min(Math.max(current + delta, 1), maxMinutes);
  updateMinutesHint();
}


for (const button of document.querySelectorAll('#stepper [data-step]')) {
  button.addEventListener('click', () => stepMinutes(Number(button.dataset.step)));
}

document.getElementById('minutesInput').addEventListener('input', updateMinutesHint);


document.getElementById('startBtn').addEventListener('click', async () => {
  const minutes = Math.floor(Number(document.getElementById('minutesInput').value));
  const result = await ask({ type: 'START_SESSION', minutes: minutes });

  // background가 한 번 더 검사한다. 거절당하면 이유를 보여주고 멈춘다.
  if (!result.ok) {
    document.getElementById('minutesHint').textContent = result.error;
    return;
  }

  // 차단이 풀렸으니 막혀 왔던 사이트로 보낸다
  location.href = returnUrl;
});


// 서버와 맞추고 화면을 다시 그린다.
// 화면이 열릴 때, 그리고 RESYNC_EVERY_SEC마다 이걸 부른다.
// 공유 코드가 비어 있으면 background가 알아서 건너뛴다.
async function syncAndRefresh() {
  try {
    const synced = await ask({ type: 'SYNC_SHARED' });
    if (synced && synced.status) {
      lastStatus = synced.status;
      lastStatusAt = Date.now();
      render(synced.status);
    }
  } catch (e) {
    // 못 맞췄어도 그냥 진행한다. 로컬 사본으로 계속 돌아간다.
    console.warn('[차단화면] 동기화 실패:', e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 오늘 기록 (화면 아래 칸)
// ─────────────────────────────────────────────────────────────

// Supabase에서 오늘 요약과 최근 7일을 받아와 그린다.
//
// 1초 갱신(ticker)에는 넣지 않는다. 이건 네트워크를 타는데, 숫자가 바뀌는 건
// [시도하기]를 눌렀을 때뿐이라 그때만 다시 받으면 충분하다.
async function loadTodayStats() {
  let result;
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    result = await ask({ type: 'GET_STATS', timeZone: timeZone });
  } catch (e) {
    return;
  }

  // secrets.js가 없거나 인터넷이 끊긴 경우. 칸을 숨긴 채로 둔다.
  // 차단 화면의 본래 일(확률·시도)에는 영향이 없어야 하므로 오류 문구도 안 띄운다.
  if (!result || !result.ok) return;

  const cards = document.getElementById('statsCards');
  cards.innerHTML = '';
  addStatCard(cards, '오늘', result.data.today);
  renderDailyTable(result.data.daily || []);

  document.getElementById('blockedStats').hidden = false;
}


async function start() {
  await syncAndRefresh();
  startTicking();
  loadTodayStats();   // 기다리지 않는다. 늦게 와도 확률 표시는 먼저 뜨게
}

start();
