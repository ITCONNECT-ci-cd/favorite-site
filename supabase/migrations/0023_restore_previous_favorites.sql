-- Restore only the 19 favorites and their order from the pre-reset snapshot.
-- Keep the newly requested JIINSI news link after the restored selection.
-- Operating-site copy, icons, category order, bookmark rows and click history are untouched.
begin;
lock table public.bookmarks in share row exclusive mode;

create temporary table previous_favorites (
  id uuid primary key,
  url text not null,
  fav_order integer not null unique
) on commit drop;
insert into previous_favorites values
  ('bd12f640-4efc-4fab-ac9c-86e035fd0008'::uuid, 'https://chat.openai.com/', 0),
  ('c413872d-b0a0-46fb-9392-79fd9d50d5ff'::uuid, 'https://claude.ai/login?returnTo=%2F%3F', 1),
  ('16bec72a-86ba-4caa-ab10-b3d10fb13dc7'::uuid, 'https://gemini.google.com/app', 2),
  ('c3baafdb-5209-4f72-99b5-7e07feedb80a'::uuid, 'https://www.perplexity.ai/', 3),
  ('1d14c1fd-39b7-4116-9247-f6a08a21d559'::uuid, 'https://liner.com/ko', 4),
  ('acd37d63-a567-423c-8bbc-309b832eb464'::uuid, 'https://www.genspark.ai/', 5),
  ('1021286a-213c-4305-b811-f5b33e858f21'::uuid, 'https://skywork.ai/', 6),
  ('f9ddae3c-7f2a-4404-8c1a-d9d1bccd4cb9'::uuid, 'https://aistudio.google.com/prompts/new_chat', 7),
  ('182919f7-a910-4c4f-a2d9-1d658e69c694'::uuid, 'https://grok.com/', 8),
  ('6f483af0-2278-4a67-8307-c7b5413c9932'::uuid, 'https://lilys.ai/', 9),
  ('c87d600f-e9a4-43e5-8a1e-ec288d8bef45'::uuid, 'https://aitrends.kr/', 10),
  ('c55b1214-d571-48e6-af9f-0c7520746552'::uuid, 'https://news.hada.io/', 11),
  ('c1fa58ab-10fa-4c45-a209-2823623a3c76'::uuid, 'https://www.aitimes.com/', 12),
  ('fb1d8703-38ff-4ca0-b178-3c2a0e668d00'::uuid, 'https://www.aitimes.kr/', 13),
  ('f8f0410b-35bc-47ef-ba68-dec9a3362420'::uuid, 'https://aimatters.co.kr/', 14),
  ('37f48658-0d37-4f41-8e3b-a930465726fa'::uuid, 'https://news.aikoreacommunity.com/', 15),
  ('484f92d9-b73f-45e8-84ff-8ae9524bfe53'::uuid, 'https://www.gpters.org/newsletter', 16),
  ('b9f6aeb6-a421-46ce-898a-0fde4b6d1519'::uuid, 'https://blog.secondbrush.co.kr/', 17),
  ('97c09f85-d136-4a62-89e6-910098c79c13'::uuid, 'https://yozm.wishket.com/magazine/', 18);

do $migration$
declare
  v_jiinsi_id constant uuid := 'b670f70f-d8c0-45fd-b441-54c739bbb2d2';
  v_count integer;
begin
  select count(*) into v_count
    from previous_favorites f
    join public.bookmarks b on b.id = f.id
   where b.normalized_url = public.normalize_bookmark_url_v1(f.url);
  if v_count <> 19 then
    raise exception 'Favorite identities changed; expected 19, matched %', v_count;
  end if;

  if not exists (
    select 1 from public.bookmarks
     where id = v_jiinsi_id and is_favorite
       and normalized_url = public.normalize_bookmark_url_v1('https://jiinsi.com/')
  ) then
    raise exception 'Expected the newly added JIINSI favorite';
  end if;

  if exists (
    select 1 from public.bookmarks b
     where b.is_favorite and b.id <> v_jiinsi_id
       and not exists (select 1 from previous_favorites f where f.id = b.id)
  ) then
    raise exception 'Favorite selection changed after the reset; review before restoring';
  end if;

  update public.bookmarks b
     set is_favorite = true, fav_order = f.fav_order
    from previous_favorites f
   where b.id = f.id
     and (not b.is_favorite or b.fav_order is distinct from f.fav_order);

  update public.bookmarks
     set fav_order = 19
   where id = v_jiinsi_id and fav_order is distinct from 19;

  select count(*) into v_count
    from previous_favorites f
    join public.bookmarks b on b.id = f.id
   where b.is_favorite and b.fav_order = f.fav_order;
  if v_count <> 19
     or (select count(*) from public.bookmarks where is_favorite) <> 20
     or not exists (
       select 1 from public.bookmarks
        where id = v_jiinsi_id and is_favorite and fav_order = 19
     ) then
    raise exception 'Restored favorite count or order did not match the snapshot';
  end if;
end;
$migration$;
commit;
