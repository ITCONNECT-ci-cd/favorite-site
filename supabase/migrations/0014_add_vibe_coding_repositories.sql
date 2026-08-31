-- 0014_add_vibe_coding_repositories.sql
--
-- 바이브코딩에 직접 도움이 되는 기존 GitHub 저장소 9건을
-- `AI 도구 모음 > 바이브코딩`으로 분리한다.
--
-- 이 migration은 링크 행을 삭제하거나 다시 만들지 않는다. category_id와 새 분류 안의
-- sort_order만 바꿔 bookmark id, 클릭 이력, favicon, source, 즐겨찾기 상태를 보존한다.
-- 대상 URL이 누락됐거나 예상 밖 분류로 이동해 있으면 전체 transaction을 중단한다.

begin;

lock table public.categories in share row exclusive mode;
lock table public.bookmarks in share row exclusive mode;

do $migration$
declare
  v_parent_id uuid;
  v_source_id uuid;
  v_target_id uuid;
  v_anchor_order integer;
  v_target_max_order integer;
  v_count integer;
  v_source_target_count integer;
  v_affected integer;
begin
  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id is null
     and category.name = 'AI 도구 모음';

  if v_count <> 1 then
    raise exception 'AI 도구 모음 상위 카테고리는 정확히 1개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select category.id
    into v_parent_id
    from public.categories as category
   where category.parent_id is null
     and category.name = 'AI 도구 모음';

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id = v_parent_id
     and category.name = '오픈소스·자료 모음';

  if v_count <> 1 then
    raise exception 'AI 도구 모음 > 오픈소스·자료 모음은 정확히 1개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select category.id
    into v_source_id
    from public.categories as category
   where category.parent_id = v_parent_id
     and category.name = '오픈소스·자료 모음';

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id = v_parent_id
     and category.name = '코딩·에이전트';

  if v_count <> 1 then
    raise exception 'AI 도구 모음 > 코딩·에이전트는 정확히 1개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select category.sort_order
    into v_anchor_order
    from public.categories as category
   where category.parent_id = v_parent_id
     and category.name = '코딩·에이전트';

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id = v_parent_id
     and category.sort_order = v_anchor_order;

  if v_count <> 1 then
    raise exception '코딩·에이전트의 하위 분류 순서 %는 고유해야 합니다. 실제: %개',
      v_anchor_order, v_count using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id = v_parent_id
     and category.name = '바이브코딩';

  if v_count > 1 then
    raise exception 'AI 도구 모음 > 바이브코딩은 최대 1개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  if v_count = 0 then
    update public.categories as category
       set sort_order = category.sort_order + 1
     where category.parent_id = v_parent_id
       and category.sort_order > v_anchor_order;

    insert into public.categories (name, parent_id, sort_order)
    values ('바이브코딩', v_parent_id, v_anchor_order + 1)
    returning id into v_target_id;
  else
    select category.id
      into v_target_id
      from public.categories as category
     where category.parent_id = v_parent_id
       and category.name = '바이브코딩';

    select category.sort_order
      into v_count
      from public.categories as category
     where category.id = v_target_id;

    if v_count <> v_anchor_order + 1 then
      raise exception '바이브코딩은 코딩·에이전트 바로 다음 순서여야 합니다. 기대: %, 실제: %',
        v_anchor_order + 1, v_count using errcode = '23514';
    end if;
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id = v_target_id;

  if v_count <> 0 then
    raise exception '바이브코딩은 leaf 카테고리여야 합니다. 하위 분류: %개', v_count
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from (
      values
        ('https://github.com/NomaDamas/k-skill'),
        ('https://github.com/rullerzhou-afk/clawd-on-desk'),
        ('https://github.com/whiteport-collective/whiteport-design-studio'),
        ('https://github.com/ultraworkers/claw-code'),
        ('https://github.com/ysys143/analyze-cc-prompts'),
        ('https://github.com/phuryn/pm-skills'),
        ('https://github.com/chopratejas/headroom'),
        ('https://github.com/VoltAgent/awesome-design-md/tree/main'),
        ('https://github.com/zarazhangrui/frontend-slides')
    ) as target(url)
   where public.normalize_bookmark_url_v1(target.url) is not null;

  if v_count <> 9 then
    raise exception '바이브코딩 대상 URL 9개가 모두 정규화 가능해야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from (
      select distinct public.normalize_bookmark_url_v1(target.url) as normalized_url
        from (
          values
            ('https://github.com/NomaDamas/k-skill'),
            ('https://github.com/rullerzhou-afk/clawd-on-desk'),
            ('https://github.com/whiteport-collective/whiteport-design-studio'),
            ('https://github.com/ultraworkers/claw-code'),
            ('https://github.com/ysys143/analyze-cc-prompts'),
            ('https://github.com/phuryn/pm-skills'),
            ('https://github.com/chopratejas/headroom'),
            ('https://github.com/VoltAgent/awesome-design-md/tree/main'),
            ('https://github.com/zarazhangrui/frontend-slides')
        ) as target(url)
    ) as normalized;

  if v_count <> 9 then
    raise exception '바이브코딩 대상 URL은 정규화 뒤에도 9개로 고유해야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.bookmarks as bookmark
    join (
      values
        ('https://github.com/NomaDamas/k-skill'),
        ('https://github.com/rullerzhou-afk/clawd-on-desk'),
        ('https://github.com/whiteport-collective/whiteport-design-studio'),
        ('https://github.com/ultraworkers/claw-code'),
        ('https://github.com/ysys143/analyze-cc-prompts'),
        ('https://github.com/phuryn/pm-skills'),
        ('https://github.com/chopratejas/headroom'),
        ('https://github.com/VoltAgent/awesome-design-md/tree/main'),
        ('https://github.com/zarazhangrui/frontend-slides')
    ) as target(url)
      on bookmark.normalized_url = public.normalize_bookmark_url_v1(target.url);

  if v_count <> 9 then
    raise exception '바이브코딩 이동 대상 bookmark는 정확히 9개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.bookmarks as bookmark
    join (
      values
        ('https://github.com/NomaDamas/k-skill'),
        ('https://github.com/rullerzhou-afk/clawd-on-desk'),
        ('https://github.com/whiteport-collective/whiteport-design-studio'),
        ('https://github.com/ultraworkers/claw-code'),
        ('https://github.com/ysys143/analyze-cc-prompts'),
        ('https://github.com/phuryn/pm-skills'),
        ('https://github.com/chopratejas/headroom'),
        ('https://github.com/VoltAgent/awesome-design-md/tree/main'),
        ('https://github.com/zarazhangrui/frontend-slides')
    ) as target(url)
      on bookmark.normalized_url = public.normalize_bookmark_url_v1(target.url)
   where bookmark.category_id not in (v_source_id, v_target_id)
      or bookmark.category_id is null;

  if v_count <> 0 then
    raise exception '바이브코딩 대상 중 예상 밖 분류에 있는 bookmark가 있습니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_source_target_count
    from public.bookmarks as bookmark
    join (
      values
        ('https://github.com/NomaDamas/k-skill'),
        ('https://github.com/rullerzhou-afk/clawd-on-desk'),
        ('https://github.com/whiteport-collective/whiteport-design-studio'),
        ('https://github.com/ultraworkers/claw-code'),
        ('https://github.com/ysys143/analyze-cc-prompts'),
        ('https://github.com/phuryn/pm-skills'),
        ('https://github.com/chopratejas/headroom'),
        ('https://github.com/VoltAgent/awesome-design-md/tree/main'),
        ('https://github.com/zarazhangrui/frontend-slides')
    ) as target(url)
      on bookmark.normalized_url = public.normalize_bookmark_url_v1(target.url)
   where bookmark.category_id = v_source_id;

  select coalesce(pg_catalog.max(bookmark.sort_order), -1)
    into v_target_max_order
    from public.bookmarks as bookmark
   where bookmark.category_id = v_target_id;

  update public.bookmarks as bookmark
     set category_id = v_target_id,
         sort_order = v_target_max_order + target.position
    from (
      values
        (1, 'https://github.com/NomaDamas/k-skill'),
        (2, 'https://github.com/rullerzhou-afk/clawd-on-desk'),
        (3, 'https://github.com/whiteport-collective/whiteport-design-studio'),
        (4, 'https://github.com/ultraworkers/claw-code'),
        (5, 'https://github.com/ysys143/analyze-cc-prompts'),
        (6, 'https://github.com/phuryn/pm-skills'),
        (7, 'https://github.com/chopratejas/headroom'),
        (8, 'https://github.com/VoltAgent/awesome-design-md/tree/main'),
        (9, 'https://github.com/zarazhangrui/frontend-slides')
    ) as target(position, url)
   where bookmark.normalized_url = public.normalize_bookmark_url_v1(target.url)
     and bookmark.category_id = v_source_id;

  get diagnostics v_affected = row_count;
  if v_affected <> v_source_target_count then
    raise exception '바이브코딩 bookmark 이동 수가 사전 점검과 다릅니다. 기대: %, 실제: %',
      v_source_target_count, v_affected using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.bookmarks as bookmark
    join (
      values
        ('https://github.com/NomaDamas/k-skill'),
        ('https://github.com/rullerzhou-afk/clawd-on-desk'),
        ('https://github.com/whiteport-collective/whiteport-design-studio'),
        ('https://github.com/ultraworkers/claw-code'),
        ('https://github.com/ysys143/analyze-cc-prompts'),
        ('https://github.com/phuryn/pm-skills'),
        ('https://github.com/chopratejas/headroom'),
        ('https://github.com/VoltAgent/awesome-design-md/tree/main'),
        ('https://github.com/zarazhangrui/frontend-slides')
    ) as target(url)
      on bookmark.normalized_url = public.normalize_bookmark_url_v1(target.url)
   where bookmark.category_id = v_target_id;

  if v_count <> 9 then
    raise exception '바이브코딩 최종 대상 bookmark는 정확히 9개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;
end;
$migration$;

commit;
