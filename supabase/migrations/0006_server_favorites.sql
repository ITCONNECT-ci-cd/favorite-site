-- 0006_server_favorites.sql — 즐겨찾기를 브라우저에서 DB 로 옮긴다
--
-- 적용 방법: Supabase SQL Editor 에 전체 붙여넣기 실행(1회). 재실행 안전(`if not exists`).
--
-- ## 왜 옮기나
-- 1단계는 방문자 계정이 없어 즐겨찾기를 브라우저 localStorage 에만 두었다(docs/PRD.md 148-151).
-- 그 결과 담은 브라우저를 벗어나면 홈이 거의 빈 화면이 된다 — 홈의 본문 세 묶음이 전부
-- 즐겨찾기이기 때문이다(components/HomeView.tsx). 2026-08-11 사용자 결정으로 **관리자가 담은
-- 한 벌을 모두의 홈**으로 삼는다. 설계는
-- docs/superpowers/specs/2026-08-11-server-favorites-design.md 에 있다.
--
-- ## 왜 새 테이블이 아니라 컬럼인가
-- 공용 한 벌이면 즐겨찾기는 사실상 북마크의 상태다. 컬럼으로 두면 getAllData 가 이미 읽는 행에
-- 실려 와 **쿼리가 늘지 않고**, 쓰기 권한도 기존 bm_write(관리자 한 명)가 그대로 덮어
-- **새 RLS 정책이 필요 없다**. 훗날 방문자 계정이 생기면 favorites(user_id, bookmark_id) 로
-- 옮기고 이 두 컬럼을 버린다.
--
-- ## fav_order 를 따로 두는 이유
-- sort_order 는 **분류 안에서의** 차례다. 재활용하면 홈에서 카드를 끈 것이 카테고리 화면의
-- 순서까지 바꾼다. 두 축은 갈라 두어야 한다.
--
-- ## is_pinned 를 재활용하지 않는 이유
-- '매일 사용하는 사이트'가 걷히며 놀게 된 컬럼이지만(lib/constants.ts) 이미 true 로 남아 있는
-- 행들이 있어, 재활용하면 담은 적 없는 링크가 홈에 뜬다.

alter table bookmarks
  add column if not exists is_favorite boolean not null default false,
  add column if not exists fav_order   int     not null default 0;

-- 인덱스를 만들지 않는다 — 290행이고 getAllData 가 전 행을 읽어 JS 에서 거른다.
-- RLS 정책도 새로 쓰지 않는다 — bm_read(공개 select)·bm_write(관리자 전용)는 컬럼이 아니라
-- 행에 걸리므로 새 컬럼에 자동으로 적용된다.

-- 적용 확인용 조회 (SQL Editor 에서 눈으로 볼 때):
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_name = 'bookmarks' and column_name in ('is_favorite', 'fav_order');
--   → 두 행이 나와야 한다.
