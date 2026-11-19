// background.js
// 확장 프로그램의 "관리자". 화면은 없고 뒤에서 조용히 돌아간다.
// 하는 일: 확률 판정 / 유튜브를 열어주고 다시 막기 / 이용 시간 재기 / 기록 저장
//
// 주의: 크롬은 할 일이 없으면 이 파일을 잠시 꺼버린다.
// 그래서 기억해야 할 값은 전부 chrome.storage에 저장한다. (변수에 두면 날아감)

importScripts('config.js', 'probability.js');

// Supabase 키. secrets.js는 .gitignore에 있어서 저장소에 없을 수 있다.
// 없다고 확장이 죽으면 안 되므로 따로 감싸서 불러온다.
// (secrets.js가 없으면 기록 저장만 조용히 꺼지고 나머지는 그대로 돈다)
try {
  importScripts('secrets.js');
} catch (e) {
  console.warn('[기록] secrets.js가 없습니다. 기록 저장을 건너뜁니다.',
               'secrets.example.js를 복사해 secrets.js를 만드세요.');
}

importScripts('supabase.js');


// 규칙 번호. 사이트마다 하나씩, 목록 순서대로 번호를 붙인다.
//   차단 규칙: 100, 101, 102, ...   (100~999)
//   통과 규칙: 1000, 1001, 1002, ... (1000~1999). 이용 중인 사이트만 켜진다
// 지울 때는 범위를 통째로 지운다. 사이트가 목록에서 빠져도 규칙이 남지 않게.
const BLOCK_RULE_ID_START = 100;
const ALLOW_RULE_ID_START = 1000;
const ALLOW_RULE_ID_END = 2000;

// 이용 시간이 끝났을 때 우리를 깨워줄 알람의 이름. 뒤에 사이트가 붙는다.
// 예: 'sessionEnd:naver.com'. 사이트마다 끝나는 시각이 다르므로 알람도 따로다.
const SESSION_ALARM_PREFIX = 'sessionEnd:';

// 사이트별로 나누기 전(2026-11-16 이전)에는 유튜브만 막았다.
// 그때 저장된 상태·설정을 이 사이트 몫으로 옮긴다 (migrateToPerSite 참고).
// 설정값이 아니라 '옛 기록이 어느 사이트 것이었나'라는 사실이라 config.js에 두지 않았다.
const OLD_VERSION_SITE = 'youtube.com';


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
//
// ★ 주의: sync는 쓰기 횟수 제한이 있다 (시간당 1,800번, 분당 120번).
//   넘으면 그 뒤로 모든 저장이 거부되어 판정이 멈춘다.
//   그래서 자주 바뀌는 값은 여기 두지 않고, 쓸 때도 바뀐 것만 쓴다 (saveState 참고).
const STORE = chrome.storage.sync;

// 이 기기에만 있으면 되는 값. 쓰기 횟수 제한이 없다.
// "마지막 동기화 시각"처럼 2초마다 바뀌는 값을 여기 둔다.
const LOCAL = chrome.storage.local;

// 브라우저를 끄면 사라지는 값. 확장 페이지에서만 읽을 수 있다.
// "방금 통과했다"는 통과권을 여기 둔다 (startSession 참고).
const TEMP = chrome.storage.session;


// ─────────────────────────────────────────────────────────────
// 저장소 다루기
// ─────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  waitStartAt: null,      // 확률 계산의 기준 시각(ms). 여기서부터 얼마나 지났는지를 잰다
  todayKey: '',           // '2026-09-07' 같은 날짜. 날이 바뀌면 사용량을 초기화하려고 둔다
  usedTodayMin: 0,        // 오늘 이미 쓴 시간(분)
  sessionEndAt: null,     // 이용 중이면 끝나는 시각(ms), 아니면 null
  chanceDay: ''           // 오늘의 찬스를 마지막으로 쓴 날짜. 오늘 날짜와 같으면 이미 쓴 것
};


// 오늘 날짜를 '2026-09-07' 모양의 글자로 만든다.
function getTodayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}


// 사이트별 상태를 저장할 때 쓰는 이름. 예: 'naver.com|waitStartAt'
//
// 사이트마다 상태가 따로다. 유튜브에서 실패해도 네이버의 기다린 시간은 그대로다.
//
// 사이트 하나를 한 덩어리({ waitStartAt, usedTodayMin, ... })로 묶지 않고
// 칸마다 따로 저장하는 이유: 차단 화면의 2초 동기화와 [시작하기]가 거의 동시에
// 저장하면, 덩어리째 읽고 쓰는 쪽이 상대가 방금 바꾼 칸을 옛 값으로 덮어쓴다
// (예: 방금 시작한 이용이 사라짐). 칸이 따로면 각자 자기 칸만 쓴다.
function stateKey(site, field) {
  return `${site}|${field}`;
}


// 한 사이트의 상태를 읽어온다. 날짜가 바뀌었으면 오늘 사용량을 0으로 되돌린다.
async function loadState(site) {
  const fields = Object.keys(DEFAULT_STATE);
  const saved = await STORE.get(fields.map(field => stateKey(site, field)));

  const state = { ...DEFAULT_STATE };
  for (const field of fields) {
    const value = saved[stateKey(site, field)];
    if (value !== undefined) state[field] = value;
  }

  const today = getTodayKey();
  if (state.todayKey !== today) {
    state.todayKey = today;
    state.usedTodayMin = 0;
    await saveState(site, { todayKey: today, usedTodayMin: 0 });
  }

  return state;
}


// 이 확장을 구분하는 id. 기록을 보낼 때 "누가 보낸 것인지" 표시하는 데 쓴다.
// 로그인이 없으므로 처음 한 번 임의로 만들어 저장해두고 계속 쓴다.
//
// sync에 저장하므로 같은 구글 계정의 다른 프로필에서도 같은 id가 된다.
// 즉 기기가 아니라 '사람' 단위에 가깝다.
async function getClientId() {
  const saved = await STORE.get('clientId');
  if (saved.clientId) return saved.clientId;

  const id = crypto.randomUUID();
  await STORE.set({ clientId: id });
  return id;
}


// 기록에 붙일 이름표를 고른다.
//
// 공유 코드를 넣어뒀으면 그것을, 아니면 기기별 clientId를 쓴다.
// 코드를 쓰면 프로필이나 구글 계정이 달라도 기록이 한 사람으로 묶인다.
//
// ★ Supabase에 보내는 모든 기록은 이 함수를 거친다.
//   여기 한 곳만 고치면 "무엇을 한 사람으로 볼지"가 전부 따라 바뀐다.
//
// 기록은 사이트를 나누지 않고 한 이름표로 보낸다. 통계도 모든 사이트를 합쳐서 본다.
// (attempts / sessions 표에 사이트 칸이 아직 없다)
async function getRecordId() {
  const code = await getShareCode();
  return code !== null ? code : await getClientId();
}


