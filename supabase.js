// supabase.js
// 기록을 Supabase로 보내는 부분.
//
// background.js가 importScripts로 불러온다. secrets.js가 먼저 불려 있어야 한다.
// 여기서는 보내기만 한다. 무엇을 보낼지 정하는 건 background.js의 몫이다.
//
// 중요한 원칙: 기록을 못 보내도 확장은 그대로 돌아가야 한다.
// 인터넷이 끊겼다고 유튜브 차단이 풀리거나 판정이 멈추면 안 되기 때문이다.
// 그래서 이 파일의 함수들은 절대 예외를 밖으로 던지지 않는다.


// 응답이 없을 때 얼마나 기다릴지.
// 판정 버튼을 누른 뒤 이만큼은 늦어질 수 있으므로 짧게 잡는다.
const SUPABASE_TIMEOUT_MS = 3000;


// 주소를 쓸 수 있는 모양으로 다듬는다.
//
// Supabase 설정 화면에는 비슷한 주소가 여러 줄 있어서, 어느 것을 복사하느냐에
// 따라 뒤에 /rest/v1 이나 / 가 붙어 온다. 아래에서 /rest/v1/테이블이름을
// 직접 붙이므로, 그대로 두면 .../rest/v1/rest/v1/attempts 가 되어 404가 난다.
// 손으로 맞추게 하는 대신 여기서 떼어낸다.
function getBaseUrl() {
  return String(SUPABASE.url)
    .trim()
    .replace(/\/+$/, '')          // 끝에 붙은 / 제거
    .replace(/\/rest\/v1$/, '')   // 끝에 붙은 /rest/v1 제거
    .replace(/\/+$/, '');         // 그래도 남은 / 제거
}


// 키가 채워져 있는지 확인한다.
// secrets.js를 안 만들었거나 example 그대로 두면 기록을 건너뛴다.
function isSupabaseReady() {
  return typeof SUPABASE !== 'undefined'
      && typeof SUPABASE.url === 'string'
      && typeof SUPABASE.anonKey === 'string'
      && SUPABASE.url.startsWith('https://')
      && !SUPABASE.url.includes('여기에')
      && !SUPABASE.anonKey.includes('여기에');
}


