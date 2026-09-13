// background.js
// 확장 프로그램의 "관리자". 화면은 없고 뒤에서 조용히 돌아간다.
// 하는 일: 확률 판정 / 유튜브를 열어주고 다시 막기 / 이용 시간 재기 / 기록 저장
//
// 주의: 크롬은 할 일이 없으면 이 파일을 잠시 꺼버린다.
// 그래서 기억해야 할 값은 전부 chrome.storage에 저장한다. (변수에 두면 날아감)

importScripts('config.js', 'probability.js');


// 이용 중일 때만 켜지는 "통과시켜라" 규칙의 번호.
// rules.json의 차단 규칙(id 1)보다 priority가 높아서 이게 이긴다.
const ALLOW_RULE_ID = 1000;

// 이용 시간이 끝났을 때 우리를 깨워줄 알람의 이름
const SESSION_ALARM = 'sessionEnd';


// 상태를 어디에 저장할지.
//
//   chrome.storage.sync  : 같은 구글 계정으로 로그인한 프로필끼리 값을 공유한다.
//                          프로필 A에서 60분을 다 쓰면 프로필 B에서도 0분 남음.
//   chrome.storage.local : 이 프로필 안에만 저장된다.
//
// 프로필을 바꿔서 한도를 초기화하는 우회를 막으려고 sync를 쓴다.
// 단, 아예 다른 구글 계정으로 가거나 로그인을 안 하면 공유되지 않는다.
// (확장으로 막을 수 있는 한계가 여기까지다)
//
// sync가 말썽이면 이 한 줄만 local로 바꾸면 원래대로 돌아온다.
const STORE = chrome.storage.sync;


// ─────────────────────────────────────────────────────────────
// 저장소 다루기
// ─────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  waitStartAt: null,      // 확률 계산의 기준 시각(ms). 여기서부터 얼마나 지났는지를 잰다
  todayKey: '',           // '2026-09-07' 같은 날짜. 날이 바뀌면 사용량을 초기화하려고 둔다
  usedTodayMin: 0,        // 오늘 이미 쓴 시간(분)
  sessionEndAt: null,     // 이용 중이면 끝나는 시각(ms), 아니면 null
  cooldownUntil: null     // 거부당했을 때 언제까지 못 누르는지(ms)
};


// 오늘 날짜를 '2026-09-07' 모양의 글자로 만든다.
function getTodayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}


// 저장된 값을 전부 읽어온다. 날짜가 바뀌었으면 오늘 사용량을 0으로 되돌린다.
async function loadState() {
  const saved = await STORE.get();
  const state = { ...DEFAULT_STATE, ...saved };

  const today = getTodayKey();
  if (state.todayKey !== today) {
    state.todayKey = today;
    state.usedTodayMin = 0;
    await STORE.set({ todayKey: today, usedTodayMin: 0 });
  }

  return state;
}


// 바꾸고 싶은 값만 골라서 저장한다. (예: saveState({ usedTodayMin: 15 }))
//
// sync는 쓰기 횟수에 제한이 있다(분당 120회). 그래서 이 함수는
// 판정할 때와 세션을 시작·종료할 때만 부른다.
// 차단 화면이 1초마다 하는 건 읽기뿐이라 제한에 걸리지 않는다.
async function saveState(changes) {
  await STORE.set(changes);
}


// ─────────────────────────────────────────────────────────────
// 사용자 설정 다루기
//
// config.js의 CONFIG는 이제 '공장 초기값' 역할만 한다.
// 사용자가 옵션 화면에서 바꾼 값은 storage의 'settings' 키 하나에
// 통째로 들어가고, 저장된 값이 기본값을 덮어쓴다.
//
// storage를 만지는 건 아래 loadSettings / saveSettings 두 함수뿐이다.
// 나중에 Supabase로 옮길 때 이 둘만 고치면 나머지는 손댈 게 없다.
// ─────────────────────────────────────────────────────────────

