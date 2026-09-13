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


// 점을 찍는 시간대. 이 시점들은 고정이고 높이(확률)만 조절한다.
const POINT_TIMES = [10, 30, 45, 60, 80, 120];


// 높이 6개만 적으면 {x, y} 목록으로 만들어 주는 도우미.
// 아래 프리셋과 모양 자동 설정에서 숫자를 두 번 적지 않으려고 쓴다.
function toPoints(heights) {
  return POINT_TIMES.map((x, i) => ({ x, y: heights[i] }));
}


// ─────────────────────────────────────────────────────────────
// 프리셋
// 누르면 아래 값들이 한 번에 채워진다. 저장은 따로 눌러야 한다.
//
// usagePenalty는 셋 다 0이다. "오늘 쓴 시간은 확률에 영향을 주지 않는다"가
// 현재 방침이라, 프리셋이 그걸 몰래 켜면 안 되기 때문이다.
// ─────────────────────────────────────────────────────────────
// 프리셋은 curve(곡선 종류)를 바꾸지 않는다.
// 점 잇기로 다듬는 중에 눌렀다가 S자로 튕겨나가면 곤란하기 때문이다.
// 대신 S자용 값과 점 높이를 둘 다 담아서, 어느 곡선을 쓰든 세기가 맞춰지게 했다.
const PRESETS = {
  loose: {
    midpoint: 30, steepness: 0.08,
    points: toPoints([9, 45, 75, 91, 95, 95]),
    maxProb: 95, dailyLimit: 120, usagePenalty: 0
  },
  normal: {
    midpoint: 60, steepness: 0.05,
    points: toPoints([3, 14, 29, 48, 72, 85]),
    maxProb: 85, dailyLimit: 60, usagePenalty: 0
  },
  strict: {
    midpoint: 120, steepness: 0.04,
    points: toPoints([0, 2, 4, 8, 16, 50]),
    maxProb: 60, dailyLimit: 30, usagePenalty: 0
  }
};


// 점 잇기 곡선의 모양 자동 설정.
// 시간대(x)는 그대로 두고 높이(y)만 바꾼다.
// 순서는 config.js의 points 순서와 같다. (10 / 30 / 45 / 60 / 80 / 120분)
const POINT_SHAPES = {
  s:    [3, 14, 29, 48, 72, 85],   // 초반 느리고 중간에 급함 (기본값)
  line: [7, 21, 32, 43, 57, 85],   // 일정한 속도로 오름
  log:  [15, 37, 48, 58, 69, 85],  // 초반에 확 오르고 완만해짐
  late: [1, 3, 8, 18, 45, 85]      // 한참 버티다 끝에 열림
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


// 곡선 점 목록.
//
// 다른 설정들은 화면의 슬라이더가 값을 들고 있지만, 점은 입력칸을 없앴으므로
// 들고 있을 곳이 없다. 그래서 여기에 따로 둔다.
// 그래프를 끌면 이 배열이 바뀌고, 저장할 때 collectForm이 이걸 읽어간다.
let currentPoints = [];


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

  // 점 목록. 원본을 그대로 두면 끌 때 저장된 설정까지 바뀌므로 복사해서 쓴다.
  currentPoints = settings.points.map(p => ({ x: Number(p.x), y: Number(p.y) }));

  refreshView();
}


// 슬라이더 옆 숫자, 곡선 그룹 표시 여부, 안내 문구 색을 한 번에 갱신한다.
function refreshView() {
  updateDisplays();
  updateCurveGroups();
  updateDailyLimitHint();
  updatePreviewUsedSlider();
  drawPreview();
}


// 미리보기의 '오늘 사용 시간' 슬라이더는 하루 한도까지만 움직이면 된다.
// 한도를 줄였을 때 슬라이더가 그보다 큰 값을 가리키고 있으면 같이 줄인다.
function updatePreviewUsedSlider() {
  const limit = Number(document.querySelector('[data-setting="dailyLimit"]').value);
  const slider = document.getElementById('previewUsed');

  slider.max = limit;
  if (Number(slider.value) > limit) slider.value = limit;

  document.getElementById('previewUsedLabel').textContent = slider.value;
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

  // 점 목록도 복사해서 넘긴다. 받은 쪽에서 고쳐도 여기 원본은 안 바뀌게.
  settings.points = currentPoints.map(p => ({ x: p.x, y: p.y }));

  return settings;
}


