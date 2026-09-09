-- Display the product name only; preserve the Korean description and other fields.
begin;
do $migration$
declare
  v_title text;
begin
  select title into v_title from public.bookmarks
   where id = '556fd17c-8427-4529-96f0-8b3d9203dcd1'
     and url = 'https://jiro.build/'
   for update;
  if not found then
    raise exception 'Jiro identity changed; review before renaming';
  end if;
  if v_title = 'Jiro' then return; end if;
  if v_title is distinct from 'Jiro — The Design Prompt Library to Vibe Code Better Websites' then
    raise exception 'Jiro title was edited; refusing to overwrite it';
  end if;
  update public.bookmarks set title = 'Jiro'
   where id = '556fd17c-8427-4529-96f0-8b3d9203dcd1';
end;
$migration$;
commit;
