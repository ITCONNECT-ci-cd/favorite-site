-- 0002_admin_write_policy.sql — 쓰기 RLS 를 "인증됨"에서 "그 관리자임"으로 좁힌다
--
-- ⚠️ 상태: **아직 적용되지 않았다.** 아래 '적용 방법'대로 사람이 직접 실행해야 한다.
--    이 파일이 저장소에 있다는 사실만으로는 DB 가 바뀌지 않는다.
--
-- ## 왜 필요한가
--
-- 0001 의 쓰기 정책은 술어가 `to authenticated using (true)` 다 — **아무 인증 사용자나**
-- categories·bookmarks 전체를 쓰고 clicks 원본을 읽는다. 그런데
--
--   1) anon 키는 브라우저에 실려 나가는 공개 값이고,
--   2) Supabase 프로젝트에 public signup 이 켜져 있으면(기본값) 누구나
--      `POST /auth/v1/signup` 으로 스스로 "인증 사용자"가 될 수 있다.
--
-- 즉 이 두 가지가 겹치면 아무나 REST 로 붙어 전체 데이터를 지울 수 있다. 앱의 세션 게이트
-- (`lib/supabase/server.ts` 의 `getAdminSession`)도 같은 술어("인증됨")를 쓰고 있었으므로,
-- 게이트와 RLS 는 이중 방어가 아니라 사실상 같은 문 하나였다.
--
-- 이 마이그레이션은 그중 **DB 겹**을 관리자 신원으로 좁힌다. 나머지 두 겹은 이렇다:
--
--   - **앱 겹** — `getAdminSession()` 이 이메일까지 확인한다. 같은 커밋에서 이미 반영됐다.
--   - **설정 겹** — 대시보드에서 signup 자체를 끈다(아래 '함께 해야 하는 일').
--
-- 세 겹은 서로를 대체하지 못한다. 앱을 우회한 REST 호출은 게이트를 지나지 않고,
-- RLS 는 화면 노출을 막지 못하며, 설정은 이미 만들어진 계정을 지우지 않는다.
--
-- ## 적용 방법
--
--   Supabase 대시보드 → SQL Editor → New query → 이 파일 **전체**를 붙여넣고 Run (1회).
--
--   ⚠️ 정책 세 개만 복사하지 말고 **파일 끝의 `admin_policy_summary()` 함수까지** 실행할 것.
--      그 함수가 없으면 verify-schema 의 검사 ⑧ 이 "0002 미적용" 으로 실패한다.
--
-- 0001 은 이미 적용된 마이그레이션이라 손대지 않는다 — 여기서 정책만 갈아 끼운다.
-- 재실행해도 안전하다(`drop policy if exists` 뒤 재생성, 함수는 `create or replace`).
--
-- ## 함께 해야 하는 일 (SQL 로는 못 한다)
--
--   Supabase 대시보드 → Authentication → Sign In / Up → "Allow new users to sign up" 끄기.
--   `npx tsx scripts/verify-schema.ts` 의 검사 ⑦ 이 이 설정을 확인한다(끄기 전에는 실패한다).
--
-- ## 적용 확인
--
--   `npx tsx scripts/verify-schema.ts` 의 **검사 ⑧** 이 자동으로 확인한다 — 아래 함수를 통해
--   세 정책의 술어를 읽어 관리자 이메일 비교가 들어 있는지 본다. 눈으로 볼 일은 없다.
--
--   손으로 보고 싶다면(대시보드 SQL Editor):
--
--     select policyname, cmd, roles, qual::text, with_check::text
--       from pg_policies
--      where schemaname = 'public'
--        and policyname in ('cat_write', 'bm_write', 'clk_read')
--      order by policyname;
--
--   세 행의 qual 이 `lower((select auth.jwt() ->> 'email')) = '…'` 이면 적용된 것이다
--   (`true` 면 아직이다).
--
-- 적용 뒤 `npx tsx scripts/verify-schema.ts` 를 다시 돌려 ①~⑥ 이 그대로 통과하는지도 본다.
-- 그 검사들은 anon 과 service role 만 쓰므로 이 변경의 영향을 받지 않아야 한다 —
-- 하나라도 깨지면 정책을 잘못 옮겨 적은 것이다.