// ─────────────────────────────────────────────────────────────
// 곡선 미리보기
//
// 확률 계산은 probability.js의 calcProb를 그대로 쓴다.
// 미리보기용으로 따로 계산하면 실제 동작과 어긋날 수 있기 때문이다.
// ─────────────────────────────────────────────────────────────

const PREVIEW_X_MAX = 180;                          // x축 최대 (분)
const PREVIEW_TIMES = [10, 20, 30, 40, 60, 80, 120]; // 표에 보여줄 시점
const HANDLE_RADIUS = 6;                            // 점 손잡이 크기(px)
const GRAB_DISTANCE = 16;                           // 이 거리 안이면 잡힌 것으로 본다

// 마지막으로 그린 좌표 변환 정보. 드래그할 때 화면 위치를 값으로 되돌리는 데 쓴다.
let previewGeom = null;

// 지금 끌고 있는 점의 번호. 아무것도 안 끌면 -1
let draggingIndex = -1;


function drawPreview() {
  const canvas = document.getElementById('preview');
  if (!canvas || !canvas.clientWidth) return;

  const settings = collectForm();
  const usedMin = Number(document.getElementById('previewUsed').value);

  // 화면 배율(고해상도 모니터)을 반영해야 선이 흐려지지 않는다
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 280;

  canvas.style.height = height + 'px';
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 이후로는 CSS 픽셀 기준으로 그린다
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 40, right: 14, top: 14, bottom: 26 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // 값 <-> 화면 위치 변환
  const xToPx = (min) => pad.left + (min / PREVIEW_X_MAX) * plotW;
  const yToPx = (pct) => pad.top + (1 - pct / 100) * plotH;
  const pxToX = (px) => ((px - pad.left) / plotW) * PREVIEW_X_MAX;
  const pxToY = (px) => (1 - (px - pad.top) / plotH) * 100;

  previewGeom = { xToPx, yToPx, pxToX, pxToY };

  drawGrid(ctx, settings, { xToPx, yToPx, pad, plotW, plotH, width, height });

  // 실선: 오늘 사용 시간을 0으로 본 확률
  drawCurve(ctx, settings, 0, { xToPx, yToPx, pad, width }, '#1a73e8', false);

  // 점선: 오늘 사용 시간을 반영한 확률
  drawCurve(ctx, settings, usedMin, { xToPx, yToPx, pad, width }, '#e8710a', true);

  // 점 잇기 곡선일 때만 끌 수 있는 손잡이를 그린다
  if (settings.curve === 'points') {
    drawHandles(ctx, settings.points, xToPx, yToPx);
  }

  updatePreviewHint(settings, usedMin);
  updatePreviewTable(settings, usedMin);
}


// 눈금과 격자
function drawGrid(ctx, settings, g) {
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#999';

  // 가로선 (확률)
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = g.yToPx(pct);
    ctx.strokeStyle = '#eee';
    ctx.beginPath();
    ctx.moveTo(g.pad.left, y);
    ctx.lineTo(g.width - g.pad.right, y);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', g.pad.left - 6, y);
  }

  // 세로선 (시간)
  for (let min = 0; min <= PREVIEW_X_MAX; min += 30) {
    const x = g.xToPx(min);
    ctx.strokeStyle = '#eee';
    ctx.beginPath();
    ctx.moveTo(x, g.pad.top);
    ctx.lineTo(x, g.height - g.pad.bottom);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(min + '분', x, g.height - g.pad.bottom + 6);
  }

  // 확률 상한선. 곡선이 어디서 잘리는지 보이게 한다
  const capY = g.yToPx(settings.maxProb);
  ctx.strokeStyle = '#bbb';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(g.pad.left, capY);
  ctx.lineTo(g.width - g.pad.right, capY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#999';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('상한 ' + settings.maxProb + '%', g.pad.left + 4, capY - 2);
}


// 곡선 한 줄을 그린다. 1픽셀마다 calcProb를 불러 실제 값을 따라 그린다.
function drawCurve(ctx, settings, usedMin, g, color, dashed) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.beginPath();

  for (let px = g.pad.left; px <= g.width - g.pad.right; px++) {
    const minutes = ((px - g.pad.left) / (g.width - g.pad.right - g.pad.left)) * PREVIEW_X_MAX;
    const prob = calcProb(minutes, usedMin, settings);
    const y = g.yToPx(prob);

    if (px === g.pad.left) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }

  ctx.stroke();
  ctx.setLineDash([]);
}


