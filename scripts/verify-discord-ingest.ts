import { readFile } from 'node:fs/promises';

import { Client, type QueryResultRow } from 'pg';

import { normalizeBookmarkUrlV1 } from '@/lib/bookmark-url';

const DATABASE_URL_ENV = 'DISCORD_INGEST_ADMIN_DATABASE_URL';
const MIGRATION_PATH = new URL('../supabase/migrations/0006_discord_link_auto_ingest.sql', import.meta.url);
const FAVICON_FENCE_MIGRATION_PATH = new URL(
  '../supabase/migrations/0007_fence_favicon_reference_read.sql',
  import.meta.url,
);
const ADMIN_EMAIL = 'contact@itconnect.dev';

type Mode = 'preflight' | 'integration';
type BookmarkRow = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  url_length: number;
  title_length: number;
  description_length: number | null;
  trimmed_title: string;
};
type PreflightFailure = { id: string; reason: string; collisionKey: string | null };

function parseMode(): Mode {
  const flags = new Set(process.argv.slice(2));
  if (flags.size !== 1 || (!flags.has('--preflight') && !flags.has('--integration'))) {
    throw new Error(
      '사용법: tsx scripts/verify-discord-ingest.ts --preflight|--integration\n' +
        '  --preflight   원격에서도 안전한 READ ONLY 데이터/catalog 검사\n' +
        '  --integration localhost 전용 fixture/RPC/ACL 검사(끝에서 ROLLBACK)',
    );
  }
  return flags.has('--integration') ? 'integration' : 'preflight';
}

