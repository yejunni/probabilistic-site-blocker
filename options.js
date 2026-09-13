// options.js
// 설정 화면의 동작을 담당한다.
//
// 여기서는 chrome.storage를 직접 만지지 않는다. 전부 background.js에 물어본다.
// 나중에 저장 위치를 Supabase로 옮길 때 background의 두 함수만 고치면
// 이 파일은 손댈 게 없도록 하려는 것이다.


// background.js에 말을 거는 함수
function ask(message) {
  return chrome.runtime.sendMessage(message);
}


// background에서 받아온 것들. init()에서 채워진다.
let RULES = null;      // 각 항목의 허용 범위 (슬라이더 min/max를 여기서 가져온다)
let DEFAULTS = null;   // 공장 초기값 ([기본값으로] 버튼이 쓴다)


// 하루 한도 권장 범위. 벗어나도 막지는 않고 색만 바꿔서 알려준다.
const DAILY_LIMIT_ADVICE = { min: 30, max: 60 };


// ─────────────────────────────────────────────────────────────
// 프리셋
// 누르면 아래 값들이 한 번에 채워진다. 저장은 따로 눌러야 한다.
//
// usagePenalty는 셋 다 0이다. "오늘 쓴 시간은 확률에 영향을 주지 않는다"가
// 현재 방침이라, 프리셋이 그걸 몰래 켜면 안 되기 때문이다.
// ─────────────────────────────────────────────────────────────
const PRESETS = {
  loose: {
    curve: 'scurve', midpoint: 30, steepness: 0.08,
    maxProb: 95, dailyLimit: 120, usagePenalty: 0, cooldownSec: 30,
    durationOptions: [10, 20, 30, 45]
  },
  normal: {
    curve: 'scurve', midpoint: 60, steepness: 0.05,
    maxProb: 85, dailyLimit: 60, usagePenalty: 0, cooldownSec: 60,
    durationOptions: [10, 15, 20, 30]
  },
  strict: {
    curve: 'scurve', midpoint: 120, steepness: 0.04,
    maxProb: 60, dailyLimit: 30, usagePenalty: 0, cooldownSec: 180,
    durationOptions: [5, 10, 15]
  }
};


// ─────────────────────────────────────────────────────────────
// 화면 만들기
// ─────────────────────────────────────────────────────────────

// 슬라이더의 min/max/step을 background가 알려준 범위로 맞춘다.
// 여기에 숫자를 직접 적어두면 background의 검사 범위와 언젠가 어긋난다.
function applyRanges() {
  for (const input of document.querySelectorAll('input[type="range"][data-setting]')) {
    const rule = RULES[input.dataset.setting];
    if (rule && rule.type === 'number') {
      input.min = rule.min;
      input.max = rule.max;
      input.step = rule.step;
    }
  }
}


// 점 입력칸을 점 개수만큼 만든다.
function buildPointRows(points) {
  const tbody = document.getElementById('pointRows');
  tbody.innerHTML = '';

  points.forEach((point, index) => {
    const tr = document.createElement('tr');

    const label = document.createElement('td');
    label.textContent = (index + 1) + '번';

    const xCell = document.createElement('td');
    const xInput = document.createElement('input');
    xInput.type = 'number';
    xInput.className = 'point-x';
    xInput.min = 0;
    xInput.max = 300;
    xInput.value = point.x;
    xCell.appendChild(xInput);

    const yCell = document.createElement('td');
    const yInput = document.createElement('input');
    yInput.type = 'number';
    yInput.className = 'point-y';
    yInput.min = 0;
    yInput.max = 100;
    yInput.value = point.y;
    yCell.appendChild(yInput);

    tr.append(label, xCell, yCell);
    tbody.appendChild(tr);
  });
}


// ─────────────────────────────────────────────────────────────
// 설정 -> 화면
// ─────────────────────────────────────────────────────────────

function fillForm(settings) {
  // 슬라이더들
  for (const input of document.querySelectorAll('input[type="range"][data-setting]')) {
    input.value = settings[input.dataset.setting];
  }

  // 곡선 종류 라디오
  for (const radio of document.querySelectorAll('input[name="curve"]')) {
    radio.checked = (radio.value === settings.curve);
  }

  // 이용 시간 선택지는 "10,15,20,30" 모양의 글자로 보여준다
  document.getElementById('durationOptions').value = settings.durationOptions.join(',');

  // 점 목록
  buildPointRows(settings.points);

  refreshView();
}


// 슬라이더 옆 숫자, 곡선 그룹 표시 여부, 안내 문구 색을 한 번에 갱신한다.
function refreshView() {
  updateDisplays();
  updateCurveGroups();
  updateDailyLimitHint();
}


// 슬라이더 옆에 현재 값을 적어준다.
function updateDisplays() {
  for (const input of document.querySelectorAll('input[type="range"][data-setting]')) {
    const key = input.dataset.setting;
    const target = document.querySelector(`[data-display="${key}"]`);
    if (!target) continue;

    const rule = RULES[key];
    // step이 1보다 작은 항목(기울기, 사용량 보정)은 소수점까지 보여준다
    const decimals = (rule && rule.step < 1) ? 2 : 0;
    target.textContent = Number(input.value).toFixed(decimals);
  }
}


// 고른 곡선의 설정만 보이고 나머지는 숨긴다.
function updateCurveGroups() {
  const chosen = getCheckedCurve();
  for (const group of document.querySelectorAll('[data-curve-group]')) {
    group.hidden = (group.dataset.curveGroup !== chosen);
  }
}