// 사용자가 바꿀 수 있는 항목과 허용 범위.
// 여기 없는 항목(devMode 등)은 옵션 화면에서 못 바꾼다.
//
// 옵션 화면도 이 표를 받아가서 슬라이더의 min/max를 정한다.
// 범위를 두 군데 적어두면 언젠가 어긋나기 때문이다.
const SETTING_RULES = {
  curve: {
    label: '확률 곡선', type: 'choice',
    choices: ['scurve', 'log', 'linear', 'points']
  },

  // scurve 전용
  midpoint:      { label: '중간 지점',     type: 'number', min: 10,   max: 180, step: 1 },
  steepness:     { label: '기울기',        type: 'number', min: 0.01, max: 0.2, step: 0.01 },

  // log 전용
  anchorMinutes: { label: '기준 시점',     type: 'number', min: 10,   max: 180, step: 1 },
  anchorProb:    { label: '기준 확률',     type: 'number', min: 10,   max: 100, step: 1 },
  smoothness:    { label: '초반 완만함',   type: 'number', min: 5,    max: 100, step: 1 },

  // linear 전용
  linearFullMin: { label: '상한 도달 시점', type: 'number', min: 10,   max: 300, step: 1 },

  // points 전용
  points:        { label: '곡선 점',       type: 'points' },

  // 공통
  maxProb:       { label: '확률 상한',     type: 'number', min: 50,   max: 100, step: 1 },
  dailyLimit:    { label: '하루 이용 한도', type: 'number', min: 10,   max: 180, step: 5 },
  usagePenalty:  { label: '사용량 보정',   type: 'number', min: 0,    max: 1,   step: 0.05 }
  // 없앤 항목:
  //   cooldownSec     - 거부 후 대기. attempt()의 설명 참고
  //   durationOptions - 이용 시간 선택지. 차단 화면에서 직접 정하도록 바뀜
};


// CONFIG에서 '사용자가 바꿀 수 있는 항목'만 뽑아낸다.
function getDefaultSettings() {
  const defaults = {};
  for (const key of Object.keys(SETTING_RULES)) {
    defaults[key] = CONFIG[key];
  }
  return defaults;
}


// 저장된 설정을 읽는다. 저장된 게 없는 항목은 기본값을 쓴다.
// ★ 설정을 읽는 통로는 여기 하나뿐이다.
async function loadSettings() {
  const saved = await STORE.get('settings');
  return { ...getDefaultSettings(), ...(saved.settings || {}) };
}


// 설정을 저장한다. 범위를 벗어난 값이 하나라도 있으면 전부 거부한다.
// ★ 설정을 쓰는 통로는 여기 하나뿐이다.
//
// 일부만 저장하지 않고 전부 거부하는 이유: 반쯤 적용된 설정이 제일 헷갈린다.
async function saveSettings(changes) {
  const merged = { ...(await loadSettings()), ...changes };
  const checked = validateSettings(merged);

  if (!checked.ok) {
    return { ok: false, errors: checked.errors };
  }

  await STORE.set({ settings: checked.settings });
  return { ok: true, settings: checked.settings };
}


// 값이 제대로 된 것인지 확인하고, 깔끔하게 정리해서 돌려준다.
// 화면에서 막는 것과 별개로 여기서 한 번 더 본다.
// 화면은 얼마든지 우회할 수 있기 때문이다.
function validateSettings(input) {
  const errors = [];
  const settings = {};

  for (const key of Object.keys(SETTING_RULES)) {
    const rule = SETTING_RULES[key];
    const value = input[key];

    // ── 정해진 것 중 하나를 고르는 항목 (curve) ──
    if (rule.type === 'choice') {
      if (!rule.choices.includes(value)) {
        errors.push(`${rule.label}: '${value}'는 없는 값입니다`);
      } else {
        settings[key] = value;
      }

    // ── 숫자 항목 ──
    } else if (rule.type === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        errors.push(`${rule.label}: 숫자가 아닙니다`);
      } else if (num < rule.min || num > rule.max) {
        errors.push(`${rule.label}: ${rule.min}~${rule.max} 범위를 벗어났습니다 (받은 값 ${num})`);
      } else {
        settings[key] = num;
      }

    // ── 곡선 점 목록 ──
    } else if (rule.type === 'points') {
      const cleaned = cleanPoints(value, errors);
      if (cleaned) settings[key] = cleaned;
    }
  }

  return { ok: errors.length === 0, errors, settings };
}


