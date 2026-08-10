-- 0005_lift_pin_limit.sql — '매일 고정' 개수 상한(12)을 걷어낸다
--
-- 적용 방법: Supabase SQL Editor 에 전체 붙여넣기 실행(1회). 재실행 안전(`if exists`).
--
-- 적용 뒤 검증: `npx tsx scripts/verify-schema.ts` — 검사 ④ 가 "상한이 걷혔다"를 확인한다
-- (적용 전에는 13번째 고정이 거부되어 ④ 가 실패한다).
--
-- ## 왜 걷어내나
-- 0001 은 PRD 의 하드 제약("매일 고정 최대 12")을 `enforce_pin_limit` 트리거로 강제했다.
-- 운영해 보니 매일 쓰는 사이트가 20개 안팎으로 늘어 그 숫자가 실제 사용을 막는다 —
-- 제품 소유자 판단으로 상한 자체를 없앤다(2026-08-10).
--
-- ## 무엇이 함께 사라지나
-- 트리거가 걸려 있던 advisory lock(`pg_advisory_xact_lock('pin_limit')`)도 함께 없어진다.
-- 그 잠금은 "동시에 두 개를 고정할 때 12를 넘지 않게" 직렬화하려던 것이라, 셀 상한이
-- 없어지면 지킬 것도 없다. 고정 토글은 행 하나의 boolean 갱신이라 그 자체로 원자적이다.
--
-- ## 화면 쪽
-- 홈의 '매일' 섹션과 `/daily` 는 `is_pinned` 로 거르기만 하고 개수를 자르지 않으므로
-- (`components/HomeView.tsx`, `app/(public)/daily/page.tsx`) 별도 수정이 필요 없다.
-- 다시 상한을 두고 싶어지면 이 파일을 되돌리지 말고 새 마이그레이션으로 트리거를 다시 만든다.

-- 트리거를 먼저 지운다 — 함수가 트리거에 묶여 있는 동안에는 함수를 지울 수 없다.
drop trigger if exists bookmarks_pin_limit on bookmarks;
drop function if exists enforce_pin_limit();

-- 적용 확인용 조회 (SQL Editor 에서 눈으로 볼 때):
--   select tgname from pg_trigger where tgrelid = 'bookmarks'::regclass and not tgisinternal;
--   → 결과에 bookmarks_pin_limit 이 없어야 한다(bookmarks_updated_at 은 남는다).
