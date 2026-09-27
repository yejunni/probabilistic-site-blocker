-- supabase/shared_state.sql
--
-- 여러 기기가 하루 한도와 기준 시각을 같이 쓰기 위한 표와 함수.
-- SQL Editor에 붙여넣고 Run. schema.sql을 먼저 실행해 두었어야 한다.


-- ─────────────────────────────────────────────────────────────
-- 공유 상태 표
--
-- 공유 코드 하나당 줄 하나. 그 코드를 쓰는 모든 기기가 이 줄을 본다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.shared_state (
  client_id      text primary key,        -- 공유 코드
  today_key      text not null,           -- '2026-09-27'. 날이 바뀌면 사용량 초기화
  used_today_min real not null default 0, -- 오늘 쓴 시간(분)
  wait_start_at  bigint,                  -- 확률 계산의 기준 시각(ms). 거부/종료 때 갱신
  updated_at     timestamptz not null default now()
);

-- 표를 직접 만지는 건 전부 막는다.
-- 아래 함수들만 security definer 로 접근한다.
alter table public.shared_state enable row level security;


-- ─────────────────────────────────────────────────────────────
-- 1) 읽어오기 — 차단 화면이 열릴 때 한 번
--
-- 줄이 없으면 만들고, 날짜가 바뀌었으면 사용량을 0으로 되돌린 뒤 돌려준다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sync_state(
  p_client_id text,
  p_today_key text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today text;
  v_used  real;
  v_wait  bigint;
begin
  insert into public.shared_state (client_id, today_key, used_today_min)
  values (p_client_id, p_today_key, 0)
  on conflict (client_id) do nothing;

  -- for update: 이 줄을 잠근다. 다른 요청은 끝날 때까지 기다린다
  select today_key, used_today_min, wait_start_at
    into v_today, v_used, v_wait
  from public.shared_state
  where client_id = p_client_id
  for update;

  if v_today is distinct from p_today_key then
    v_used := 0;
    update public.shared_state
      set today_key = p_today_key, used_today_min = 0, updated_at = now()
      where client_id = p_client_id;
  end if;

  return json_build_object(
    'used_today_min', v_used,
    'wait_start_at',  v_wait
  );
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 2) 시간 차감 — 유튜브를 열 때
--
-- 읽고·더하고·쓰기를 한 번에 처리한다. 이게 핵심이다.
--
-- 왜 함수로 하나:
--   기기 A와 B가 거의 같이 시작하면, 둘 다 "35분"을 읽고 각자 더해서 쓴다.
--   나중 것이 앞 것을 덮어써서 한 쪽의 차감이 통째로 사라진다.
--   DB 안에서 잠그고 처리하면 끼어들 틈이 없다.
--
-- 한도를 넘으면 ok:false 를 돌려주고 아무것도 바꾸지 않는다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.consume_minutes(
  p_client_id text,
  p_today_key text,
  p_minutes   int,
  p_limit     int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today text;
  v_used  real;
  v_wait  bigint;
begin
  insert into public.shared_state (client_id, today_key, used_today_min)
  values (p_client_id, p_today_key, 0)
  on conflict (client_id) do nothing;

  select today_key, used_today_min, wait_start_at
    into v_today, v_used, v_wait
  from public.shared_state
  where client_id = p_client_id
  for update;

  if v_today is distinct from p_today_key then
    v_used := 0;
  end if;

  if v_used + p_minutes > p_limit then
    return json_build_object(
      'ok', false,
      'reason', 'limit',
      'used_today_min', v_used,
      'wait_start_at',  v_wait
    );
  end if;

  update public.shared_state
    set today_key      = p_today_key,
        used_today_min = v_used + p_minutes,
        updated_at     = now()
    where client_id = p_client_id;

  return json_build_object(
    'ok', true,
    'used_today_min', v_used + p_minutes,
    'wait_start_at',  v_wait
  );
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 3) 기준 시각 갱신 — 거부당했을 때, 이용이 끝났을 때
--
-- 이걸 안 보내면 프로필을 바꿔서 거부당한 걸 없던 일로 만들 수 있다.
-- (A에서 80분 기다려 거부 → B는 여전히 80분 기다린 상태)
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_wait_start(
  p_client_id     text,
  p_today_key     text,
  p_wait_start_at bigint
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used real;
begin
  insert into public.shared_state (client_id, today_key, used_today_min, wait_start_at)
  values (p_client_id, p_today_key, 0, p_wait_start_at)
  on conflict (client_id) do update
    set wait_start_at = p_wait_start_at,
        updated_at    = now();

  select used_today_min into v_used
  from public.shared_state
  where client_id = p_client_id;

  return json_build_object(
    'used_today_min', v_used,
    'wait_start_at',  p_wait_start_at
  );
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 4) 사용량 직접 지정 — 테스트 전용
--
-- config.js의 devMode가 켜져 있을 때, 차단 화면 맨 아래 테스트 칸에서
-- "오늘 사용 N분으로 적용"을 누르면 이 함수가 불린다.
--
-- consume_minutes는 '더하기'만 하고 한도를 넘으면 거부하지만,
-- 테스트는 값을 통째로 바꿔치기해야 하므로 별도 함수로 뒀다.
-- devMode가 꺼진 실제 사용에서는 background.js가 이 요청 자체를 막아서
-- 호출되지 않는다. (다만 이 함수 자체는 anon 키만 있으면 부를 수 있어서,
-- 공유 코드를 아는 사람이 남의 사용량을 마음대로 바꿀 수 있다는 위험은
-- 남아 있다. shareCode 자체가 비밀번호가 아니라는 기존 방침과 같은 수준이다)
-- ─────────────────────────────────────────────────────────────
create or replace function public.dev_set_used_minutes(
  p_client_id     text,
  p_today_key     text,
  p_used_today_min real
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.shared_state (client_id, today_key, used_today_min)
  values (p_client_id, p_today_key, p_used_today_min)
  on conflict (client_id) do update
    set today_key      = p_today_key,
        used_today_min = p_used_today_min,
        updated_at     = now();

  return json_build_object('used_today_min', p_used_today_min);
end;
$$;


-- anon 키로는 이 함수들만 부를 수 있다. 표는 계속 막혀 있다.
revoke all on function public.sync_state(text, text)                    from public;
revoke all on function public.consume_minutes(text, text, int, int)     from public;
revoke all on function public.set_wait_start(text, text, bigint)        from public;
revoke all on function public.dev_set_used_minutes(text, text, real)    from public;

grant execute on function public.sync_state(text, text)                 to anon;
grant execute on function public.consume_minutes(text, text, int, int)  to anon;
grant execute on function public.set_wait_start(text, text, bigint)     to anon;
grant execute on function public.dev_set_used_minutes(text, text, real) to anon;
