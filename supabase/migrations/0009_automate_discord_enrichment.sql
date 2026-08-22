-- Discord ingest 응답 뒤의 제한된 metadata/favicon worker가 사용할 최소 RPC다.
-- runtime role에는 table 권한을 열지 않고, 방금 저장한 exact bookmark id+URL에 대한
-- metadata fill 및 token-fenced favicon write만 허용한다.

do $$
begin
  execute pg_catalog.format('grant discord_favicon_owner to %I', current_user);
end;
$$;
grant create on schema public to discord_favicon_owner;

grant select (title, description) on public.bookmarks to discord_favicon_owner;
grant update (title, description) on public.bookmarks to discord_favicon_owner;

-- 기존 no-fetch 정책으로 hostname/NULL 설명이 저장된 8건을 현재 사이트 내용에 맞춰 보정한다.
-- ID+URL+source를 모두 맞추고 빈 설명/기존 hostname title만 바꿔 관리자 수정과 경쟁하지 않는다.
with corrections(id, url, expected_title, title, description) as (
  values
    ('72b83f88-8f76-4ccc-8424-48d06b9b39e2'::uuid, 'https://ai.keywert.com/about', 'ai.keywert.com',
     '키워트 인사이트', '대화형 AI로 특허 검색과 명세서·조사보고서 작성을 돕는 특허 리서치 플랫폼'),
    ('9aa15c93-cc2d-4418-ad64-d259e70c177b'::uuid, 'https://welaunch.kr/', 'welaunch.kr',
     '위런치', '스타트업·벤처투자·딥테크 산업의 최신 소식과 분석을 전하는 전문 미디어'),
    ('f268f8cf-1530-4d82-902f-3c3c45863f96'::uuid, 'https://tldr.tech/', 'tldr.tech',
     'TLDR Tech', '스타트업·기술·프로그래밍 주요 소식을 짧게 요약해 보내는 일일 뉴스레터'),
    ('47e4af23-264c-4629-b9b2-b1f73d232402'::uuid, 'https://www.therundown.ai/', 'www.therundown.ai',
     'The Rundown AI', 'AI 뉴스와 실무 활용법을 매일 5분 분량으로 정리해 보내는 뉴스레터'),
    ('9be49832-0091-4aa0-b714-99f74af380e6'::uuid, 'https://newsletter.theaireport.ai/', 'newsletter.theaireport.ai',
     'The AI Report', '비전문가도 이해할 수 있게 AI 산업 동향과 활용 정보를 정리하는 뉴스레터'),
    ('f21b3b7e-5d48-488a-bd76-f0ffd3328af2'::uuid, 'https://www.mindstream.news/', 'www.mindstream.news',
     'Mindstream', 'AI 뉴스·의견·설문과 주요 이슈를 큐레이션해 전하는 뉴스레터'),
    ('d05c3710-bbd9-4270-948a-899b82124448'::uuid, 'https://aibreakfast.beehiiv.com/', 'aibreakfast.beehiiv.com',
     'AI Breakfast', '최신 AI 프로젝트·제품·뉴스를 선별해 매주 분석하는 뉴스레터'),
    ('d1277582-aa2d-4333-aa27-f7dd360a7442'::uuid, 'https://www.themiilk.com/', 'www.themiilk.com',
     '더밀크', '실리콘밸리 혁신 산업과 미국 주식 정보를 분석해 전하는 미디어')
)
update public.bookmarks as bookmark
   set title = case when bookmark.title = corrections.expected_title then corrections.title else bookmark.title end,
       description = case
         when coalesce(pg_catalog.btrim(bookmark.description), '') = '' then corrections.description
         else bookmark.description
       end
  from corrections
 where bookmark.id = corrections.id
   and bookmark.url = corrections.url
   and bookmark.source = 'discord'
   and (
     bookmark.title = corrections.expected_title
     or coalesce(pg_catalog.btrim(bookmark.description), '') = ''
   );

