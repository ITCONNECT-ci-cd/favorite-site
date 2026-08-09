-- 0003_stats.sql — 관리자 전용 통계 집계 SQL 계층 (K1)
--
-- ⚠️ 상태: **아직 적용되지 않았다.** 아래 '적용 방법'대로 사람이 직접 실행해야 한다.
--    저장소에 파일이 있다는 사실만으로는 DB 가 바뀌지 않는다.
--
-- ## 무엇인가
--
-- DESIGN_SPEC 6장(통계) 화면(K2)이 소비하는 집계 함수 다섯 개 + 관리자 게이트 하나.
--   ① admin_stats_kpi()             — 누적 클릭 · 오늘 클릭 · 미사용 링크 수
--   ② admin_stats_daily(days)       — 일별 추이(빈 날도 0 으로 채운 연속 구간)
--   ③ admin_stats_top_links(n,excl) — 링크 순위(고유 방문자 기준 + 참고용 총클릭, bulk 제외 옵션)
--   ④ admin_stats_by_category()     — 상위 카테고리별 클릭 합계(하위·직속 롤업)
--   ⑤ admin_stats_recent(n)         — 최근 클릭 n 건(활동 로그)
-- 앱 쪽 소비는 `lib/stats.ts` 의 타입 래퍼가 rpc 로 부른다.
--
-- ## 적용 방법
--
--   Supabase 대시보드 → SQL Editor → New query → 이 파일 **전체**를 붙여넣고 Run (1회).
--   `create or replace` 라 재실행해도 안전하다(아침 전체 마이그레이션 재확인 시 그대로 다시 돌린다).
--
-- ## 보안 모델 — 왜 이렇게까지 하는가
--
-- 이 함수들은 clicks 원본(visitor_hash 포함)을 다룬다. 익명·비관리자에게 **절대** 노출되면 안 된다.
-- 방어는 삼중이고 서로를 대체하지 않는다:
--
--   1) **grant 겹** — 각 함수 실행 권한을 `authenticated` 에게만 준다(`public`·`anon` revoke).
--      anon 키로 부르면 함수를 찾지 못하거나(42501) 권한이 없어 거부된다.
--   2) **함수 겹** — 각 함수 첫머리에서 `assert_admin_stats()` 가 호출자 JWT 의 email 이
--      관리자(`contact@itconnect.dev`)인지 확인하고, 아니면 `42501` 예외를 던진다.
--      **security definer 라 소유자 권한으로 돌아 RLS 를 우회하므로, 이 자기 확인이 최종 방어다.**
--      이 겹은 0002 마이그레이션 적용 여부와 무관하게 성립한다 — 함수가 스스로 신원을 본다.
--   3) **앱 겹** — `lib/stats.ts` 가 rpc 전에 `getAdminSession()` 으로 한 번 더 거른다.
--
-- 여기에 더해 각 definer 함수는 `set search_path = public, pg_temp` 로 검색 경로를 고정한다.
-- `pg_temp` 를 **맨 끝**에 두는 게 핵심이다: 세션 소유자가 `pg_temp.clicks` 같은 임시 테이블을
-- 만들어 관계 검색을 가로채(temp table shadowing) definer 함수가 그걸 보게 하는 걸 막는다 —
-- pg_temp 가 마지막이라 실제 `public.clicks` 가 항상 먼저 잡힌다(defense-in-depth, 삼중 겹과 별개).
--
-- visitor_hash 원본은 어떤 함수도 반환하지 않는다 — 순위는 `count(distinct visitor_hash)`(수)만
-- 돌려주고 해시 값 자체는 결과 밖으로 나가지 않는다.
--
-- ## bulk 집계 규칙 (G4 품질 리뷰 확정)
--
-- 카드 표시용 `bookmark_click_counts` 뷰는 bulk **포함**(PRD 절대값 참고용 — 수용). 반면 이
-- 통계·순위는 **is_bulk 를 제외**한다 — '한 번에 열기'의 bulk 기록은 팝업 차단된 탭까지 포함될 수
-- 있는 best-effort 라(noopener 로 연 창은 감지 불가) 신뢰도가 낮다. 순위(③)만 포함 여부를
-- 인자로 열어 두고, 나머지는 항상 제외한다.
--
-- ## 시간대
--
-- '오늘'·일별 경계는 **Asia/Seoul** 로 계산한다(clicked_at 은 timestamptz). UTC 로 자르면
-- 한국 자정~오전 9시 클릭이 전날로 밀린다.

-- 아래 관리자 이메일은 `lib/admin-config.ts` 의 `ADMIN_EMAIL`·`0002_admin_write_policy.sql` 의
-- 정책 술어와 **같아야 한다.** SQL 은 그 모듈을 import 할 수 없어 값이 복사돼 있다.
-- 한쪽만 바꾸면 "로그인은 되는데 통계가 전부 거부된다"가 된다.
--
-- `lower(...)` 로 감싸는 이유: 앱 게이트(getAdminSession)·0002 정책이 이메일을 대소문자 무시로
-- 비교한다. 여기만 exact `=` 로 두면 판정 기준이 어긋난다. 세 겹의 기준을 같게 맞춘다.

