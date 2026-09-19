-- supabase/schema.sql
--
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하면 된다.
-- 여러 번 실행해도 괜찮도록 "이미 있으면 넘어가기(if not exists)"를 붙여뒀다.


-- ─────────────────────────────────────────────────────────────
-- 1) 시도 기록
--    [시도하기]를 누를 때마다 한 줄씩 쌓인다. 통과/거부 모두 남긴다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.attempts (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),

  -- 누가 보낸 기록인지 구분하는 값.
  -- 로그인이 없으므로 확장이 처음 켜질 때 만든 임의의 id를 쓴다.
  client_id       text        not null,

  passed          boolean     not null,   -- 통과했는지
  prob            real        not null,   -- 그때의 통과 확률(%)
  roll            real        not null,   -- 뽑은 난수(0~100). prob보다 작으면 통과
  elapsed_min     real        not null,   -- 얼마나 기다렸는지(분)
  used_today_min  real        not null,   -- 그 시점까지 오늘 쓴 시간(분)
  curve           text                    -- 그때 쓰던 곡선 종류
);

-- 날짜별로 모아 볼 일이 많으므로 시간순 색인을 둔다
create index if not exists attempts_created_at_idx
  on public.attempts (created_at desc);


-- ─────────────────────────────────────────────────────────────
-- 2) 이용 기록
--    통과한 뒤 실제로 시간을 골라 유튜브를 열었을 때 한 줄씩 쌓인다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  client_id   text        not null,
  minutes     int         not null   -- 고른 이용 시간(분)
);

create index if not exists sessions_created_at_idx
  on public.sessions (created_at desc);


-- ─────────────────────────────────────────────────────────────
-- 3) 접근 권한 (RLS)
--
-- 확장 프로그램은 사용자 PC에서 도는 코드라 키를 숨길 방법이 없다.
-- 누구나 확장 파일을 열어 anon 키를 꺼낼 수 있다.
-- 그래서 "키를 가진 사람이 무엇을 할 수 있는지"를 여기서 좁혀 둔다.
--
-- 지금 허용하는 것: 넣기(insert) 하나뿐.
-- 읽기/수정/삭제는 전부 막혀 있어서, 키가 유출돼도 남의 기록을 보거나
-- 지울 수 없다. (Supabase 대시보드에서 보는 건 별개의 권한이라 잘 된다)
--
-- 나중에 웹 대시보드를 만들 때 읽기 권한이 필요해지는데,
-- 그때는 client_id로 자기 기록만 보게 하는 방식을 따로 정한다.
-- ─────────────────────────────────────────────────────────────
alter table public.attempts enable row level security;
alter table public.sessions enable row level security;

drop policy if exists "anon can insert attempts" on public.attempts;
create policy "anon can insert attempts"
  on public.attempts
  for insert
  to anon
  with check (true);

drop policy if exists "anon can insert sessions" on public.sessions;
create policy "anon can insert sessions"
  on public.sessions
  for insert
  to anon
  with check (true);