// 곡선 점 목록을 검사하고 x 순서로 정렬해서 돌려준다.
// 문제가 있으면 errors에 담고 null을 돌려준다.
function cleanPoints(value, errors) {
  if (!Array.isArray(value) || value.length < 2) {
    errors.push('곡선 점: 점이 2개 이상이어야 합니다');
    return null;
  }

  const cleaned = [];
  for (const point of value) {
    const x = Number(point.x);
    const y = Number(point.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      errors.push('곡선 점: 숫자가 아닌 값이 있습니다');
      return null;
    }
    if (x < 0 || x > 300) {
      errors.push(`곡선 점: 시간은 0~300분이어야 합니다 (받은 값 ${x})`);
      return null;
    }
    if (y < 0 || y > 100) {
      errors.push(`곡선 점: 확률은 0~100%여야 합니다 (받은 값 ${y})`);
      return null;
    }
    cleaned.push({ x, y });
  }

  cleaned.sort((a, b) => a.x - b.x);

  // 시간이 같은 점이 둘 있으면 기울기 계산에서 0으로 나누게 된다
  for (let i = 1; i < cleaned.length; i++) {
    if (cleaned[i].x === cleaned[i - 1].x) {
      errors.push(`곡선 점: 시간이 같은 점이 둘 있습니다 (${cleaned[i].x}분)`);
      return null;
    }
  }

  return cleaned;
}


// ─────────────────────────────────────────────────────────────
// 차단 풀기 / 다시 막기
// ─────────────────────────────────────────────────────────────

// on이 true면 "유튜브를 통과시켜라"는 임시 규칙을 켜고, false면 끈다.
// rules.json은 건드리지 않고, 이 규칙을 위에 덮어씌우는 방식이다.
async function setAllowRule(on) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    // 같은 번호의 규칙이 이미 있으면 오류가 나므로 항상 먼저 지운다
    removeRuleIds: [ALLOW_RULE_ID],
    addRules: on
      ? [{
          id: ALLOW_RULE_ID,
          priority: 2,                  // rules.json의 차단 규칙(priority 1)보다 높다
          action: { type: 'allow' },
          condition: {
            urlFilter: '||youtube.com',
            resourceTypes: ['main_frame']
          }
        }]
      : []
  });
}


// 지금 열려 있는 유튜브 탭을 새로고침한다.
// 차단 규칙은 "새로 이동할 때"만 작동하므로, 이미 열려 있는 탭은
// 이렇게 직접 새로고침해야 차단 화면으로 돌아간다.
async function reloadYoutubeTabs() {
  const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
  for (const tab of tabs) {
    chrome.tabs.reload(tab.id);
  }
}


// ─────────────────────────────────────────────────────────────
// 지금 상황 계산하기
// ─────────────────────────────────────────────────────────────

// 차단 화면에 보여줄 정보를 한 덩어리로 만들어 준다.
async function buildStatus() {
  const now = Date.now();
  const settings = await loadSettings();   // CONFIG가 아니라 저장된 설정을 쓴다
  let state = await loadState();

  // 아직 기준 시각이 없다면(= 설치 후 처음 들어온 것) 지금을 기준으로 잡는다.
  // 이 순간부터 확률이 0%에서 시작해 올라간다.
  if (state.waitStartAt === null) {
    state.waitStartAt = now;
    await saveState({ waitStartAt: now });
  }

  const elapsedMin = (now - state.waitStartAt) / 60000;
  const remainingMin = Math.max(settings.dailyLimit - state.usedTodayMin, 0);

  // 쿨타임이 이미 지났으면 0초로 취급한다
  const cooldownLeftSec = state.cooldownUntil
    ? Math.max(Math.ceil((state.cooldownUntil - now) / 1000), 0)
    : 0;

  return {
    elapsedMin,
    usedTodayMin: state.usedTodayMin,
    remainingMin,
    cooldownLeftSec,
    dailyLimit: settings.dailyLimit,

    // 실제 통과 확률 (probability.js가 계산).
    // 세 번째 인자로 설정을 넘겨야 사용자가 바꾼 곡선이 반영된다.
    prob: calcProb(elapsedMin, state.usedTodayMin, settings),

    // 버튼을 누를 수 있는 상태인지
    canAttempt: remainingMin > 0 && cooldownLeftSec === 0
  };
}


