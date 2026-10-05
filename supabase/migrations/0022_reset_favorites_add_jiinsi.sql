-- Clear the existing 19 favorites, then add only the newly requested JIINSI news link.
-- Home AI news and /favorites share is_favorite, so this leaves one new favorite.
-- Bookmark rows and click history are preserved.
begin;
lock table public.bookmarks in share row exclusive mode;

do $migration$
declare
  v_jiinsi_id constant uuid := 'b670f70f-d8c0-45fd-b441-54c739bbb2d2';
  v_count integer;
begin
  select count(*) into v_count
    from public.bookmarks b
    join public.categories child on child.id = b.category_id
    join public.categories parent on parent.id = child.parent_id
   where b.id = v_jiinsi_id
     and b.normalized_url = public.normalize_bookmark_url_v1('https://jiinsi.com/')
     and child.name = 'AI 뉴스'
     and parent.name = '뉴스·인사이트'
     and parent.parent_id is null;
  if v_count <> 1 then
    raise exception 'Expected the existing JIINSI bookmark in AI news';
  end if;

  if exists (
    select 1 from public.bookmarks
     where is_favorite and id not in (
      '1021286a-213c-4305-b811-f5b33e858f21'::uuid,
      '16bec72a-86ba-4caa-ab10-b3d10fb13dc7'::uuid,
      '182919f7-a910-4c4f-a2d9-1d658e69c694'::uuid,
      '1d14c1fd-39b7-4116-9247-f6a08a21d559'::uuid,
      '37f48658-0d37-4f41-8e3b-a930465726fa'::uuid,
      '484f92d9-b73f-45e8-84ff-8ae9524bfe53'::uuid,
      '6f483af0-2278-4a67-8307-c7b5413c9932'::uuid,
      '97c09f85-d136-4a62-89e6-910098c79c13'::uuid,
      'acd37d63-a567-423c-8bbc-309b832eb464'::uuid,
      'b9f6aeb6-a421-46ce-898a-0fde4b6d1519'::uuid,
      'bd12f640-4efc-4fab-ac9c-86e035fd0008'::uuid,
      'c1fa58ab-10fa-4c45-a209-2823623a3c76'::uuid,
      'c3baafdb-5209-4f72-99b5-7e07feedb80a'::uuid,
      'c413872d-b0a0-46fb-9392-79fd9d50d5ff'::uuid,
      'c55b1214-d571-48e6-af9f-0c7520746552'::uuid,
      'c87d600f-e9a4-43e5-8a1e-ec288d8bef45'::uuid,
      'f8f0410b-35bc-47ef-ba68-dec9a3362420'::uuid,
      'f9ddae3c-7f2a-4404-8c1a-d9d1bccd4cb9'::uuid,
      'fb1d8703-38ff-4ca0-b178-3c2a0e668d00'::uuid,
      'b670f70f-d8c0-45fd-b441-54c739bbb2d2'::uuid
     )
  ) then
    raise exception 'Favorite selection changed since the snapshot; review before clearing';
  end if;

  update public.bookmarks
     set is_favorite = false, fav_order = 0
   where is_favorite or fav_order <> 0;

  update public.bookmarks
     set is_favorite = true, fav_order = 0
   where id = v_jiinsi_id;

  if (select count(*) from public.bookmarks where is_favorite) <> 1
     or not exists (
       select 1 from public.bookmarks where id = v_jiinsi_id and is_favorite and fav_order = 0
     ) then
    raise exception 'Favorites reset verification failed';
  end if;
end;
$migration$;
commit;
