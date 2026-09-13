// blocked.js
// 차단 화면의 버튼 동작을 담당한다.
// 계산이나 판정은 하지 않는다. 전부 background.js에게 물어보고 결과만 그린다.


// HTML에서 다룰 요소들을 미리 찾아둔다
const probEl = document.getElementById('prob');
const infoEl = document.getElementById('info');
const attemptBtn = document.getElementById('attemptBtn');
const resultEl = document.getElementById('result');
const durationsEl = document.getElementById('durations');
const durationButtonsEl = document.getElementById('durationButtons');

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
      `통과!  주사위 ${outcome.roll.toFixed(1)} < 확률 ${outcome.prob.toFixed(1)}`;
    resultEl.className = 'pass';

    attemptBtn.hidden = true;
    stopTicking();   // 시간 선택 화면에서는 갱신을 멈춘다
    showDurationButtons(outcome.status.durationOptions);

  } else {
    resultEl.textContent =
      `거부  주사위 ${outcome.roll.toFixed(1)} ≥ 확률 ${outcome.prob.toFixed(1)}`;
    resultEl.className = 'fail';

    // 쿨타임이 걸린 최신 상태를 받아 다시 그린다
    render(outcome.status);
  }
});


// 통과했을 때 5 / 10 / 20 / 30분 버튼을 만들어 붙인다.
// 남은 한도보다 큰 선택지는 background.js가 미리 걸러서 보내준다.
function showDurationButtons(options) {
  durationButtonsEl.innerHTML = '';

  for (const minutes of options) {
    const btn = document.createElement('button');
    btn.textContent = minutes + '분';

    btn.addEventListener('click', async () => {
      await ask({ type: 'START_SESSION', minutes: minutes });
      // 차단이 풀렸으니 유튜브로 보낸다
      location.href = 'https://www.youtube.com';
    });

    durationButtonsEl.appendChild(btn);
  }

  durationsEl.hidden = false;
}


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
