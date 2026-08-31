begin;

select plan(9);

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

select is(
  (
    select pg_catalog.count(*)
      from public.categories as category
     where category.parent_id is null
       and category.name = 'AI 도구 모음'
  ),
  1::bigint,
  'AI 도구 모음 상위 카테고리가 정확히 하나다'
);

select is(
  (
    select pg_catalog.count(*)
      from public.categories as child
      join public.categories as parent on parent.id = child.parent_id
     where parent.parent_id is null
       and parent.name = 'AI 도구 모음'
       and child.name = '바이브코딩'
  ),
  1::bigint,
  'AI 도구 모음 아래 바이브코딩 카테고리가 정확히 하나다'
);

select is(
  (
    select pg_catalog.count(*)
      from public.categories as grandchild
      join public.categories as child on child.id = grandchild.parent_id
      join public.categories as parent on parent.id = child.parent_id
     where parent.name = 'AI 도구 모음'
       and child.name = '바이브코딩'
  ),
  0::bigint,
  '바이브코딩은 leaf 카테고리다'
);

select is(
  (
    select vibe.sort_order
      from public.categories as vibe
      join public.categories as parent on parent.id = vibe.parent_id
     where parent.name = 'AI 도구 모음'
       and vibe.name = '바이브코딩'
  ),
  (
    select coding.sort_order + 1
      from public.categories as coding
      join public.categories as parent on parent.id = coding.parent_id
     where parent.name = 'AI 도구 모음'
       and coding.name = '코딩·에이전트'
  ),
  '바이브코딩은 코딩·에이전트 바로 다음 순서다'
);

select is(
  (
    select pg_catalog.count(*)
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
      join public.categories as category on category.id = bookmark.category_id
      join public.categories as parent on parent.id = category.parent_id
     where parent.name = 'AI 도구 모음'
       and category.name = '바이브코딩'
  ),
  9::bigint,
  '승인된 GitHub 저장소 9개가 바이브코딩으로 이동했다'
);

select is(
  (
    select pg_catalog.count(*)
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
      join public.categories as category on category.id = bookmark.category_id
     where category.name = '오픈소스·자료 모음'
  ),
  0::bigint,
  '이동 대상은 오픈소스·자료 모음에 남지 않았다'
);

select is(
  (
    select pg_catalog.count(*)
      from expected_open_source_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
      join public.categories as category on category.id = bookmark.category_id
      join public.categories as parent on parent.id = category.parent_id
     where parent.name = 'AI 도구 모음'
       and category.name = '오픈소스·자료 모음'
  ),
  3::bigint,
  '검토·유지 대상 3개는 오픈소스·자료 모음에 남았다'
);

select is(
  (
    select pg_catalog.count(distinct bookmark.id)
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
  ),
  9::bigint,
  '승인된 URL은 서로 다른 bookmark 9개를 가리킨다'
);

select is(
  (
    select pg_catalog.count(*)
      from expected_vibe_repositories as expected
      join public.bookmarks as bookmark on bookmark.url = expected.url
     where bookmark.source = 'manual'
  ),
  9::bigint,
  '이동한 기존 링크의 manual source가 보존됐다'
);

select * from finish();

rollback;