// ─────────────────────────────────────────────────────────────
// 판정 / 이용 시작 / 이용 종료
// ─────────────────────────────────────────────────────────────

// [시도] 버튼을 눌렀을 때. 난수를 뽑아 통과/거부를 정한다.
async function attempt() {
  const status = await buildStatus();

  // 한도가 없거나 쿨타임 중이면 판정 자체를 하지 않는다
  if (!status.canAttempt) {
    return { passed: false, blocked: true, status };
  }

  // 0 이상 100 미만의 난수를 뽑아 확률과 비교한다.
  // 확률이 30%면 0~29.99가 나올 때 통과 → 100번 중 30번꼴
  const roll = Math.random() * 100;
  const passed = roll < status.prob;

  if (!passed) {
    // 거부: 기준 시각을 지금으로 되돌린다.
    // 확률이 0%부터 다시 자라므로 한 번 실패하면 처음부터 다시 기다려야 한다.
    //
    // 따로 대기 시간을 걸지 않는 이유:
    // 모든 곡선은 0분에서 정확히 0%다. 그래서 연타해도 "난수 < 0"이
    // 참이 되지 않아 어차피 계속 실패한다. 대기가 하는 일이 없었다.
    // (cooldownUntil을 null로 지우는 건 예전에 저장된 값을 치우려는 것)
    await saveState({
      waitStartAt: Date.now(),
      cooldownUntil: null
    });
  }

  return { passed, roll, prob: status.prob, status: await buildStatus() };
}


// 시간을 고르고 나서. 차단을 풀고 알람을 맞춘다.
async function startSession(minutes) {
  const state = await loadState();
  const settings = await loadSettings();
  const remainingMin = Math.max(settings.dailyLimit - state.usedTodayMin, 0);

  // 화면이 보낸 값을 그대로 믿지 않는다.
  // 예전에는 차단 화면이 정해진 버튼만 눌렀지만, 이제 사용자가 직접 숫자를
  // 정하므로 여기서 막아야 한다. 콘솔에서 직접 메시지를 보내는 것도 마찬가지다.
  const wanted = Math.floor(Number(minutes));

  if (!Number.isFinite(wanted) || wanted < 1) {
    return { ok: false, error: '이용 시간은 1분 이상이어야 합니다' };
  }
  if (wanted > remainingMin) {
    return { ok: false, error: `남은 한도(${remainingMin}분)를 넘을 수 없습니다` };
  }

  const now = Date.now();
  const endAt = now + wanted * 60000;

  await setAllowRule(true);

  await saveState({
    sessionEndAt: endAt,
    // 사용량은 '끝날 때'가 아니라 '시작할 때' 미리 차감한다.
    // 도중에 브라우저를 꺼버려도 기록이 남게 하려는 것.
    usedTodayMin: state.usedTodayMin + wanted,
    cooldownUntil: null
  });

  // setTimeout 대신 alarms를 쓴다. 확장이 잠들어도 시간이 되면 깨워준다.
  chrome.alarms.create(SESSION_ALARM, { when: endAt });

  return { ok: true, endAt };
}


// 이용 시간이 다 됐을 때. 다시 막고, 기준 시각을 지금으로 새로 잡는다.
async function endSession() {
  await setAllowRule(false);
  await chrome.alarms.clear(SESSION_ALARM);

  await saveState({
    sessionEndAt: null,
    // 여기가 핵심. 이용이 끝난 이 시각부터 다시 확률이 0%에서 자란다.
    waitStartAt: Date.now(),
    cooldownUntil: null
  });

  await reloadYoutubeTabs();
}


// ─────────────────────────────────────────────────────────────
// 테스트용 (나중에 지울 부분)
// ─────────────────────────────────────────────────────────────

// 80분 확률을 보려고 진짜 80분을 기다릴 수는 없으니,
// 기준 시각을 과거로 옮겨서 "이미 N분 기다린 것"으로 만든다.
async function devSetElapsed(minutes) {
  await saveState({
    waitStartAt: Date.now() - minutes * 60000,
    cooldownUntil: null
  });
}

