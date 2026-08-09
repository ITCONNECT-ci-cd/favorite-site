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
-- 0001 은 이미 적용된 마이그레이션이라 손대지 않는다 — 여기서 정책만 갈아 끼운다.
-- 재실행해도 안전하다(`drop policy if exists` 뒤 재생성).
--
-- ## 함께 해야 하는 일 (SQL 로는 못 한다)
--
--   Supabase 대시보드 → Authentication → Sign In / Up → "Allow new users to sign up" 끄기.
--   `npx tsx scripts/verify-schema.ts` 의 검사 ⑦ 이 이 설정을 확인한다(끄기 전에는 실패한다).
--
-- ## 적용 확인
--
--   select policyname, cmd, roles, qual::text, with_check::text
--     from pg_policies
--    where schemaname = 'public'
--      and policyname in ('cat_write', 'bm_write', 'clk_read')
--    order by policyname;
--
-- 세 행의 qual 에 `auth.jwt() ->> 'email'` 비교가 보이면 적용된 것이다(`true` 면 아직이다).
-- 그다음 `npx tsx scripts/verify-schema.ts` 를 다시 돌려 ①~⑥ 이 그대로 통과하는지 본다.
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
-- service role 키는 RLS 자체를 우회하므로 이 정책의 영향을 받지 않는다.
-- `/api/click` 의 기록과 시드·파비콘 스크립트는 그대로 돈다.

drop policy if exists cat_write on categories;
create policy cat_write on categories for all to authenticated
  using      ((select auth.jwt() ->> 'email') = 'contact@itconnect.dev')
  with check ((select auth.jwt() ->> 'email') = 'contact@itconnect.dev');

drop policy if exists bm_write on bookmarks;
create policy bm_write on bookmarks for all to authenticated
  using      ((select auth.jwt() ->> 'email') = 'contact@itconnect.dev')
  with check ((select auth.jwt() ->> 'email') = 'contact@itconnect.dev');

-- clicks 에는 읽기 정책만 있다(기록은 service role 전용 — 0001 마지막 줄 주석 참조).
-- select 정책이라 with check 는 쓰지 않는다.
drop policy if exists clk_read on clicks;
create policy clk_read on clicks for select to authenticated
  using ((select auth.jwt() ->> 'email') = 'contact@itconnect.dev');

-- 읽기 정책(cat_read·bm_read)은 건드리지 않는다. 공개 대시보드가 익명으로 읽어야 한다.