// 표 하나에 줄 하나를 넣는다.
// 성공하든 실패하든 결과를 돌려주기만 하고, 오류를 던지지는 않는다.
async function insertRow(table, row) {
  if (!isSupabaseReady()) {
    return { ok: false, skipped: true };
  }

  // 네트워크가 멈춰 있어도 판정이 계속 기다리지 않도록 제한 시간을 건다
  const stopper = new AbortController();
  const timer = setTimeout(() => stopper.abort(), SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(`${getBaseUrl()}/rest/v1/${table}`, {
      method: 'POST',
      signal: stopper.signal,
      headers: {
        // Supabase REST는 이 두 개를 같이 본다
        'apikey': SUPABASE.anonKey,
        'Authorization': `Bearer ${SUPABASE.anonKey}`,
        'Content-Type': 'application/json',
        // 넣은 줄을 돌려받을 필요가 없으므로 응답을 비워달라고 한다.
        // (RLS에서 읽기를 막아뒀기 때문에 돌려받으려 하면 오히려 오류가 난다)
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`[supabase] ${table} 넣기 실패 (${response.status})`, detail);
      return { ok: false, status: response.status, detail };
    }

    return { ok: true };

  } catch (error) {
    // 인터넷 끊김, 시간 초과, 주소 오타 등이 여기로 온다
    const reason = (error.name === 'AbortError')
      ? `${SUPABASE_TIMEOUT_MS}ms 안에 응답이 없었습니다`
      : error.message;

    console.warn(`[supabase] ${table} 보내지 못했습니다:`, reason);
    return { ok: false, error: reason };

  } finally {
    clearTimeout(timer);
  }
}


// Supabase에 만들어둔 함수를 부른다.
//
// 표를 직접 읽는 게 아니라 함수를 부르는 이유는 supabase/stats.sql의 설명 참고.
// 요약하면, 로그인이 없어서 "자기 것만 읽게" 하는 규칙을 세울 수 없기 때문에
// 표는 막아두고 "이 코드의 요약만 달라"는 창구 하나만 열어둔 것이다.
async function callFunction(name, args) {
  if (!isSupabaseReady()) {
    return { ok: false, skipped: true };
  }

  const stopper = new AbortController();
  const timer = setTimeout(() => stopper.abort(), SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(`${getBaseUrl()}/rest/v1/rpc/${name}`, {
      method: 'POST',
      signal: stopper.signal,
      headers: {
        'apikey': SUPABASE.anonKey,
        'Authorization': `Bearer ${SUPABASE.anonKey}`,
        'Content-Type': 'application/json'
        // 여기서는 결과를 받아야 하므로 return=minimal 을 쓰지 않는다
      },
      body: JSON.stringify(args)
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`[supabase] ${name} 실패 (${response.status})`, detail);
      return { ok: false, status: response.status, detail };
    }

    return { ok: true, data: await response.json() };

  } catch (error) {
    const reason = (error.name === 'AbortError')
      ? `${SUPABASE_TIMEOUT_MS}ms 안에 응답이 없었습니다`
      : error.message;

    console.warn(`[supabase] ${name} 부르지 못했습니다:`, reason);
    return { ok: false, error: reason };

  } finally {
    clearTimeout(timer);
  }
}


// 통계를 가져온다.
// timeZone을 넘기는 이유: 서버는 UTC로 도는데 한국은 9시간 빠르다.
// 안 맞추면 밤 9시 이후 기록이 '내일' 것으로 잡힌다.
async function fetchStats(clientId, timeZone) {
  return callFunction('get_stats', {
    p_client_id: clientId,
    p_tz: timeZone || 'Asia/Seoul'
  });
}


// ─────────────────────────────────────────────────────────────
// 한도 공유
//
// 아래 셋은 공유 코드를 넣었을 때만 쓰인다.
// 호출 지점은 딱 네 군데뿐이다 — 차단 화면 열 때(읽기),
// 거부당했을 때, 유튜브 열 때, 시간이 끝났을 때(쓰기).
// 차단 화면이 1초마다 하는 갱신은 여기를 거치지 않는다.
// ─────────────────────────────────────────────────────────────

// 공유된 사용량과 기준 시각을 읽어온다. 차단 화면이 열릴 때 한 번.
async function pullSharedState(clientId, todayKey) {
  return callFunction('sync_state', {
    p_client_id: clientId,
    p_today_key: todayKey
  });
}


// 이용 시간을 차감한다. 읽고·더하고·쓰기를 DB가 한 번에 처리한다.
// 한도를 넘으면 data.ok 가 false로 오고 아무것도 바뀌지 않는다.
async function consumeSharedMinutes(clientId, todayKey, minutes, dailyLimit) {
  return callFunction('consume_minutes', {
    p_client_id: clientId,
    p_today_key: todayKey,
    p_minutes: minutes,
    p_limit: dailyLimit
  });
}


// 기준 시각을 알린다. 거부당했을 때와 이용이 끝났을 때.
async function pushSharedWaitStart(clientId, todayKey, waitStartAt) {
  return callFunction('set_wait_start', {
    p_client_id: clientId,
    p_today_key: todayKey,
    p_wait_start_at: waitStartAt
  });
}


// 설정(곡선, 하루 한도 등)을 서버에 올린다. 옵션 화면에서 [저장]을 누를 때.
// shareCode 필드는 빼고 보낸다. 그건 각 기기가 스스로 정하는 값이다.
async function setSharedSettings(clientId, todayKey, settings) {
  return callFunction('set_shared_settings', {
    p_client_id: clientId,
    p_today_key: todayKey,
    p_settings: settings
  });
}


// 테스트 전용. 오늘 사용량을 통째로 지정한다.
// consume_minutes는 '더하기'만 하고 한도를 넘으면 거부하므로,
// 테스트 칸에서 값을 통째로 바꿔치기하려면 이 함수가 따로 필요하다.
// devMode가 꺼져 있으면 background.js가 이 요청 자체를 막는다.
async function devSetSharedUsed(clientId, todayKey, minutes) {
  return callFunction('dev_set_used_minutes', {
    p_client_id: clientId,
    p_today_key: todayKey,
    p_used_today_min: minutes
  });
}


// [시도하기]를 누를 때마다 한 줄. 통과/거부 모두 남긴다.
async function logAttempt(row) {
  return insertRow('attempts', row);
}


// 실제로 유튜브를 열었을 때 한 줄.
async function logSession(row) {
  return insertRow('sessions', row);
}
