-- supabase/stats.sql
--
-- 통계를 읽어오는 함수. SQL Editor에 붙여넣고 Run 하면 된다.
-- schema.sql을 먼저 실행해 두었어야 한다.
--
--
-- 왜 표를 직접 읽지 않고 함수를 만드나
--
--   확장 프로그램에는 로그인이 없다. 그래서 DB 입장에서는 요청을 보낸 사람이
--   누구인지 알 방법이 없고, "자기 기록만 읽게" 하는 규칙을 세울 수가 없다.
--   표에 읽기 권한을 열어버리면 키를 가진 누구나 전체 기록을 훑을 수 있다.
--
--   그래서 표는 계속 막아두고, "이 코드의 요약만 달라"는 창구 하나만 연다.
--   아래 함수는 숫자만 돌려주므로 원본 줄을 가져갈 수 없고,
--   코드를 모르면 아무것도 못 본다.
--
--   완벽한 인증은 아니다. 코드를 아는 사람은 그 묶음의 통계를 볼 수 있다.
--   그래서 설정 화면에 "추측하기 어려운 코드를 쓰라"고 적어두었다.
--
--
-- security definer 가 무슨 뜻인가
--
--   보통 함수는 '부른 사람의 권한'으로 실행된다. 그러면 anon 권한으로는
--   표를 못 읽으니 함수도 아무것도 못 읽는다.
--   security definer 를 붙이면 '함수를 만든 사람의 권한'으로 실행되어
--   표를 읽을 수 있다. 대신 함수가 무엇을 돌려주는지 직접 통제해야 한다.


create or replace function public.get_stats(
  p_client_id text,
  p_tz        text default 'Asia/Seoul'
)
returns json
language sql
security definer
set search_path = public
as $$
  with
  -- 사용자의 시간대 기준 '오늘' 날짜.
  -- 서버는 UTC로 도는데 한국은 9시간 빠르다. 이걸 안 맞추면
  -- 밤 9시 이후의 기록이 '내일' 것으로 잡힌다.
  today_date as (
    select (now() at time zone p_tz)::date as d
  ),

  -- 시도 기록을 날짜별로 정리
  att as (
    select (created_at at time zone p_tz)::date as d, passed
    from public.attempts
    where client_id = p_client_id
  ),

  -- 이용 기록을 날짜별로 정리
  ses as (
    select (created_at at time zone p_tz)::date as d, minutes
    from public.sessions
    where client_id = p_client_id
  ),

  -- 최근 7일. 기록이 없는 날도 0으로 나와야 하므로 날짜를 먼저 만들어 둔다
  last7 as (
    select generate_series(
             (select d from today_date) - 6,
             (select d from today_date),
             interval '1 day'
           )::date as d
  )

  select json_build_object(
    'tz', p_tz,

    'today', json_build_object(
      'attempts', (select count(*) from att where att.d = (select d from today_date)),
      'passed',   (select count(*) from att where att.d = (select d from today_date) and att.passed),
      'minutes',  coalesce((select sum(minutes) from ses where ses.d = (select d from today_date)), 0)
    ),

    'week', json_build_object(
      'attempts', (select count(*) from att where att.d >= (select d from today_date) - 6),
      'passed',   (select count(*) from att where att.d >= (select d from today_date) - 6 and att.passed),
      'minutes',  coalesce((select sum(minutes) from ses where ses.d >= (select d from today_date) - 6), 0)
    ),

    'total', json_build_object(
      'attempts', (select count(*) from att),
      'passed',   (select count(*) from att where att.passed),
      'minutes',  coalesce((select sum(minutes) from ses), 0)
    ),

    -- 최근 7일을 하루씩. 기록 없는 날은 0
    'daily', (
      select coalesce(
        json_agg(
          json_build_object(
            'day',      to_char(last7.d, 'MM-DD'),
            'attempts', (select count(*) from att where att.d = last7.d),
            'passed',   (select count(*) from att where att.d = last7.d and att.passed),
            'minutes',  coalesce((select sum(minutes) from ses where ses.d = last7.d), 0)
          )
          order by last7.d
        ),
        '[]'::json
      )
      from last7
    )
  );
$$;


-- 이 함수만 anon 키로 부를 수 있게 한다.
-- 표에 대한 읽기 권한은 계속 막혀 있다.
revoke all on function public.get_stats(text, text) from public;
grant execute on function public.get_stats(text, text) to anon;
