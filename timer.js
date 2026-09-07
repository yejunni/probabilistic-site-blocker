// timer.js
// 유튜브 페이지 위에 남은 시간을 띄워주는 작은 표시.
//
// 이 파일은 다른 파일들과 다르게 "유튜브 페이지 안에서" 실행된다.
// (이런 걸 content script라고 부른다)
// 그래서 유튜브의 화면에 직접 글자를 얹을 수 있다.
//
// 이용 중이 아니면 아무것도 하지 않는다.


let timerBox = null;   // 화면에 띄운 상자
let ticker = null;     // 1초마다 숫자를 갱신하는 타이머


// 상자를 만들어 화면 우측 상단에 붙인다.
function createBox() {
  const box = document.createElement('div');

  Object.assign(box.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',

    padding: '6px 12px',
    borderRadius: '6px',

    background: 'rgba(0, 0, 0, 0.7)',
    color: 'white',
    font: 'bold 14px sans-serif',

    // 유튜브의 어떤 요소보다도 위에 오도록 최대값을 준다
    zIndex: '2147483647',

    // 상자가 클릭을 가로채면 유튜브 버튼이 안 눌리므로 클릭을 통과시킨다
    pointerEvents: 'none'
  });

  // body 대신 documentElement에 붙인다.
  // 유튜브가 body 안을 마음대로 갈아치워도 상자가 지워지지 않게 하려는 것.
  document.documentElement.appendChild(box);

  return box;
}


// 남은 시간을 계산해서 "4:32" 모양으로 상자에 써준다.
function updateBox(endAt) {
  const leftSec = Math.max(Math.ceil((endAt - Date.now()) / 1000), 0);

  const minutes = Math.floor(leftSec / 60);
  const seconds = String(leftSec % 60).padStart(2, '0');
  timerBox.textContent = `${minutes}:${seconds}`;

  // 마지막 1분은 빨갛게 바꿔서 곧 끝난다는 걸 알린다
  timerBox.style.background =
    leftSec <= 60 ? 'rgba(200, 30, 30, 0.9)' : 'rgba(0, 0, 0, 0.7)';

  if (leftSec === 0) {
    // 0이 되면 갱신을 멈춘다.
    // 실제로 다시 막는 일은 background.js의 알람이 처리한다.
    clearInterval(ticker);
  }
}


async function start() {
  let session;

  try {
    session = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
  } catch (e) {
    // 확장을 방금 새로고침했을 때 등, 연결이 끊겨 있으면 그냥 넘어간다
    return;
  }

  // 이용 중이 아니면 타이머를 띄우지 않는다
  if (!session || !session.sessionEndAt) return;

  timerBox = createBox();
  updateBox(session.sessionEndAt);
  ticker = setInterval(() => updateBox(session.sessionEndAt), 1000);
}


start();
