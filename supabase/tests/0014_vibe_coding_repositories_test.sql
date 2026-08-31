begin;

-- Linked test의 임시 로그인 role은 extensions schema USAGE가 없다. 운영 권한을 넓히거나
-- pgTAP을 남기지 않고도 pg_prove가 판정할 수 있도록 표준 TAP 문자열을 직접 만든다.
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

create temporary table expected_open_source_repositories (
  url text primary key
) on commit drop;

insert into expected_open_source_repositories (url)
values
  ('https://github.com/zeroclaw-labs/zeroclaw'),
  ('https://github.com/ZeroLu/awesome-gpt-image'),
  ('https://github.com/pim97/anti-detect-browser-tools-tech-comparison');

select '1..9';

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 1
      from public.categories as category
     where category.parent_id is null
       and category.name = 'AI 도구 모음'
  ),
  1,
  'AI 도구 모음 상위 카테고리가 정확히 하나다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 1
      from public.categories as category
     where category.name = '바이브코딩'
  ),
  2,
  '전체 계층에 바이브코딩 카테고리가 정확히 하나다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 0
      from public.categories as child
      join public.categories as vibe on vibe.id = child.parent_id
     where vibe.name = '바이브코딩'
  ),
  3,
  '바이브코딩은 leaf 카테고리다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 9
      from public.bookmarks as bookmark
      join public.categories as category on category.id = bookmark.category_id
     where category.name = '바이브코딩'
  ),
  4,
  '바이브코딩에는 승인된 bookmark 9개만 있다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 9
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
      join public.categories as category on category.id = bookmark.category_id
     where category.name = '바이브코딩'
  ),
  5,
  '승인된 GitHub 저장소 9개가 바이브코딩으로 이동했다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 0
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
      join public.categories as category on category.id = bookmark.category_id
     where category.name = '오픈소스·자료 모음'
  ),
  6,
  '이동 대상은 오픈소스·자료 모음에 남지 않았다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 3
      from expected_open_source_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
      join public.categories as category on category.id = bookmark.category_id
      join public.categories as parent on parent.id = category.parent_id
     where parent.name = 'AI 도구 모음'
       and category.name = '오픈소스·자료 모음'
  ),
  7,
  '검토·유지 대상 3개는 오픈소스·자료 모음에 남았다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(distinct bookmark.id) = 9
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
  ),
  8,
  '승인된 URL은 서로 다른 bookmark 9개를 가리킨다'
);

select pg_temp.tap_assert(
  (
    select pg_catalog.count(*) = 9
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
     where bookmark.source = 'manual'
  ),
  9,
  '이동한 기존 링크의 manual source가 보존됐다'
);

rollback;
