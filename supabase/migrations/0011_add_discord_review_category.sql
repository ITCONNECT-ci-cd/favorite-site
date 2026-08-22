-- 0011_add_discord_review_category.sql
--
-- Discord에서 메시지와 hostname만으로 신뢰할 만한 분류를 정할 수 없는 링크를
-- 억지로 기존 콘텐츠 분류에 넣지 않도록 전용 검토함을 보장한다.
-- 최상위 leaf라서 ingest API가 그대로 사용할 수 있고, 이후 관리자가 재분류할 수 있다.

do $migration$
declare
  v_review_category_id uuid;
  v_next_sort_order integer;
begin
  select category.id
    into v_review_category_id
    from public.categories as category
   where category.parent_id is null
     and category.name = '분류 대기';

  if v_review_category_id is null then
    select coalesce(pg_catalog.max(category.sort_order), -1) + 1
      into v_next_sort_order
      from public.categories as category
     where category.parent_id is null;

    insert into public.categories (name, parent_id, sort_order)
    values ('분류 대기', null, v_next_sort_order)
    returning id into v_review_category_id;
  end if;

  if exists (
    select 1
      from public.categories as child
     where child.parent_id = v_review_category_id
  ) then
    raise exception '분류 대기는 ingest fallback으로 사용할 leaf여야 합니다.'
      using errcode = '23514';
  end if;
end;
$migration$;