// 끌 수 있는 점을 동그라미로 그린다
function drawHandles(ctx, points, xToPx, yToPx) {
  points.forEach((point, index) => {
    const x = xToPx(point.x);
    const y = yToPx(point.y);

    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = (index === draggingIndex) ? '#e8710a' : '#fff';
    ctx.fill();
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}


function updatePreviewHint(settings, usedMin) {
  const hint = document.getElementById('previewHint');

  const solid = '파란 실선 = 오늘 사용 0분일 때의 확률';
  const dashed = '주황 점선 = 오늘 ' + usedMin + '분 썼을 때';

  if (settings.usagePenalty === 0) {
    hint.textContent = solid + ' / ' + dashed +
      '. 지금은 사용량 보정이 0이라 두 선이 완전히 겹칩니다.';
  } else {
    hint.textContent = solid + ' / ' + dashed + '.';
  }
}


function updatePreviewTable(settings, usedMin) {
  const tbody = document.querySelector('#previewTable tbody');
  tbody.innerHTML = '';

  for (const minutes of PREVIEW_TIMES) {
    const tr = document.createElement('tr');

    const timeCell = document.createElement('td');
    timeCell.textContent = minutes + '분';

    const baseCell = document.createElement('td');
    baseCell.textContent = calcProb(minutes, 0, settings).toFixed(1) + '%';

    const usedCell = document.createElement('td');
    usedCell.textContent = calcProb(minutes, usedMin, settings).toFixed(1) + '%';

    tr.append(timeCell, baseCell, usedCell);
    tbody.appendChild(tr);
  }
}


// ─────────────────────────────────────────────────────────────
// 점 끌기
// ─────────────────────────────────────────────────────────────

// 마우스/손가락 위치를 캔버스 안 좌표로 바꾼다
function canvasPos(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}


// 그 위치에 잡을 만한 점이 있으면 번호를, 없으면 -1을 돌려준다
function findHandleAt(event) {
  if (!previewGeom) return -1;

  const pos = canvasPos(event);

  let best = -1;
  let bestDist = GRAB_DISTANCE;

  currentPoints.forEach((point, index) => {
    const dx = previewGeom.xToPx(point.x) - pos.x;
    const dy = previewGeom.yToPx(point.y) - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });

  return best;
}


// 끌고 있는 점을 새 높이로 옮긴다.
//
// 시간대(x)는 건드리지 않는다. 위아래로만 움직이면 되므로
// 옆 점을 넘어가 순서가 뒤집힐 걱정도 없다.
function movePointTo(index, event) {
  const pos = canvasPos(event);

  currentPoints[index].y =
    Math.min(Math.max(Math.round(previewGeom.pxToY(pos.y)), 0), 100);

  drawPreview();
}


function hookPreviewDrag() {
  const canvas = document.getElementById('preview');

  canvas.addEventListener('pointerdown', (event) => {
    if (getCheckedCurve() !== 'points') return;

    const index = findHandleAt(event);
    if (index < 0) return;

    draggingIndex = index;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    drawPreview();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (draggingIndex >= 0) {
      movePointTo(draggingIndex, event);
      return;
    }

    // 안 끌고 있을 때는 점 위에 왔는지 알려주기만 한다.
    // 위아래로만 움직이므로 커서도 그 모양으로 바꾼다.
    if (getCheckedCurve() === 'points') {
      canvas.style.cursor = (findHandleAt(event) >= 0) ? 'ns-resize' : 'default';
    } else {
      canvas.style.cursor = 'default';
    }
  });

  const stopDragging = () => {
    if (draggingIndex < 0) return;
    draggingIndex = -1;
    drawPreview();
  };

  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);

  // 창 크기가 바뀌면 캔버스 너비도 달라지므로 다시 그린다
  window.addEventListener('resize', drawPreview);
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

  // 점 모양 자동 설정. 시간대는 그대로 두고 높이만 바꾼다.
  for (const button of document.querySelectorAll('[data-shape]')) {
    button.addEventListener('click', () => {
      const heights = POINT_SHAPES[button.dataset.shape];

      currentPoints.forEach((point, index) => {
        if (index < heights.length) point.y = heights[index];
      });

      refreshView();
    });
  }

  document.getElementById('saveBtn').addEventListener('click', save);

  document.getElementById('resetBtn').addEventListener('click', () => {
    fillForm(DEFAULTS);
  });

  hookPreviewDrag();
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
