// dashboard/app.js
// 대시보드 화면. 공유 코드를 받아 /api/stats에 묻고 결과를 그린다.
//
// Supabase에 직접 묻지 않는다. 키는 Vercel 서버(api/stats.js)에만 있다.
// 그리는 방식은 확장 설정 화면(options.js)의 통계 카드와 같다.


const codeForm = document.getElementById('codeForm');
const codeInput = document.getElementById('codeInput');
const messageEl = document.getElementById('message');
const resultEl = document.getElementById('result');

// 마지막으로 쓴 공유 코드를 이 브라우저에 기억해 둔다. 다음에 다시 안 치게.
// 비밀번호가 아니라서 기억해도 괜찮다. 저장이 막힌 환경(시크릿 창 등)이면 그냥 넘어간다.
const SAVED_CODE_KEY = 'shareCode';


function showMessage(text, isWarning) {
  messageEl.textContent = text;
  messageEl.className = isWarning ? 'warn' : '';
}


async function loadStats(code) {
  showMessage('불러오는 중...', false);

  // 브라우저의 시간대를 같이 보낸다.
  // 서버는 UTC로 돌기 때문에 이게 없으면 밤 9시 이후 기록이 '내일'로 잡힌다.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // encodeURIComponent: 주소에 넣을 수 없는 글자가 있어도 안전하게 바꿔 준다
  const url = `/api/stats?code=${encodeURIComponent(code)}&tz=${encodeURIComponent(timeZone)}`;

  let result;
  try {
    const response = await fetch(url);
    result = await response.json();
  } catch (e) {
    showMessage('서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true);
    return;
  }

  if (!result.ok) {
    // 코드 모양이 틀렸거나, 서버 설정이 없거나, Supabase가 늦은 경우.
    // 이유는 api/stats.js가 짧게 적어서 보내준다.
    showMessage(result.error || '불러오지 못했습니다', true);
    return;
  }

  try { localStorage.setItem(SAVED_CODE_KEY, code); } catch (e) {}

  renderStats(result.data);
  resultEl.hidden = false;

  // 없는 코드여도 오류가 아니라 0으로만 나온다 (서버는 '없는 코드'를 구분하지 않는다).
  // 그래서 전부 0이면 오타일 수 있다고 알려준다.
  if (result.data.total.attempts === 0) {
    showMessage('기록이 없습니다. 공유 코드에 오타가 없는지 확인해 주세요.', true);
  } else {
    showMessage('', false);
  }
}


function renderStats(data) {
  const cards = document.getElementById('statsCards');
  cards.innerHTML = '';

  addStatCard(cards, '오늘', data.today);
  addStatCard(cards, '최근 7일', data.week);
  addStatCard(cards, '전체', data.total);

  renderDailyTable(data.daily || []);
}


// 카드 한 장: 시도 횟수를 크게, 통과율과 이용 시간을 작게
function addStatCard(parent, title, stat) {
  const box = document.createElement('div');
  box.className = 'stat-card';

  const titleEl = document.createElement('div');
  titleEl.textContent = title;

  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = `${stat.attempts}회 시도`;

  const sub = document.createElement('div');
  sub.textContent = `통과 ${stat.passed}회 (${passRate(stat)}%) · ${formatMinutes(stat.minutes)}`;

  box.append(titleEl, big, sub);
  parent.appendChild(box);
}


// 하루에 한 줄. 표 안의 글자는 textContent로만 넣는다 (innerHTML로 넣으면 글자가 HTML로 해석될 수 있다)
function renderDailyTable(days) {
  const body = document.getElementById('dailyBody');
  body.innerHTML = '';

  for (const day of days) {
    const row = document.createElement('tr');
    for (const text of [day.day, `${day.attempts}회`, `${day.passed}회`, formatMinutes(day.minutes)]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
}


// 시도가 0번이면 0으로 나누게 되므로 따로 처리한다
function passRate(stat) {
  return stat.attempts > 0 ? Math.round((stat.passed / stat.attempts) * 100) : 0;
}


// 90 -> "1시간 30분", 45 -> "45분"
function formatMinutes(total) {
  const minutes = Number(total) || 0;
  if (minutes < 60) return `${minutes}분`;

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}


// [불러오기]. form의 submit을 쓰면 입력칸에서 엔터를 쳐도 동작한다.
codeForm.addEventListener('submit', (event) => {
  event.preventDefault();   // 이게 없으면 페이지가 새로고침되어 버린다
  loadStats(codeInput.value.trim());
});


// 처음 열 때 기억해 둔 코드가 있으면 바로 불러온다
try {
  const saved = localStorage.getItem(SAVED_CODE_KEY);
  if (saved) {
    codeInput.value = saved;
    loadStats(saved);
  }
} catch (e) {}
