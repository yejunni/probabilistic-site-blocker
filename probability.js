// probability.js
// "얼마나 기다렸는지"와 "오늘 얼마나 썼는지"를 넣으면 통과 확률(%)을 돌려주는 파일.
// 여기서는 계산만 한다. 저장하거나 화면에 그리거나 난수를 뽑는 일은 하지 않는다.
// 사용하려면 이 파일보다 config.js를 먼저 불러와야 한다.
//
// 모든 함수가 설정(settings)을 인자로 받는다.
// 옵션 화면에서 "아직 저장하지 않은 값"으로 곡선을 미리 그려야 하기 때문이다.
// 안 넘기면 config.js의 기본값(CONFIG)을 쓴다.


// 값을 min~max 범위 안으로 강제로 밀어넣는 도우미 함수.
// 예: clamp(120, 0, 100) -> 100 / clamp(-5, 0, 100) -> 0
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


// ── 곡선 1) S자 곡선 ────────────────────────────────────────────
// 초반엔 천천히, midpoint 근처에서 급하게, 후반에 다시 완만해진다.
function scurveProb(elapsedMin, s) {
  // 로지스틱 함수. 결과는 항상 0~1 사이.
  function logistic(t) {
    return 1 / (1 + Math.exp(-s.steepness * (t - s.midpoint)));
  }

  // 그냥 logistic(t)를 쓰면 0분에서도 확률이 몇 % 나와버린다.
  // (midpoint 60, steepness 0.05이면 logistic(0)이 약 0.047 → 4.7%)
  // 0분에는 정확히 0%가 나와야 하므로, logistic(0)만큼 빼고 다시 0~1로 늘려준다.
  const atZero = logistic(0);
  return 100 * (logistic(elapsedMin) - atZero) / (1 - atZero);
}


// ── 곡선 2) 로그 곡선 ───────────────────────────────────────────
// 초반에 확 오르고 갈수록 완만해진다.
function logProb(elapsedMin, s) {
  // 높이(A)를 직접 정하지 않고 역산한다.
  // "anchorMinutes분에 anchorProb%가 나와야 한다"는 조건에서 A를 구하는 것.
  const height = s.anchorProb / Math.log(1 + s.anchorMinutes / s.smoothness);

  return height * Math.log(1 + elapsedMin / s.smoothness);
}


// ── 곡선 3) 직선 ────────────────────────────────────────────────
// linearFullMin분이 지나면 상한(maxProb)에 딱 도달하는 일정한 기울기.
function linearProb(elapsedMin, s) {
  return s.maxProb * (elapsedMin / s.linearFullMin);
}


