-- 0006_discord_link_auto_ingest.sql
--
-- Discord에서 전달된 링크를 최소 권한 함수 한 번으로 등록하기 위한 데이터베이스 경계다.
-- 이 migration은 기존 데이터를 자동 수정하지 않는다. URL/길이/중복 preflight가 한 건이라도
-- 실패하면 전체 transaction을 중단하고, 운영자는 backup 뒤 별도 remediation을 승인해야 한다.

-- ---------------------------------------------------------------------------
-- 1. URL parser/canonicalizer (versioned; v1은 이후 CREATE OR REPLACE 금지)
-- ---------------------------------------------------------------------------

create function public.normalize_bookmark_url_v1(p_url text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_match text[];
  v_scheme text;
  v_authority text;
  v_tail text;
  v_host text;
  v_port_text text;
  v_port integer;
  v_path_query text;
  v_preserved_fragment text;
  v_path text;
  v_query text;
  v_query_out text;
  v_label text;
  v_octet text;
begin
  -- URL 저장자는 ingest/app 경계에서 trim한다. normalizer 자체는 공백을 허용하지 않는다.
  if p_url = ''
     or p_url collate pg_catalog."C" ~ '[[:cntrl:] ]'
     or pg_catalog.strpos(p_url, E'\\') > 0
     or pg_catalog.strpos(
       pg_catalog.regexp_replace(p_url, '%[0-9A-Fa-f]{2}', '', 'g'),
       '%'
     ) > 0 then
    return null;
  end if;

  v_match := pg_catalog.regexp_match(
    p_url,
    '^([Hh][Tt][Tt][Pp][Ss]?)://([^/?#]+)(.*)$'
  );
  if v_match is null then
    return null;
  end if;

  v_scheme := pg_catalog.translate(
    v_match[1],
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );
  v_authority := v_match[2];
  v_tail := v_match[3];

  -- userinfo, bracket IPv6, raw colon ambiguity는 지원 문법 밖이다.
  if pg_catalog.strpos(v_authority, '@') > 0
     or pg_catalog.strpos(v_authority, '[') > 0
     or pg_catalog.strpos(v_authority, ']') > 0 then
    return null;
  end if;

  if pg_catalog.strpos(v_authority, ':') > 0 then
    v_match := pg_catalog.regexp_match(v_authority, '^([^:]+):([0-9]+)$');
    if v_match is null then
      return null;
    end if;
    v_host := v_match[1];
    v_port_text := v_match[2];

    -- 선행 0 포트는 동등 URL 표현을 늘리므로 보수적으로 거부한다.
    if v_port_text !~ '^[1-9][0-9]{0,4}$' then
      return null;
    end if;
    v_port := v_port_text::integer;
    if v_port > 65535 then
      return null;
    end if;
  else
    v_host := v_authority;
    v_port_text := null;
    v_port := null;
  end if;

  if v_host = '' or pg_catalog.char_length(v_host) > 253 then
    return null;
  end if;

  -- 숫자와 점으로만 된 host는 DNS 이름으로 fallback하지 않고 엄격한 IPv4로 판정한다.
  if v_host ~ '^[0-9.]+$' then
    if pg_catalog.array_length(pg_catalog.string_to_array(v_host, '.'), 1) <> 4 then
      return null;
    end if;
    foreach v_octet in array pg_catalog.string_to_array(v_host, '.') loop
      if v_octet !~ '^(0|[1-9][0-9]{0,2})$' or v_octet::integer > 255 then
        return null;
      end if;
    end loop;
  else
    -- ASCII DNS와 localhost/단일 label을 허용한다. IDN은 punycode로 전달해야 한다.
    foreach v_label in array pg_catalog.string_to_array(v_host, '.') loop
      if pg_catalog.char_length(v_label) > 63
         or v_label !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$' then
        return null;
      end if;
    end loop;
  end if;

  v_host := pg_catalog.translate(
    v_host,
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );

  -- 일반 anchor fragment는 제거한다. 다만 `#/`는 SPA route identity이므로 뒤의 `?`까지
  -- opaque fragment text로 그대로 보존하고 query tracking 규칙을 적용하지 않는다.
  if pg_catalog.strpos(v_tail, '#') > 0 then
    v_preserved_fragment := pg_catalog.substr(v_tail, pg_catalog.strpos(v_tail, '#'));
    if pg_catalog.left(v_preserved_fragment, 2) <> '#/' then
      v_preserved_fragment := null;
    end if;
  else
    v_preserved_fragment := null;
  end if;

  v_path_query := pg_catalog.split_part(v_tail, '#', 1);
  if pg_catalog.strpos(v_path_query, '?') > 0 then
    v_path := pg_catalog.substr(v_path_query, 1, pg_catalog.strpos(v_path_query, '?') - 1);
    v_query := pg_catalog.substr(v_path_query, pg_catalog.strpos(v_path_query, '?') + 1);
  else
    v_path := v_path_query;
    v_query := null;
  end if;

  -- authority 다음의 비어 있지 않은 path는 반드시 /로 시작해야 한다.
  if v_path <> '' and pg_catalog.left(v_path, 1) <> '/' then
    return null;
  end if;
  v_path := pg_catalog.regexp_replace(v_path, '/+$', '', 'g');

  if v_query is not null and v_query <> '' then
    select pg_catalog.string_agg(
      q.segment,
      '&' order by q.name collate pg_catalog."C", q.ordinality
    )
      into v_query_out
      from (
        select
          parts.segment,
          pg_catalog.split_part(parts.segment, '=', 1) as name,
          parts.ordinality
        from pg_catalog.regexp_split_to_table(v_query, '&')
          with ordinality as parts(segment, ordinality)
      ) as q
     where not (
       q.name collate pg_catalog."C" ~ '^[Uu][Tt][Mm]_'
       or q.name collate pg_catalog."C" ~ '^[Gg][Cc][Ll][Ii][Dd]$'
       or q.name collate pg_catalog."C" ~ '^[Ff][Bb][Cc][Ll][Ii][Dd]$'
       or q.name collate pg_catalog."C" ~ '^[Ii][Gg][Ss][Hh][Ii][Dd]$'
     );
  else
    v_query_out := null;
  end if;

  if (v_scheme = 'http' and v_port = 80)
     or (v_scheme = 'https' and v_port = 443) then
    v_port_text := null;
  end if;

  return v_scheme || '://' || v_host
    || case when v_port_text is null then '' else ':' || v_port_text end
    || v_path
    || case when v_query_out is null or v_query_out = '' then '' else '?' || v_query_out end
    || coalesce(v_preserved_fragment, '');
end;
$$;

revoke execute on function public.normalize_bookmark_url_v1(text) from public;
revoke execute on function public.normalize_bookmark_url_v1(text) from anon;
revoke execute on function public.normalize_bookmark_url_v1(text) from authenticated;
revoke execute on function public.normalize_bookmark_url_v1(text) from service_role;

-- 0001 trigger helper의 생성 시 PUBLIC EXECUTE도 runtime의 함수 allowlist를 넓힌다.
-- trigger 실행에는 호출자의 직접 EXECUTE가 필요하지 않으므로 외부 호출권을 모두 닫는다.
revoke execute on function public.set_updated_at() from public, anon, authenticated, service_role;

-- DDL 직전 write를 막아 preflight와 constraint 생성 사이의 race를 닫는다.
lock table public.bookmarks in access exclusive mode;

do $$
declare
  v_failures jsonb;
begin
  with row_failures as (
    select b.id, 'invalid_url'::text as reason, null::text as collision_key
      from public.bookmarks as b
     where public.normalize_bookmark_url_v1(b.url) is null
    union all
    select b.id, 'url_length'::text, null::text
      from public.bookmarks as b
     where pg_catalog.char_length(b.url) not between 1 and 2048
    union all
    select b.id, 'title_empty'::text, null::text
      from public.bookmarks as b
     where pg_catalog.btrim(b.title) = ''
    union all
    select b.id, 'title_length'::text, null::text
      from public.bookmarks as b
     where pg_catalog.char_length(b.title) > 120
    union all
    select b.id, 'description_length'::text, null::text
      from public.bookmarks as b
     where b.description is not null and pg_catalog.char_length(b.description) > 200
    union all
    select b.id, 'normalized_collision'::text, collisions.normalized_url
      from public.bookmarks as b
      join (
        select public.normalize_bookmark_url_v1(url) as normalized_url
          from public.bookmarks
         group by public.normalize_bookmark_url_v1(url)
        having pg_catalog.count(*) > 1
      ) as collisions
        on collisions.normalized_url = public.normalize_bookmark_url_v1(b.url)
  )
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', failures.id,
      'reason', failures.reason,
      'collision_key', failures.collision_key
    )
    order by failures.reason, failures.id
  )
    into v_failures
    from (select * from row_failures limit 100) as failures;

  if v_failures is not null then
    raise exception 'discord ingest migration preflight failed'
      using errcode = '23514',
            detail = v_failures::text,
            hint = 'Do not auto-fix. Back up the database, approve row-by-row remediation, then rerun the read-only preflight.';
  end if;
