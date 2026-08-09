-- 0004_cleanup.sql — M1 정리 판정: "방치된 링크" 판정 함수
--
-- ## 적용 방법
--
--   Supabase 대시보드 → SQL Editor → New query → 이 파일 **전체**를 붙여넣고 Run (1회).
--   `create or replace` 라 멱등하다 — 재실행해도 안전하다(아침 재적용·검증 반복 안전).
--
-- 정본은 이 파일이다. 검증용 service role 적용이 있었더라도 최종 형태는 여기에 맞춘다.
--
-- ## 무엇을 판정하나 (계획서 M1 절)
--
-- 정리 판정 셋 중 **③ 방치**만 DB 함수다:
--   ① 완전 동일 URL 중복 · ② 같은 도메인·다른 페이지 그룹 — 둘 다 bookmarks(공개)만 보고
--      host 추출이 lib/url.ts 의 hostOf 규칙을 그대로 써야 해서 lib/cleanup.ts 에서 판정한다.
--   ③ 방치 = **최근 N일 클릭 0 AND 등록 N일 경과, 고정(is_pinned) 제외** — 여기, 이 함수다.
--      N(retention_days)은 화면이 고르는 30·90·180·365 중 하나.
--
-- 경계: **등록 직후 링크는 방치가 아니다.** created_at 이 창(now - N일)보다 나중이면 제외된다.
--
-- ## 왜 security definer 인가 — clicks 는 비공개다
--
-- 방치 판정은 clicks 를 읽는다. clicks 원본은 익명에게 노출 금지다(0001·0002: clk_read 는
-- 관리자 전용, 공개 화면에는 합계 뷰만 준다). 이 함수는 **정의자(postgres) 권한**으로 clicks 를
-- 읽어 방치 목록만 돌려주므로, clicks 원본이 새지 않으면서 판정 결과만 나간다.
--
-- 익명 노출을 막는 두 겹:
--   ① 실행 권한을 authenticated 로만 준다(anon·public 회수). 익명 rpc 는 함수 본문에 닿지 못한다.
--   ② 본문 첫 줄에서 JWT 이메일이 관리자인지 확인한다 — 스스로 인증 사용자가 된 비관리자가
--      실행 권한을 갖더라도 데이터는 못 본다(앱 겹 getAdminSession 과 **같은 판정**의 2차 방어).
-- 앱 겹(lib/cleanup.ts 의 getAdminSession)까지 세 겹이며 서로를 대체하지 못한다 —
-- 앱을 우회한 REST rpc 는 게이트를 지나지 않고, 게이트만으로는 REST 직접 호출을 막지 못한다.
--
-- `security definer` 함수의 기본 방어로 `set search_path = public` 을 건다(호출자가 search_path 를
-- 바꿔 다른 스키마의 동명 객체를 끼워 넣는 것을 막는다. auth.jwt() 는 스키마를 명시해 그대로 해석된다).
--
-- ## 관리자 이메일이 여기 복사돼 있는 이유
--
-- 아래 이메일은 `lib/admin-config.ts` 의 `ADMIN_EMAIL`·`0002_admin_write_policy.sql` 의 정책
-- 술어와 **같아야 한다.** SQL 은 그 모듈을 import 할 수 없어 값이 복사돼 있다. 한쪽만 바꾸면
-- "관리자로 로그인해도 판정이 전부 거부된다"(또는 그 반대)가 된다. 0002 와 같은 규약이며,
-- `lower(...)` 로 접어 비교하는 것도 게이트(getAdminSession)와 판정 기준을 맞추기 위해서다.
--
-- ## bulk 클릭 포함 판단
--
-- 방치는 "아무도 안 쓴다"는 **실사용** 판정이다. bulk(한 번에 열기)로 열린 것도 실제로 열린
-- 것이므로 사용으로 센다 — 즉 **bulk 를 포함해 최근 N일 클릭이 0** 이어야 방치다. 그래서 아래
-- clicks 조회에는 bulk 여부를 거르는 조건이 없다(걸면 "bulk 는 사용이 아님" 이 되어 근거가 뒤집힌다).

create or replace function public.cleanup_abandoned(retention_days int)
returns table (
  id uuid,
  category_id uuid,
  title text,
  url text,
  created_at timestamptz,
  last_clicked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 2차 방어: definer 권한으로 clicks 를 읽으므로, 관리자 신원을 본문에서 다시 확인한다.
  if lower(coalesce((auth.jwt() ->> 'email'), '')) <> 'contact@itconnect.dev' then
    raise exception 'FORBIDDEN: 정리 판정은 관리자 전용입니다' using errcode = '42501';
  end if;

  -- 화면이 고르는 값(30·90·180·365)은 앱(lib/cleanup.ts)이 먼저 검증하지만, REST 직접 호출도
  -- 있으니 여기서도 방어한다. 창을 만들 수 없는 값(널·0 이하)은 거부한다.
  if retention_days is null or retention_days < 1 then
    raise exception 'INVALID: retention_days 는 1 이상의 정수여야 합니다' using errcode = '22023';
  end if;

  return query
  select
    b.id,
    b.category_id,
    b.title,
    b.url,
    b.created_at,
    -- 참고용 최근 사용 시점(없으면 한 번도 안 씀). 판정과 같은 이유로 bulk 도 포함해 최댓값을 본다.
    (select max(c.clicked_at) from clicks c where c.bookmark_id = b.id) as last_clicked_at
  from bookmarks b
  where b.is_pinned = false                                                   -- 고정 제외
    and b.created_at <= now() - make_interval(days => retention_days)         -- 등록 N일 경과(직후는 제외)
    and not exists (                                                          -- 최근 N일 클릭 0 (bulk 포함)
      select 1
      from clicks c
      where c.bookmark_id = b.id
        and c.clicked_at >= now() - make_interval(days => retention_days)
    )
  order by b.created_at asc, b.id asc;
end
$$;

-- 실행 권한은 authenticated(로그인한 관리자가 쿠키 클라이언트로 부른다)에게만 준다. 함수는 생성 시
-- public 에 execute 가 기본으로 붙으므로 먼저 회수한다. anon 은 그 public 을 통해 상속받을 뿐 직접
-- 부여가 없어 `WARNING: no privileges could be revoked` 가 날 수 있다 — 정상이다(직접 부여가 언젠가
-- 생겼을 때를 대비한 못이다). 익명 rpc 는 이 회수로 함수 본문에 닿지 못한다.
revoke execute on function public.cleanup_abandoned(int) from public;
revoke execute on function public.cleanup_abandoned(int) from anon;
grant  execute on function public.cleanup_abandoned(int) to authenticated;
