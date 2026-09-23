-- Add three user-requested sites to the existing operating-sites category.
-- Keep existing bookmarks untouched if any target URL was added separately.
begin;

do $migration$
declare
  v_category_id uuid;
  v_category_count integer;
  v_existing_count integer;
  v_last_order integer;
begin
  select count(*)
    into v_category_count
    from public.categories
   where parent_id is null and name = '현재 운영 중인 사이트';

  if v_category_count <> 1 then
    raise exception 'Expected one top-level operating-sites category; found %', v_category_count;
  end if;

  select id into v_category_id
    from public.categories
   where parent_id is null and name = '현재 운영 중인 사이트';

  select count(*)
    into v_existing_count
    from public.bookmarks
   where normalized_url in (
     public.normalize_bookmark_url_v1('https://video.itconnect.dev/'),
     public.normalize_bookmark_url_v1('https://thebeige.kr/'),
     public.normalize_bookmark_url_v1('https://info.itconnect.dev/')
   );

  if v_existing_count <> 0 then
    raise exception 'One or more requested sites already exist; review before adding';
  end if;

  select coalesce(max(sort_order), -1)
    into v_last_order
    from public.bookmarks
   where category_id = v_category_id;

  insert into public.bookmarks (
    category_id, title, url, description, tags, favicon_url,
    is_pinned, sort_order, source
  )
  values
    (v_category_id, 'AutoVideo Studio', 'https://video.itconnect.dev/',
     '영상 제작 스튜디오', '{}'::text[], null, false, v_last_order + 1, 'manual'),
    (v_category_id, 'THE BEIGE', 'https://thebeige.kr/',
     '24시간 무인 의류 편집 공간', '{}'::text[], null, false, v_last_order + 2, 'manual'),
    (v_category_id, 'AI 정보 매거진', 'https://info.itconnect.dev/',
     'AI 소식과 논문·해설을 모아 보는 매거진', '{}'::text[], null, false, v_last_order + 3, 'manual');
end;
$migration$;

commit;