// ─────────────────────────────────────────────────────────────
// 한도 공유
//
// 공유 코드를 넣었을 때만 켜진다. 비어 있으면 지금까지처럼 완전히 로컬이다.
//
// chrome.storage를 '작업용 사본'으로 계속 쓰고, Supabase와는
// 중요한 순간에만 맞춘다. 차단 화면이 1초마다 하는 갱신은 사본만 본다.
// ─────────────────────────────────────────────────────────────

// 공유가 켜져 있으면 공유 코드를, 아니면 null을 돌려준다.
// 공유 코드는 사이트와 상관없이 하나다.
async function getShareCode() {
  const saved = await STORE.get('shareCode');
  const code = (saved.shareCode || '').trim();
  return code !== '' ? code : null;
}


// 서버 표(shared_state)에서 이 사이트의 줄을 찾는 이름. 예: 'mycode:naver.com'
//
// 서버 표는 이름 하나에 줄 하나다. 공유 코드 뒤에 사이트를 붙이면
// SQL을 고치지 않고도 사이트마다 한도·기다린 시간·찬스·설정이 따로 공유된다.
function sharedRowId(code, site) {
  return `${code}:${site}`;
}

// 공유가 켜져 있으면 이 사이트의 서버 줄 이름을, 아니면 null을 돌려준다.
async function getSharedRowId(site) {
  const code = await getShareCode();
  return code ? sharedRowId(code, site) : null;
}


// 서버의 값을 받아와 이 사이트의 로컬 사본에 덮어쓴다.
// 차단 화면이 열릴 때와 2초마다, 판정 직전에 부른다.
//
// 서버 값을 그대로 믿는 이유: 차감은 항상 서버를 거쳐서 하므로
// 로컬이 서버보다 앞서 있을 일이 없다. 서버가 언제나 진실이다.
async function pullShared(site) {
  const rowId = await getSharedRowId(site);
  if (!rowId) return { sharing: false };

  const result = await pullSharedState(rowId, getTodayKey());
  if (!result.ok) {
    // 못 받아왔으면 로컬 사본으로 계속 간다. 앱이 멈추면 안 된다.
    return { sharing: true, ok: false };
  }

  // 서버에 기준 시각이 아직 없을 때 (공유 코드를 새로 넣었고, 아직 거부·종료가 없었음).
  //
  // 예전에는 이 null을 그대로 받아 로컬 값을 지웠다. 그러면 buildStatus가
  // '처음 왔다'고 보고 기준 시각을 지금으로 잡고, 2초 뒤 동기화가 또 null로 지워서
  // 기다린 시간이 2초마다 0으로 돌아갔다 (확률이 0%에서 안 올라가던 버그).
  //
  // 그래서 서버가 비어 있으면 로컬 값을 지키고, 그 값을 서버에 올려 채운다.
  // 로컬에도 없으면 지금을 기준으로 잡는다.
  let waitStartAt;
  if (result.data.wait_start_at === null) {
    const local = await loadState(site);
    waitStartAt = local.waitStartAt !== null ? local.waitStartAt : Date.now();
    await pushWaitStart(site, waitStartAt);
  } else {
    waitStartAt = Number(result.data.wait_start_at);
  }

  // saveState는 바뀐 값만 쓰므로, 서버 값이 그대로면 아무것도 쓰지 않는다.
  await saveState(site, {
    usedTodayMin: Number(result.data.used_today_min) || 0,
    waitStartAt,
    todayKey: getTodayKey()
  });
  await markSynced();

  // 다른 기기가 오늘 찬스를 썼으면 여기서도 쓴 걸로 친다.
  //
  // '오늘'일 때만 받고, 비어 있다고 로컬 값을 지우지는 않는다.
  // shared_state.sql을 아직 다시 실행하지 않은 DB는 chance_day를 안 보내주는데,
  // 그걸 "안 씀"으로 받아 지워버리면 찬스를 또 쓸 수 있게 되기 때문이다.
  if (result.data.chance_day === getTodayKey()) {
    await saveState(site, { chanceDay: getTodayKey() });
  }

  if (result.data.settings) {
    // 다른 기기가 올려둔 이 사이트의 설정(곡선, 하루 한도 등)을 받아온다.
    // 새 네트워크 요청이 아니라 방금 받은 응답에 이미 들어있던 것이다.
    await mergeSharedSettings(site, result.data.settings);

  } else {
    // 이 코드로 설정을 올린 사람이 아직 아무도 없다.
    //
    // 사용 시간·기준 시각은 sync_state가 줄이 없으면 자동으로 만들어주는데
    // 설정은 그렇지 않다 — 옵션 화면에서 [저장]을 눌러야만 생긴다.
    // 그러면 "코드만 넣으면 맞을 것"이라는 기대와 어긋나므로, 여기서
    // 지금 이 기기의 설정을 그룹의 첫 값으로 자동으로 올려준다.
    //
    // 두 기기가 거의 동시에 이 상황을 맞아도 문제없다. 나중에 쓴 값이
    // 이기고, 그다음 재동기화(몇 초 안)에서 둘 다 그 값으로 맞춰진다.
    const local = await loadSettings(site);
    const { shareCode, ...toShare } = local;
    await setSharedSettings(rowId, getTodayKey(), toShare);
  }

  return { sharing: true, ok: true };
}


// 서버에서 받아온 공유 설정을 로컬에 합친다.
//
// shareCode 필드는 절대 덮어쓰지 않는다. 그건 이 기기가 스스로 정한 값이라,
// 서버 값(원래 안 담겨 있지만 혹시 몰라서)으로 바뀌면 안 되기 때문이다.
//
// 서버 값이 이상해도(validateSettings 실패) 조용히 무시한다.
// 여기서 요청이 거절돼 판정이 막히면 안 된다.
async function mergeSharedSettings(site, serverSettings) {
  if (!serverSettings) return;   // 이 코드로 아직 아무도 설정을 올린 적 없음

  const local = await loadSettings(site);
  const merged = { ...local, ...serverSettings, shareCode: local.shareCode };
  const checked = validateSettings(merged);

  // 지금 설정과 똑같으면 쓰지 않는다. 2초마다 불리므로 매번 쓰면
  // sync 쓰기 한도(시간당 1,800번)를 금방 넘긴다. saveState와 같은 이유.
  if (checked.ok && !sameSettings(checked.settings, local)) {
    await writeSettings(site, checked.settings);
    await rebuildBlockRules();   // 다른 기기가 바꾼 설정을 받았을 때도 저장 지점이다
  }
}


// 두 설정이 내용상 같은지 본다. 항목마다 글자로 바꿔 비교한다.
// (점 목록처럼 배열이 들어 있어서 === 로는 비교할 수 없다)
function sameSettings(a, b) {
  return Object.keys(SETTING_RULES).every(
    key => JSON.stringify(a[key]) === JSON.stringify(b[key])
  );
}


