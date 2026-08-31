begin;

create or replace function pg_temp.tap_assert(
  condition boolean,
  test_number integer,
  description text
) returns text
language plpgsql
immutable
as $function$
begin
  if condition is not true then
    raise exception 'not ok % - %', test_number, description using errcode = '23514';
  end if;

  return 'ok ' || test_number::text || ' - ' || description;
end;
$function$;

create temporary table expected_vibe_repositories (
  url text primary key
) on commit drop;

insert into expected_vibe_repositories (url)
values
  ('https://github.com/NomaDamas/k-skill'),
  ('https://github.com/rullerzhou-afk/clawd-on-desk'),
  ('https://github.com/whiteport-collective/whiteport-design-studio'),
  ('https://github.com/ultraworkers/claw-code'),
  ('https://github.com/ysys143/analyze-cc-prompts'),
  ('https://github.com/phuryn/pm-skills'),
  ('https://github.com/chopratejas/headroom'),
  ('https://github.com/VoltAgent/awesome-design-md/tree/main'),
  ('https://github.com/zarazhangrui/frontend-slides');

select '1..9';

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 1
      from public.categories as category
     where category.name = '바이브코딩'
       and category.parent_id is null
  ),
  1,
  '바이브코딩은 정확히 하나의 최상위 카테고리다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 1
      from public.categories as category
     where category.name = '바이브코딩'
  ),
  2,
  '전체 계층에 바이브코딩은 정확히 하나다'
);

select pg_temp.tap_assert(
  (
    select category.sort_order = 0
      from public.categories as category
     where category.name = '바이브코딩'
       and category.parent_id is null
  ),
  3,
  '바이브코딩은 분류 바로 아래 첫 순서다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 0
      from public.categories as category
     where category.parent_id is null
       and category.name <> '바이브코딩'
       and category.sort_order <= 0
  ),
  4,
  '다른 최상위 분류는 모두 바이브코딩 뒤에 있다'
);

select pg_temp.tap_assert(
  (
    select category.sort_order = 1
      from public.categories as category
     where category.name = 'AI 도구 모음'
       and category.parent_id is null
  ),
  5,
  '기존 첫 항목 AI 도구 모음은 두 번째 순서로 보존된다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 0
      from public.categories as category
     where category.name = '바이브코딩'
       and category.parent_id is not null
  ),
  6,
  'AI 도구 모음 하위에 바이브코딩이 남지 않는다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 0
      from public.categories as child
      join public.categories as vibe on vibe.id = child.parent_id
     where vibe.name = '바이브코딩'
  ),
  7,
  '바이브코딩은 leaf 카테고리다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 9
      from public.bookmarks as bookmark
      join public.categories as category on category.id = bookmark.category_id
     where category.name = '바이브코딩'
       and category.parent_id is null
  ),
  8,
  '기존 bookmark 9개가 최상위 바이브코딩에 연결돼 있다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 9
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
      join public.categories as category on category.id = bookmark.category_id
     where category.name = '바이브코딩'
       and category.parent_id is null
  ),
  9,
  '승인된 GitHub 저장소 9개가 그대로 보존됐다'
);

rollback;