-- ── 관리자 게이트 ──────────────────────────────────────────────────────────
-- 각 통계 함수가 첫 줄에서 부른다. 관리자가 아니면 던져 함수 본문이 실행되지 않는다.
-- 소유자만 실행(내부 호출 전용) — definer 함수가 소유자 권한으로 부르므로 grant 가 필요 없다.
-- public 에 붙는 기본 execute 를 걷어 외부에서 직접 부를 수 없게 한다.
create or replace function public.assert_admin_stats() returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'contact@itconnect.dev' then
    raise exception '통계는 관리자 전용입니다' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.assert_admin_stats() from public;
revoke execute on function public.assert_admin_stats() from anon;
revoke execute on function public.assert_admin_stats() from authenticated;

-- ── ① KPI ──────────────────────────────────────────────────────────────────
-- 누적 클릭(bulk 제외 총합) · 오늘(Asia/Seoul) 클릭 · 한 번도(일반 클릭으로) 안 눌린 링크 수.
create or replace function public.admin_stats_kpi()
returns table (total_clicks int, today_clicks int, unused_links int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin_stats();

  return query
  select
    (select count(*) from clicks where not coalesce(is_bulk, false))::int,
    (select count(*) from clicks
       where not coalesce(is_bulk, false)
         and (clicked_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)::int,
    (select count(*) from bookmarks b
       where not exists (
         select 1 from clicks c
          where c.bookmark_id = b.id and not coalesce(c.is_bulk, false)
       ))::int;
end;
$$;
revoke execute on function public.admin_stats_kpi() from public;
revoke execute on function public.admin_stats_kpi() from anon;
grant  execute on function public.admin_stats_kpi() to authenticated;

-- ── ② 일별 추이 ────────────────────────────────────────────────────────────
-- 최근 `days` 일(오늘 포함)의 일별 bulk 제외 클릭 수. 클릭이 없는 날도 0 행으로 채워
-- K2 가 빈 자리 없이 막대를 그릴 수 있게 한다. days 는 14·30·90·180·365 로 제한한다 —
-- 래퍼(lib/stats.ts)와 함수 본문이 둘 다 화이트리스트로 막는다(rpc 직접 호출 방어).
create or replace function public.admin_stats_daily(days int)
returns table (day date, clicks int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform public.assert_admin_stats();

  -- days 화이트리스트 이중화(defense-in-depth): 앱은 lib/stats.ts 의 STATS_PERIODS 로 이미
  -- 막지만, rpc 를 직접 부르면 임의 값이 들어와 거대한 generate_series 를 돌릴 수 있다.
  -- 여기 값 5종은 STATS_PERIODS(14·30·90·180·365)와 반드시 같아야 한다 — 한쪽만 바꾸면 어긋난다.
  if days not in (14, 30, 90, 180, 365) then
    raise exception '허용되지 않은 기간입니다: %', days using errcode = '22023';
  end if;

  return query
  with span as (
    -- generate_series 인자를 명시적으로 timestamp 로 캐스팅한다 — date 로 주면
    -- timestamp/timestamptz 오버로드가 모호해질 수 있다. gs::date 로 다시 날짜만 남긴다.
    select gs::date as day
    from generate_series(
      ((now() at time zone 'Asia/Seoul')::date - (days - 1))::timestamp,
      ((now() at time zone 'Asia/Seoul')::date)::timestamp,
      interval '1 day'
    ) as gs
  ),
  daily as (
    select (clicked_at at time zone 'Asia/Seoul')::date as day, count(*)::int as clicks
    from clicks
    where not coalesce(is_bulk, false)
      and (clicked_at at time zone 'Asia/Seoul')::date
            >= (now() at time zone 'Asia/Seoul')::date - (days - 1)
    group by 1
  )
  select s.day, coalesce(d.clicks, 0)::int
  from span s
  left join daily d on d.day = s.day
  order by s.day;
end;
$$;
revoke execute on function public.admin_stats_daily(int) from public;
revoke execute on function public.admin_stats_daily(int) from anon;
grant  execute on function public.admin_stats_daily(int) to authenticated;

-- ── ③ 링크 순위 ────────────────────────────────────────────────────────────
-- 정렬 기준은 **고유 방문자 수**(count distinct visitor_hash), total_clicks 는 참고용.
-- exclude_bulk=true(기본)면 bulk 클릭을 두 수 모두에서 뺀다. visitor_hash 값 자체는 반환하지 않는다.
-- 클릭이 하나라도 있는 링크만 나온다(clicks 를 join 의 기준으로 두었다).
create or replace function public.admin_stats_top_links(limit_n int default 12, exclude_bulk boolean default true)
returns table (
  bookmark_id uuid,
  title text,
  url text,
  favicon_url text,
  category_id uuid,
  category_name text,
  unique_visitors int,
  total_clicks int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform public.assert_admin_stats();

  return query
  select
    b.id,
    b.title,
    b.url,
    b.favicon_url,
    b.category_id,
    c.name,
    count(distinct cl.visitor_hash)::int as unique_visitors,
    count(*)::int as total_clicks
  from clicks cl
  join bookmarks b on b.id = cl.bookmark_id
  left join categories c on c.id = b.category_id
  where (not exclude_bulk) or (not coalesce(cl.is_bulk, false))
  group by b.id, b.title, b.url, b.favicon_url, b.category_id, c.name
  order by unique_visitors desc, total_clicks desc, b.title asc
  limit limit_n;
end;
$$;
revoke execute on function public.admin_stats_top_links(int, boolean) from public;
revoke execute on function public.admin_stats_top_links(int, boolean) from anon;
grant  execute on function public.admin_stats_top_links(int, boolean) to authenticated;

-- ── ④ 카테고리별 합계 ──────────────────────────────────────────────────────
-- 상위 카테고리(parent_id is null) 한 개당 한 행. 값은 그 아래 모든 하위·직속 링크의
-- bulk 제외 클릭 합(사이드바 숫자와 같은 롤업 방식). 상위는 클릭이 0 이어도 한 행으로 남는다.
-- category_id 가 null 이거나 없는 카테고리를 가리키는 링크의 클릭은 어디에도 세지 않는다
-- (화면에 그릴 자리가 없다 — lib/queries 의 rollupCounts 규칙과 같다).
create or replace function public.admin_stats_by_category()
returns table (category_id uuid, category_name text, clicks int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform public.assert_admin_stats();

  return query
  with recursive ancestry as (
    -- 각 카테고리를 자기 자신에서 출발시켜 parent 를 따라 위로 올린다.
    select c.id as cat_id, c.id as node_id, c.parent_id
    from categories c
    union all
    select a.cat_id, p.id, p.parent_id
    from ancestry a
    join categories p on p.id = a.parent_id
  )
  -- 사이클 가드(defense-in-depth): 0001 스키마엔 A.parent=B, B.parent=A 같은 순환을
  -- 막는 CHECK 가 없어 관리자 UPDATE 로 만들 수 있다. 그 경로가 생기면 위 재귀가 같은
  -- node_id 를 무한히 되짚어 함수가 hang 한다. PG14+ CYCLE 절이 이미 지나온 node_id 를
  -- 만나면(경로별로) 그 가지의 확장을 멈춘다 — is_cycle/path 두 컬럼은 추가되지만 아래
  -- root_of 는 컬럼을 명시 선택하므로 결과는 그대로다. 순환뿐인 카테고리는 parent_id 가
  -- null 인 조상이 없어 root_of 에서 자연히 빠진다(그 클릭은 어디에도 세지 않는다 — 고아 규칙).
  cycle node_id set is_cycle using path,
  root_of as (
    -- parent_id 가 null 이 되는 지점이 그 카테고리의 최상위 조상이다.
    select cat_id, node_id as root_id from ancestry where parent_id is null
  ),
  counts as (
    select ro.root_id, count(*)::int as clicks
    from clicks cl
    join bookmarks b on b.id = cl.bookmark_id
    join root_of ro on ro.cat_id = b.category_id
    where not coalesce(cl.is_bulk, false)
    group by ro.root_id
  )
  select t.id, t.name, coalesce(cn.clicks, 0)::int
  from categories t
  left join counts cn on cn.root_id = t.id
  where t.parent_id is null
  order by coalesce(cn.clicks, 0) desc, t.name asc;
end;
$$;
revoke execute on function public.admin_stats_by_category() from public;
revoke execute on function public.admin_stats_by_category() from anon;
grant  execute on function public.admin_stats_by_category() to authenticated;

-- ── ⑤ 최근 클릭 ────────────────────────────────────────────────────────────
-- bulk 제외 최근 클릭 n 건(활동 로그). visitor_hash 는 반환하지 않는다. bookmark 이 없는(끊긴)
-- 클릭은 join 에서 빠진다. 같은 시각 동점은 id 내림차순으로 안정 정렬한다.
create or replace function public.admin_stats_recent(limit_n int default 14)
returns table (id bigint, bookmark_id uuid, title text, url text, favicon_url text, clicked_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  perform public.assert_admin_stats();

  return query
  select cl.id, b.id, b.title, b.url, b.favicon_url, cl.clicked_at
  from clicks cl
  join bookmarks b on b.id = cl.bookmark_id
  where not coalesce(cl.is_bulk, false)
  order by cl.clicked_at desc, cl.id desc
  limit limit_n;
end;
$$;
revoke execute on function public.admin_stats_recent(int) from public;
revoke execute on function public.admin_stats_recent(int) from anon;
grant  execute on function public.admin_stats_recent(int) to authenticated;
