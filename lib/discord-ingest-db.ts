import 'server-only';

import { Pool, type QueryResultRow } from 'pg';

/**
 * Discord ingest 전용 PostgreSQL 경계.
 *
 * 이 파일만 `DISCORD_INGEST_DATABASE_URL`을 읽고 `pg`를 import한다. 외부 agent에는 이 DSN을 주지
 * 않으며, 이 모듈도 caller SQL·transaction API·client/pool을 export하지 않는다. 아래 두 함수는 각각
 * hard-coded parameterized statement 한 개를 `pool.query()`로 실행하므로 반환과 함께 implicit
 * transaction이 끝난다. 후처리 함수도 exact bookmark/URL 또는 claim token만 받으며 임의 SQL이나
 * 범용 table API를 노출하지 않는다.
 */

export type DiscordIngestCategory = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
};

export type DiscordIngestInput = {
  url: string;
  title: string;
  description: string;
  categoryId: string;
  messageId: string;
};

const DISCORD_INGEST_RESULT_CODES = [
  'success',
  'duplicate_url',
  'duplicate_message',
  'invalid_url',
  'url_too_long',
  'invalid_category',
  'rate_limited',
  'invalid_message_id',
  'internal_error',
] as const;

export type DiscordIngestResultCode = (typeof DISCORD_INGEST_RESULT_CODES)[number];

export type DiscordIngestResult = {
  resultCode: DiscordIngestResultCode;
  bookmarkId: string | null;
  title: string | null;
  categoryName: string | null;
  retryAt: string | null;
};

export type DiscordIngestMetadataUpdate = {
  bookmarkId: string;
  claimedUrl: string;
  expectedTitle: string;
  title: string;
  description: string;
};

export type DiscordIngestFaviconClaim = {
  bookmarkId: string;
  claimedUrl: string;
  claimToken: string;
};

const APPLICATION_NAME = 'discord-link-ingest';
const QUERY_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 4_500;

const LIST_CATEGORIES_SQL = `select
  id::text as "id",
  name as "name",
  parent_id::text as "parentId",
  sort_order as "sortOrder"
from public.categories
order by sort_order, id`;

const INGEST_SQL = `select
  result_code as "resultCode",
  bookmark_id::text as "bookmarkId",
  title as "title",
  category_name as "categoryName",
  retry_at as "retryAt"
from public.ingest_bookmark($1::text, $2::text, $3::text, $4::text, $5::text)`;

const UPDATE_METADATA_SQL = `select public.discord_ingest_update_metadata(
  $1::uuid, $2::text, $3::text, $4::text, $5::text
) as "updated"`;

const CLAIM_FAVICON_SQL = `select claim_token::text as "claimToken"
from public.discord_ingest_claim_favicon($1::uuid, $2::text)`;

const FINALIZE_FAVICON_SQL = `select public.discord_ingest_finalize_favicon(
  $1::uuid, $2::uuid, $3::text, $4::text
) as "updated"`;

const FAIL_FAVICON_SQL = `select public.discord_ingest_fail_favicon(
  $1::uuid, $2::uuid, $3::text
) as "updated"`;

let pool: Pool | null = null;

export async function listCategories(): Promise<DiscordIngestCategory[]> {
  const result = await getPool().query<CategoryRow>({
    text: LIST_CATEGORIES_SQL,
    values: [],
  });

  return result.rows.map(parseCategoryRow);
}

export async function ingest(input: DiscordIngestInput): Promise<DiscordIngestResult> {
  const result = await getPool().query<IngestRow>({
    text: INGEST_SQL,
    values: [input.url, input.title, input.description, input.categoryId, input.messageId],
  });

  if (result.rows.length !== 1) throw new Error('invalid discord ingest result cardinality');
  return parseIngestRow(result.rows[0]);
}

export async function updateDiscordIngestMetadata(
  input: DiscordIngestMetadataUpdate,
): Promise<boolean> {
  const result = await getPool().query<BooleanRow>({
    text: UPDATE_METADATA_SQL,
    values: [input.bookmarkId, input.claimedUrl, input.expectedTitle, input.title, input.description],
  });
  return parseBooleanRow(result.rows);
}

