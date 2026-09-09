-- Jiro's existing English metadata was preserved during 0016. Localize only its description.
begin;
do $migration$
declare
  v_row public.bookmarks%rowtype;
  v_description constant text := '디자인 예시의 프롬프트를 복사해 바이브코딩 도구로 웹사이트를 만드는 디자인 자료 모음';
  v_original constant text := $original$You know how your website should look & feel, but can't describe it to AI? Jiro fixes that. Browse real design → Copy prompt → Paste into vibe coding tool → Ship fast.$original$;
begin
  select * into v_row from public.bookmarks
   where id = '556fd17c-8427-4529-96f0-8b3d9203dcd1'
     and url = 'https://jiro.build/' and source = 'discord'
   for update;
  if not found then
    raise exception 'Jiro identity changed; review before localization';
  end if;
  if v_row.description = v_description then return; end if;
  if v_row.description is distinct from v_original then
    raise exception 'Jiro description was edited; refusing to overwrite it';
  end if;
  update public.bookmarks set description = v_description where id = v_row.id;
end;
$migration$;
commit;