// 기준 시각을 서버에도 알린다. 거부당했을 때와 이용이 끝났을 때.
//
// 이걸 빼먹으면 프로필을 바꿔서 거부를 없던 일로 만들 수 있다.
async function pushWaitStart(site, waitStartAt) {
  const rowId = await getSharedRowId(site);
  if (!rowId) return;

  const result = await pushSharedWaitStart(rowId, getTodayKey(), waitStartAt);
  if (result.ok) {
    await markSynced();
  }
}


// 한 사이트의 상태 중 바꾸고 싶은 값만 골라서 저장한다.
// (예: saveState('naver.com', { usedTodayMin: 15 }))
//
// 지금 저장된 값과 똑같으면 쓰지 않는다.
//
// 왜 이렇게 하나: sync는 시간당 1,800번까지만 쓸 수 있다. 공유 중에는 차단 화면이
// 2초마다 서버 값을 받아오는데, 그때마다 그냥 쓰면 시간당 1,800번을 넘겨서
// 30분쯤 뒤부터 모든 저장이 거부된다(실제로 있던 버그). 서버 값은 대부분
// 그대로이므로, 바뀐 것만 쓰면 실제 쓰기는 거의 일어나지 않는다.
async function saveState(site, changes) {
  // 'waitStartAt' → 'naver.com|waitStartAt' 처럼 사이트 이름을 붙인다
  const keyed = {};
  for (const field of Object.keys(changes)) {
    keyed[stateKey(site, field)] = changes[field];
  }

  const current = await STORE.get(Object.keys(keyed));

  const changed = {};
  for (const key of Object.keys(keyed)) {
    if (current[key] !== keyed[key]) changed[key] = keyed[key];
  }

  if (Object.keys(changed).length > 0) {
    await STORE.set(changed);
  }
}