end;
$$;

alter table public.bookmarks
  add column source text not null default 'manual',
  add column normalized_url text generated always as
    (public.normalize_bookmark_url_v1(url)) stored;

alter table public.bookmarks
  alter column normalized_url set not null,
  add constraint bookmarks_source_check
    check (source in ('manual', 'discord')),
  add constraint bookmarks_url_canonicalizable_check
    check (
      pg_catalog.char_length(url) between 1 and 2048
      and normalized_url is not null
    ),
  add constraint bookmarks_title_length_check
    check (pg_catalog.btrim(title) <> '' and pg_catalog.char_length(title) <= 120),
  add constraint bookmarks_description_length_check
    check (description is null or pg_catalog.char_length(description) <= 200),
  add constraint bookmarks_normalized_url_key unique (normalized_url);

-- ---------------------------------------------------------------------------
-- 2. Roles, default privileges, private stores, and RLS
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'discord_ingest_owner') then
    create role discord_ingest_owner
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'discord_favicon_owner') then
    create role discord_favicon_owner
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'discord_ingest_runtime') then
    -- 비밀번호는 migration에 넣지 않는다. 운영 secret 발급 단계에서 별도로 설정한다.
    create role discord_ingest_runtime
      login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls
      connection limit 2;
  end if;
end;
$$;

-- Supabase의 migration runner는 CREATEROLE이지만 hosted 환경에서 실제 SUPERUSER는 아니다.
-- 따라서 SUPERUSER/BYPASSRLS 속성을 ALTER로 토글하지 않고, 생성 절에서 안전값을 고정한 뒤
-- 기존 역할이 있었다면 아래 catalog audit가 fail-loud하게 한다.
alter role discord_ingest_owner nologin noinherit;
alter role discord_favicon_owner nologin noinherit;
alter role discord_ingest_runtime login noinherit connection limit 2;

