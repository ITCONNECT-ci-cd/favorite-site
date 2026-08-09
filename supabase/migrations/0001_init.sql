-- 0001_init.sql — 링크 대시보드 초기 스키마 (테이블 · 인덱스 · 뷰 · RLS · 트리거)
--
-- 적용 방법: Supabase SQL Editor에 전체 붙여넣기 실행(1회).
-- CLI를 쓸 경우 supabase link 후 db push.
--
-- 적용 뒤 검증: `npx tsx scripts/verify-schema.ts` (B2 완료 기준 6종을 자동 확인한다).
-- 아래 본문은 구현 계획 §2.1 의 SQL 그대로다 — 임의 수정 금지.

create extension if not exists pgcrypto;

create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid references categories(id) on delete set null,
  sort_order int  not null default 0,
  created_at timestamptz default now(),
  unique nulls not distinct (name, parent_id)  -- 상위(parent_id null)끼리·같은 부모의 하위끼리 이름 중복 금지 (V2, PG15+)
);

create table bookmarks (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete set null,
  title       text not null,
  url         text not null,
  description text,
  tags        text[] not null default '{}',
  favicon_url text,
  is_pinned   boolean not null default false,   -- 매일 사용하는 사이트 (최대 12)
  sort_order  int not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table clicks (
  id           bigserial primary key,
  bookmark_id  uuid references bookmarks(id) on delete cascade,
  visitor_hash text,
  is_bulk      boolean default false,
  clicked_at   timestamptz default now()
);
create index clicks_bookmark_time_idx on clicks (bookmark_id, clicked_at desc);
create index clicks_time_idx on clicks (clicked_at desc);

-- 공개 카드에 노출할 합계만 공개 (clicks 원본은 비공개)
-- 의도: 뷰는 소유자(definer) 권한으로 실행되어 clicks RLS를 우회해 "합계만" 노출한다.
-- security_invoker=true를 붙이면 익명에게 0행이 되므로 금지. grant는 암묵적 기본권한에 기대지 않고 명시한다.
create view bookmark_click_counts as
  select bookmark_id, count(*)::int as click_count
  from clicks group by bookmark_id;
grant select on bookmark_click_counts to anon, authenticated;

-- updated_at 자동 갱신
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger bookmarks_updated_at
  before update on bookmarks
  for each row execute function set_updated_at();

-- 매일 고정 최대 12 강제 (PRD 하드 제약)
create or replace function enforce_pin_limit() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('pin_limit'));  -- 동시 토글 경합 직렬화
  if (select count(*) from bookmarks where is_pinned and id <> new.id) >= 12 then
    raise exception 'PIN_LIMIT: 매일 고정은 최대 12개입니다';
  end if;
  return new;
end $$;
create trigger bookmarks_pin_limit
  before insert or update of is_pinned on bookmarks
  for each row when (new.is_pinned) execute function enforce_pin_limit();

alter table categories enable row level security;
alter table bookmarks  enable row level security;
alter table clicks     enable row level security;

create policy cat_read  on categories for select using (true);
create policy cat_write on categories for all to authenticated using (true) with check (true);
create policy bm_read   on bookmarks  for select using (true);
create policy bm_write  on bookmarks  for all to authenticated using (true) with check (true);
create policy clk_read  on clicks     for select to authenticated using (true);
-- clicks insert 정책 없음: 기록은 /api/click(service role)로만 (0장 '의도적 편차' 참조)