// 서버와 방금 맞췄다고 표시한다. 차단 화면의 "마지막 동기화" 글자에 쓰인다.
// 2초마다 바뀌는 값이라 sync가 아니라 local에 둔다.
async function markSynced() {
  await LOCAL.set({ lastSyncAt: Date.now() });
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
// 여기 없는 항목(화면·동작 세부값 등)은 옵션 화면에서 못 바꾼다.
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

  // 여러 프로필·계정을 한 사람으로 묶는 코드. 비워두면 기기별 id를 쓴다
  shareCode:     { label: '공유 코드',     type: 'code', maxLength: 40 },

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


// 사이트별 설정을 저장할 때 쓰는 이름. 예: 'settings|naver.com'
//
// 곡선·한도 등은 사이트마다 따로, 공유 코드만 공통('shareCode' 칸 하나)이다.
// 사이트마다 칸을 따로 두는 이유는 상태(stateKey)와 같다. 한 덩어리면
// 두 사이트의 설정을 거의 동시에 저장할 때 한쪽이 지워질 수 있다.
function settingsKey(site) {
  return `settings|${site}`;
}


// 한 사이트의 설정을 읽는다. 저장된 게 없는 항목은 기본값(config.js)을 쓴다.
// ★ 설정을 읽는 통로는 여기 하나뿐이다.
//
// 돌려주는 모양은 예전과 같다 ({ curve, points, ..., dailyLimit, shareCode }).
// 그래서 calcProb 등 설정을 쓰는 쪽은 고칠 게 없다.
async function loadSettings(site) {
  const key = settingsKey(site);
  const saved = await STORE.get([key, 'shareCode']);
  const defaults = getDefaultSettings();

  return {
    ...defaults,
    ...(saved[key] || {}),
    shareCode: saved.shareCode !== undefined ? saved.shareCode : defaults.shareCode
  };
}


// 검사가 끝난 설정을 실제로 저장한다. 공유 코드는 공통 칸, 나머지는 사이트 칸으로 나눈다.
// ★ 설정을 쓰는 통로는 여기 하나뿐이다. (검사는 부르는 쪽이 먼저 한다)
async function writeSettings(site, settings) {
  const { shareCode, ...siteValues } = settings;
  await STORE.set({ shareCode, [settingsKey(site)]: siteValues });
}


// 한 사이트의 설정을 저장한다. 범위를 벗어난 값이 하나라도 있으면 전부 거부한다.
//
// 일부만 저장하지 않고 전부 거부하는 이유: 반쯤 적용된 설정이 제일 헷갈린다.
async function saveSettings(site, changes) {
  const previous = await loadSettings(site);
  const merged = { ...previous, ...changes };
  const checked = validateSettings(merged);

  if (!checked.ok) {
    return { ok: false, errors: checked.errors };
  }

  const newCode = (checked.settings.shareCode || '').trim();
  const oldCode = (previous.shareCode || '').trim();

  // 공유 코드를 '새로' 넣거나 다른 코드로 바꿨다면: 그 코드로 이미 공유되고
  // 있는 설정이 있는지 먼저 확인한다. 있으면 그걸 따른다.
  //
  // 왜 이렇게 하나: 그룹에 새로 들어가는 것은 그 그룹의 현재 설정을
  // 받아오는 것이지, 방금 이 화면에서 만지던 값으로 그룹 설정을
  // 덮어쓰는 게 아니다. (덮어쓰면 먼저 세팅해둔 사람 것이 날아간다)
  //
  // (다른 사이트의 설정은 그 사이트의 차단 화면이 열릴 때 pullShared가 받아온다)
  if (newCode && newCode !== oldCode) {
    const existing = await pullSharedState(sharedRowId(newCode, site), getTodayKey());

    if (existing.ok && existing.data && existing.data.settings) {
      const adopted = { ...checked.settings, ...existing.data.settings, shareCode: newCode };
      const adoptedChecked = validateSettings(adopted);

      if (adoptedChecked.ok) {
        await writeSettings(site, adoptedChecked.settings);
        await rebuildBlockRules();
        return { ok: true, settings: adoptedChecked.settings, adopted: true };
      }
    }
  }

  await writeSettings(site, checked.settings);

  // 설정이 바뀌었으니 차단 규칙도 다시 만든다.
  // 지금은 blockedSites가 config.js에만 있어 결과가 같지만, 나중에 설정 화면에서
  // 사이트를 바꾸게 되면 여기서 바로 반영된다. 그때 부르는 곳을 찾아다니지 않으려고 미리 넣어 둔다.
  await rebuildBlockRules();

  // 공유 중이면 방금 저장한 값을 서버에도 올린다.
  // 다른 기기들은 재동기화 때(몇 초 안에) 이 값을 받아간다.
  if (newCode) {
    const { shareCode, ...toShare } = checked.settings;
    await setSharedSettings(sharedRowId(newCode, site), getTodayKey(), toShare);
  }

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

    // ── 공유 코드 (글자) ──
    } else if (rule.type === 'code') {
      const text = String(value == null ? '' : value).trim();

      // 비워두는 건 허용한다. "공유 안 함"이라는 뜻.
      if (text === '') {
        settings[key] = '';

      // 영문/숫자/밑줄/붙임표만 받는다.
      // 이 값이 나중에 DB 조회 조건과 주소에 들어가므로, 공백이나 특수문자가
      // 섞이면 엉뚱한 곳에서 깨진다. 처음부터 좁혀두는 편이 안전하다.
      } else if (!/^[A-Za-z0-9_-]+$/.test(text)) {
        errors.push(`${rule.label}: 영문, 숫자, _, - 만 쓸 수 있습니다`);

      } else if (text.length < 4) {
        errors.push(`${rule.label}: 4자 이상이어야 합니다 (너무 짧으면 남과 겹칩니다)`);

      } else if (text.length > rule.maxLength) {
        errors.push(`${rule.label}: ${rule.maxLength}자를 넘을 수 없습니다`);

      } else {
        settings[key] = text;
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

// 차단할 사이트 목록. ★ 목록을 읽는 통로는 여기 하나뿐이다.
//
// 지금은 config.js의 blockedSites를 그대로 읽는다. 설정 화면에서 바꾸게 되면
// 이 함수만 loadSettings()를 읽도록 고치면 된다. (loadSettings / saveSettings와 같은 생각)
//
// 일반 변수에 담아두지 않고 부를 때마다 읽는다. 워커가 잠들었다 깨도 늘 같은 값이 나온다.
//
// 형식이 틀린 값('https://naver.com', 'www.naver.com', 빈 칸)은 고쳐 쓰지 않고 빼고 경고만 한다.
// 이유: 크롬은 규칙 하나라도 틀리면 updateDynamicRules 전체를 거절한다.
//       오타 하나 때문에 유튜브 차단까지 통째로 풀리면 안 된다.
//       몰래 고쳐 주지 않는 건, 차단 화면(blocked.js)이 config.js 목록과
//       글자 그대로 비교하기 때문이다. 고친 값과 적힌 값이 다르면 어긋난다.
function getBlockedSites() {
  const domainShape = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;   // 소문자.점.으로.이어진.이름
  const sites = [];

  for (const site of CONFIG.blockedSites || []) {
    if (typeof site !== 'string' || !domainShape.test(site) || site.startsWith('www.')) {
      console.warn(`[차단 목록] '${site}'는 건너뜁니다. www. 없이 'naver.com'처럼 소문자 도메인만 적으세요`);
      continue;
    }
    if (!sites.includes(site)) sites.push(site);   // 같은 게 두 번 있으면 하나만
  }
  return sites;
}


// 차단 규칙을 목록대로 새로 만든다. 사이트마다 규칙 하나.
//
// 예전에는 rules.json(정적 규칙)에 youtube.com이 적혀 있었다. 정적 규칙은 파일이라
// 코드에서 내용을 바꿀 수 없어서, 동적 규칙으로 옮겨 목록에서 만들어 낸다.
// 동적 규칙은 브라우저를 껐다 켜도 남지만, 목록이 바뀌었을 수 있으니
// 설치·시작·설정 저장 때마다 다시 만든다.
async function rebuildBlockRules() {
  const sites = getBlockedSites();

  // 지금 걸려 있는 차단 규칙(100~999번)을 전부 찾아서 지운다.
  // 사이트가 3개였다가 2개로 줄면 102번이 남는데, 번호를 범위로 찾아야 그것까지 지워진다.
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const oldBlockIds = existing
    .map(rule => rule.id)
    .filter(id => id >= BLOCK_RULE_ID_START && id < ALLOW_RULE_ID_START);

  const newRules = sites.map((site, index) => ({
    id: BLOCK_RULE_ID_START + index,
    priority: 1,
    action: {
      type: 'redirect',
      // ?site=... 를 붙여 차단 화면이 '어느 사이트에서 왔는지' 알게 한다.
      // 크롬은 이 경로를 확장 주소에 이어 붙일 때 ? 뒤를 그대로 둔다
      // (Chromium indexed_rule.cc: base_url.Resolve(extension_path))
      redirect: { extensionPath: '/blocked.html?site=' + encodeURIComponent(site) }
    },
    condition: {
      // requestDomains는 서브도메인까지 잡는다. youtube.com → www.youtube.com, m.youtube.com
      requestDomains: [site],
      resourceTypes: ['main_frame']
    }
  }));

  // 지우기와 넣기를 한 번에 보낸다. 크롬이 한꺼번에 처리해서 '잠깐 아무것도 안 막히는' 틈이 없다
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldBlockIds,
    addRules: newRules
  });
}


// 받은 사이트 이름이 차단 목록에 있으면 그대로, 없으면 null.
//
// 차단 화면이 보낸 site 값을 그대로 믿지 않는다. 콘솔에서 목록에 없는 이름을
// 보내 엉뚱한 저장 칸이나 규칙을 만들지 못하게 한다.
function checkSite(site) {
  return getBlockedSites().includes(site) ? site : null;
}


// 주소(예: 'https://m.naver.com/news')가 목록의 어느 사이트인지 찾는다. 없으면 null.
// 유튜브 위에 뜨는 타이머(timer.js)는 사이트를 모르므로, 탭 주소로 알아낸다.
function siteFromUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch (e) {
    return null;
  }
  // 'naver.com' 자체이거나 '...naver.com'으로 끝나는 주소 (서브도메인)
  return getBlockedSites().find(site => host === site || host.endsWith('.' + site)) || null;
}


// on이 true면 "이 사이트를 통과시켜라"는 임시 규칙을 켜고, false면 끈다.
// 차단 규칙은 건드리지 않고, 이 규칙을 위에 덮어씌우는 방식이다.
//
// 사이트마다 규칙이 따로다. 유튜브를 통과해도 네이버는 막혀 있다.
// 번호는 목록 순서대로 1000, 1001, ... (목록 순서가 바뀌면 reconcile이 정리한다)
async function setAllowRule(site, on) {
  const index = getBlockedSites().indexOf(site);
  if (index === -1) return;   // 목록에서 빠진 사이트. 남은 규칙은 reconcile이 지운다

  const ruleId = ALLOW_RULE_ID_START + index;

  await chrome.declarativeNetRequest.updateDynamicRules({
    // 같은 번호의 규칙이 이미 있으면 오류가 나므로 항상 먼저 지운다
    removeRuleIds: [ruleId],
    addRules: on
      ? [{
          id: ruleId,
          priority: 2,                  // 차단 규칙(priority 1)보다 높다
          action: { type: 'allow' },
          condition: {
            requestDomains: [site],
            resourceTypes: ['main_frame']
          }
        }]
      : []
  });
}


