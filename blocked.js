// blocked.js
// 차단 화면의 버튼 동작을 담당한다.
// 계산이나 판정은 하지 않는다. 전부 background.js에게 물어보고 결과만 그린다.


// HTML에서 다룰 요소들을 미리 찾아둔다
const probEl = document.getElementById('prob');
const infoEl = document.getElementById('info');
const attemptBtn = document.getElementById('attemptBtn');
const resultEl = document.getElementById('result');
const durationsEl = document.getElementById('durations');

// 1초마다 화면을 새로 그리는 타이머.
// 이게 없으면 화면을 연 순간의 확률이 그대로 멈춰 있게 된다.
let ticker = null;


// background.js에게 말을 거는 함수.
// 답장이 올 때까지 기다렸다가 결과를 돌려준다.
function ask(message) {
  return chrome.runtime.sendMessage(message);
}


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

  if (status.remainingMin <= 0) {
    // 한도를 다 썼으면 판정 자체를 안 한다
    attemptBtn.disabled = true;
    attemptBtn.textContent = '오늘 한도를 다 썼습니다';

  } else if (status.cooldownLeftSec > 0) {
    // 거부당한 직후. 남은 초는 background.js가 계산해서 보내준다
    attemptBtn.disabled = true;
    attemptBtn.textContent = `${status.cooldownLeftSec}초 후 다시 시도`;

  } else {
    attemptBtn.disabled = false;
    attemptBtn.textContent = '시도하기';
  }
}


// background.js에서 최신 상태를 받아와 화면을 새로 그린다
async function refresh() {
  const status = await ask({ type: 'GET_STATUS' });
  render(status);
}


// 1초마다 refresh를 돌려서 확률과 시간이 실제로 흘러가게 만든다.
// 계산은 전부 background.js가 하므로 여기서는 물어보기만 한다.
function startTicking() {
  if (ticker) return;
  ticker = setInterval(refresh, 1000);
}

function stopTicking() {
  clearInterval(ticker);
  ticker = null;
}


// ─────────────────────────────────────────────────────────────
// 버튼 동작
// ─────────────────────────────────────────────────────────────

attemptBtn.addEventListener('click', async () => {
  // 연타로 여러 번 판정되는 걸 막는다
  attemptBtn.disabled = true;

  const outcome = await ask({ type: 'ATTEMPT' });

  if (outcome.blocked) {
    // 누르는 순간 쿨타임이나 한도에 걸려서 판정 자체를 못 한 경우.
    // 주사위를 굴리지도 않았으므로 결과를 표시하지 않는다.
    resultEl.textContent = '';
    resultEl.className = '';
    render(outcome.status);

  } else if (outcome.passed) {
    // 주사위가 확률보다 작게 나오면 통과다.
    // 예: 확률 71.8%일 때 0~71.8 사이가 나오면 통과 → 100번 중 약 72번
    resultEl.textContent =
      `통과!`;
    resultEl.className = 'pass';

    attemptBtn.hidden = true;
    stopTicking();   // 시간 선택 화면에서는 갱신을 멈춘다
    showDurationPicker(outcome.status.remainingMin);

  } else {
    resultEl.textContent =
      `실패`;
    resultEl.className = 'fail';

    // 쿨타임이 걸린 최신 상태를 받아 다시 그린다
    render(outcome.status);
  }
});


// [설정] 버튼. 확장의 옵션 화면을 새 탭으로 연다.
document.getElementById('settingsBtn').addEventListener('click', () => {
  // 주소를 직접 만들어 여는 방법. 확장 ID가 바뀌어도 알아서 맞춰준다.
  const openDirectly = () => window.open(chrome.runtime.getURL('options.html'));

  // 원래는 이 한 줄이면 된다.
  // 다만 manifest의 options_page가 아직 반영되지 않았으면 조용히 실패한다.
  // 그때는 주소로 직접 열어서라도 설정에 들어갈 수 있게 한다.
  try {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) openDirectly();
    });
  } catch (e) {
    openDirectly();
  }
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

  // 기본값은 10분. 남은 한도가 그보다 적으면 남은 만큼만.
  input.value = Math.min(10, remainingMin);

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

  // 차단이 풀렸으니 유튜브로 보낸다
  location.href = 'https://www.youtube.com';
});


// ─────────────────────────────────────────────────────────────
// 테스트용
// config.js의 devMode가 false면 이 칸이 통째로 사라진다.
// 코드를 지울 필요 없이 그 한 줄만 바꾸면 된다.
// ─────────────────────────────────────────────────────────────

if (CONFIG.devMode) {
  document.getElementById('devElapsedBtn').addEventListener('click', async () => {
    const minutes = Number(document.getElementById('devElapsed').value);
    const status = await ask({ type: 'DEV_SET_ELAPSED', minutes: minutes });
    render(status);
  });

  document.getElementById('devUsedBtn').addEventListener('click', async () => {
    const minutes = Number(document.getElementById('devUsed').value);
    const status = await ask({ type: 'DEV_SET_USED', minutes: minutes });
    render(status);
  });

} else {
  document.getElementById('dev').hidden = true;
}


// 화면이 열리면 한 번 그린 뒤, 1초마다 계속 갱신한다
refresh();
startTicking();