// 하루 한도가 권장 범위를 벗어나면 문구 색을 바꿔서 알려준다. 막지는 않는다.
function updateDailyLimitHint() {
  const minutes = Number(document.querySelector('[data-setting="dailyLimit"]').value);
  const hint = document.getElementById('dailyLimitHint');

  const base = '30~60분을 권장합니다. 너무 넉넉하면 차단의 의미가 옅어지고, ' +
               '너무 짧으면 답답해서 확장을 꺼 버리게 됩니다.';

  if (minutes < DAILY_LIMIT_ADVICE.min) {
    hint.className = 'hint warn';
    hint.textContent = `${minutes}분은 권장 범위보다 짧습니다. ` + base;
  } else if (minutes > DAILY_LIMIT_ADVICE.max) {
    hint.className = 'hint warn';
    hint.textContent = `${minutes}분은 권장 범위보다 넉넉합니다. ` + base;
  } else {
    hint.className = 'hint';
    hint.textContent = base;
  }
}


function getCheckedCurve() {
  const checked = document.querySelector('input[name="curve"]:checked');
  return checked ? checked.value : 'scurve';
}


// ─────────────────────────────────────────────────────────────
// 화면 -> 설정
// ─────────────────────────────────────────────────────────────

function collectForm() {
  const settings = { curve: getCheckedCurve() };

  for (const input of document.querySelectorAll('input[type="range"][data-setting]')) {
    settings[input.dataset.setting] = Number(input.value);
  }

  // "10, 15, 20,30" 처럼 적어도 되도록 공백을 털어내고 빈 칸은 버린다.
  // 범위 검사는 background가 한다.
  settings.durationOptions = document.getElementById('durationOptions').value
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')
    .map(Number);

  // 점 목록
  const xs = document.querySelectorAll('#pointRows .point-x');
  const ys = document.querySelectorAll('#pointRows .point-y');
  settings.points = [];
  for (let i = 0; i < xs.length; i++) {
    settings.points.push({ x: Number(xs[i].value), y: Number(ys[i].value) });
  }

  return settings;
}


// ─────────────────────────────────────────────────────────────
// 저장
// ─────────────────────────────────────────────────────────────

async function save() {
  const msg = document.getElementById('saveMsg');
  const result = await ask({ type: 'SET_SETTINGS', settings: collectForm() });

  if (result.ok) {
    msg.className = 'ok';
    msg.textContent = '저장했습니다';

    // background가 정리한 값(정렬·중복 제거 등)을 화면에 되비춘다.
    // 내가 적은 것과 실제 저장된 것이 다를 수 있기 때문이다.
    fillForm(result.settings);

    setTimeout(() => { msg.textContent = ''; msg.className = ''; }, 2500);

  } else {
    // 하나라도 잘못되면 background가 전부 거부한다. 무엇이 문제인지 그대로 보여준다.
    msg.className = 'fail';
    msg.innerHTML = '<strong>저장하지 못했습니다</strong>';

    const list = document.createElement('ul');
    for (const error of result.errors) {
      const item = document.createElement('li');
      item.textContent = error;
      list.appendChild(item);
    }
    msg.appendChild(list);
  }
}


// ─────────────────────────────────────────────────────────────
// 시작
// ─────────────────────────────────────────────────────────────

function hookEvents() {
  // 슬라이더나 라디오를 움직이면 화면만 갱신한다. 저장은 하지 않는다.
  // (sync는 쓰기 횟수 제한이 있어서 슬라이더를 움직일 때마다 저장하면 금방 걸린다)
  document.addEventListener('input', refreshView);
  document.addEventListener('change', refreshView);

  for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => {
      // 프리셋에 없는 항목(점 목록 등)은 지금 값을 그대로 둔다
      fillForm({ ...collectForm(), ...PRESETS[button.dataset.preset] });
    });
  }

  document.getElementById('saveBtn').addEventListener('click', save);

  document.getElementById('resetBtn').addEventListener('click', () => {
    fillForm(DEFAULTS);
  });
}


async function init() {
  let res;

  try {
    res = await ask({ type: 'GET_SETTINGS' });
  } catch (e) {
    showStartupError('background.js에 연결하지 못했습니다: ' + e.message);
    return;
  }

  // background가 GET_SETTINGS를 모르면 { error: ... }가 돌아온다.
  // 확장을 새로고침하지 않아 옛 background.js가 돌고 있을 때 이렇게 된다.
  // 이 확인이 없으면 아래에서 엉뚱한 오류가 나서 원인을 못 찾는다.
  if (!res || !res.rules || !res.settings) {
    showStartupError(
      '설정을 불러오지 못했습니다. chrome://extensions 에서 확장을 새로고침한 뒤 다시 열어보세요.' +
      (res && res.error ? ' (' + res.error + ')' : '')
    );
    return;
  }

  RULES = res.rules;
  DEFAULTS = res.defaults;

  applyRanges();           // 슬라이더 범위를 먼저 맞춰야
  fillForm(res.settings);  // 값을 넣었을 때 잘리지 않는다
  hookEvents();
}


// 시작부터 실패하면 화면에 이유를 크게 띄운다.
// 빈 화면만 보이면 뭐가 잘못됐는지 알 수가 없다.
function showStartupError(text) {
  const box = document.createElement('p');
  box.textContent = text;
  box.style.color = '#c23';
  box.style.fontWeight = 'bold';
  document.body.prepend(box);
  console.error('[options]', text);
}

init();
