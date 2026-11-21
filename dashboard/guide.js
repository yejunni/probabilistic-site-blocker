// dashboard/guide.js
// 설치 안내 부분만 담당한다. 기록 통계는 app.js가 따로 맡는다.
//
// 하는 일 두 가지
//   1. chrome://extensions 주소를 클립보드에 복사
//   2. 설치 단계 체크 상태를 이 브라우저에 기억
//
// localStorage는 시크릿 창이나 저장을 막아 둔 환경에서 에러를 던진다.
// 그래서 읽고 쓰는 곳을 전부 try/catch로 감쌌다. 기억이 안 되더라도
// 안내 자체는 그대로 읽을 수 있어야 하기 때문이다.


const STEPS_KEY = 'installSteps';


/* ---------- 1. 주소 복사 ---------- */

// chrome:// 로 시작하는 주소는 보안 때문에 <a href>로 걸 수 없다.
// 그래서 복사 버튼을 두고 사용자가 주소창에 직접 붙여 넣게 한다.
const copyBtn = document.getElementById('copyBtn');
const copyDone = document.getElementById('copyDone');

let copyTimer = null;

function showCopied(text) {
  copyDone.textContent = text;

  // 안내가 계속 남아 있으면 지저분하므로 3초 뒤에 지운다.
  // 연속으로 누를 때 앞 타이머가 남아 글자가 먼저 사라지지 않게 매번 취소한다.
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copyDone.textContent = ''; }, 3000);
}

if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    const text = copyBtn.dataset.copy;

    try {
      await navigator.clipboard.writeText(text);
      showCopied('복사되었습니다');
    } catch (e) {
      // 브라우저가 클립보드를 막는 경우가 있다 (권한 거부 등).
      // 이때는 글자를 대신 선택해 줘서 Ctrl+C를 누를 수 있게 한다.
      const target = document.getElementById('copyText');
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      showCopied('Ctrl+C로 복사해 주세요');
    }
  });
}


/* ---------- 2. 단계 체크 기억 ---------- */

const stepList = document.getElementById('steps');
const checks = document.querySelectorAll('.step-check');

// 체크된 단계 번호를 ['1','3'] 같은 배열로 저장한다.
// 번호로 저장하면 나중에 단계 순서를 바꿔도 엉뚱한 칸이 체크되지 않는다.
function loadDoneSteps() {
  try {
    const saved = JSON.parse(localStorage.getItem(STEPS_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch (e) {
    return [];
  }
}

function saveDoneSteps() {
  const done = [];
  for (const check of checks) {
    const step = check.closest('.step');
    if (check.checked) done.push(step.dataset.step);
  }
  try {
    localStorage.setItem(STEPS_KEY, JSON.stringify(done));
  } catch (e) {}
}

// 체크 표시에 맞춰 칸의 모양도 바꾼다.
// CSS가 .step[data-done="true"] 를 보고 흐리게 처리한다.
function paintStep(check) {
  const step = check.closest('.step');
  step.dataset.done = check.checked ? 'true' : 'false';
}

if (stepList) {
  const done = loadDoneSteps();

  for (const check of checks) {
    const step = check.closest('.step');
    check.checked = done.includes(step.dataset.step);
    paintStep(check);

    check.addEventListener('change', () => {
      paintStep(check);
      saveDoneSteps();
    });
  }
}