// 이 사이트로 열려 있는 탭을 새로고침한다.
// 차단 규칙은 "새로 이동할 때"만 작동하므로, 이미 열려 있는 탭은
// 이렇게 직접 새로고침해야 차단 화면으로 돌아간다.
//
// '*.naver.com'은 naver.com 자체와 서브도메인(m.naver.com 등)을 다 잡는다.
async function reloadSiteTabs(site) {
  const tabs = await chrome.tabs.query({ url: `*://*.${site}/*` });
  for (const tab of tabs) {
    chrome.tabs.reload(tab.id);
  }
}


// ─────────────────────────────────────────────────────────────
// 지금 상황 계산하기
// ─────────────────────────────────────────────────────────────

// 차단 화면에 보여줄 이 사이트의 정보를 한 덩어리로 만들어 준다.
async function buildStatus(site) {
  const now = Date.now();
  const settings = await loadSettings(site);   // CONFIG가 아니라 저장된 설정을 쓴다
  let state = await loadState(site);

  // 아직 기준 시각이 없다면(= 이 사이트의 차단 화면이 처음 뜬 것) 지금을 기준으로 잡는다.
  // 이 순간부터 확률이 0%에서 시작해 올라간다.
  if (state.waitStartAt === null) {
    state.waitStartAt = now;
    await saveState(site, { waitStartAt: now });
  }

  const elapsedMin = (now - state.waitStartAt) / 60000;
  const remainingMin = Math.max(settings.dailyLimit - state.usedTodayMin, 0);

  // 지금 유튜브를 보는 중인지.
  // 이용 중에도 설정 화면의 "← 차단 화면" 링크로 이 화면에 올 수 있는데,
  // 그때 또 통과하면 남은 이용 시간이 새 시간으로 덮여서 사라진다. 그래서 막는다.
  const inSession = state.sessionEndAt !== null && state.sessionEndAt > now;

  const { lastSyncAt } = await LOCAL.get('lastSyncAt');

  return {
    site,
    elapsedMin,
    usedTodayMin: state.usedTodayMin,
    remainingMin,
    dailyLimit: settings.dailyLimit,
    inSession,
    sessionEndAt: state.sessionEndAt,

    // 차단 화면에 '마지막 동기화'를 띄우기 위한 값.
    // 공유가 꺼져 있으면 표시하지 않는다.
    sharing: (settings.shareCode || '').trim() !== '',
    lastSyncAt: lastSyncAt || null,

    // 실제 통과 확률 (probability.js가 계산).
    // 세 번째 인자로 설정을 넘겨야 사용자가 바꾼 곡선이 반영된다.
    prob: calcProb(elapsedMin, state.usedTodayMin, settings),

    // 버튼을 누를 수 있는 상태인지
    canAttempt: remainingMin > 0 && !inSession,

    // 오늘의 찬스. 확률·시간은 config.js.
    // 남은 한도가 30분보다 적어도 30분을 그대로 준다 (startSession의 allowOverLimit 참고)
    chanceUsed: state.chanceDay === getTodayKey(),
    chanceProb: CONFIG.chanceProb,
    chanceMinutes: CONFIG.chanceMinutes,
    canChance: remainingMin > 0 && !inSession && state.chanceDay !== getTodayKey()
  };
}


// ─────────────────────────────────────────────────────────────
// 판정 / 이용 시작 / 이용 종료
// ─────────────────────────────────────────────────────────────

// 테스트 칸 (차단 화면 맨 아래). config.js의 testTools가 true일 때만 받는다.
//
// changes: { elapsedMin } 또는 { usedTodayMin } (둘 다 있어도 된다)
//   elapsedMin   : 기다린 시간을 이 분으로 만든다 → 기준 시각을 '지금 - 이만큼'으로
//   usedTodayMin : 오늘 쓴 시간을 이 분으로 만든다. 공유 중에는 거절한다
async function testSet(site, changes) {
  if (!CONFIG.testTools) {
    return { ok: false, error: '테스트 칸이 꺼져 있습니다 (config.js의 testTools)' };
  }

  // 화면 값은 믿지 않는다. 숫자인지, 0~testMaxMinutes 안인지 여기서 본다
  const toMinutes = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 && num <= CONFIG.testMaxMinutes ? num : null;
  };

  if (changes.elapsedMin !== undefined) {
    const minutes = toMinutes(changes.elapsedMin);
    if (minutes === null) return { ok: false, error: `기다린 시간은 0~${CONFIG.testMaxMinutes}분` };

    const waitStartAt = Date.now() - minutes * 60000;
    await saveState(site, { waitStartAt });

    // 공유 중이면 서버에도 보낸다. 안 보내면 2초 동기화가 서버 값으로 바로 되돌린다.
    // 원래 있던 함수(set_wait_start)라 새로 열리는 구멍은 없다.
    await pushWaitStart(site, waitStartAt);
  }

  if (changes.usedTodayMin !== undefined) {
    if (await getSharedRowId(site)) {
      return { ok: false, error: '공유 코드를 쓰는 중에는 오늘 사용량을 바꿀 수 없습니다' };
    }
    const minutes = toMinutes(changes.usedTodayMin);
    if (minutes === null) return { ok: false, error: `오늘 사용량은 0~${CONFIG.testMaxMinutes}분` };

    await saveState(site, { usedTodayMin: minutes });
  }

  return { ok: true, status: await buildStatus(site) };
}


// 주사위 한 번. 시도하기와 찬스가 이 함수 하나를 같이 쓴다.
//
// 0 이상 100 미만의 난수를 뽑아 확률과 비교한다.
// 확률이 30%면 0~29.99가 나올 때 통과 → 100번 중 30번꼴
function rollDice(prob) {
  const roll = Math.random() * 100;
  return { roll, passed: roll < prob };
}


// 통과권을 담는 칸의 이름. 사이트마다 따로다.
// 유튜브에서 통과해 받은 통과권으로 네이버를 열 수 없게.
function passTicketKey(site) {
  return `passTicket|${site}`;
}