export async function claimDiscordIngestFavicon(
  bookmarkId: string,
  claimedUrl: string,
): Promise<DiscordIngestFaviconClaim | null> {
  const result = await getPool().query<FaviconClaimRow>({
    text: CLAIM_FAVICON_SQL,
    values: [bookmarkId, claimedUrl],
  });
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1 || !isUuid(result.rows[0].claimToken)) {
    throw new Error('invalid discord favicon claim row');
  }
  return { bookmarkId, claimedUrl, claimToken: result.rows[0].claimToken };
}

export async function finalizeDiscordIngestFavicon(
  claim: DiscordIngestFaviconClaim,
  faviconUrl: string,
): Promise<boolean> {
  const result = await getPool().query<BooleanRow>({
    text: FINALIZE_FAVICON_SQL,
    values: [claim.bookmarkId, claim.claimToken, claim.claimedUrl, faviconUrl],
  });
  return parseBooleanRow(result.rows);
}

export async function failDiscordIngestFavicon(
  claim: DiscordIngestFaviconClaim,
): Promise<boolean> {
  const result = await getPool().query<BooleanRow>({
    text: FAIL_FAVICON_SQL,
    values: [claim.bookmarkId, claim.claimToken, claim.claimedUrl],
  });
  return parseBooleanRow(result.rows);
}

type CategoryRow = QueryResultRow & {
  id: unknown;
  name: unknown;
  parentId: unknown;
  sortOrder: unknown;
};

type IngestRow = QueryResultRow & {
  resultCode: unknown;
  bookmarkId: unknown;
  title: unknown;
  categoryName: unknown;
  retryAt: unknown;
};

type BooleanRow = QueryResultRow & { updated: unknown };
type FaviconClaimRow = QueryResultRow & { claimToken: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getPool(): Pool {
  if (pool !== null) return pool;

  const connectionString = requireRuntimeDsn();
  const created = new Pool({
    connectionString,
    application_name: APPLICATION_NAME,
    max: 2,
    min: 0,
    allowExitOnIdle: true,
    keepAlive: true,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: 10_000,
  });

  // idle client 오류에 listener가 없으면 node-postgres가 process-level error로 올린다. 원문은 DSN·서버
  // 내부를 포함할 수 있으므로 고정 문구만 기록한다.
  created.on('error', () => {
    console.error('[discord-ingest-db] idle database connection failed');
  });

  pool = created;
  return created;
}

function requireRuntimeDsn(): string {
  const value = process.env.DISCORD_INGEST_DATABASE_URL;
  if (value === undefined || value.trim() === '') throw new Error('discord ingest database is not configured');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('discord ingest database is not configured');
  }

  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    parsed.searchParams.get('sslmode') !== 'require'
  ) {
    throw new Error('discord ingest database is not configured');
  }

  return value;
}

function parseCategoryRow(row: CategoryRow): DiscordIngestCategory {
  if (
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    (row.parentId !== null && typeof row.parentId !== 'string') ||
    typeof row.sortOrder !== 'number'
  ) {
    throw new Error('invalid discord ingest category row');
  }

  return { id: row.id, name: row.name, parentId: row.parentId, sortOrder: row.sortOrder };
}

function parseIngestRow(row: IngestRow): DiscordIngestResult {
  if (
    typeof row.resultCode !== 'string' ||
    !isResultCode(row.resultCode) ||
    !isNullableString(row.bookmarkId) ||
    !isNullableString(row.title) ||
    !isNullableString(row.categoryName)
  ) {
    throw new Error('invalid discord ingest result row');
  }

  return {
    resultCode: row.resultCode,
    bookmarkId: row.bookmarkId,
    title: row.title,
    categoryName: row.categoryName,
    retryAt: parseTimestamp(row.retryAt),
  };
}

function parseBooleanRow(rows: BooleanRow[]): boolean {
  if (rows.length !== 1 || typeof rows[0].updated !== 'boolean') {
    throw new Error('invalid discord enrichment result row');
  }
  return rows[0].updated;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isResultCode(value: string): value is DiscordIngestResultCode {
  return (DISCORD_INGEST_RESULT_CODES as readonly string[]).includes(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseTimestamp(value: unknown): string | null {
  if (value === null) return null;

  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) throw new Error('invalid discord ingest timestamp');
  return date.toISOString();
}
