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

// 쿨타임 카운트다운을 1초마다 돌리는 타이머. 필요 없어지면 멈추려고 담아둔다
let cooldownTimer = null;


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

  infoEl.textContent =
    `기다린 시간 ${Math.floor(status.elapsedMin)}분` +
    ` · 오늘 ${status.usedTodayMin}분 사용` +
    ` · ${status.remainingMin}분 남음`;

  // 이전에 돌던 카운트다운이 있으면 멈춘다
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }

  if (status.remainingMin <= 0) {
    // 한도를 다 썼으면 판정 자체를 안 한다
    attemptBtn.disabled = true;
    attemptBtn.textContent = '오늘 한도를 다 썼습니다';

  } else if (status.cooldownLeftSec > 0) {
    // 거부당한 직후. 남은 초를 1초마다 줄여서 보여준다
    attemptBtn.disabled = true;
    startCooldownCountdown(status.cooldownLeftSec);

  } else {
    attemptBtn.disabled = false;
    attemptBtn.textContent = '시도하기';
  }
}


function startCooldownCountdown(seconds) {
  let left = seconds;
  attemptBtn.textContent = `${left}초 후 다시 시도`;

  cooldownTimer = setInterval(async () => {
    left = left - 1;

    if (left > 0) {
      attemptBtn.textContent = `${left}초 후 다시 시도`;
    } else {
      // 쿨타임이 끝났다. 그동안 확률도 올라갔으니 새로 받아서 다시 그린다
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      refresh();
    }
  }, 1000);
}


// background.js에서 최신 상태를 받아와 화면을 새로 그린다
async function refresh() {
  const status = await ask({ type: 'GET_STATUS' });
  render(status);
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
    // 뽑은 값이 없으므로 결과를 표시하지 않고 상태만 새로 그린다.
    resultEl.textContent = '';
    resultEl.className = '';
    render(outcome.status);

  } else if (outcome.passed) {
    resultEl.textContent = `통과! (확률 ${outcome.prob.toFixed(1)}% / 뽑은 값 ${outcome.roll.toFixed(1)})`;
    resultEl.className = 'pass';

    attemptBtn.hidden = true;
    showDurationButtons(outcome.status.durationOptions);

  } else {
    resultEl.textContent = `거부 (확률 ${outcome.prob.toFixed(1)}% / 뽑은 값 ${outcome.roll.toFixed(1)})`;
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
// 테스트용 (나중에 이 블록과 HTML의 #dev를 함께 지우면 된다)
// ─────────────────────────────────────────────────────────────

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


// 화면이 열리면 일단 한 번 상태를 받아온다
refresh();