function resolveDatabaseUrl(mode: Mode): string {
  const value = (process.env[DATABASE_URL_ENV] ?? '').trim();
  if (value === '') {
    throw new Error(
      `${DATABASE_URL_ENV}가 비어 있습니다. admin/test DSN은 .env 파일에 저장하지 말고 ` +
        '현재 프로세스 환경에만 주입하세요.',
    );
  }

  const parsed = new URL(value);
  if (mode === 'integration' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error('--integration은 운영 쓰기를 막기 위해 localhost DB에서만 실행할 수 있습니다.');
  }
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function staticMigrationGuard(): Promise<void> {
  const source = await readFile(MIGRATION_PATH, 'utf8');
  const faviconFenceSource = await readFile(FAVICON_FENCE_MIGRATION_PATH, 'utf8');
  assert(
    !/create\s+or\s+replace\s+function\s+public\.normalize_bookmark_url_v1/i.test(source),
    'v1 normalizer를 CREATE OR REPLACE로 바꾸면 stored generated 값/index가 조용히 drift합니다.',
  );
  assert(
    /create\s+function\s+public\.normalize_bookmark_url_v1/i.test(source),
    'versioned SQL normalizer 정의가 없습니다.',
  );
  assert(
    /constraint\s+bookmarks_normalized_url_key\s+unique/i.test(source),
    '수동 mutation 오류 매핑에 쓰는 고정 URL unique constraint가 없습니다.',
  );
  assert(
    /create\s+or\s+replace\s+function\s+public\.admin_get_discord_favicon_reference[\s\S]*?for\s+update/i.test(
      faviconFenceSource,
    ),
    '0007 favicon authoritative read에 provenance FOR UPDATE fence가 없습니다.',
  );
}

async function readOnlyDataPreflight(client: Client): Promise<PreflightFailure[]> {
  await client.query('BEGIN READ ONLY');
  try {
    const rows = await client.query<BookmarkRow>(`
      select id::text, url, title, description,
             pg_catalog.char_length(url)::integer as url_length,
             pg_catalog.char_length(title)::integer as title_length,
             case when description is null then null
                  else pg_catalog.char_length(description)::integer end as description_length,
             pg_catalog.btrim(title) as trimmed_title
        from public.bookmarks
       order by id
    `);

    const failures: PreflightFailure[] = [];
    const normalizedGroups = new Map<string, string[]>();

    for (const row of rows.rows) {
      const normalized = normalizeBookmarkUrlV1(row.url);
      if (normalized === null) failures.push({ id: row.id, reason: 'invalid_url', collisionKey: null });
      if (row.url_length < 1 || row.url_length > 2048) {
        failures.push({ id: row.id, reason: 'url_length', collisionKey: null });
      }
      if (row.trimmed_title === '') failures.push({ id: row.id, reason: 'title_empty', collisionKey: null });
      if (row.title_length > 120) failures.push({ id: row.id, reason: 'title_length', collisionKey: null });
      if ((row.description_length ?? 0) > 200) {
        failures.push({ id: row.id, reason: 'description_length', collisionKey: null });
      }
      if (normalized !== null) normalizedGroups.set(normalized, [...(normalizedGroups.get(normalized) ?? []), row.id]);
    }

    for (const [collisionKey, ids] of normalizedGroups) {
      if (ids.length < 2) continue;
      for (const id of ids) failures.push({ id, reason: 'normalized_collision', collisionKey });
    }

    await client.query('COMMIT');
    return failures.sort(
      (left, right) => left.reason.localeCompare(right.reason) || left.id.localeCompare(right.id),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function migrationExists(client: Client): Promise<boolean> {
  const result = await client.query<{ oid: string | null }>(
    `select pg_catalog.to_regprocedure('public.ingest_bookmark(text,text,text,text,text)')::text as oid`,
  );
  return result.rows[0]?.oid !== null;
}

async function checkNormalizerCorpus(client: Client): Promise<void> {
  const validCases: Array<[string, string]> = [
    ['HTTPS://Example.COM:443/', 'https://example.com'],
    ['http://EXAMPLE.com:80/a/?utm_source=x&b=2&a=1#top', 'http://example.com/a?a=1&b=2'],
    ['https://e.test/p///', 'https://e.test/p'],
    ['https://e.test/?a=2&a=1&b', 'https://e.test?a=2&a=1&b'],
    ['https://e.test?%75tm_source=x&utm_source=y', 'https://e.test?%75tm_source=x'],
    ['https://e.test?b=&a&b=2&a=', 'https://e.test?a&a=&b=&b=2'],
    ['https://e.test?b=1&&a=2', 'https://e.test?&a=2&b=1'],
    ['https://localhost:8443/', 'https://localhost:8443'],
    ['http://127.0.0.1:80/', 'http://127.0.0.1'],
    ['https://xn--fsq.test/경로?나=값', 'https://xn--fsq.test/경로?나=값'],
    ['https://e.test?#fragment', 'https://e.test'],
    ['https://e.test/path/#section', 'https://e.test/path'],
    ['https://e.test/path/#/route?utm_source=x&gclid=y', 'https://e.test/path#/route?utm_source=x&gclid=y'],
    [
      'https://analytics.google.com/analytics/web/#/p123456789/reports/intelligenthome',
      'https://analytics.google.com/analytics/web#/p123456789/reports/intelligenthome',
    ],
    [
      'https://analytics.google.com/analytics/web/#/p987654321/reports/intelligenthome',
      'https://analytics.google.com/analytics/web#/p987654321/reports/intelligenthome',
    ],
  ];
  const evaluated = await client.query<{ input: string; expected: string; actual: string | null }>(`
    select corpus.input, ($2::text[])[corpus.ordinality] as expected,
           public.normalize_bookmark_url_v1(corpus.input) as actual
      from pg_catalog.unnest($1::text[]) with ordinality as corpus(input, ordinality)
     where public.normalize_bookmark_url_v1(corpus.input)
       is distinct from ($2::text[])[corpus.ordinality]
  `, [validCases.map(([input]) => input), validCases.map(([, expected]) => expected)]);
  assert(
    evaluated.rowCount === 0,
    `SQL normalizer valid corpus drift: ${evaluated.rows.map((row) => `${row.input}=>${row.actual}`).join(', ')}`,
  );

  const invalidInputs = [
    'https://user:pw@e.test/', 'https://[::1]/', 'https://예시.한국/', 'https://e.test/%ZZ',
    ' https://e.test', 'https://e.test\\x', 'https://e.test:0443', 'http://01.2.3.4',
    'http://256.1.1.1', 'https://e.test.', 'https://a..test', 'https://-e.test',
    'https://e_.test', 'https://e.test:0', 'https://e.test:65536',
  ];
  const invalid = await client.query<{ input: string; actual: string }>(`
    select input, public.normalize_bookmark_url_v1(input) as actual
      from pg_catalog.unnest($1::text[]) as corpus(input)
     where public.normalize_bookmark_url_v1(input) is not null
  `, [invalidInputs]);
  assert(invalid.rowCount === 0, `SQL normalizer invalid corpus accepted: ${invalid.rows.map((row) => row.input).join(', ')}`);

  const idempotence = await client.query<{ input: string; normalized: string }>(`
    with normalized as (
      select input, public.normalize_bookmark_url_v1(input) as value
        from pg_catalog.unnest($1::text[]) as corpus(input)
    )
    select input, value as normalized
      from normalized
     where public.normalize_bookmark_url_v1(value) is distinct from value
  `, [validCases.map(([input]) => input)]);
  assert(idempotence.rowCount === 0, 'SQL normalize(normalize(url)) idempotence가 깨졌습니다.');
}

async function checkCatalog(client: Client): Promise<void> {
  await checkNormalizerCorpus(client);
  const roles = await client.query<{
    rolname: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolcanlogin: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolconnlimit: number;
  }>(`
    select rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin,
           rolreplication, rolbypassrls, rolconnlimit
      from pg_catalog.pg_roles
     where rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
     order by rolname
  `);
  assert(roles.rowCount === 3, 'Discord 전용 역할 3개가 모두 존재하지 않습니다.');
  for (const role of roles.rows) {
    assert(
      !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolreplication && !role.rolbypassrls,
      `${role.rolname}에 elevated role attribute가 있습니다.`,
    );
    assert(role.rolcanlogin === (role.rolname === 'discord_ingest_runtime'), `${role.rolname} LOGIN 속성이 틀렸습니다.`);
  }
  assert(
    roles.rows.find((role) => role.rolname === 'discord_ingest_runtime')?.rolconnlimit === 2,
    'discord_ingest_runtime CONNECTION LIMIT가 2가 아닙니다.',
  );

  const memberships = await client.query<{
    granted_role: string;
    member_role: string;
    grantor_role: string;
    admin_option: boolean;
    inherit_option: boolean;
    set_option: boolean;
  }>(`
    select granted.rolname as granted_role,
           member.rolname as member_role,
           grantor.rolname as grantor_role,
           membership.admin_option,
           membership.inherit_option,
           membership.set_option
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles as member on member.oid = membership.member
      join pg_catalog.pg_roles as grantor on grantor.oid = membership.grantor
     where granted.rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
        or member.rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
  `);
  const unsafeMemberships = memberships.rows.filter(
    (row) =>
      !(
        ['discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime'].includes(row.granted_role) &&
        row.member_role === 'postgres' &&
        row.grantor_role === 'supabase_admin' &&
        row.admin_option &&
        !row.inherit_option &&
        !row.set_option
      ),
  );
  assert(
    unsafeMemberships.length === 0,
    `예상 밖 role membership: ${unsafeMemberships.map((row) => `${row.granted_role}->${row.member_role}`).join(', ')}`,
  );

  const publicFunctions = await client.query<{
    signature: string;
    runtime_execute: boolean;
    owner: string;
    security_definer: boolean;
    volatility: string;
    strict: boolean;
    settings: string[] | null;
  }>(`
    select procedure.oid::regprocedure::text as signature,
           pg_catalog.has_function_privilege('discord_ingest_runtime', procedure.oid, 'EXECUTE') as runtime_execute,
           owner.rolname as owner,
           procedure.prosecdef as security_definer,
           procedure.provolatile::text as volatility,
           procedure.proisstrict as strict,
           procedure.proconfig as settings
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
     where namespace.nspname = 'public'
     order by signature
  `);
  const runtimeExecutables = publicFunctions.rows.filter((fn) => fn.runtime_execute).map((fn) => fn.signature);
  assert(
    runtimeExecutables.length === 1 && runtimeExecutables[0] === 'ingest_bookmark(text,text,text,text,text)',
    `runtime 함수 allowlist가 틀렸습니다: ${runtimeExecutables.join(', ') || '(없음)'}`,
  );

  const normalizer = publicFunctions.rows.find((fn) => fn.signature === 'normalize_bookmark_url_v1(text)');
  assert(normalizer, 'normalize_bookmark_url_v1(text)가 없습니다.');
  assert(normalizer.volatility === 'i' && normalizer.strict, 'normalizer가 IMMUTABLE STRICT가 아닙니다.');
  assert(normalizer.settings?.includes('search_path=""'), 'normalizer search_path가 빈 값으로 고정되지 않았습니다.');

  const ingest = publicFunctions.rows.find((fn) => fn.signature === 'ingest_bookmark(text,text,text,text,text)');
  assert(ingest, 'ingest_bookmark 함수가 없습니다.');
  assert(ingest.owner === 'discord_ingest_owner' && ingest.security_definer, 'ingest 함수 owner/definer가 틀렸습니다.');
  assert(ingest.settings?.includes('search_path=""'), 'ingest 함수 search_path가 빈 값으로 고정되지 않았습니다.');
  assert(ingest.settings?.includes('lock_timeout=1s'), 'ingest 함수 lock_timeout이 1초가 아닙니다.');

  const reorder = publicFunctions.rows.find((fn) => fn.signature === 'admin_reorder_bookmarks(uuid[])');
  assert(reorder && !reorder.security_definer, 'admin_reorder_bookmarks가 SECURITY INVOKER가 아닙니다.');
  const reorderAcl = await client.query<{ authenticated: boolean; anon: boolean; runtime: boolean }>(`
    select
      pg_catalog.has_function_privilege('authenticated', 'public.admin_reorder_bookmarks(uuid[])', 'EXECUTE') as authenticated,
      pg_catalog.has_function_privilege('anon', 'public.admin_reorder_bookmarks(uuid[])', 'EXECUTE') as anon,
      pg_catalog.has_function_privilege('discord_ingest_runtime', 'public.admin_reorder_bookmarks(uuid[])', 'EXECUTE') as runtime
  `);
  assert(
    reorderAcl.rows[0]?.authenticated && !reorderAcl.rows[0]?.anon && !reorderAcl.rows[0]?.runtime,
    'admin_reorder_bookmarks EXECUTE ACL이 틀렸습니다.',
  );

  for (const signature of [
    'admin_get_discord_favicon_reference(uuid)',
    'admin_list_discord_favicon_references()',
  ]) {
    const referenceRpc = publicFunctions.rows.find((fn) => fn.signature === signature);
    assert(referenceRpc, `${signature}가 없습니다.`);
    assert(
      referenceRpc.owner === 'discord_favicon_owner' && referenceRpc.security_definer,
      `${signature} owner/definer가 틀렸습니다.`,
    );
    assert(referenceRpc.settings?.includes('search_path=""'), `${signature} search_path가 빈 값으로 고정되지 않았습니다.`);
    if (signature === 'admin_get_discord_favicon_reference(uuid)') {
      assert(referenceRpc.settings?.includes('lock_timeout=1s'), `${signature} lock_timeout이 1초가 아닙니다.`);
    }
  }
  const referenceAcl = await client.query<{
    get_authenticated: boolean;
    get_anon: boolean;
    get_service: boolean;
    get_runtime: boolean;
    list_authenticated: boolean;
    list_anon: boolean;
    list_service: boolean;
    list_runtime: boolean;
  }>(`
    select
      pg_catalog.has_function_privilege('authenticated', 'public.admin_get_discord_favicon_reference(uuid)', 'EXECUTE') as get_authenticated,
      pg_catalog.has_function_privilege('anon', 'public.admin_get_discord_favicon_reference(uuid)', 'EXECUTE') as get_anon,
      pg_catalog.has_function_privilege('service_role', 'public.admin_get_discord_favicon_reference(uuid)', 'EXECUTE') as get_service,
      pg_catalog.has_function_privilege('discord_ingest_runtime', 'public.admin_get_discord_favicon_reference(uuid)', 'EXECUTE') as get_runtime,
      pg_catalog.has_function_privilege('authenticated', 'public.admin_list_discord_favicon_references()', 'EXECUTE') as list_authenticated,
      pg_catalog.has_function_privilege('anon', 'public.admin_list_discord_favicon_references()', 'EXECUTE') as list_anon,
      pg_catalog.has_function_privilege('service_role', 'public.admin_list_discord_favicon_references()', 'EXECUTE') as list_service,
      pg_catalog.has_function_privilege('discord_ingest_runtime', 'public.admin_list_discord_favicon_references()', 'EXECUTE') as list_runtime
  `);
  assert(
    referenceAcl.rows[0]?.get_authenticated &&
      !referenceAcl.rows[0]?.get_anon &&
      !referenceAcl.rows[0]?.get_service &&
      !referenceAcl.rows[0]?.get_runtime &&
      referenceAcl.rows[0]?.list_authenticated &&
      !referenceAcl.rows[0]?.list_anon &&
      !referenceAcl.rows[0]?.list_service &&
      !referenceAcl.rows[0]?.list_runtime,
    'favicon reference RPC EXECUTE ACL이 틀렸습니다.',
  );

  const faviconBookmarkPolicies = await client.query<{
    policy_name: string;
    command: string;
    using_expression: string | null;
    check_expression: string | null;
  }>(`
    select policy.polname as policy_name,
           policy.polcmd::text as command,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) as using_expression,
           pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) as check_expression
      from pg_catalog.pg_policy as policy
     where policy.polrelid = 'public.bookmarks'::regclass
       and policy.polname in (
         'discord_favicon_owner_bookmarks_select',
         'discord_favicon_owner_bookmarks_update'
       )
     order by policy.polname
  `);
  const faviconSelectPolicy = faviconBookmarkPolicies.rows.find(
    (policy) => policy.policy_name === 'discord_favicon_owner_bookmarks_select',
  );
  const faviconUpdatePolicy = faviconBookmarkPolicies.rows.find(
    (policy) => policy.policy_name === 'discord_favicon_owner_bookmarks_update',
  );
  assert(
    faviconSelectPolicy?.command === 'r' && faviconSelectPolicy.using_expression === 'true',
    'favicon owner SELECT RLS가 모든 bookmark 참조를 허용하지 않습니다.',
  );
  assert(
    faviconUpdatePolicy?.command === 'w' &&
      faviconUpdatePolicy.using_expression?.includes("source = 'discord'::text") &&
      faviconUpdatePolicy.check_expression?.includes("source = 'discord'::text"),
    'favicon owner UPDATE RLS가 source=discord로 제한되지 않습니다.',
  );

  const columns = await client.query<{ column_name: string; allowed: boolean }>(`
    select column_name,
           pg_catalog.has_column_privilege(
             'discord_ingest_runtime',
             'public.categories',
             column_name,
             'SELECT'
           ) as allowed
      from information_schema.columns
     where table_schema = 'public' and table_name = 'categories'
     order by ordinal_position
  `);
  const allowedColumns = columns.rows.filter((column) => column.allowed).map((column) => column.column_name);
  assert(
    JSON.stringify(allowedColumns) === JSON.stringify(['id', 'name', 'parent_id', 'sort_order']),
    `runtime category column allowlist가 틀렸습니다: ${allowedColumns.join(', ')}`,
  );

  const forbiddenTables = await client.query<{ relation: string; privilege: string }>(`
    with targets(relation) as (values
      ('public.bookmarks'), ('public.clicks'),
      ('private.discord_ingest_provenance'),
      ('private.discord_ingest_receipts'),
      ('private.discord_ingest_rate_events'),
      ('storage.objects')
    ), privileges(privilege) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
    select relation, privilege
      from targets cross join privileges
     where pg_catalog.to_regclass(relation) is not null
       and pg_catalog.has_table_privilege('discord_ingest_runtime', relation, privilege)
  `);
  assert(
    forbiddenTables.rowCount === 0,
    `runtime direct table privilege가 열렸습니다: ${forbiddenTables.rows.map((row) => `${row.relation}:${row.privilege}`).join(', ')}`,
  );

  const privateUsage = await client.query<{ role_name: string }>(`
    select role_name
      from (values ('anon'), ('authenticated'), ('service_role'), ('discord_ingest_runtime')) as roles(role_name)
     where pg_catalog.has_schema_privilege(role_name, 'private', 'USAGE')
  `);
  assert(privateUsage.rowCount === 0, `private schema USAGE가 열렸습니다: ${privateUsage.rows.map((row) => row.role_name).join(', ')}`);

  const relationOwners = await client.query<{ relation: string; owner: string }>(`
    select namespace.nspname || '.' || relation.relname as relation, owner.rolname as owner
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
     where namespace.nspname in ('public', 'private')
       and owner.rolname in ('discord_ingest_owner', 'discord_favicon_owner', 'discord_ingest_runtime')
  `);
  assert(relationOwners.rowCount === 0, 'Discord 역할이 참조 table/sequence를 소유하고 있습니다.');

  const unsafeDefaults = await client.query<{ grantee: string }>(`
    select coalesce(grantee.rolname, 'PUBLIC') as grantee
      from pg_catalog.pg_default_acl as defaults
      join pg_catalog.pg_roles as owner on owner.oid = defaults.defaclrole
      join pg_catalog.pg_namespace as namespace on namespace.oid = defaults.defaclnamespace
      cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as acl
      left join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee
     where owner.rolname = 'postgres'
       and namespace.nspname = 'public'
       and defaults.defaclobjtype = 'f'
       and acl.privilege_type = 'EXECUTE'
       and coalesce(grantee.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role', 'discord_ingest_runtime')
  `);
  assert(unsafeDefaults.rowCount === 0, `future public RPC default EXECUTE가 열렸습니다: ${unsafeDefaults.rows.map((row) => row.grantee).join(', ')}`);

  const cron = await client.query<{ schedule: string; command: string; username: string; can_execute: boolean }>(`
    select schedule, command, username,
           pg_catalog.has_function_privilege(
             username,
             'private.cleanup_discord_ingest_receipts()',
             'EXECUTE'
           ) as can_execute
      from cron.job where jobname = 'discord-ingest-receipt-cleanup'
  `);
  assert(cron.rowCount === 1, 'receipt cleanup Cron job이 정확히 하나가 아닙니다.');
  assert(cron.rows[0]?.schedule === '17 3 * * *', 'receipt cleanup Cron schedule이 다릅니다.');
  assert(
    cron.rows[0]?.command === 'select private.cleanup_discord_ingest_receipts();',
    'receipt cleanup Cron command가 다릅니다.',
  );
  assert(cron.rows[0]?.username === 'postgres' && cron.rows[0]?.can_execute, 'Cron 실행 역할에 cleanup EXECUTE가 없습니다.');
}

async function expectPermissionDenied(client: Client, statement: string): Promise<void> {
  await client.query('SAVEPOINT expected_denial');
  try {
    await client.query(statement);
    throw new Error(`권한 거부가 필요한 문장이 성공했습니다: ${statement}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('권한 거부가 필요한')) throw error;
    assert(codeOf(error) === '42501', `예상한 42501 대신 ${codeOf(error) ?? 'unknown'}: ${statement}`);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_denial');
    await client.query('RELEASE SAVEPOINT expected_denial');
  }
}

async function callIngest(
  client: Client,
  input: { url: string; title: string; description: string; categoryId: string; messageId: string },
): Promise<QueryResultRow> {
  const result = await client.query(
    `select * from public.ingest_bookmark($1::text, $2::text, $3::text, $4::text, $5::text)`,
    [input.url, input.title, input.description, input.categoryId, input.messageId],
  );
  assert(result.rowCount === 1, 'ingest_bookmark가 정확히 한 행을 반환하지 않았습니다.');
  return result.rows[0];
}

async function runLocalIntegration(client: Client): Promise<void> {
  await client.query('BEGIN');
  try {
    const current = await client.query<{ current_user: string }>('select current_user');
    const currentUser = current.rows[0]?.current_user;
    assert(currentUser, '현재 DB 역할을 확인하지 못했습니다.');
    const cleanup = await client.query<{ deleted: string }>(
      'select private.cleanup_discord_ingest_receipts()::text as deleted',
    );
    assert(/^\d+$/.test(cleanup.rows[0]?.deleted ?? ''), 'Cron 실행 역할로 receipt cleanup을 호출하지 못했습니다.');
    await client.query(`grant discord_ingest_runtime to ${quoteIdentifier(currentUser)}`);

    const category = await client.query<{ id: string }>(`
      insert into public.categories (name, sort_order)
      values ('__verify_discord_ingest__', 0)
      returning id::text
    `);
    const categoryId = category.rows[0]?.id;
    assert(categoryId, 'integration leaf category를 만들지 못했습니다.');

    await client.query('SET LOCAL ROLE discord_ingest_runtime');
    const categories = await client.query('select id, name, parent_id, sort_order from public.categories limit 1');
    assert((categories.rowCount ?? 0) >= 1, 'runtime category allowlist SELECT가 실패했습니다.');
    await expectPermissionDenied(client, 'select id from public.bookmarks limit 1');
    await expectPermissionDenied(client, 'select id from public.clicks limit 1');
    await expectPermissionDenied(client, 'select bookmark_id from private.discord_ingest_provenance limit 1');

    const success = await callIngest(client, {
      url: 'HTTPS://Example.COM:443/verify/?utm_source=x&b=2&a=1#fragment',
      title: '  검증 제목  ',
      description: '  검증 설명  ',
      categoryId,
      messageId: '1536248705844248606',
    });
    assert(success.result_code === 'success' && success.category_name === '__verify_discord_ingest__', 'success 결과 shape가 틀렸습니다.');
    const bookmarkId = String(success.bookmark_id);

    const duplicateMessage = await callIngest(client, {
      url: 'https://example.com/verify?a=1&b=2', title: '', description: '', categoryId,
      messageId: '1536248705844248606',
    });
    assert(duplicateMessage.result_code === 'duplicate_message', '같은 message/url replay가 차단되지 않았습니다.');

    const duplicateUrl = await callIngest(client, {
      url: 'https://example.com/verify?a=1&b=2', title: '', description: '', categoryId,
      messageId: '1536248705844248607',
    });
    assert(
      duplicateUrl.result_code === 'duplicate_url' &&
        duplicateUrl.bookmark_id === null &&
        duplicateUrl.title === '검증 제목',
      '정규화 URL 중복 결과가 틀렸습니다.',
    );

    await client.query('RESET ROLE');
    await client.query(`
      with probe_time as (select pg_catalog.clock_timestamp() as now)
      update private.discord_ingest_receipts
         set first_seen_at = probe_time.now - pg_catalog.make_interval(secs => 7776001),
             expires_at = probe_time.now - pg_catalog.make_interval(secs => 1)
        from probe_time
       where message_id = '1536248705844248606'
    `);
    await client.query('SET LOCAL ROLE discord_ingest_runtime');
    const expiredReplay = await callIngest(client, {
      url: 'https://example.com/verify?a=1&b=2', title: '', description: '', categoryId,
      messageId: '1536248705844248606',
    });
    assert(expiredReplay.result_code === 'duplicate_url', '90일이 지난 receipt가 duplicate_message를 연장했습니다.');

    const invalidUrl = await callIngest(client, {
      url: 'https://[::1]/', title: '', description: '', categoryId,
      messageId: '1536248705844248608',
    });
    assert(invalidUrl.result_code === 'invalid_url', 'invalid_url 결과가 틀렸습니다.');

    const invalidMessage = await callIngest(client, {
      url: 'https://valid.test', title: '', description: '', categoryId, messageId: 'not-a-snowflake',
    });
    assert(invalidMessage.result_code === 'invalid_message_id', 'invalid_message_id 결과가 틀렸습니다.');

    const invalidCategory = await callIngest(client, {
      url: 'https://category-invalid.test', title: '', description: '', categoryId: 'bad-uuid',
      messageId: '1536248705844248609',
    });
    assert(invalidCategory.result_code === 'invalid_category', 'invalid_category 결과가 틀렸습니다.');

    const tooLong = await callIngest(client, {
      url: `https://too-long.test/${'x'.repeat(2049)}`, title: '', description: '', categoryId,
      messageId: '1536248705844248610',
    });
    assert(tooLong.result_code === 'url_too_long', 'url_too_long 결과가 틀렸습니다.');

    await client.query('RESET ROLE');
    const stored = await client.query<{
      normalized_url: string;
      source: string;
      title: string;
      description: string | null;
      favicon_url: string | null;
      is_pinned: boolean;
      tags: string[];
      provenance_count: number;
    }>(`
      select bookmark.normalized_url, bookmark.source, bookmark.title, bookmark.description,
             bookmark.favicon_url, bookmark.is_pinned, bookmark.tags,
             (select pg_catalog.count(*)::integer
                from private.discord_ingest_provenance as provenance
               where provenance.bookmark_id = bookmark.id) as provenance_count
        from public.bookmarks as bookmark where bookmark.id = $1
    `, [bookmarkId]);
    assert(stored.rows[0]?.normalized_url === 'https://example.com/verify?a=1&b=2', '저장 normalized_url이 틀렸습니다.');
    assert(stored.rows[0]?.source === 'discord' && stored.rows[0]?.provenance_count === 1, 'bookmark/provenance 원자성이 틀렸습니다.');
    assert(stored.rows[0]?.title === '검증 제목' && stored.rows[0]?.description === '검증 설명', 'trim 저장 계약이 틀렸습니다.');
    assert(stored.rows[0]?.favicon_url === null && !stored.rows[0]?.is_pinned && stored.rows[0]?.tags.length === 0, '자동 bookmark 고정값이 틀렸습니다.');

    const reorderFixtures = await client.query<{ id: string; title: string }>(`
      insert into public.bookmarks (category_id, title, url, sort_order)
      values
        ($1, '__verify_reorder_a__', 'https://reorder-a.test', 0),
        ($1, '__verify_reorder_b__', 'https://reorder-b.test', 0)
      returning id::text, title
    `, [categoryId]);
    const manualBookmarkId = reorderFixtures.rows.find((row) => row.title === '__verify_reorder_a__')?.id;
    assert(manualBookmarkId, 'manual favicon 참조 fixture ID를 확인하지 못했습니다.');
    const beforeReorder = await client.query<{ id: string }>(
      'select id::text from public.bookmarks order by sort_order, id',
    );
    assert(beforeReorder.rowCount === 3, 'reorder fixture가 정확히 3행이 아닙니다.');
    const beforeIds = beforeReorder.rows.map((row) => row.id);

    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`select pg_catalog.set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ email: ADMIN_EMAIL })]);
    const reordered = await client.query<{ reordered_count: number }>(
      'select public.admin_reorder_bookmarks($1::uuid[]) as reordered_count',
      [[beforeIds[2], beforeIds[0]]],
    );
    assert(reordered.rows[0]?.reordered_count === 2, 'admin reorder가 found count 2를 반환하지 않았습니다.');
    await client.query('RESET ROLE');
    const afterReorder = await client.query<{ id: string; sort_order: number }>(
      'select id::text, sort_order from public.bookmarks order by sort_order, id',
    );
    assert(
      JSON.stringify(afterReorder.rows.map((row) => row.id)) ===
        JSON.stringify([beforeIds[2], beforeIds[1], beforeIds[0]]),
      'admin reorder가 요청 밖 가운데 position을 보존하지 않았습니다.',
    );
    assert(
      JSON.stringify(afterReorder.rows.map((row) => row.sort_order)) === JSON.stringify([0, 1, 2]),
      'admin reorder가 전체 stable sequence를 고유 0..n-1로 재번호화하지 않았습니다.',
    );

    await client.query('truncate private.discord_ingest_rate_events');
    await client.query('SET LOCAL ROLE discord_ingest_runtime');
    for (let index = 1; index <= 31; index += 1) {
      const result = await callIngest(client, {
        url: 'https://rate.test', title: '', description: '', categoryId, messageId: `invalid-${index}`,
      });
      const expected = index <= 30 ? 'invalid_message_id' : 'rate_limited';
      assert(result.result_code === expected, `${index}번째 rate 호출이 ${expected}가 아닙니다.`);
      if (index === 31) assert(result.retry_at !== null, 'rate_limited retry_at이 null입니다.');
    }
    await client.query('RESET ROLE');
    const ring = await client.query<{ count: number }>('select pg_catalog.count(*)::integer as count from private.discord_ingest_rate_events');
    assert(ring.rows[0]?.count === 30, `rate ring 물리 행이 ${ring.rows[0]?.count}개입니다.`);

    const manualFaviconUrl = 'https://storage.test/discord/manual-service-repair.png';
    await client.query('update public.bookmarks set favicon_url = $1 where id = $2', [manualFaviconUrl, manualBookmarkId]);

    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`select pg_catalog.set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ email: ADMIN_EMAIL })]);
    const claimed = await client.query<{ bookmark_id: string; claimed_url: string; claim_token: string }>(
      'select * from public.admin_claim_discord_favicons($1)', [1],
    );
    assert(claimed.rowCount === 1 && claimed.rows[0]?.bookmark_id === bookmarkId, 'favicon fair claim이 성공하지 않았습니다.');
    const claim = claimed.rows[0];
    const claimedReference = await client.query<{ favicon_url: string | null; active_claim_token: string | null }>(
      'select * from public.admin_get_discord_favicon_reference($1)',
      [claim.bookmark_id],
    );
    assert(
      claimedReference.rowCount === 1 &&
        claimedReference.rows[0]?.favicon_url === null &&
        claimedReference.rows[0]?.active_claim_token === claim.claim_token,
      'favicon status RPC가 유효한 claim 상태를 반환하지 않았습니다.',
    );
    const finalized = await client.query<{ finalized: boolean }>(
      'select public.admin_finalize_discord_favicon($1, $2, $3, $4) as finalized',
      [claim.bookmark_id, claim.claim_token, claim.claimed_url, 'https://storage.test/discord/favicon.png'],
    );
    assert(finalized.rows[0]?.finalized, 'favicon triple-CAS finalize가 실패했습니다.');
    const staleRelease = await client.query<{ released: boolean }>(
      'select public.admin_release_discord_favicon($1, $2, $3) as released',
      [claim.bookmark_id, claim.claim_token, claim.claimed_url],
    );
    assert(staleRelease.rows[0]?.released === false, 'stale favicon worker가 완료된 claim을 release했습니다.');
    const finalizedReference = await client.query<{ favicon_url: string | null; active_claim_token: string | null }>(
      'select * from public.admin_get_discord_favicon_reference($1)',
      [claim.bookmark_id],
    );
    assert(
      finalizedReference.rowCount === 1 &&
        finalizedReference.rows[0]?.favicon_url === 'https://storage.test/discord/favicon.png' &&
        finalizedReference.rows[0]?.active_claim_token === null,
      'favicon status RPC가 finalize commit 상태를 반환하지 않았습니다.',
    );
    const missingReference = await client.query(
      `select * from public.admin_get_discord_favicon_reference('00000000-0000-0000-0000-000000000000')`,
    );
    assert(missingReference.rowCount === 0, '없는 bookmark의 favicon status RPC가 행을 반환했습니다.');
    const references = await client.query<{ bookmark_id: string; favicon_url: string | null; active_claim_token: string | null }>(
      'select bookmark_id, favicon_url, active_claim_token from public.admin_list_discord_favicon_references()',
    );
    assert(references.rows.some((row) => row.bookmark_id === bookmarkId && row.favicon_url !== null), 'Storage reconciliation 참조가 누락됐습니다.');
    assert(
      references.rows.some(
        (row) => row.bookmark_id === manualBookmarkId && row.favicon_url === manualFaviconUrl && row.active_claim_token === null,
      ),
      'manual/service-repaired bookmark의 live Storage 참조가 누락됐습니다.',
    );
    await client.query('RESET ROLE');

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runLocalConcurrency(admin: Client, databaseUrl: string): Promise<void> {
  const marker = '__verify_discord_concurrency__';
  const messages = ['1536248705844248701', '1536248705844248702'];
  const workers = [
    new Client({ connectionString: databaseUrl, application_name: 'verify-discord-ingest-a' }),
    new Client({ connectionString: databaseUrl, application_name: 'verify-discord-ingest-b' }),
  ];
  const current = await admin.query<{ current_user: string }>('select current_user');
  const currentUser = current.rows[0]?.current_user;
  assert(currentUser, 'concurrency verifier DB role을 확인하지 못했습니다.');

  let granted = false;
  let categoryId: string | null = null;
  try {
    await admin.query('delete from public.bookmarks where title = $1', [marker]);
    await admin.query('delete from private.discord_ingest_receipts where message_id = any($1::varchar[])', [messages]);
    await admin.query('delete from public.categories where name = $1', [marker]);
    await admin.query('truncate private.discord_ingest_rate_events');

    await admin.query(`grant discord_ingest_runtime to ${quoteIdentifier(currentUser)}`);
    granted = true;
    const category = await admin.query<{ id: string }>(
      'insert into public.categories(name) values ($1) returning id::text',
      [marker],
    );
    categoryId = category.rows[0]?.id ?? null;
    assert(categoryId, 'concurrency category를 만들지 못했습니다.');

    await Promise.all(workers.map((worker) => worker.connect()));
    await Promise.all(workers.map((worker) => worker.query('set role discord_ingest_runtime')));

    const attempts = await Promise.allSettled(
      workers.map((worker, index) =>
        callIngest(worker, {
          url: index === 0
            ? 'https://concurrency.test/path/?utm_source=first&a=1#ordinary'
            : 'HTTPS://CONCURRENCY.test:443/path?a=1',
          title: marker,
          description: '',
          categoryId: categoryId!,
          messageId: messages[index],
        }),
      ),
    );

    const terminalRows: QueryResultRow[] = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      if (attempt.status === 'fulfilled') {
        terminalRows.push(attempt.value);
        continue;
      }
      assert(codeOf(attempt.reason) === '55P03', `concurrent loser가 55P03이 아닙니다: ${codeOf(attempt.reason)}`);
      terminalRows.push(await callIngest(workers[index], {
        url: index === 0
          ? 'https://concurrency.test/path/?utm_source=first&a=1#ordinary'
          : 'HTTPS://CONCURRENCY.test:443/path?a=1',
        title: marker,
        description: '',
        categoryId: categoryId!,
        messageId: messages[index],
      }));
    }

    assert(terminalRows.filter((row) => row.result_code === 'success').length === 1, 'concurrent URL에서 success가 정확히 1건이 아닙니다.');
    assert(terminalRows.filter((row) => row.result_code === 'duplicate_url').length === 1, 'concurrent loser가 duplicate_url로 수렴하지 않았습니다.');

    const lockReleased = await workers[0].query<{ acquired: boolean }>(
      'select pg_catalog.pg_try_advisory_xact_lock(821937472833609260::bigint) as acquired',
    );
    assert(lockReleased.rows[0]?.acquired, 'auto-commit 반환 뒤 global advisory xact lock이 해제되지 않았습니다.');

    await Promise.all(workers.map((worker) => worker.query('reset role')));
    const committed = await admin.query<{ bookmarks: number; provenance: number }>(`
      select
        (select pg_catalog.count(*)::integer from public.bookmarks where title = $1) as bookmarks,
        (select pg_catalog.count(*)::integer
           from private.discord_ingest_provenance as provenance
           join public.bookmarks as bookmark on bookmark.id = provenance.bookmark_id
          where bookmark.title = $1) as provenance
    `, [marker]);
    assert(
      committed.rows[0]?.bookmarks === 1 && committed.rows[0]?.provenance === 1,
      'concurrent ingest가 bookmark/provenance 한 쌍으로 수렴하지 않았습니다.',
    );
  } finally {
    await Promise.all(workers.map(async (worker) => {
      try { await worker.end(); } catch { /* 연결 전 실패도 cleanup을 막지 않는다. */ }
    }));
    await admin.query('delete from public.bookmarks where title = $1', [marker]);
    await admin.query('delete from private.discord_ingest_receipts where message_id = any($1::varchar[])', [messages]);
    if (categoryId !== null) await admin.query('delete from public.categories where id = $1', [categoryId]);
    await admin.query('truncate private.discord_ingest_rate_events');
    if (granted) await admin.query(`revoke discord_ingest_runtime from ${quoteIdentifier(currentUser)}`);
  }
}