-- 아래 이메일은 `lib/admin-config.ts` 의 `ADMIN_EMAIL` 과 **같아야 한다.**
-- SQL 은 그 모듈을 import 할 수 없어 값이 복사돼 있다. 한쪽만 바꾸면 "로그인은 되는데
-- 저장이 전부 실패한다"(또는 그 반대)가 된다.
--
-- `(select auth.jwt() ->> 'email')` 로 감싸는 이유: 서브쿼리로 감싸면 플래너가 이 식을
-- 행마다가 아니라 문장당 한 번만 평가한다(initplan). 감싸지 않으면 대량 update·delete 에서
-- 행 수만큼 JWT 를 파싱한다 — Supabase 가 RLS 성능 문서에서 권하는 관용구다.
--
-- `lower(...)` 로 감싸는 이유: 앱 겹의 게이트(`getAdminSession()`)가 이메일을 **대소문자
-- 무시**로 비교한다. 여기만 exact `=` 로 두면 `Contact@…` 로 발급된 JWT 가 게이트는 지나고
-- RLS 에서만 막혀, 화면은 열리는데 저장이 전부 실패하는 비대칭이 생긴다. 두 겹의 판정 기준을
-- 같게 맞춘다. 비교 대상 리터럴은 이미 소문자다(`lib/admin-config.ts` 의 값과 같아야 한다).
--
-- service role 키는 RLS 자체를 우회하므로 이 정책의 영향을 받지 않는다.
-- `/api/click` 의 기록과 시드·파비콘 스크립트는 그대로 돈다.

drop policy if exists cat_write on categories;
create policy cat_write on categories for all to authenticated
  using      (lower((select auth.jwt() ->> 'email')) = 'contact@itconnect.dev')
  with check (lower((select auth.jwt() ->> 'email')) = 'contact@itconnect.dev');

drop policy if exists bm_write on bookmarks;
create policy bm_write on bookmarks for all to authenticated
  using      (lower((select auth.jwt() ->> 'email')) = 'contact@itconnect.dev')
  with check (lower((select auth.jwt() ->> 'email')) = 'contact@itconnect.dev');

-- clicks 에는 읽기 정책만 있다(기록은 service role 전용 — 0001 마지막 줄 주석 참조).
-- select 정책이라 with check 는 쓰지 않는다.
drop policy if exists clk_read on clicks;
create policy clk_read on clicks for select to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'contact@itconnect.dev');

-- 읽기 정책(cat_read·bm_read)은 건드리지 않는다. 공개 대시보드가 익명으로 읽어야 한다.


-- ## 적용 여부를 기계가 확인할 수 있게 하는 함수
--
-- 위 정책들은 **DB 안에만** 존재한다. 파일이 저장소에 있다는 사실은 아무것도 증명하지 못하고,
-- 정책 술어가 `true` 든 관리자 이메일이든 앱의 다른 검사(①~⑥)는 똑같이 통과한다. 그래서
-- "0002 를 실행했는가"는 지금까지 사람 눈으로만 확인할 수 있었다 — 잊으면 조용히 뚫린 채로 간다.
--
-- 이 함수가 그 틈을 메운다. `scripts/verify-schema.ts` 의 검사 ⑧ 이 service role 로 호출해
-- 세 정책의 술어를 읽고, 관리자 이메일 비교가 실제로 들어 있는지 단언한다.
-- **함수가 없으면 그 자체가 "0002 미적용" 신호다** — 검사 ⑧ 이 그렇게 보고한다.
--
-- security definer 인 이유: `pg_policies` 는 pg_catalog 에 있어 PostgREST 가 노출하는
-- public 스키마 밖이다. 정의자(postgres) 권한으로 읽어 public 스키마의 함수로 돌려준다.
-- `set search_path = public` 은 정의자 권한 함수의 기본 방어다(호출자가 search_path 를
-- 바꿔치기해 다른 스키마의 동명 객체를 끼워 넣는 것을 막는다. pg_catalog 는 항상 암묵적으로
-- 먼저 검색되므로 `pg_policies` 는 그대로 해석된다).
--
-- 실행 권한은 service role 에게만 준다. 정책 술어에는 관리자 이메일이 들어 있어 익명·일반
-- 인증 사용자에게 보일 이유가 없다. `revoke ... from public` 을 먼저 해야 한다 — 함수는
-- 생성 시 public 에 execute 가 기본으로 붙는다. anon·authenticated 는 그 public 을 통해
-- 상속받을 뿐 직접 부여받은 권한이 없어, 그 두 줄에서 `WARNING: no privileges could be
-- revoked` 가 나올 수 있다. **정상이다** — 직접 부여가 언젠가 생겼을 때를 대비한 못이다.
--
-- 반환은 **정책 세 개로 한정**한다. pg_policies 전체를 돌려주면 이 저장소와 무관한 정책까지
-- 새어 나간다. 검사가 필요로 하는 것은 이 셋뿐이다.

create or replace function public.admin_policy_summary()
returns table (policyname text, qual text, with_check text)
language sql
security definer
set search_path = public
as $$
  select p.policyname::text, p.qual::text, p.with_check::text
    from pg_policies p
   where p.schemaname = 'public'
     and p.policyname in ('cat_write', 'bm_write', 'clk_read')
   order by p.policyname;
$$;

revoke execute on function public.admin_policy_summary() from public;
revoke execute on function public.admin_policy_summary() from anon;
revoke execute on function public.admin_policy_summary() from authenticated;
grant  execute on function public.admin_policy_summary() to service_role;
