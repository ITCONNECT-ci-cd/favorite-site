-- Preserve category/bookmark identity while making 바이브코딩 a three-leaf group.
begin;
lock table public.categories in share row exclusive mode;
lock table public.bookmarks in share row exclusive mode;

do $migration$
declare
  v_vibe constant uuid := '9a5325d2-f82f-4687-b4c3-887fb4feb7fa';
  v_ai constant uuid := '56bca6dd-7333-4bf9-b4ea-3319de5f0237';
  v_design constant uuid := '357c9ec8-1f7e-4072-a578-28e7007e523e';
  v_code constant uuid := '0466fe3e-7887-42cd-8f1d-6209973ad818';
  v_review constant uuid := '9355bb1f-7fba-40d6-bf8a-9301a0a7f387';
  v_jiro constant uuid := '556fd17c-8427-4529-96f0-8b3d9203dcd1';
  v_tools constant uuid := 'cf70e080-7131-4749-a567-ea093f93de08';
  v_expected text[] := array[
    'https://github.com/NomaDamas/k-skill',
    'https://github.com/rullerzhou-afk/clawd-on-desk',
    'https://github.com/whiteport-collective/whiteport-design-studio',
    'https://github.com/ultraworkers/claw-code',
    'https://github.com/ysys143/analyze-cc-prompts',
    'https://github.com/phuryn/pm-skills',
    'https://github.com/chopratejas/headroom',
    'https://github.com/VoltAgent/awesome-design-md/tree/main',
    'https://github.com/zarazhangrui/frontend-slides'
  ];
begin
  if not exists (select 1 from public.categories where id = v_vibe and name = '바이브코딩' and parent_id is null and sort_order = 0)
     or not exists (select 1 from public.categories where id = v_ai and name = 'AI 도구 모음' and parent_id is null) then
    raise exception 'Unexpected 바이브코딩/AI 도구 모음 roots';
  end if;

  if exists (select 1 from public.categories where id = v_tools and parent_id = v_vibe and name = '도구모음') then
    -- Exact completed shape only. Reruns must not overwrite later administrator changes.
    if (select count(*) from public.categories where parent_id = v_vibe) <> 3
       or not exists (select 1 from public.categories where id = v_tools and sort_order = 0)
       or not exists (select 1 from public.categories where id = v_design and parent_id = v_vibe and name = '디자인' and sort_order = 1)
       or not exists (select 1 from public.categories where id = v_code and parent_id = v_vibe and name = '코딩/에이전트' and sort_order = 2)
       or exists (select 1 from public.bookmarks where category_id = v_vibe)
       or exists (select 1 from public.categories where parent_id in (v_tools, v_design, v_code)) then
      raise exception 'Partially applied or subsequently changed 바이브코딩 hierarchy';
    end if;
    return;
  end if;

  if exists (select 1 from public.categories where parent_id in (v_vibe, v_tools, v_design, v_code))
     or not exists (select 1 from public.categories where id = v_tools and parent_id = v_ai and name = '오픈소스·자료 모음')
     or not exists (select 1 from public.categories where id = v_design and parent_id = v_ai and name = '디자인')
     or not exists (select 1 from public.categories where id = v_code and parent_id = v_ai and name = '코딩·에이전트')
     or not exists (select 1 from public.categories where id = v_review and name = '분류 대기' and parent_id is null) then
    raise exception 'Unexpected source category hierarchy';
  end if;

  if (select count(*) from public.bookmarks where category_id = v_vibe) <> 9
     or (select count(distinct url) from public.bookmarks where category_id = v_vibe and url = any(v_expected)) <> 9
     or (select count(*) from public.bookmarks where category_id = v_design) <> 10
     or (select count(*) from public.bookmarks where category_id = v_code) <> 21 then
    raise exception 'Source bookmark inventory changed; review before migration';
  end if;
  if (select count(*) from public.bookmarks where category_id = v_tools) <> 3
     or (select count(distinct url) from public.bookmarks where category_id = v_tools and url in (
       'https://github.com/zeroclaw-labs/zeroclaw',
       'https://github.com/ZeroLu/awesome-gpt-image',
       'https://github.com/pim97/anti-detect-browser-tools-tech-comparison'
     )) <> 3 then
    raise exception 'Existing GitHub collection changed; review before migration';
  end if;
  if not exists (select 1 from public.bookmarks where id = v_jiro and url = 'https://jiro.build/' and category_id = v_review and source = 'discord')
     or not exists (select 1 from public.bookmarks where id = '5ec956b9-ae6e-4054-a341-42e5648d6f0c' and url = 'https://21st.dev/?tab=home' and category_id = v_code)
     or not exists (select 1 from public.bookmarks where id = '732250d2-21ed-423d-b6d1-88d3419c1051' and url = 'https://v0.app/templates/blog-and-portfolio' and category_id = v_code) then
    raise exception 'Jiro or design-resource identity/category changed';
  end if;

  update public.bookmarks set sort_order = case url
    when 'https://github.com/zeroclaw-labs/zeroclaw' then 9
    when 'https://github.com/ZeroLu/awesome-gpt-image' then 10
    else 11 end where category_id = v_tools;
  update public.categories set name = '도구모음', parent_id = v_vibe, sort_order = 0 where id = v_tools;
  update public.bookmarks set category_id = v_tools where category_id = v_vibe;
  update public.categories set parent_id = v_vibe, sort_order = 1 where id = v_design;
  update public.categories set parent_id = v_vibe, name = '코딩/에이전트', sort_order = 2 where id = v_code;

  -- Actual implementation resources belong with Jiro in 디자인, not coding services.
  update public.bookmarks set category_id = v_design, sort_order = 246 where id = v_jiro;
  update public.bookmarks set category_id = v_design, sort_order = 247 where id = '5ec956b9-ae6e-4054-a341-42e5648d6f0c';
  update public.bookmarks set category_id = v_design, sort_order = 248 where id = '732250d2-21ed-423d-b6d1-88d3419c1051';
end;
$migration$;
commit;