async function runFaviconReferenceFence(admin: Client, databaseUrl: string): Promise<void> {
  const marker = '__verify_favicon_reference_fence__';
  const url = 'https://favicon-reference-fence.test/path';
  const faviconUrl = 'https://storage.test/discord/fenced.png';
  const claimToken = '33333333-3333-4333-8333-333333333333';
  const finalizer = new Client({
    connectionString: databaseUrl,
    application_name: 'verify-favicon-finalizer',
  });
  const observer = new Client({
    connectionString: databaseUrl,
    application_name: 'verify-favicon-observer',
  });
  let categoryId: string | null = null;
  let bookmarkId: string | null = null;

  const beginAdmin = async (client: Client) => {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select pg_catalog.set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ email: ADMIN_EMAIL }),
    ]);
  };

  try {
    await admin.query('delete from public.bookmarks where title = $1', [marker]);
    await admin.query('delete from public.categories where name = $1', [marker]);
    const category = await admin.query<{ id: string }>(
      'insert into public.categories(name) values ($1) returning id::text',
      [marker],
    );
    categoryId = category.rows[0]?.id ?? null;
    assert(categoryId, 'favicon fence category를 만들지 못했습니다.');
    const bookmark = await admin.query<{ id: string }>(`
      insert into public.bookmarks (category_id, title, url, source, sort_order)
      values ($1, $2, $3, 'discord', 0)
      returning id::text
    `, [categoryId, marker, url]);
    bookmarkId = bookmark.rows[0]?.id ?? null;
    assert(bookmarkId, 'favicon fence bookmark를 만들지 못했습니다.');
    await admin.query(`
      insert into private.discord_ingest_provenance (
        bookmark_id,
        message_id,
        favicon_last_attempted_at,
        favicon_last_attempted_url,
        favicon_claimed_until,
        favicon_claim_token
      ) values ($1, '1536248705844248799', pg_catalog.clock_timestamp(), $2,
                pg_catalog.clock_timestamp() + interval '120 seconds', $3)
    `, [bookmarkId, url, claimToken]);

    await Promise.all([finalizer.connect(), observer.connect()]);
    await beginAdmin(finalizer);
    const finalized = await finalizer.query<{ finalized: boolean }>(
      'select public.admin_finalize_discord_favicon($1, $2, $3, $4) as finalized',
      [bookmarkId, claimToken, url, faviconUrl],
    );
    assert(finalized.rows[0]?.finalized, 'in-flight favicon finalize fixture가 실패했습니다.');

    await beginAdmin(observer);
    try {
      await observer.query(
        'select * from public.admin_get_discord_favicon_reference($1)',
        [bookmarkId],
      );
      throw new Error('in-flight finalize 동안 status RPC가 stale claim을 반환했습니다.');
    } catch (error) {
      assert(
        codeOf(error) === '55P03',
        `in-flight status RPC가 안전한 lock timeout이 아닙니다: ${codeOf(error) ?? 'unknown'}`,
      );
    }
    await observer.query('rollback');

    await finalizer.query('commit');
    await beginAdmin(observer);
    const reference = await observer.query<{
      favicon_url: string | null;
      active_claim_token: string | null;
    }>('select * from public.admin_get_discord_favicon_reference($1)', [bookmarkId]);
    assert(
      reference.rowCount === 1 &&
        reference.rows[0]?.favicon_url === faviconUrl &&
        reference.rows[0]?.active_claim_token === null,
      'finalize commit 뒤 status RPC가 authoritative 상태를 반환하지 않았습니다.',
    );
    await observer.query('commit');
  } finally {
    for (const client of [finalizer, observer]) {
      try { await client.query('rollback'); } catch { /* 연결/transaction 상태와 무관하게 cleanup한다. */ }
      try { await client.end(); } catch { /* 연결 전 실패도 cleanup을 막지 않는다. */ }
    }
    if (bookmarkId !== null) await admin.query('delete from public.bookmarks where id = $1', [bookmarkId]);
    if (categoryId !== null) await admin.query('delete from public.categories where id = $1', [categoryId]);
  }
}