// [시도] 버튼을 눌렀을 때. 난수를 뽑아 통과/거부를 정한다.
// 결과(실패 시 초기화 포함)는 이 사이트에만 적용된다.
async function attempt(site) {
  // 판정 직전에 서버 값을 한 번 더 확인한다.
  //
  // 차단 화면은 열릴 때 딱 한 번만 서버를 읽는다. 화면을 계속 열어둔 채
  // 다른 기기가 거부당하거나 세션을 끝내면, 이 화면의 사본은 낡은 채로 남는다.
  // 화면 숫자가 잠깐 틀리는 건 넘어갈 수 있지만, 그 낡은 값으로 실제 주사위를
  // 굴려버리면 공정성 문제가 된다. 그래서 굴리기 직전에 한 번 더 맞춘다.
  //
  // 공유가 꺼져 있으면 pullShared()가 바로 { sharing:false }를 돌려주고 끝난다.
  await pullShared(site);

  const status = await buildStatus(site);

  // 한도가 없거나 이미 이용 중이면 판정 자체를 하지 않는다
  if (!status.canAttempt) {
    return { passed: false, blocked: true, status };
  }

  const { roll, passed } = rollDice(status.prob);

  if (passed) {
    // 통과권을 발급한다. startSession은 이게 있을 때만 유튜브를 열어준다.
    //
    // 이게 없으면 판정을 건너뛸 수 있다. 차단 화면에서 개발자 도구 콘솔에
    // START_SESSION 메시지를 직접 보내면 주사위 없이 바로 열리기 때문이다.
    await TEMP.set({ [passTicketKey(site)]: true });

  } else {
    // 거부: 기준 시각을 지금으로 되돌린다.
    // 확률이 0%부터 다시 자라므로 한 번 실패하면 처음부터 다시 기다려야 한다.
    //
    // 따로 대기 시간을 걸지 않는 이유:
    // 모든 곡선은 0분에서 정확히 0%다. 그래서 연타해도 "난수 < 0"이
    // 참이 되지 않아 어차피 계속 실패한다. 대기가 하는 일이 없었다.
    const now = Date.now();
    await saveState(site, { waitStartAt: now });
    await TEMP.remove(passTicketKey(site));

    // 거부당한 사실을 서버에도 알린다.
    // 안 보내면 프로필을 바꿔서 거부를 없던 일로 만들 수 있다.
    await pushWaitStart(site, now);
  }

  // 기록을 남긴다.
  //
  // 일부러 await로 기다린다. 기다리지 않고 넘어가면 답장을 보낸 뒤
  // 서비스 워커가 잠들면서 전송이 중간에 끊길 수 있기 때문이다.
  // 대신 supabase.js에 3초 제한을 걸어둬서 오래 붙잡히지는 않는다.
  // 실패해도 판정 결과에는 아무 영향이 없다.
  const settings = await loadSettings(site);
  await logAttempt({
    client_id: await getRecordId(),
    passed: passed,
    prob: status.prob,
    roll: roll,
    elapsed_min: status.elapsedMin,
    used_today_min: status.usedTodayMin,
    curve: settings.curve
  });

  return { passed, roll, prob: status.prob, status: await buildStatus(site) };
}


// 시간을 고르고 나서. 차단을 풀고 알람을 맞춘다.
//
// allowOverLimit: 오늘의 찬스 전용. 남은 한도가 30분보다 적어도 30분을 열어준다.
//   (예: 10분 남았을 때 당첨 → 30분 열림, 오늘 사용 80분)
//   메시지(START_SESSION)로는 이 값을 넘길 수 없다. handleMessage가 minutes만 넘기므로,
//   콘솔에서 직접 보내도 한도를 넘길 수 없다.
async function startSession(site, minutes, allowOverLimit = false) {
  // 방금 이 사이트에서 통과한 사람만 연다. 통과권은 attempt()가 통과했을 때 발급한다.
  const ticketKey = passTicketKey(site);
  const ticket = await TEMP.get(ticketKey);
  if (!ticket[ticketKey]) {
    return { ok: false, error: '먼저 시도해서 통과해야 합니다' };
  }

  const state = await loadState(site);
  const settings = await loadSettings(site);
  const remainingMin = Math.max(settings.dailyLimit - state.usedTodayMin, 0);

  // 화면이 보낸 값을 그대로 믿지 않는다.
  // 예전에는 차단 화면이 정해진 버튼만 눌렀지만, 이제 사용자가 직접 숫자를
  // 정하므로 여기서 막아야 한다. 콘솔에서 직접 메시지를 보내는 것도 마찬가지다.
  const wanted = Math.floor(Number(minutes));

  if (!Number.isFinite(wanted) || wanted < 1) {
    return { ok: false, error: '이용 시간은 1분 이상이어야 합니다' };
  }
  if (wanted > remainingMin && !allowOverLimit) {
    return { ok: false, error: `남은 한도(${remainingMin}분)를 넘을 수 없습니다` };
  }

  // 서버에 넘길 한도. 찬스일 때는 찬스 시간만큼 넘는 걸 허락한다.
  // 서버(consume_minutes)는 '쓴 시간 + 이번 시간 ≤ 한도'만 검사하므로
  // 한도를 그만큼 늘려서 보내면 된다. SQL을 고칠 필요가 없다.
  const serverLimit = allowOverLimit
    ? settings.dailyLimit + CONFIG.chanceMinutes
    : settings.dailyLimit;

  // 공유가 켜져 있으면 서버에서 차감한다.
  //
  // 여기서 차감해야 하는 이유: 기기 A와 B가 거의 같이 시작하면 둘 다
  // 같은 사용량을 읽고 각자 더해 써서 한 쪽 차감이 사라진다.
  // DB 함수 안에서 잠그고 처리하면 그럴 틈이 없다.
  const rowId = await getSharedRowId(site);
  let newUsedMin = state.usedTodayMin + wanted;

  if (rowId) {
    const result = await consumeSharedMinutes(
      rowId, getTodayKey(), wanted, serverLimit
    );

    if (result.ok && result.data.ok === false) {
      // 서버가 거절했다 = 다른 기기가 이미 한도를 써버렸다.
      // 받아온 값으로 사본을 맞춰두면 화면이 바로 정확해진다.
      // 통과권은 남겨둔다. 시간을 줄여서 다시 시작할 수 있어야 하므로.
      await saveState(site, { usedTodayMin: Number(result.data.used_today_min) || 0 });
      await markSynced();
      return {
        ok: false,
        error: '다른 기기에서 한도를 이미 사용했습니다. 남은 시간을 다시 확인하세요'
      };
    }

    if (result.ok) {
      // 서버가 계산한 값을 쓴다. 서버가 진실이다.
      newUsedMin = Number(result.data.used_today_min) || newUsedMin;
      await markSynced();
    }
    // result.ok가 false면(인터넷 끊김 등) 로컬 계산으로 그냥 진행한다.
    // 인터넷 문제로 유튜브를 아예 못 쓰게 되는 게 더 나쁜 결과라서.
  }

  const now = Date.now();
  const endAt = now + wanted * 60000;

  await setAllowRule(site, true);

  await saveState(site, {
    sessionEndAt: endAt,
    // 사용량은 '끝날 때'가 아니라 '시작할 때' 미리 차감한다.
    // 도중에 브라우저를 꺼버려도 기록이 남게 하려는 것.
    usedTodayMin: newUsedMin
  });

  // 통과권은 한 번 쓰면 없앤다. 한 번 통과로 여러 번 열 수 없게.
  await TEMP.remove(ticketKey);

  // setTimeout 대신 alarms를 쓴다. 확장이 잠들어도 시간이 되면 깨워준다.
  chrome.alarms.create(SESSION_ALARM_PREFIX + site, { when: endAt });

  // 실제로 몇 분을 썼는지 기록한다. 실패해도 이용에는 영향이 없다.
  await logSession({
    client_id: await getRecordId(),
    minutes: wanted
  });

  return { ok: true, endAt };
}