do $$
declare
  v_unsafe_roles text;
begin
  select pg_catalog.string_agg(role.rolname, ', ' order by role.rolname)
    into v_unsafe_roles
    from pg_catalog.pg_roles as role
   where role.rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
     and (
       role.rolsuper
       or role.rolcreatedb
       or role.rolcreaterole
       or role.rolreplication
       or role.rolbypassrls
     );
  if v_unsafe_roles is not null then
    raise exception 'unsafe pre-existing discord roles: %', v_unsafe_roles
      using errcode = '42501',
            hint = 'A database superuser must remove elevated attributes before this migration can continue.';
  end if;
end;
$$;

-- ALTER FUNCTION ... OWNER는 새 owner로 SET ROLE할 수 있어야 한다. migration 실행 역할에만
-- 임시 membership을 주고, 파일 끝에서 즉시 회수해 최종 membership graph를 비운다.
do $$
begin
  execute pg_catalog.format('grant discord_ingest_owner to %I', current_user);
  execute pg_catalog.format('grant discord_favicon_owner to %I', current_user);
end;
$$;
alter role discord_ingest_runtime set statement_timeout = '5s';
alter role discord_ingest_runtime set lock_timeout = '1s';
alter role discord_ingest_runtime set idle_in_transaction_session_timeout = '10s';

-- 기존에 실수로 membership이 생겼다면 migration 적용 자체가 권한 합성을 제거한다.
revoke discord_ingest_owner from discord_ingest_runtime;
revoke discord_favicon_owner from discord_ingest_runtime;
revoke discord_favicon_owner from discord_ingest_owner;
revoke discord_ingest_owner from discord_favicon_owner;

do $$
begin
  execute pg_catalog.format(
    'grant connect on database %I to discord_ingest_runtime',
    pg_catalog.current_database()
  );
end;
$$;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
revoke all on schema private from service_role;
revoke all on schema private from discord_ingest_runtime;
grant usage on schema private to discord_ingest_owner, discord_favicon_owner;
grant usage on schema public to discord_ingest_owner, discord_favicon_owner, discord_ingest_runtime;
-- 새 함수로 ownership을 넘기는 동안에만 필요한 권한이며 파일 끝에서 회수한다.
grant create on schema private, public to discord_ingest_owner, discord_favicon_owner;

-- Supabase의 legacy broad routine defaults가 새 SECURITY DEFINER RPC를 자동 노출하지 않게 한다.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role, discord_ingest_runtime;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role, discord_ingest_runtime;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated, service_role, discord_ingest_runtime;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role, discord_ingest_runtime;