// 오늘 사용량을 원하는 값으로 바꾼다. 사용량 보정이 걸리는지 확인용.
async function devSetUsed(minutes) {
  await saveState({ usedTodayMin: minutes });
}


// ─────────────────────────────────────────────────────────────
// 차단 화면과 대화하기
// ─────────────────────────────────────────────────────────────

// blocked.js가 chrome.runtime.sendMessage로 보낸 요청을 여기서 받는다.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);

  // true를 돌려줘야 "답장은 조금 뒤에 보낼게"라는 뜻이 된다.
  // 이걸 빼먹으면 답장이 안 간다.
  return true;
});


async function handleMessage(message) {
  switch (message.type) {
    case 'GET_STATUS':
      return await buildStatus();

    case 'ATTEMPT':
      return await attempt();

    // 유튜브 위에 뜨는 타이머(timer.js)가 "언제 끝나요?"라고 물어볼 때
    case 'GET_SESSION': {
      const state = await loadState();
      return { sessionEndAt: state.sessionEndAt };
    }

    // 옵션 화면이 열릴 때. 현재 설정과 함께 허용 범위표도 같이 보낸다.
    // 범위를 옵션 화면에도 적어두면 언젠가 두 곳이 어긋나기 때문이다.
    case 'GET_SETTINGS':
      return {
        settings: await loadSettings(),
        rules: SETTING_RULES,
        defaults: getDefaultSettings()
      };

    // 옵션 화면에서 [저장]을 눌렀을 때.
    // 성공하면 { ok: true, settings }, 실패하면 { ok: false, errors: [...] }
    case 'SET_SETTINGS':
      return await saveSettings(message.settings);

    case 'START_SESSION':
      return await startSession(message.minutes);

    // 아래 두 개는 테스트용. CONFIG.devMode가 꺼져 있으면 무시한다.
    // 화면에서 버튼을 숨기는 것과 별개로, 요청 자체도 막아둬야
    // 콘솔에서 직접 보내는 식으로 한도를 늘릴 수 없다.
    case 'DEV_SET_ELAPSED':
      if (!CONFIG.devMode) return { error: '테스트 모드가 꺼져 있습니다' };
      await devSetElapsed(message.minutes);
      return await buildStatus();

    case 'DEV_SET_USED':
      if (!CONFIG.devMode) return { error: '테스트 모드가 꺼져 있습니다' };
      await devSetUsed(message.minutes);
      return await buildStatus();

    default:
      return { error: '알 수 없는 요청: ' + message.type };
  }
}


// ─────────────────────────────────────────────────────────────
// 알람 / 시작할 때 정리
// ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSION_ALARM) {
    endSession();
  }
});


// 툴바의 확장 아이콘을 눌렀을 때 설정 화면을 연다.
//
// manifest에 "action"이 있어야 툴바에 아이콘이 생긴다.
// default_popup을 주지 않았으므로 클릭이 이 함수로 들어온다.
// (설정으로 가는 입구가 chrome://extensions 세부정보 안에만 있어서 추가했다)
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});


// 브라우저를 껐다 켜면 알람이 사라질 수 있고,
// "통과시켜라" 규칙만 남아서 차단이 안 걸리는 상황이 생길 수 있다.
// 그래서 시작할 때 상태를 한 번 맞춰준다.
async function reconcile() {
  const state = await loadState();

  if (state.sessionEndAt === null) {
    // 이용 중이 아니었다 → 혹시 남아 있을 통과 규칙을 지운다
    await setAllowRule(false);
  } else if (Date.now() >= state.sessionEndAt) {
    // 이용 중이었는데 시간이 이미 지났다 → 지금 끝낸 걸로 처리
    await endSession();
  } else {
    // 아직 이용 중이다 → 통과 규칙과 알람을 다시 세운다.
    //
    // 규칙까지 다시 세우는 이유: 상태(sessionEndAt)는 sync로 프로필 간에
    // 공유되지만, 차단 해제 규칙은 프로필마다 따로 갖고 있다.
    // 이게 없으면 다른 프로필이 "이용 중"인 줄만 알고 유튜브는 막혀 있게 된다.
    await setAllowRule(true);
    chrome.alarms.create(SESSION_ALARM, { when: state.sessionEndAt });
  }
}

chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(reconcile);
