// probability.js
// "얼마나 기다렸는지"와 "오늘 얼마나 썼는지"를 넣으면 통과 확률(%)을 돌려주는 파일.
// 여기서는 계산만 한다. 저장하거나 화면에 그리거나 난수를 뽑는 일은 하지 않는다.
// 사용하려면 이 파일보다 config.js를 먼저 불러와야 한다.


// 값을 min~max 범위 안으로 강제로 밀어넣는 도우미 함수.
// 예: clamp(120, 0, 100) -> 100 / clamp(-5, 0, 100) -> 0
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


// ── 곡선 1) S자 곡선 ────────────────────────────────────────────
// 초반엔 천천히, midpoint 근처에서 급하게, 후반에 다시 완만해진다.
function scurveProb(elapsedMin) {
  // 로지스틱 함수. 결과는 항상 0~1 사이.
  function s(t) {
    return 1 / (1 + Math.exp(-CONFIG.steepness * (t - CONFIG.midpoint)));
  }

  // 그냥 s(t)를 쓰면 0분에서도 확률이 몇 % 나와버린다.
  // (midpoint 60, steepness 0.05이면 s(0)이 약 0.047 → 4.7%)
  // 0분에는 정확히 0%가 나와야 하므로, s(0)만큼 빼고 다시 0~1로 늘려준다.
  const atZero = s(0);
  return 100 * (s(elapsedMin) - atZero) / (1 - atZero);
}


// ── 곡선 2) 로그 곡선 ───────────────────────────────────────────
// 초반에 확 오르고 갈수록 완만해진다.
function logProb(elapsedMin) {
  // 높이(A)를 직접 정하지 않고 역산한다.
  // "anchorMinutes분에 anchorProb%가 나와야 한다"는 조건에서 A를 구하는 것.
  const height =
    CONFIG.anchorProb / Math.log(1 + CONFIG.anchorMinutes / CONFIG.smoothness);

  return height * Math.log(1 + elapsedMin / CONFIG.smoothness);
}


// ── 곡선 3) 직선 ────────────────────────────────────────────────
// linearFullMin분이 지나면 상한(maxProb)에 딱 도달하는 일정한 기울기.
function linearProb(elapsedMin) {
  return CONFIG.maxProb * (elapsedMin / CONFIG.linearFullMin);
}


// CONFIG.curve 설정에 따라 위 세 곡선 중 하나를 골라 계산하고,
// 상한(maxProb)을 넘지 않도록 잘라준다.
function getBaseProb(elapsedMin) {
  let prob;

  if (CONFIG.curve === 'log') {
    prob = logProb(elapsedMin);
  } else if (CONFIG.curve === 'linear') {
    prob = linearProb(elapsedMin);
  } else {
    prob = scurveProb(elapsedMin);   // 'scurve' 또는 오타가 났을 때의 기본값
  }

  return clamp(prob, 0, CONFIG.maxProb);
}


// ── 최종 확률 ───────────────────────────────────────────────────
// elapsedMin    : 마지막 이용이 끝난 뒤 지난 시간(분)
// usedTodayMin  : 오늘 이미 사용한 시간(분)
// 반환값        : 0~100 사이의 숫자(%)
function calcProb(elapsedMin, usedTodayMin) {
  // 음수가 들어와도 계산이 깨지지 않도록 먼저 막아준다.
  const elapsed = Math.max(elapsedMin, 0);
  const used = Math.max(usedTodayMin, 0);

  // 1) 기다린 시간만 보고 기본 확률을 구한다.
  const baseProb = getBaseProb(elapsed);

  // 2) 오늘 많이 썼으면 그만큼 깎는다.
  //    ratio  : 하루 한도를 얼마나 썼는지 (0 = 안 씀, 1 = 다 씀)
  //    factor : 확률에 곱할 배수 (1 = 그대로, 0.5 = 절반으로)
  const ratio = Math.min(used / CONFIG.dailyLimit, 1);
  const factor = 1 - CONFIG.usagePenalty * ratio;

  const finalProb = baseProb * factor;

  return clamp(finalProb, 0, 100);
}
