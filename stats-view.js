// stats-view.js
// 기록 통계를 카드와 표로 그리는 함수들. 설정 화면과 차단 화면이 같이 쓴다.
//
// 왜 따로 뺐나: 두 화면에 같은 코드를 복사해 두면, 한쪽만 고쳤을 때 모양이 어긋난다.
// 그리기만 한다. 통계를 받아오는 건 각 화면이 background에 GET_STATS로 묻는다.
//
// 이 파일을 쓰는 화면에는 id="statsDaily"인 표(안에 tbody)가 있어야 한다.


// 카드 한 장: 시도 횟수를 크게, 통과율과 사용 시간을 작게
function addStatCard(parent, title, stat) {
  const passRate = stat.attempts > 0
    ? Math.round((stat.passed / stat.attempts) * 100)
    : 0;

  const box = document.createElement('div');
  box.className = 'stat-card';

  const t = document.createElement('div');
  t.className = 'title';
  t.textContent = title;

  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = `${stat.attempts}회 시도`;

  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `통과 ${stat.passed}회 (${passRate}%) · ${formatMinutes(stat.minutes)}`;

  box.append(t, big, sub);
  parent.appendChild(box);
}


// 90 -> "1시간 30분", 45 -> "45분"
function formatMinutes(total) {
  const minutes = Number(total) || 0;
  if (minutes < 60) return `${minutes}분`;

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}


function renderDailyTable(daily) {
  const tbody = document.querySelector('#statsDaily tbody');
  tbody.innerHTML = '';

  // 막대 길이를 정하려면 최대값이 필요하다. 0이면 1로 둬서 0으로 나누는 걸 막는다
  const maxMinutes = Math.max(1, ...daily.map(d => Number(d.minutes) || 0));

  for (const day of daily) {
    const attempts = Number(day.attempts) || 0;
    const passed = Number(day.passed) || 0;
    const minutes = Number(day.minutes) || 0;
    const rate = attempts > 0 ? Math.round((passed / attempts) * 100) + '%' : '-';

    const tr = document.createElement('tr');

    for (const text of [day.day, attempts + '회', passed + '회', rate, formatMinutes(minutes)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }

    // 사용 시간을 막대 길이로도 보여준다. 숫자만 보면 흐름이 안 보인다
    const barCell = document.createElement('td');
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.width = Math.round((minutes / maxMinutes) * 100) + 'px';
    barCell.appendChild(bar);
    tr.appendChild(barCell);

    tbody.appendChild(tr);
  }
}