// [찬스 쓰기]를 눌렀을 때. 하루 한 번, 기다린 시간과 상관없이 정해진 확률로 판정한다.
//
// 일반 시도와 다른 점:
//   - 확률이 곡선이 아니라 CONFIG.chanceProb로 고정
//   - 꽝이어도 기다린 시간(waitStartAt)을 건드리지 않는다
//   - 당첨되면 시간을 고르지 않고 바로 CONFIG.chanceMinutes만큼 연다
//
// 찬스도 사이트마다 하루 한 번이다 (사용자 결정, 2026-11-16).
async function useChance(site) {
  await pullShared(site);   // 다른 기기가 오늘 이 사이트의 찬스를 썼는지 먼저 확인한다
  const status = await buildStatus(site);

  if (!status.canChance) {
    const reason = status.chanceUsed ? '오늘은 찬스를 이미 썼습니다'
                 : status.inSession  ? '이용 중에는 쓸 수 없습니다'
                 :                     '오늘 한도를 다 썼습니다';
    return { ok: false, error: reason, status };
  }

  // 주사위를 굴리기 '전에' 쓴 걸로 적는다.
  // 굴린 뒤에 적으면, 꽝을 보고 적히기 전에 창을 닫아 다시 쓸 틈이 생긴다.
  const today = getTodayKey();
  const rowId = await getSharedRowId(site);

  if (rowId) {
    // 서버가 줄을 잠그고 확인한다. 두 기기가 거의 같이 눌러도 한 쪽만 된다
    const claim = await claimSharedChance(rowId, today);

    if (claim.ok && claim.data.ok === false) {
      await saveState(site, { chanceDay: today });
      return { ok: false, error: '다른 기기에서 오늘 찬스를 이미 썼습니다', status: await buildStatus(site) };
    }
    // claim.ok가 false면(인터넷 끊김 등) 로컬 기록만으로 진행한다. 다른 기능과 같은 방침
  }
  await saveState(site, { chanceDay: today });

  const { roll, passed } = rollDice(CONFIG.chanceProb);

  // 일반 시도와 같은 표에 남기되, curve를 'chance'로 적어 구분한다
  await logAttempt({
    client_id: await getRecordId(),
    passed: passed,
    prob: CONFIG.chanceProb,
    roll: roll,
    elapsed_min: status.elapsedMin,
    used_today_min: status.usedTodayMin,
    curve: 'chance'
  });

  if (!passed) {
    return { ok: true, passed: false, roll, prob: CONFIG.chanceProb, status: await buildStatus(site) };
  }

  // 당첨: 통과권을 주고 일반 통과와 같은 길(startSession)로 연다.
  // 한도 검사, 서버 차감, 알람, 기록을 새로 만들지 않고 그대로 쓰려는 것.
  await TEMP.set({ [passTicketKey(site)]: true });
  const session = await startSession(site, status.chanceMinutes, true);

  if (!session.ok) {
    // 그 사이 다른 기기가 한도를 써버린 경우 등. 시간을 고를 수 없는 찬스라 통과권은 거둔다
    await TEMP.remove(passTicketKey(site));
    return { ok: false, error: session.error, status: await buildStatus(site) };
  }

  return { ok: true, passed: true, roll, prob: CONFIG.chanceProb,
           minutes: status.chanceMinutes, endAt: session.endAt };
}


// 이 사이트의 이용 시간이 다 됐을 때. 다시 막고, 기준 시각을 지금으로 새로 잡는다.
// 다른 사이트는 건드리지 않는다.
async function endSession(site) {
  await setAllowRule(site, false);
  await chrome.alarms.clear(SESSION_ALARM_PREFIX + site);

  const now = Date.now();
  await saveState(site, {
    sessionEndAt: null,
    // 여기가 핵심. 이용이 끝난 이 시각부터 다시 확률이 0%에서 자란다.
    waitStartAt: now
  });

  // 다른 기기의 기준 시각도 같이 맞춘다
  await pushWaitStart(site, now);

  await reloadSiteTabs(site);
}


// ─────────────────────────────────────────────────────────────
// 차단 화면과 대화하기
// ─────────────────────────────────────────────────────────────

// blocked.js가 chrome.runtime.sendMessage로 보낸 요청을 여기서 받는다.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 처리 중에 오류가 나도 반드시 답장을 보낸다.
  // 답장을 안 보내면 화면 쪽은 영원히 기다리다가 버튼이 먹통이 된다.
  handleMessage(message, sender).then(sendResponse, (error) => {
    console.error('[background]', message.type, '처리 실패:', error);
    sendResponse({ ok: false, error: '처리하지 못했습니다: ' + error.message });
  });

  // true를 돌려줘야 "답장은 조금 뒤에 보낼게"라는 뜻이 된다.
  // 이걸 빼먹으면 답장이 안 간다.
  return true;
});


// 사이트(message.site)가 꼭 있어야 하는 요청들. 차단 화면이 보낸다.
const SITE_MESSAGES = ['GET_STATUS', 'ATTEMPT', 'SYNC_SHARED', 'START_SESSION', 'CHANCE', 'TEST_SET'];

