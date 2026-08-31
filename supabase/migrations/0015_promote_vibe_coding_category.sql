-- 0015_promote_vibe_coding_category.sql
--
-- `AI 도구 모음 > 바이브코딩`을 사이드바의 `분류` 바로 아래 첫 번째
-- 최상위 카테고리로 올린다. 카테고리 행의 id와 bookmark 연결은 보존한다.

begin;

lock table public.categories in share row exclusive mode;
lock table public.bookmarks in share mode;

do $migration$
declare
  v_ai_id uuid;
  v_target_id uuid;
  v_target_parent_id uuid;
  v_target_order integer;
  v_count integer;
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
    into v_ai_id
    from public.categories as category
   where category.parent_id is null
     and category.name = 'AI 도구 모음';

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.name = '바이브코딩';

  if v_count <> 1 then
    raise exception '바이브코딩 카테고리는 전체 계층에서 정확히 1개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select category.id, category.parent_id, category.sort_order
    into v_target_id, v_target_parent_id, v_target_order
    from public.categories as category
   where category.name = '바이브코딩';

  if v_target_parent_id is distinct from v_ai_id
     and v_target_parent_id is not null then
    raise exception '바이브코딩은 AI 도구 모음 하위 또는 최상위여야 합니다. 실제 parent_id: %',
      v_target_parent_id using errcode = '23514';
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
    from public.bookmarks as bookmark
   where bookmark.category_id = v_target_id;

  if v_count <> 9 then
    raise exception '바이브코딩 bookmark는 정확히 9개여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  if v_target_parent_id = v_ai_id then
    select pg_catalog.count(*) - pg_catalog.count(distinct category.sort_order)
      into v_count
      from public.categories as category
     where category.parent_id is null;

    if v_count <> 0 then
      raise exception '기존 최상위 카테고리 sort_order는 고유해야 합니다. 중복 차이: %', v_count
        using errcode = '23514';
    end if;

    select pg_catalog.count(*)
      into v_count
      from public.categories as category
     where category.parent_id is null
       and category.sort_order < 0;

    if v_count <> 0 then
      raise exception '기존 최상위 카테고리 sort_order는 음수일 수 없습니다. 실제: %', v_count
        using errcode = '23514';
    end if;

    select pg_catalog.count(*)
      into v_count
      from public.categories as category
     where category.parent_id is null
       and category.sort_order = 0
       and category.id = v_ai_id;

    if v_count <> 1 then
      raise exception '이동 전 AI 도구 모음이 분류 바로 아래 첫 항목이어야 합니다. 실제: %', v_count
        using errcode = '23514';
    end if;

    update public.categories as category
       set sort_order = category.sort_order + 1
     where category.parent_id is null;

    update public.categories as category
       set parent_id = null,
           sort_order = 0
     where category.id = v_target_id
       and category.parent_id = v_ai_id;

    if not found then
      raise exception '바이브코딩 최상위 이동 대상이 사전 점검 뒤 변경됐습니다.'
        using errcode = '23514';
    end if;
  elsif v_target_order <> 0 then
    raise exception '이미 최상위인 바이브코딩의 sort_order는 0이어야 합니다. 실제: %',
      v_target_order using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.id = v_target_id
     and category.parent_id is null
     and category.sort_order = 0;

  if v_count <> 1 then
    raise exception '바이브코딩은 분류 바로 아래 첫 최상위 카테고리여야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id is null
     and category.id <> v_target_id
     and category.sort_order <= 0;

  if v_count <> 0 then
    raise exception '바이브코딩 외 최상위 카테고리는 첫 순서 뒤에 있어야 합니다. 실제: %', v_count
      using errcode = '23514';
  end if;

  select pg_catalog.count(*)
    into v_count
    from public.categories as category
   where category.parent_id = v_ai_id
     and category.name = '바이브코딩';

  if v_count <> 0 then
    raise exception 'AI 도구 모음 하위에 바이브코딩이 남아 있으면 안 됩니다. 실제: %', v_count
      using errcode = '23514';
  end if;
end;
$migration$;

commit;