async function main(): Promise<void> {
  const mode = parseMode();
  const databaseUrl = resolveDatabaseUrl(mode);
  await staticMigrationGuard();

  const client = new Client({ connectionString: databaseUrl, application_name: 'verify-discord-ingest' });
  await client.connect();
  try {
    const failures = await readOnlyDataPreflight(client);
    if (failures.length > 0) {
      console.error(`FAIL preflight: ${failures.length}건`);
      for (const failure of failures) console.error(JSON.stringify(failure));
      throw new Error('기존 bookmark remediation 승인 전에는 0006을 적용할 수 없습니다.');
    }
    console.log('PASS preflight: 기존 bookmark URL/길이/normalized collision 0건');

    if (await migrationExists(client)) {
      await checkCatalog(client);
      console.log('PASS catalog: role/ACL/function/default privilege/Cron 계약');
    } else if (mode === 'integration') {
      throw new Error('0006 migration이 적용되지 않아 integration을 실행할 수 없습니다.');
    } else {
      console.log('SKIP catalog: 0006 적용 전 read-only preflight 대상');
    }

    if (mode === 'integration') {
      await runLocalIntegration(client);
      await runLocalConcurrency(client, databaseUrl);
      await runFaviconReferenceFence(client, databaseUrl);
      console.log('PASS integration: SQL URL corpus, 주요 result, direct denial, ring≤30, reorder, provenance, favicon CAS/fence, concurrent auto-commit');
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