async function handleMessage(message, sender) {
  // 차단 화면이 보낸 사이트가 목록에 있는지 먼저 본다. 없으면 아무것도 하지 않는다.
  const site = checkSite(message.site);
  if (SITE_MESSAGES.includes(message.type) && !site) {
    return { ok: false, error: '차단 목록에 없는 사이트입니다: ' + message.site };
  }

  // 설정 화면은 아직 사이트를 고르는 칸이 없다 (2단계에서 만든다).
  // 그동안은 사이트를 안 보내면 목록의 첫 번째 사이트 설정을 보여주고 고친다.
  const settingsSite = site || getBlockedSites()[0];

  switch (message.type) {
    case 'GET_STATUS':
      return await buildStatus(site);

    case 'ATTEMPT':
      return await attempt(site);

    // 차단 화면이 열릴 때와 2초마다. 다른 기기가 쓴 시간을 받아온다.
    // 1초마다 하는 갱신(GET_STATUS)은 여기를 거치지 않고 사본만 본다.
    case 'SYNC_SHARED': {
      const synced = await pullShared(site);
      return { ...synced, status: await buildStatus(site) };
    }

    // 사이트 위에 뜨는 타이머(timer.js)가 "언제 끝나요?"라고 물어볼 때.
    // 몇 초 전부터 빨갛게 할지도 같이 보낸다. timer.js는 사이트 페이지 안에서
    // 돌아서 config.js를 직접 읽을 수 없기 때문이다.
    //
    // timer.js는 사이트를 보내지 않는다. 그 탭의 주소로 어느 사이트인지 알아낸다.
    case 'GET_SESSION': {
      const tabSite = siteFromUrl(sender && sender.tab ? sender.tab.url : '');
      if (!tabSite) return { sessionEndAt: null, warnBeforeEndSec: CONFIG.warnBeforeEndSec };

      const state = await loadState(tabSite);
      return {
        sessionEndAt: state.sessionEndAt,
        warnBeforeEndSec: CONFIG.warnBeforeEndSec
      };
    }

    // 옵션 화면이 열릴 때. 현재 설정과 함께 허용 범위표도 같이 보낸다.
    // 범위를 옵션 화면에도 적어두면 언젠가 두 곳이 어긋나기 때문이다.
    case 'GET_SETTINGS':
      return {
        site: settingsSite,
        settings: await loadSettings(settingsSite),
        rules: SETTING_RULES,
        defaults: getDefaultSettings()
      };

    // 옵션 화면에서 [저장]을 눌렀을 때.
    // 성공하면 { ok: true, settings }, 실패하면 { ok: false, errors: [...] }
    case 'SET_SETTINGS':
      return await saveSettings(settingsSite, message.settings);

    // 옵션 화면의 통계 칸이 부른다.
    // 어느 이름표로 묶어 볼지는 getRecordId()가 정한다 (공유 코드 우선).
    case 'GET_STATS': {
      const recordId = await getRecordId();
      const result = await fetchStats(recordId, message.timeZone);
      return { ...result, recordId };
    }

    case 'START_SESSION':
      return await startSession(site, message.minutes);

    case 'CHANCE':
      return await useChance(site);

    // 테스트 칸. 꺼져 있으면 testSet이 거절한다
    case 'TEST_SET':
      return await testSet(site, {
        elapsedMin: message.elapsedMin,
        usedTodayMin: message.usedTodayMin
      });

    default:
      return { error: '알 수 없는 요청: ' + message.type };
  }
}


// ─────────────────────────────────────────────────────────────
// 알람 / 시작할 때 정리
// ─────────────────────────────────────────────────────────────

// 알람 이름에서 사이트를 떼어내 그 사이트만 끝낸다.
// 예: 'sessionEnd:naver.com' → endSession('naver.com')
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(SESSION_ALARM_PREFIX)) {
    endSession(alarm.name.slice(SESSION_ALARM_PREFIX.length));
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
  // 통과 규칙(1000~1999번)을 일단 전부 지운다.
  // 목록에서 빠진 사이트나, 순서가 바뀌어 번호가 달라진 규칙까지 정리하려는 것.
  // 이용 중인 사이트는 바로 아래에서 다시 세운다.
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const oldAllowIds = existing
    .map(rule => rule.id)
    .filter(id => id >= ALLOW_RULE_ID_START && id < ALLOW_RULE_ID_END);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldAllowIds });

  for (const site of getBlockedSites()) {
    const state = await loadState(site);

    if (state.sessionEndAt === null) {
      // 이용 중이 아니었다 → 할 일 없음 (규칙은 위에서 이미 지웠다)
    } else if (Date.now() >= state.sessionEndAt) {
      // 이용 중이었는데 시간이 이미 지났다 → 지금 끝낸 걸로 처리
      await endSession(site);
    } else {
      // 아직 이용 중이다 → 통과 규칙과 알람을 다시 세운다.
      //
      // 규칙까지 다시 세우는 이유: 상태(sessionEndAt)는 sync로 프로필 간에
      // 공유되지만, 차단 해제 규칙은 프로필마다 따로 갖고 있다.
      // 이게 없으면 다른 프로필이 "이용 중"인 줄만 알고 사이트는 막혀 있게 된다.
      await setAllowRule(site, true);
      chrome.alarms.create(SESSION_ALARM_PREFIX + site, { when: state.sessionEndAt });
    }
  }
}


// 사이트별로 나누기 전 버전의 값을 OLD_VERSION_SITE(유튜브) 몫으로 옮긴다.
//
// 옛 버전은 'waitStartAt', 'settings' 같은 이름으로 하나씩만 저장했다.
// 그대로 두면 업데이트하는 순간 기다린 시간·오늘 쓴 시간·설정이 전부 처음으로 돌아간다.
// 옛 값이 남아 있을 때만 옮기고 지우므로, 몇 번 불려도 한 번만 일어난다.
async function migrateToPerSite() {
  const fields = Object.keys(DEFAULT_STATE);
  const old = await STORE.get([...fields, 'settings']);

  // 상태: 'waitStartAt' → 'youtube.com|waitStartAt'
  const oldFields = fields.filter(field => old[field] !== undefined);
  if (oldFields.length > 0) {
    const moved = {};
    for (const field of oldFields) {
      moved[stateKey(OLD_VERSION_SITE, field)] = old[field];
    }
    await STORE.set(moved);
    await STORE.remove(oldFields);
  }

  // 설정: 'settings' 한 덩어리 → 공유 코드는 'shareCode', 나머지는 'settings|youtube.com'
  if (old.settings) {
    await writeSettings(OLD_VERSION_SITE, { shareCode: '', ...old.settings });
    await STORE.remove('settings');
  }

  // 사이트 이름이 안 붙은 옛 통과권·알람. 남아 있으면 아무 데서도 안 쓰이므로 치운다.
  // (이용 중이었다면 reconcile이 사이트별 알람을 새로 만든다)
  await TEMP.remove('passTicket');
  await chrome.alarms.clear('sessionEnd');
}


// 설치·업데이트·확장 ↻ 때. 순서가 중요해서 한 함수 안에서 차례로 부른다.
//   1. 옛 값을 사이트별로 옮긴다 (이게 먼저여야 아래 단계가 옮긴 값을 본다)
//   2. 이제 안 쓰는 값을 치운다
//        cooldownUntil - 거부 후 대기를 없앴다
//        lastSyncAt    - 2초마다 바뀌어서 local로 옮겼다
//   3. 차단 규칙을 목록대로 다시 만든다. config.js를 고치고 ↻를 누르면 여기서 반영된다
//   4. 이용 중인 사이트의 통과 규칙·알람을 다시 세운다
chrome.runtime.onInstalled.addListener(async () => {
  await migrateToPerSite();
  await STORE.remove(['cooldownUntil', 'lastSyncAt']);
  await rebuildBlockRules();
  await reconcile();
});

// 브라우저를 켤 때. 동적 규칙은 남아 있지만 알람은 사라질 수 있어 다시 맞춘다.
chrome.runtime.onStartup.addListener(async () => {
  await rebuildBlockRules();
  await reconcile();
});
