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
  const saved = await chrome.storage.local.get();
  const state = { ...DEFAULT_STATE, ...saved };

  const today = getTodayKey();
  if (state.todayKey !== today) {
    state.todayKey = today;
    state.usedTodayMin = 0;
    await chrome.storage.local.set({ todayKey: today, usedTodayMin: 0 });
  }

  return state;
}


// 바꾸고 싶은 값만 골라서 저장한다. (예: saveState({ usedTodayMin: 15 }))
async function saveState(changes) {
  await chrome.storage.local.set(changes);
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
  let state = await loadState();

  // 아직 기준 시각이 없다면(= 설치 후 처음 들어온 것) 지금을 기준으로 잡는다.
  // 이 순간부터 확률이 0%에서 시작해 올라간다.
  if (state.waitStartAt === null) {
    state.waitStartAt = now;
    await saveState({ waitStartAt: now });
  }

  const elapsedMin = (now - state.waitStartAt) / 60000;
  const remainingMin = Math.max(CONFIG.dailyLimit - state.usedTodayMin, 0);

  // 쿨타임이 이미 지났으면 0초로 취급한다
  const cooldownLeftSec = state.cooldownUntil
    ? Math.max(Math.ceil((state.cooldownUntil - now) / 1000), 0)
    : 0;

  return {
    elapsedMin,
    usedTodayMin: state.usedTodayMin,
    remainingMin,
    cooldownLeftSec,
    dailyLimit: CONFIG.dailyLimit,

    // 실제 통과 확률 (probability.js가 계산)
    prob: calcProb(elapsedMin, state.usedTodayMin),

    // 남은 한도 안에서 고를 수 있는 시간만 추린다.
    // 예: 7분 남았으면 [5]만 나온다
    durationOptions: [5, 10, 20, 30].filter(min => min <= remainingMin),

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
    // 거부: 쿨타임을 건다. 기준 시각(waitStartAt)은 건드리지 않으므로
    // 쿨타임이 끝나면 확률이 조금 더 올라가 있다.
    await saveState({ cooldownUntil: Date.now() + CONFIG.cooldownSec * 1000 });
  }

  return { passed, roll, prob: status.prob, status: await buildStatus() };
}


// 시간을 고르고 나서. 차단을 풀고 알람을 맞춘다.
async function startSession(minutes) {
  const state = await loadState();
  const now = Date.now();
  const endAt = now + minutes * 60000;

  await setAllowRule(true);

  await saveState({
    sessionEndAt: endAt,
    // 사용량은 '끝날 때'가 아니라 '시작할 때' 미리 차감한다.
    // 도중에 브라우저를 꺼버려도 기록이 남게 하려는 것.
    usedTodayMin: state.usedTodayMin + minutes,
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

    case 'START_SESSION':
      return await startSession(message.minutes);

    case 'DEV_SET_ELAPSED':
      await devSetElapsed(message.minutes);
      return await buildStatus();

    case 'DEV_SET_USED':
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
    // 아직 이용 중이다 → 알람을 다시 맞춰둔다
    chrome.alarms.create(SESSION_ALARM, { when: state.sessionEndAt });
  }
}

chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(reconcile);