create table private.discord_ingest_provenance (
  bookmark_id uuid primary key
    references public.bookmarks(id) on delete cascade,
  message_id varchar(20) not null
    check (message_id ~ '^[0-9]{17,20}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  favicon_last_attempted_at timestamptz,
  favicon_last_attempted_url text,
  favicon_claimed_until timestamptz,
  favicon_claim_token uuid,
  constraint discord_ingest_provenance_claim_pair_check check (
    (favicon_claimed_until is null) = (favicon_claim_token is null)
  )
);

create table private.discord_ingest_receipts (
  message_id varchar(20) not null
    check (message_id ~ '^[0-9]{17,20}$'),
  url_key bytea not null
    check (pg_catalog.octet_length(url_key) = 32),
  normalized_url text,
  result_code text not null
    check (result_code in ('success', 'duplicate_url', 'invalid_url', 'url_too_long', 'invalid_category')),
  first_seen_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (message_id, url_key),
  constraint discord_ingest_receipts_exact_expiry_check check (
    expires_at = first_seen_at + pg_catalog.make_interval(secs => 7776000)
  )
);
create index discord_ingest_receipts_expiry_idx
  on private.discord_ingest_receipts (expires_at);

create table private.discord_ingest_rate_events (
  id bigint generated always as identity primary key,
  attempted_at timestamptz not null
);
create index discord_ingest_rate_events_time_idx
  on private.discord_ingest_rate_events (attempted_at, id);

alter table private.discord_ingest_provenance enable row level security;
alter table private.discord_ingest_receipts enable row level security;
alter table private.discord_ingest_rate_events enable row level security;

create policy discord_ingest_owner_provenance_insert
  on private.discord_ingest_provenance for insert to discord_ingest_owner
  with check (true);
create policy discord_ingest_owner_receipts
  on private.discord_ingest_receipts for all to discord_ingest_owner
  using (true) with check (true);
create policy discord_ingest_owner_rate_events
  on private.discord_ingest_rate_events for all to discord_ingest_owner
  using (true) with check (true);

create policy discord_favicon_owner_provenance_select
  on private.discord_ingest_provenance for select to discord_favicon_owner
  using (true);
create policy discord_favicon_owner_provenance_update
  on private.discord_ingest_provenance for update to discord_favicon_owner
  using (true) with check (true);

create policy discord_ingest_owner_categories_select
  on public.categories for select to discord_ingest_owner
  using (true);
create policy discord_ingest_runtime_categories_select
  on public.categories for select to discord_ingest_runtime
  using (true);
create policy discord_ingest_owner_bookmarks_select
  on public.bookmarks for select to discord_ingest_owner
  using (true);
create policy discord_ingest_owner_bookmarks_insert
  on public.bookmarks for insert to discord_ingest_owner
  with check (
    source = 'discord'
    and favicon_url is null
    and is_pinned = false
    and tags = '{}'::text[]
  );
create policy discord_favicon_owner_bookmarks_select
  on public.bookmarks for select to discord_favicon_owner
  using (true);
create policy discord_favicon_owner_bookmarks_update
  on public.bookmarks for update to discord_favicon_owner
  using (source = 'discord') with check (source = 'discord');

-- runtime은 public 전체를 먼저 닫고 category 4-column + ingest RPC만 뒤에서 연다.
revoke all on all tables in schema public from discord_ingest_runtime;
revoke all on all sequences in schema public from discord_ingest_runtime;
revoke execute on all functions in schema public from discord_ingest_runtime;
revoke all on all tables in schema private from public, anon, authenticated, service_role, discord_ingest_runtime;
revoke all on all sequences in schema private from public, anon, authenticated, service_role, discord_ingest_runtime;
revoke execute on all functions in schema private from public, anon, authenticated, service_role, discord_ingest_runtime;

grant select (id, name, parent_id, sort_order)
  on public.categories to discord_ingest_runtime;
grant select (id, name, parent_id)
  on public.categories to discord_ingest_owner;
grant select (id, category_id, title, normalized_url, sort_order)
  on public.bookmarks to discord_ingest_owner;
grant insert (category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source)
  on public.bookmarks to discord_ingest_owner;
grant insert on private.discord_ingest_provenance to discord_ingest_owner;
grant select, insert, update, delete on private.discord_ingest_receipts to discord_ingest_owner;
grant select, insert, delete on private.discord_ingest_rate_events to discord_ingest_owner;
grant usage, select on sequence private.discord_ingest_rate_events_id_seq to discord_ingest_owner;

grant select (id, url, source, favicon_url, created_at)
  on public.bookmarks to discord_favicon_owner;
grant update (favicon_url)
  on public.bookmarks to discord_favicon_owner;
grant select on private.discord_ingest_provenance to discord_favicon_owner;
grant update (
  favicon_last_attempted_at,
  favicon_last_attempted_url,
  favicon_claimed_until,
  favicon_claim_token
) on private.discord_ingest_provenance to discord_favicon_owner;

grant execute on function public.normalize_bookmark_url_v1(text)
  to discord_ingest_owner, discord_favicon_owner, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Receipt retention and bounded ingest transaction
-- ---------------------------------------------------------------------------

create function private.cleanup_discord_ingest_receipts()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from private.discord_ingest_receipts
   where expires_at <= pg_catalog.clock_timestamp();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function private.cleanup_discord_ingest_receipts() owner to discord_ingest_owner;
revoke execute on function private.cleanup_discord_ingest_receipts() from public;
revoke execute on function private.cleanup_discord_ingest_receipts() from anon;
revoke execute on function private.cleanup_discord_ingest_receipts() from authenticated;
revoke execute on function private.cleanup_discord_ingest_receipts() from service_role;
revoke execute on function private.cleanup_discord_ingest_receipts() from discord_ingest_runtime;

create function public.ingest_bookmark(
  p_url text,
  p_title text,
  p_description text,
  p_category_id text,
  p_message_id text
)
returns table (
  result_code text,
  bookmark_id uuid,
  title text,
  category_name text,
  retry_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_rate_before integer;
  v_retry_at timestamptz;
  v_raw_url text := pg_catalog.btrim(coalesce(p_url, ''));
  v_normalized_url text;
  v_url_key bytea;
  v_category_id uuid;
  v_category_name text;
  v_existing_category_name text;
  v_saved_title text;
  v_saved_description text;
  v_bookmark_id uuid;
  v_constraint_name text;
  v_sqlstate text;
begin
  -- 기다리는 advisory lock은 agent가 outer transaction으로 붙들 수 있으므로 사용하지 않는다.
  if not pg_catalog.pg_try_advisory_xact_lock(821937472833609260::bigint) then
    raise exception 'discord ingest is busy' using errcode = '55P03';
  end if;

  delete from private.discord_ingest_rate_events
   where attempted_at <= v_now - pg_catalog.make_interval(secs => 600);
  select pg_catalog.count(*)::integer
    into v_rate_before
    from private.discord_ingest_rate_events;

  insert into private.discord_ingest_rate_events (attempted_at) values (v_now);
  delete from private.discord_ingest_rate_events as rate_event
   where rate_event.id not in (
     select kept.id
       from private.discord_ingest_rate_events as kept
      order by kept.attempted_at desc, kept.id desc
      limit 30
   );

  if v_rate_before >= 30 then
    select pg_catalog.min(attempted_at) + pg_catalog.make_interval(secs => 600)
      into v_retry_at
      from private.discord_ingest_rate_events;
    return query select 'rate_limited'::text, null::uuid, null::text, null::text, v_retry_at;
    return;
  end if;

  if p_message_id is null or p_message_id !~ '^[0-9]{17,20}$' then
    return query select 'invalid_message_id'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if pg_catalog.char_length(v_raw_url) > 2048 then
    v_url_key := pg_catalog.sha256(pg_catalog.convert_to(v_raw_url, 'UTF8'));

    delete from private.discord_ingest_receipts
     where message_id = p_message_id and url_key = v_url_key and expires_at <= v_now;
    if exists (
      select 1 from private.discord_ingest_receipts
       where message_id = p_message_id and url_key = v_url_key and expires_at > v_now
    ) then
      return query select 'duplicate_message'::text, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;

    insert into private.discord_ingest_receipts
      (message_id, url_key, normalized_url, result_code, first_seen_at, expires_at)
    values
      (p_message_id, v_url_key, null, 'url_too_long', v_now,
       v_now + pg_catalog.make_interval(secs => 7776000));
    return query select 'url_too_long'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_normalized_url := public.normalize_bookmark_url_v1(v_raw_url);
  if v_normalized_url is null then
    v_url_key := pg_catalog.sha256(pg_catalog.convert_to(v_raw_url, 'UTF8'));

    delete from private.discord_ingest_receipts
     where message_id = p_message_id and url_key = v_url_key and expires_at <= v_now;
    if exists (
      select 1 from private.discord_ingest_receipts
       where message_id = p_message_id and url_key = v_url_key and expires_at > v_now
    ) then
      return query select 'duplicate_message'::text, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;

    insert into private.discord_ingest_receipts
      (message_id, url_key, normalized_url, result_code, first_seen_at, expires_at)
    values
      (p_message_id, v_url_key, null, 'invalid_url', v_now,
       v_now + pg_catalog.make_interval(secs => 7776000));
    return query select 'invalid_url'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_url_key := pg_catalog.sha256(pg_catalog.convert_to(v_normalized_url, 'UTF8'));
  delete from private.discord_ingest_receipts
   where message_id = p_message_id and url_key = v_url_key and expires_at <= v_now;
  if exists (
    select 1 from private.discord_ingest_receipts
     where message_id = p_message_id and url_key = v_url_key and expires_at > v_now
  ) then
    return query select 'duplicate_message'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- Transaction-local claim. internal_error는 commit 전에 반드시 삭제되므로 terminal receipt로 남지 않는다.
  insert into private.discord_ingest_receipts
    (message_id, url_key, normalized_url, result_code, first_seen_at, expires_at)
  values
    (p_message_id, v_url_key, v_normalized_url, 'invalid_category', v_now,
     v_now + pg_catalog.make_interval(secs => 7776000));

  if p_category_id is null
     or p_category_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return query select 'invalid_category'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;
  v_category_id := p_category_id::uuid;

  select category.name
    into v_category_name
    from public.categories as category
   where category.id = v_category_id
     and not exists (
       select 1 from public.categories as child where child.parent_id = category.id
     );
  if not found then
    return query select 'invalid_category'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select existing.id, existing.title, category.name
    into v_bookmark_id, v_saved_title, v_existing_category_name
    from public.bookmarks as existing
    left join public.categories as category on category.id = existing.category_id
   where existing.normalized_url = v_normalized_url;
  if found then
    update private.discord_ingest_receipts
       set result_code = 'duplicate_url'
     where message_id = p_message_id and url_key = v_url_key;
    return query select 'duplicate_url'::text, null::uuid, v_saved_title, v_existing_category_name, null::timestamptz;
    return;
  end if;

  v_saved_title := pg_catalog.btrim(coalesce(p_title, ''));
  if v_saved_title = '' then
    v_saved_title := pg_catalog.split_part(
      pg_catalog.split_part(v_normalized_url, '://', 2),
      ':',
      1
    );
  end if;
  v_saved_title := pg_catalog.left(v_saved_title, 120);

  v_saved_description := pg_catalog.btrim(coalesce(p_description, ''));
  if v_saved_description = '' then
    v_saved_description := null;
  else
    v_saved_description := pg_catalog.left(v_saved_description, 200);
  end if;

  begin
    insert into public.bookmarks (
      category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, source
    )
    values (
      v_category_id,
      v_saved_title,
      v_raw_url,
      v_saved_description,
      '{}'::text[],
      null,
      false,
      coalesce((
        select pg_catalog.max(existing.sort_order) + 1
          from public.bookmarks as existing
         where existing.category_id = v_category_id
      ), 0),
      'discord'
    )
    returning id into v_bookmark_id;

    insert into private.discord_ingest_provenance (bookmark_id, message_id, created_at)
    values (v_bookmark_id, p_message_id, v_now);

    update private.discord_ingest_receipts
       set result_code = 'success'
     where message_id = p_message_id and url_key = v_url_key;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'bookmarks_normalized_url_key' then
        select existing.id, existing.title, category.name
          into v_bookmark_id, v_saved_title, v_existing_category_name
          from public.bookmarks as existing
          left join public.categories as category on category.id = existing.category_id
         where existing.normalized_url = v_normalized_url;
        update private.discord_ingest_receipts
           set result_code = 'duplicate_url'
         where message_id = p_message_id and url_key = v_url_key;
        return query select 'duplicate_url'::text, null::uuid, v_saved_title, v_existing_category_name, null::timestamptz;
        return;
      end if;

      delete from private.discord_ingest_receipts
       where message_id = p_message_id and url_key = v_url_key;
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      raise log 'discord ingest internal error SQLSTATE %, constraint %', v_sqlstate, v_constraint_name;
      return query select 'internal_error'::text, null::uuid, null::text, null::text, null::timestamptz;
      return;
    when query_canceled then
      raise;
    when lock_not_available then
      raise;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint_name = constraint_name;
      delete from private.discord_ingest_receipts
       where message_id = p_message_id and url_key = v_url_key;
      raise log 'discord ingest internal error SQLSTATE %, constraint %', v_sqlstate, v_constraint_name;
      return query select 'internal_error'::text, null::uuid, null::text, null::text, null::timestamptz;
      return;
  end;

  return query select 'success'::text, v_bookmark_id, v_saved_title, v_category_name, null::timestamptz;
end;
$$;

alter function public.ingest_bookmark(text, text, text, text, text) owner to discord_ingest_owner;
revoke execute on function public.ingest_bookmark(text, text, text, text, text) from public;
revoke execute on function public.ingest_bookmark(text, text, text, text, text) from anon;
revoke execute on function public.ingest_bookmark(text, text, text, text, text) from authenticated;
revoke execute on function public.ingest_bookmark(text, text, text, text, text) from service_role;
grant execute on function public.ingest_bookmark(text, text, text, text, text) to discord_ingest_runtime;

-- 관리자 링크 정렬은 JS의 여러 UPDATE로는 tie와 부분 실패를 원자적으로 해소할 수 없다.
-- SECURITY INVOKER로 실행해 기존 관리자 RLS를 그대로 적용하고, 전체 stable order를 한 transaction에서
-- 재번호화한다. requested 밖 행은 기존 global position과 상대 순서를 유지한다.
grant select on public.bookmarks to authenticated;
grant update (sort_order) on public.bookmarks to authenticated;
create function public.admin_reorder_bookmarks(ordered_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_email text;
  v_found integer;
  v_total integer;
  v_updated integer;
begin
  begin
    v_email := pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'email';
  exception when invalid_text_representation then
    v_email := null;
  end;
  if pg_catalog.lower(coalesce(v_email, '')) <> 'contact@itconnect.dev' then
    raise exception '링크 정렬은 관리자 전용입니다' using errcode = '42501';
  end if;

  if ordered_ids is null
     or pg_catalog.cardinality(ordered_ids) = 0
     or pg_catalog.array_position(ordered_ids, null::uuid) is not null
     or (
       select pg_catalog.count(distinct requested.id)
         from pg_catalog.unnest(ordered_ids) as requested(id)
     ) <> pg_catalog.cardinality(ordered_ids) then
    raise exception 'ordered_ids must be nonempty, unique UUIDs without nulls' using errcode = '22023';
  end if;

  lock table public.bookmarks in share row exclusive mode;

  select pg_catalog.count(*)::integer into v_total from public.bookmarks;
  with current_order as (
    select bookmark.id,
           pg_catalog.row_number() over (order by bookmark.sort_order, bookmark.id) as global_position
      from public.bookmarks as bookmark
  ), requested as (
    select request.id, request.ordinality
      from pg_catalog.unnest(ordered_ids) with ordinality as request(id, ordinality)
  )
  select pg_catalog.count(*)::integer
    into v_found
    from requested
    join current_order using (id);

  if v_found = 0 then
    raise exception 'none of the requested bookmarks exist' using errcode = 'P0002';
  end if;

  with current_order as (
    select bookmark.id,
           pg_catalog.row_number() over (order by bookmark.sort_order, bookmark.id) as global_position
      from public.bookmarks as bookmark
  ), requested as (
    select request.id, request.ordinality
      from pg_catalog.unnest(ordered_ids) with ordinality as request(id, ordinality)
  ), found as (
    select current_order.id, current_order.global_position, requested.ordinality
      from current_order
      join requested using (id)
  ), occupied_positions as (
    select found.global_position,
           pg_catalog.row_number() over (order by found.global_position) as request_rank
      from found
  ), requested_order as (
    select found.id,
           pg_catalog.row_number() over (order by found.ordinality) as request_rank
      from found
  ), final_positions as (
    select requested_order.id, occupied_positions.global_position
      from requested_order
      join occupied_positions using (request_rank)
    union all
    select current_order.id, current_order.global_position
      from current_order
     where not exists (select 1 from found where found.id = current_order.id)
  )
  update public.bookmarks as bookmark
     set sort_order = (final_positions.global_position - 1)::integer
    from final_positions
   where bookmark.id = final_positions.id;
  get diagnostics v_updated = row_count;

  if v_updated <> v_total then
    raise exception 'bookmark reorder did not update the full stable sequence' using errcode = '40001';
  end if;
  return v_found;
end;
$$;
revoke execute on function public.admin_reorder_bookmarks(uuid[]) from public, anon, service_role, discord_ingest_runtime;
grant execute on function public.admin_reorder_bookmarks(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin-only fair favicon claims and triple-CAS completion
-- ---------------------------------------------------------------------------

create function private.assert_discord_favicon_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  begin
    v_email := (
      pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'email'
    );
  exception when invalid_text_representation then
    v_email := null;
  end;
  if pg_catalog.lower(coalesce(v_email, '')) <> 'contact@itconnect.dev' then
    raise exception '자동 파비콘 작업은 관리자 전용입니다' using errcode = '42501';
  end if;
end;
$$;
alter function private.assert_discord_favicon_admin() owner to discord_favicon_owner;
revoke execute on function private.assert_discord_favicon_admin() from public;
revoke execute on function private.assert_discord_favicon_admin() from anon;
revoke execute on function private.assert_discord_favicon_admin() from authenticated;
revoke execute on function private.assert_discord_favicon_admin() from service_role;
revoke execute on function private.assert_discord_favicon_admin() from discord_ingest_runtime;

create function public.admin_claim_discord_favicons(limit_n integer default 10)
returns table (bookmark_id uuid, claimed_url text, claim_token uuid)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
begin
  perform private.assert_discord_favicon_admin();
  if limit_n is null or limit_n < 1 or limit_n > 10 then
    raise exception 'limit_n must be between 1 and 10' using errcode = '22023';
  end if;

  return query
  with request_time as (
    select pg_catalog.clock_timestamp() as claimed_at
  ), candidates as (
    select provenance.bookmark_id, bookmark.url
      from private.discord_ingest_provenance as provenance
      join public.bookmarks as bookmark on bookmark.id = provenance.bookmark_id
      cross join request_time
     where bookmark.source = 'discord'
       and bookmark.favicon_url is null
       and (
         provenance.favicon_claimed_until is null
         or provenance.favicon_claimed_until <= request_time.claimed_at
       )
     order by
       case
         when provenance.favicon_last_attempted_at is null
           or provenance.favicon_last_attempted_url is distinct from bookmark.url then 0
         else 1
       end,
       case
         when provenance.favicon_last_attempted_at is null
           or provenance.favicon_last_attempted_url is distinct from bookmark.url then null
         else provenance.favicon_last_attempted_at
       end asc nulls first,
       bookmark.created_at,
       bookmark.id
     for update of provenance skip locked
     limit limit_n
  ), claimed as (
    update private.discord_ingest_provenance as provenance
       set favicon_last_attempted_at = request_time.claimed_at,
           favicon_last_attempted_url = candidates.url,
           favicon_claimed_until = request_time.claimed_at + pg_catalog.make_interval(secs => 120),
           favicon_claim_token = pg_catalog.gen_random_uuid()
      from candidates, request_time
     where provenance.bookmark_id = candidates.bookmark_id
    returning provenance.bookmark_id, provenance.favicon_last_attempted_url, provenance.favicon_claim_token
  )
  select claimed.bookmark_id, claimed.favicon_last_attempted_url, claimed.favicon_claim_token
    from claimed;
end;
$$;

create function public.admin_finalize_discord_favicon(
  bookmark_id uuid,
  claim_token uuid,
  claimed_url text,
  favicon_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
begin
  perform private.assert_discord_favicon_admin();
  if favicon_url is null or favicon_url = '' or pg_catalog.char_length(favicon_url) > 2048 then
    raise exception 'favicon_url is invalid' using errcode = '22023';
  end if;

  perform 1
    from private.discord_ingest_provenance as provenance
   where provenance.bookmark_id = $1
     and provenance.favicon_claim_token = $2
     and provenance.favicon_last_attempted_url = $3
     and provenance.favicon_claimed_until > pg_catalog.clock_timestamp()
   for update;
  if not found then
    return false;
  end if;

  update public.bookmarks as bookmark
     set favicon_url = $4
   where bookmark.id = $1
     and bookmark.source = 'discord'
     and bookmark.favicon_url is null
     and bookmark.url = $3;
  if not found then
    return false;
  end if;

  update private.discord_ingest_provenance as provenance
     set favicon_claimed_until = null,
         favicon_claim_token = null
   where provenance.bookmark_id = $1
     and provenance.favicon_claim_token = $2
     and provenance.favicon_last_attempted_url = $3;
  return found;
end;
$$;

create function public.admin_fail_discord_favicon(
  bookmark_id uuid,
  claim_token uuid,
  claimed_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
begin
  perform private.assert_discord_favicon_admin();
  update private.discord_ingest_provenance as provenance
     set favicon_claimed_until = null,
         favicon_claim_token = null
    from public.bookmarks as bookmark
   where provenance.bookmark_id = $1
     and provenance.favicon_claim_token = $2
     and provenance.favicon_last_attempted_url = $3
     and bookmark.id = provenance.bookmark_id
     and bookmark.source = 'discord'
     and bookmark.favicon_url is null
     and bookmark.url = $3;
  return found;
end;
$$;

create function public.admin_release_discord_favicon(
  bookmark_id uuid,
  claim_token uuid,
  claimed_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
begin
  perform private.assert_discord_favicon_admin();
  update private.discord_ingest_provenance as provenance
     set favicon_claimed_until = null,
         favicon_claim_token = null
    from public.bookmarks as bookmark
   where provenance.bookmark_id = $1
     and provenance.favicon_claim_token = $2
     and provenance.favicon_last_attempted_url = $3
     and bookmark.id = provenance.bookmark_id
     and bookmark.source = 'discord'
     and bookmark.favicon_url is null
     and bookmark.url = $3;
  return found;
end;
$$;

create function public.admin_count_pending_discord_favicons()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.assert_discord_favicon_admin();
  select pg_catalog.count(*)::integer
    into v_count
    from private.discord_ingest_provenance as provenance
    join public.bookmarks as bookmark on bookmark.id = provenance.bookmark_id
   where bookmark.source = 'discord' and bookmark.favicon_url is null;
  return v_count;
end;
$$;

-- finalize 응답이 transport에서 유실됐을 때 DB commit 여부를 안전하게 재확인한다.
-- bookmark가 있으면 정확히 한 행, 없으면 0행을 반환한다.
create function public.admin_get_discord_favicon_reference(bookmark_id uuid)
returns table (favicon_url text, active_claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform private.assert_discord_favicon_admin();
  if $1 is null then
    raise exception 'bookmark_id is required' using errcode = '22023';
  end if;

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

-- 24시간 이상 된 discord/ Storage object reconciliation용 최소 참조 목록이다.
-- source가 수동으로 바뀌었거나 service repair된 행도 live Storage URL을 참조할 수
-- 있으므로 모든 bookmark를 기준으로 하고, active token만 Discord provenance에서 읽는다.
-- DB service-role 접근은 열지 않고, 관리자 세션이 URL 참조와 아직 유효한 claim token만 받는다.
create function public.admin_list_discord_favicon_references()
returns table (bookmark_id uuid, favicon_url text, active_claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform private.assert_discord_favicon_admin();
  return query
  select
    bookmark.id,
    bookmark.favicon_url,
    case
      when provenance.favicon_claimed_until > v_now
        then provenance.favicon_claim_token
      else null::uuid
    end
    from public.bookmarks as bookmark
    left join private.discord_ingest_provenance as provenance
      on provenance.bookmark_id = bookmark.id
   where (
       bookmark.favicon_url is not null
       or provenance.favicon_claimed_until > v_now
     );
end;
$$;

alter function public.admin_claim_discord_favicons(integer) owner to discord_favicon_owner;
alter function public.admin_finalize_discord_favicon(uuid, uuid, text, text) owner to discord_favicon_owner;
alter function public.admin_fail_discord_favicon(uuid, uuid, text) owner to discord_favicon_owner;
alter function public.admin_release_discord_favicon(uuid, uuid, text) owner to discord_favicon_owner;
alter function public.admin_count_pending_discord_favicons() owner to discord_favicon_owner;
alter function public.admin_get_discord_favicon_reference(uuid) owner to discord_favicon_owner;
alter function public.admin_list_discord_favicon_references() owner to discord_favicon_owner;

revoke execute on function public.admin_claim_discord_favicons(integer) from public, anon, service_role, discord_ingest_runtime;
revoke execute on function public.admin_finalize_discord_favicon(uuid, uuid, text, text) from public, anon, service_role, discord_ingest_runtime;
revoke execute on function public.admin_fail_discord_favicon(uuid, uuid, text) from public, anon, service_role, discord_ingest_runtime;
revoke execute on function public.admin_release_discord_favicon(uuid, uuid, text) from public, anon, service_role, discord_ingest_runtime;
revoke execute on function public.admin_count_pending_discord_favicons() from public, anon, service_role, discord_ingest_runtime;
revoke execute on function public.admin_get_discord_favicon_reference(uuid) from public, anon, service_role, discord_ingest_runtime;
revoke execute on function public.admin_list_discord_favicon_references() from public, anon, service_role, discord_ingest_runtime;
grant execute on function public.admin_claim_discord_favicons(integer) to authenticated;
grant execute on function public.admin_finalize_discord_favicon(uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_fail_discord_favicon(uuid, uuid, text) to authenticated;
grant execute on function public.admin_release_discord_favicon(uuid, uuid, text) to authenticated;
grant execute on function public.admin_count_pending_discord_favicons() to authenticated;
grant execute on function public.admin_get_discord_favicon_reference(uuid) to authenticated;
grant execute on function public.admin_list_discord_favicon_references() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Daily retention cron and final ACL closure
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'discord-ingest-receipt-cleanup';
select cron.schedule(
  'discord-ingest-receipt-cleanup',
  '17 3 * * *',
  'select private.cleanup_discord_ingest_receipts();'
);

-- 생성 시점의 implicit/default grants까지 마지막에 다시 닫는다.
revoke all on all tables in schema private from public, anon, authenticated, service_role, discord_ingest_runtime;
revoke all on all sequences in schema private from public, anon, authenticated, service_role, discord_ingest_runtime;
revoke execute on all functions in schema private from public, anon, authenticated, service_role, discord_ingest_runtime;
grant execute on function private.cleanup_discord_ingest_receipts() to discord_ingest_owner;
-- pg_cron job은 migration 역할(postgres) 이름으로 실행된다. owner 이전 뒤에도 실행 가능해야 한다.
grant execute on function private.cleanup_discord_ingest_receipts() to postgres;
grant execute on function private.assert_discord_favicon_admin() to discord_favicon_owner;
revoke create on schema private, public from discord_ingest_owner, discord_favicon_owner;

do $$
begin
  execute pg_catalog.format('revoke discord_ingest_owner from %I', current_user);
  execute pg_catalog.format('revoke discord_favicon_owner from %I', current_user);
  execute pg_catalog.format('revoke discord_ingest_runtime from %I', current_user);
end;
$$;

do $$
declare
  v_memberships text;
begin
  -- Supabase PG17은 CREATEROLE 시 superuser `supabase_admin`이 creator에게 ADMIN-only
  -- (INHERIT=false, SET=false) 행을 강제로 남긴다. hosted migration role은 이를 회수할 수 없다.
  -- 이 platform row는 권한 상속/전환을 허용하지 않으므로 정확한 shape만 예외로 하고 나머지를 거부한다.
  select pg_catalog.string_agg(
    granted.rolname || '->' || member.rolname,
    ', ' order by granted.rolname, member.rolname
  )
    into v_memberships
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
    join pg_catalog.pg_roles as member on member.oid = membership.member
    join pg_catalog.pg_roles as grantor on grantor.oid = membership.grantor
   where (
     granted.rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
     or member.rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
   )
     and not (
       granted.rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
       and member.rolname = current_user
       and grantor.rolname = 'supabase_admin'
       and membership.admin_option
       and not membership.inherit_option
       and not membership.set_option
     );
  if v_memberships is not null then
    raise exception 'unexpected discord role membership: %', v_memberships using errcode = '42501';
  end if;
end;
$$;

-- PostgREST가 새 public RPC signatures를 즉시 보게 한다.
notify pgrst, 'reload schema';
