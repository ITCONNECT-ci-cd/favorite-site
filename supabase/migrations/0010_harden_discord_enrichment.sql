-- 0009 runtime RPC를 방금 생성된 Discord 행과 claim-token 전용 Storage URL로 더 좁힌다.
-- 운영 worker는 ingest success 직후 실행되므로 10분 창이면 충분하고, 오래된 누락은 관리자
-- session 또는 명시적인 backup+repair 절차가 담당한다.

do $$
begin
  execute pg_catalog.format('grant discord_favicon_owner to %I', current_user);
end;
$$;
grant create on schema public to discord_favicon_owner;

create or replace function public.discord_ingest_update_metadata(
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
    from private.discord_ingest_provenance as provenance
   where bookmark.id = p_bookmark_id
     and provenance.bookmark_id = bookmark.id
     and provenance.created_at >= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => 600)
     and bookmark.source = 'discord'
     and bookmark.url = p_claimed_url
     and (
       bookmark.title = v_expected_title
       or coalesce(pg_catalog.btrim(bookmark.description), '') = ''
     );
  return found;
end;
$$;

create or replace function public.discord_ingest_claim_favicon(
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
       and provenance.created_at >= request_time.claimed_at - pg_catalog.make_interval(secs => 600)
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

create or replace function public.discord_ingest_finalize_favicon(
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
declare
  v_prefix text :=
    'https://jwpceskhyltegqbwlvav.supabase.co/storage/v1/object/public/favicons/discord/'
    || p_bookmark_id::text || '/' || p_claim_token::text || '.';
begin
  if p_favicon_url is null
     or pg_catalog.char_length(p_favicon_url) > 2048
     or not (
       p_favicon_url = v_prefix || 'png'
       or p_favicon_url = v_prefix || 'ico'
       or p_favicon_url = v_prefix || 'jpg'
       or p_favicon_url = v_prefix || 'gif'
       or p_favicon_url = v_prefix || 'webp'
     ) then
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

revoke execute on function public.discord_ingest_update_metadata(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.discord_ingest_claim_favicon(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.discord_ingest_finalize_favicon(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.discord_ingest_update_metadata(uuid, text, text, text, text)
  to discord_ingest_runtime;
grant execute on function public.discord_ingest_claim_favicon(uuid, text)
  to discord_ingest_runtime;
grant execute on function public.discord_ingest_finalize_favicon(uuid, uuid, text, text)
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
    raise exception 'unsafe favicon owner membership after 0010' using errcode = '42501';
  end if;
end;
$$;
