-- Resolve an ambiguous favicon finalize only after any in-flight finalize
-- transaction has committed or rolled back. A lock wait beyond one second is
-- deliberately surfaced to the caller, which then preserves the object for
-- reconciliation instead of guessing that the finalize was uncommitted.
-- Supabase creates an ADMIN-only, SET=false owner membership for the migration
-- role. Add a separate transaction-scoped effective membership, replace the
-- owner-owned function without changing the CLI's outer role, then revoke only
-- the temporary grant. Avoid RESET ROLE: hosted CLI sessions may have a
-- different session_user underneath their migration role.
do $$
begin
  execute pg_catalog.format(
    'grant discord_favicon_owner to %I',
    current_user
  );
end;
$$;
grant create on schema public to discord_favicon_owner;

create or replace function public.admin_get_discord_favicon_reference(bookmark_id uuid)
returns table (favicon_url text, active_claim_token uuid)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_now timestamptz;
begin
  perform private.assert_discord_favicon_admin();
  if $1 is null then
    raise exception 'bookmark_id is required' using errcode = '22023';
  end if;

  -- admin_finalize_discord_favicon locks and finally clears this provenance
  -- row in the same transaction as the bookmark URL update. Waiting on the
  -- same row makes the following read authoritative after that transaction.
  perform 1
    from private.discord_ingest_provenance as provenance
   where provenance.bookmark_id = $1
   for update;

  v_now := pg_catalog.clock_timestamp();
  return query
  select
    bookmark.favicon_url,
    case
      when provenance.favicon_claimed_until > v_now
        then provenance.favicon_claim_token
      else null::uuid
    end
    from public.bookmarks as bookmark
    left join private.discord_ingest_provenance as provenance
      on provenance.bookmark_id = bookmark.id
   where bookmark.id = $1;
end;
$$;

revoke execute on function public.admin_get_discord_favicon_reference(uuid)
  from public, anon, service_role, discord_ingest_runtime;
grant execute on function public.admin_get_discord_favicon_reference(uuid) to authenticated;

revoke create on schema public from discord_favicon_owner;
do $$
begin
  execute pg_catalog.format(
    'revoke discord_favicon_owner from %I',
    current_user
  );
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
    raise exception 'unsafe favicon owner membership after 0007' using errcode = '42501';
  end if;
end;
$$;