create function public.discord_ingest_update_metadata(
  p_bookmark_id uuid,
  p_claimed_url text,
  p_expected_title text,
  p_enriched_title text,
  p_enriched_description text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_expected_title text := pg_catalog.left(pg_catalog.btrim(coalesce(p_expected_title, '')), 120);
  v_enriched_title text := pg_catalog.btrim(coalesce(p_enriched_title, ''));
  v_enriched_description text := pg_catalog.btrim(coalesce(p_enriched_description, ''));
begin
  if p_bookmark_id is null
     or p_claimed_url is null
     or p_claimed_url = ''
     or pg_catalog.char_length(p_claimed_url) > 2048
     or v_expected_title = ''
     or v_enriched_title = ''
     or pg_catalog.char_length(v_enriched_title) > 120
     or v_enriched_description = ''
     or pg_catalog.char_length(v_enriched_description) > 200 then
    raise exception 'discord metadata arguments are invalid' using errcode = '22023';
  end if;

  update public.bookmarks as bookmark
     set title = case
           when bookmark.title = v_expected_title then v_enriched_title
           else bookmark.title
         end,
         description = case
           when coalesce(pg_catalog.btrim(bookmark.description), '') = ''
             then v_enriched_description
           else bookmark.description
         end
   where bookmark.id = p_bookmark_id
     and bookmark.source = 'discord'
     and bookmark.url = p_claimed_url
     and (
       bookmark.title = v_expected_title
       or coalesce(pg_catalog.btrim(bookmark.description), '') = ''
     );
  return found;
end;
$$;

create function public.discord_ingest_claim_favicon(
  p_bookmark_id uuid,
  p_claimed_url text
)
returns table (claim_token uuid)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
begin
  if p_bookmark_id is null
     or p_claimed_url is null
     or p_claimed_url = ''
     or pg_catalog.char_length(p_claimed_url) > 2048 then
    raise exception 'discord favicon claim arguments are invalid' using errcode = '22023';
  end if;

  return query
  with request_time as (
    select pg_catalog.clock_timestamp() as claimed_at
  ), candidate as (
    select provenance.bookmark_id
      from private.discord_ingest_provenance as provenance
      join public.bookmarks as bookmark on bookmark.id = provenance.bookmark_id
      cross join request_time
     where provenance.bookmark_id = p_bookmark_id
       and bookmark.source = 'discord'
       and bookmark.url = p_claimed_url
       and bookmark.favicon_url is null
       and (
         provenance.favicon_claimed_until is null
         or provenance.favicon_claimed_until <= request_time.claimed_at
       )
     for update of provenance
  ), claimed as (
    update private.discord_ingest_provenance as provenance
       set favicon_last_attempted_at = request_time.claimed_at,
           favicon_last_attempted_url = p_claimed_url,
           favicon_claimed_until = request_time.claimed_at + pg_catalog.make_interval(secs => 120),
           favicon_claim_token = pg_catalog.gen_random_uuid()
      from candidate, request_time
     where provenance.bookmark_id = candidate.bookmark_id
    returning provenance.favicon_claim_token as token
  )
  select claimed.token from claimed;
end;
$$;

create function public.discord_ingest_finalize_favicon(
  p_bookmark_id uuid,
  p_claim_token uuid,
  p_claimed_url text,
  p_favicon_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
begin
  if p_favicon_url is null
     or p_favicon_url = ''
     or pg_catalog.char_length(p_favicon_url) > 2048 then
    raise exception 'favicon_url is invalid' using errcode = '22023';
  end if;

  perform 1
    from private.discord_ingest_provenance as provenance
   where provenance.bookmark_id = p_bookmark_id
     and provenance.favicon_claim_token = p_claim_token
     and provenance.favicon_last_attempted_url = p_claimed_url
     and provenance.favicon_claimed_until > pg_catalog.clock_timestamp()
   for update;
  if not found then return false; end if;

  update public.bookmarks as bookmark
     set favicon_url = p_favicon_url
   where bookmark.id = p_bookmark_id
     and bookmark.source = 'discord'
     and bookmark.favicon_url is null
     and bookmark.url = p_claimed_url;
  if not found then return false; end if;

  update private.discord_ingest_provenance as provenance
     set favicon_claimed_until = null,
         favicon_claim_token = null
   where provenance.bookmark_id = p_bookmark_id
     and provenance.favicon_claim_token = p_claim_token
     and provenance.favicon_last_attempted_url = p_claimed_url;
  return found;
end;
$$;

create function public.discord_ingest_fail_favicon(
  p_bookmark_id uuid,
  p_claim_token uuid,
  p_claimed_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
begin
  update private.discord_ingest_provenance as provenance
     set favicon_claimed_until = null,
         favicon_claim_token = null
    from public.bookmarks as bookmark
   where provenance.bookmark_id = p_bookmark_id
     and provenance.favicon_claim_token = p_claim_token
     and provenance.favicon_last_attempted_url = p_claimed_url
     and bookmark.id = provenance.bookmark_id
     and bookmark.source = 'discord'
     and bookmark.favicon_url is null
     and bookmark.url = p_claimed_url;
  return found;
end;
$$;

alter function public.discord_ingest_update_metadata(uuid, text, text, text, text)
  owner to discord_favicon_owner;
alter function public.discord_ingest_claim_favicon(uuid, text)
  owner to discord_favicon_owner;
alter function public.discord_ingest_finalize_favicon(uuid, uuid, text, text)
  owner to discord_favicon_owner;
alter function public.discord_ingest_fail_favicon(uuid, uuid, text)
  owner to discord_favicon_owner;

revoke execute on function public.discord_ingest_update_metadata(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.discord_ingest_claim_favicon(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.discord_ingest_finalize_favicon(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.discord_ingest_fail_favicon(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.discord_ingest_update_metadata(uuid, text, text, text, text)
  to discord_ingest_runtime;
grant execute on function public.discord_ingest_claim_favicon(uuid, text)
  to discord_ingest_runtime;
grant execute on function public.discord_ingest_finalize_favicon(uuid, uuid, text, text)
  to discord_ingest_runtime;
grant execute on function public.discord_ingest_fail_favicon(uuid, uuid, text)
  to discord_ingest_runtime;

revoke create on schema public from discord_favicon_owner;
do $$
begin
  execute pg_catalog.format('revoke discord_favicon_owner from %I', current_user);
end;
$$;

do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as owned_role on owned_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
     where owned_role.rolname = 'discord_favicon_owner'
       and member_role.rolname = current_user
       and (membership.inherit_option or membership.set_option)
  ) then
    raise exception 'unsafe favicon owner membership after 0009' using errcode = '42501';
  end if;
end;
$$;
