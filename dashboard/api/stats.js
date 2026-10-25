// dashboard/api/stats.js
// Vercel 서버 함수. 주소는 /api/stats
//
// 왜 브라우저에서 Supabase를 직접 부르지 않나:
//   대시보드 파일은 공개 GitHub 저장소에 올라간다. 키를 페이지에 적으면
//   저장소에 그대로 남는다. 이 파일은 Vercel 서버에서만 돌고,
//   키는 Vercel 환경변수에서 꺼내 쓰므로 저장소에도 브라우저에도 나오지 않는다.
//
// 하는 일은 확장의 supabase.js fetchStats()와 같다. get_stats(코드, 시간대)를 불러
// 숫자 요약만 돌려준다. 표를 통째로 읽는 권한은 여전히 없다.
//
// 사용 예: /api/stats?code=내공유코드&tz=Asia/Seoul


// 공유 코드 모양 검사. 확장의 shareCode 규칙과 같다 (영문·숫자·_·-, 4~40자).
// 이상한 값은 Supabase까지 보내지 않고 여기서 돌려보낸다.
const CODE_PATTERN = /^[A-Za-z0-9_-]{4,40}$/;

// Supabase 응답을 기다리는 최대 시간(ms). 확장의 networkTimeoutMs와 같은 값.
const TIMEOUT_MS = 3000;


// 시간대 이름이 진짜 있는 이름인지 확인한다. (예: 'Asia/Seoul')
// 없는 이름이면 Supabase가 오류를 내므로 미리 걸러서 서울로 바꾼다.
function safeTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch (e) {
    return 'Asia/Seoul';
  }
}


// 주소 뒤에 /rest/v1이나 /가 붙어 있어도 떼어낸다. (확장의 getBaseUrl과 같은 이유)
function getBaseUrl(url) {
  return url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
}


module.exports = async function handler(req, res) {
  // 통계는 계속 바뀌므로 Vercel이나 브라우저가 옛 결과를 저장해두지 않게 한다
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET만 받습니다' });
  }

  // Vercel 화면의 Environment Variables에 넣은 값.
  // 반드시 anon 키여야 한다. service_role 키는 RLS를 무시하므로 절대 넣지 말 것.
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // 환경변수를 안 넣었거나, 넣은 뒤 다시 배포(Redeploy)를 안 한 경우
    return res.status(500).json({ ok: false, error: '서버에 Supabase 설정이 없습니다' });
  }

  const code = String(req.query.code || '').trim();
  if (!CODE_PATTERN.test(code)) {
    return res.status(400).json({ ok: false, error: '공유 코드는 영문·숫자·_·- 로 4~40자입니다' });
  }

  const timeZone = safeTimeZone(String(req.query.tz || 'Asia/Seoul'));

  // 네트워크가 멈춰도 계속 기다리지 않도록 제한 시간을 건다
  const stopper = new AbortController();
  const timer = setTimeout(() => stopper.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${getBaseUrl(url)}/rest/v1/rpc/get_stats`, {
      method: 'POST',
      signal: stopper.signal,
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_client_id: code, p_tz: timeZone })
    });

    if (!response.ok) {
      // 자세한 오류는 Vercel 로그에만 남기고, 화면에는 짧게만 보낸다.
      // 오류 내용에 표 이름 같은 내부 정보가 섞일 수 있어서.
      console.error('[stats] get_stats 실패', response.status, await response.text());
      return res.status(502).json({ ok: false, error: '통계를 불러오지 못했습니다' });
    }

    return res.status(200).json({ ok: true, data: await response.json() });

  } catch (error) {
    const reason = (error.name === 'AbortError') ? '응답이 너무 늦습니다' : '연결하지 못했습니다';
    console.error('[stats]', reason, error.message);
    return res.status(504).json({ ok: false, error: reason });

  } finally {
    clearTimeout(timer);
  }
};