// ── 곡선 4) 점 잇기 ─────────────────────────────────────────────
// 찍어둔 점들 사이를 매끄러운 곡선으로 이어준다.
//
// 왜 굳이 어려운 방법을 쓰나:
//   점들을 직선으로 이으면 꺾인 부분이 각지고, 흔히 쓰는 부드러운 보간법
//   (Catmull-Rom 같은 것)은 점 사이에서 곡선이 출렁여 **확률이 잠깐
//   내려가는 구간**이 생긴다. 20분일 때보다 25분일 때 확률이 낮아지는 건
//   말이 안 된다.
//
//   그래서 "찍은 점들이 올라가기만 하면 그 사이도 절대 안 내려간다"를
//   보장하는 방법을 쓴다. 이를 단조 삼차 에르미트 보간(Fritsch-Carlson)이라
//   부른다. 각 점에서의 기울기를 구한 뒤, 출렁일 만큼 가파른 기울기는
//   안전한 크기로 깎아내리는 것이 핵심이다.
function pointsProb(elapsedMin, s) {
  // x 순서로 정렬하고, x가 겹치는 점은 앞의 것만 남긴다.
  // (x가 같으면 기울기 계산에서 0으로 나누게 되어 계산이 깨진다)
  const pts = [...s.points]
    .sort((a, b) => a.x - b.x)
    .filter((p, i, arr) => i === 0 || p.x > arr[i - 1].x);

  const n = pts.length;
  if (n === 0) return 0;
  if (n === 1) return pts[0].y;

  // 첫 점보다 앞이면 첫 y값, 마지막 점보다 뒤면 마지막 y값을 그대로 쓴다
  if (elapsedMin <= pts[0].x) return pts[0].y;
  if (elapsedMin >= pts[n - 1].x) return pts[n - 1].y;

  // 1단계: 이웃한 두 점을 직선으로 이었을 때의 기울기 (할선 기울기)
  const secant = [];
  for (let i = 0; i < n - 1; i++) {
    secant.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }

  // 2단계: 각 점에서의 기울기를 양옆 할선의 평균으로 잡는다.
  //         양 끝점은 옆이 하나뿐이라 그 할선을 그대로 쓴다.
  const slope = new Array(n);
  slope[0] = secant[0];
  slope[n - 1] = secant[n - 2];
  for (let i = 1; i < n - 1; i++) {
    slope[i] = (secant[i - 1] + secant[i]) / 2;
  }

  // 3단계: 출렁임을 막는 보정 (여기가 Fritsch-Carlson의 핵심)
  for (let i = 0; i < n - 1; i++) {
    // 두 점의 y가 같은 구간은 평평해야 하므로 기울기를 0으로 만든다
    if (secant[i] === 0) {
      slope[i] = 0;
      slope[i + 1] = 0;
      continue;
    }

    // 양끝 기울기가 할선보다 얼마나 가파른지를 본다.
    // 이 둘이 그리는 점이 반지름 3인 원을 벗어나면 곡선이 출렁인다.
    const a = slope[i] / secant[i];
    const b = slope[i + 1] / secant[i];
    const dist = Math.sqrt(a * a + b * b);

    if (dist > 3) {
      // 원 안으로 들어오도록 두 기울기를 같은 비율로 깎는다
      const shrink = 3 / dist;
      slope[i] = shrink * a * secant[i];
      slope[i + 1] = shrink * b * secant[i];
    }
  }

  // 4단계: elapsedMin이 어느 두 점 사이인지 찾는다
  let k = 0;
  while (k < n - 2 && elapsedMin > pts[k + 1].x) k++;

  // 5단계: 그 구간을 3차 곡선으로 계산한다.
  //         t는 구간 안에서의 위치 (왼쪽 끝이 0, 오른쪽 끝이 1)
  const width = pts[k + 1].x - pts[k].x;
  const t = (elapsedMin - pts[k].x) / width;
  const t2 = t * t;
  const t3 = t2 * t;

  // 아래 네 개는 "양끝의 높이와 기울기를 얼마씩 섞을지" 정하는 가중치다
  const hy0 = 2 * t3 - 3 * t2 + 1;   // 왼쪽 점의 높이
  const hs0 = t3 - 2 * t2 + t;       // 왼쪽 점의 기울기
  const hy1 = -2 * t3 + 3 * t2;      // 오른쪽 점의 높이
  const hs1 = t3 - t2;               // 오른쪽 점의 기울기

  return hy0 * pts[k].y
       + hs0 * width * slope[k]
       + hy1 * pts[k + 1].y
       + hs1 * width * slope[k + 1];
}


// curve 설정에 따라 위 네 곡선 중 하나를 골라 계산하고,
// 상한(maxProb)을 넘지 않도록 잘라준다.
function getBaseProb(elapsedMin, s) {
  let prob;

  if (s.curve === 'log') {
    prob = logProb(elapsedMin, s);
  } else if (s.curve === 'linear') {
    prob = linearProb(elapsedMin, s);
  } else if (s.curve === 'points') {
    prob = pointsProb(elapsedMin, s);
  } else {
    prob = scurveProb(elapsedMin, s);   // 'scurve' 또는 오타가 났을 때의 기본값
  }

  return clamp(prob, 0, s.maxProb);
}


// ── 최종 확률 ───────────────────────────────────────────────────
// elapsedMin    : 마지막 이용이 끝난 뒤 지난 시간(분)
// usedTodayMin  : 오늘 이미 사용한 시간(분)
// settings      : 쓸 설정. 안 넘기면 config.js의 기본값을 쓴다
// 반환값        : 0~100 사이의 숫자(%)
function calcProb(elapsedMin, usedTodayMin, settings = CONFIG) {
  const s = settings;

  // 음수가 들어와도 계산이 깨지지 않도록 먼저 막아준다.
  const elapsed = Math.max(elapsedMin, 0);
  const used = Math.max(usedTodayMin, 0);

  // 1) 기다린 시간만 보고 기본 확률을 구한다.
  const baseProb = getBaseProb(elapsed, s);

  // 2) 오늘 많이 썼으면 그만큼 깎는다.
  //    usagePenalty가 0이면 이 단계는 아무 일도 하지 않는다. (현재 기본값)
  //    ratio  : 하루 한도를 얼마나 썼는지 (0 = 안 씀, 1 = 다 씀)
  //    factor : 확률에 곱할 배수 (1 = 그대로, 0.5 = 절반으로)
  const ratio = Math.min(used / s.dailyLimit, 1);
  const factor = 1 - s.usagePenalty * ratio;

  const finalProb = baseProb * factor;

  return clamp(finalProb, 0, 100);
}
