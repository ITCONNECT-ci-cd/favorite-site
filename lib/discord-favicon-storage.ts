import 'server-only';

import type { DiscordIconKind } from '@/lib/discord-favicon-image';
import { requireEnv } from '@/lib/supabase/env';

const BUCKET = 'favicons';
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_PATTERN}$`, 'i');
const DISCORD_OBJECT = new RegExp(
  `^discord/(${UUID_PATTERN})/(${UUID_PATTERN})\\.(png|ico|jpg|gif|webp)$`,
  'i',
);
const LIST_PAGE_SIZE = 1_000;
const DELETE_BATCH_SIZE = 1_000;
const MAX_LIST_ENTRIES_PER_PREFIX = 100_000;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1_000;

export type StoredDiscordFavicon = { path: string; publicUrl: string };
export type ActiveDiscordFaviconClaim = { bookmarkId: string; claimToken: string };
export type DiscordFaviconReconciliation = {
  scanned: number;
  kept: number;
  invalid: number;
  deleted: number;
};

type StorageListEntry = {
  name: string;
  id: string | null;
  createdAt: string | null;
};

/**
 * Service-role 자격은 이 모듈의 Storage REST 요청에만 닿는다. 호출자는 검증된 UUID/token과
 * 이미지 바이트만 넘기며 임의 URL, table 이름, RPC 이름을 넘길 수 없다.
 */
export async function uploadDiscordFavicon(
  bookmarkId: string,
  claimToken: string,
  body: Uint8Array,
  kind: DiscordIconKind,
  signal: AbortSignal,
): Promise<StoredDiscordFavicon> {
  assertUuid(bookmarkId, 'bookmarkId');
  assertUuid(claimToken, 'claimToken');

  const path = `discord/${bookmarkId}/${claimToken}.${kind.extension}`;
  const response = await objectFetch(path, {
    method: 'POST',
    headers: {
      'content-type': kind.contentType,
      'x-upsert': 'false',
    },
    body: body.slice().buffer as ArrayBuffer,
    signal,
  });

  if (!response.ok) throw new Error(`Storage upload failed (${response.status})`);

  const base = supabaseUrl();
  return {
    path,
    publicUrl: `${base}/storage/v1/object/public/${BUCKET}/${path}`,
  };
}

/** stale finalize나 실패 뒤 자기 claim 전용 객체만 best-effort로 지운다. */
export async function deleteDiscordFavicon(path: string, signal: AbortSignal): Promise<boolean> {
  assertDiscordObjectPath(path);
  await deleteBatch([path], signal);
  return true;
}

/**
 * DB에서 관리자 세션으로 읽어 검증한 참조만 받는 Storage 전용 경계다. 목록이 끝까지 정상적으로
 * 읽힌 뒤에만 삭제를 시작하므로, page 오류나 알 수 없는 응답 형식이 참조 객체 삭제로 이어지지 않는다.
 */
export async function reconcileDiscordFaviconStorage(
  livePaths: readonly string[],
  activeClaims: readonly ActiveDiscordFaviconClaim[],
  signal: AbortSignal,
  nowMs: number = Date.now(),
): Promise<DiscordFaviconReconciliation> {
  if (!Number.isFinite(nowMs)) throw new Error('Invalid reconciliation clock');

  const live = new Set(
    livePaths.map((path) => {
      assertDiscordObjectPath(path);
      return path.toLowerCase();
    }),
  );
  const active = new Set(
    activeClaims.map(({ bookmarkId, claimToken }) => {
      assertUuid(bookmarkId, 'bookmarkId');
      assertUuid(claimToken, 'claimToken');
      return `${bookmarkId}/${claimToken}`.toLowerCase();
    }),
  );

  const result: DiscordFaviconReconciliation = { scanned: 0, kept: 0, invalid: 0, deleted: 0 };
  const candidates: string[] = [];
  const cutoff = nowMs - ORPHAN_AGE_MS;
  const rootEntries = await listAll('discord', signal);

  for (const entry of rootEntries) {
    if (entry.id !== null) {
      result.scanned += 1;
      result.invalid += 1;
      continue;
    }

    if (!UUID.test(entry.name)) {
      result.invalid += 1;
      continue;
    }

    const folder = entry.name;
    const objects = await listAll(`discord/${folder}`, signal);
    for (const object of objects) {
      result.scanned += 1;
      const path = `discord/${folder}/${object.name}`;
      const parsed = parseDiscordObjectPath(path);

      if (object.id === null || parsed === null) {
        result.invalid += 1;
        continue;
      }

      const key = path.toLowerCase();
      const claimKey = `${parsed.bookmarkId}/${parsed.claimToken}`.toLowerCase();
      const createdAt = object.createdAt === null ? Number.NaN : Date.parse(object.createdAt);

      if (
        live.has(key) ||
        active.has(claimKey) ||
        !Number.isFinite(createdAt) ||
        createdAt > cutoff
      ) {
        result.kept += 1;
        continue;
      }

      candidates.push(path);
    }
  }

  for (let offset = 0; offset < candidates.length; offset += DELETE_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + DELETE_BATCH_SIZE);
    await deleteBatch(batch, signal);
    result.deleted += batch.length;
  }

  return result;
}

async function listAll(prefix: string, signal: AbortSignal): Promise<StorageListEntry[]> {
  const entries: StorageListEntry[] = [];

  for (let offset = 0; offset < MAX_LIST_ENTRIES_PER_PREFIX; offset += LIST_PAGE_SIZE) {
    const page = await listPage(prefix, offset, signal);
    entries.push(...page);
    if (page.length < LIST_PAGE_SIZE) return entries;
  }

  throw new Error('Storage list exceeded reconciliation limit');
}

async function listPage(
  prefix: string,
  offset: number,
  signal: AbortSignal,
): Promise<StorageListEntry[]> {
  const response = await storageFetch(`/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prefix,
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Storage list failed (${response.status})`);

  const value: unknown = await response.json();
  if (!Array.isArray(value) || value.length > LIST_PAGE_SIZE) {
    throw new Error('Invalid Storage list response');
  }

  return value.map((row) => {
    if (typeof row !== 'object' || row === null) throw new Error('Invalid Storage list entry');
    const record = row as Record<string, unknown>;
    if (
      typeof record.name !== 'string' ||
      record.name.length === 0 ||
      record.name.length > 255 ||
      record.name.includes('/') ||
      (typeof record.id !== 'string' && record.id !== null)
    ) {
      throw new Error('Invalid Storage list entry');
    }

    return {
      name: record.name,
      id: record.id,
      createdAt: typeof record.created_at === 'string' ? record.created_at : null,
    };
  });
}

async function deleteBatch(paths: readonly string[], signal: AbortSignal): Promise<void> {
  if (paths.length === 0 || paths.length > DELETE_BATCH_SIZE) {
    throw new Error('Invalid Storage delete batch');
  }
  for (const path of paths) assertDiscordObjectPath(path);

  const response = await storageFetch(`/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
    signal,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Storage delete failed (${response.status})`);
  }
}

async function objectFetch(path: string, init: RequestInit): Promise<Response> {
  return storageFetch(`/object/${BUCKET}/${path}`, init);
}

async function storageFetch(endpoint: string, init: RequestInit): Promise<Response> {
  const key = serviceRoleKey();
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.set('authorization', `Bearer ${key}`);

  return fetch(`${supabaseUrl()}/storage/v1${endpoint}`, {
    ...init,
    headers,
    cache: 'no-store',
    redirect: 'error',
  });
}

function supabaseUrl(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, '');
}

function serviceRoleKey(): string {
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function assertDiscordObjectPath(path: string): void {
  if (parseDiscordObjectPath(path) === null) {
    throw new Error('Invalid Discord favicon storage path');
  }
}

function parseDiscordObjectPath(
  path: string,
): { bookmarkId: string; claimToken: string } | null {
  const match = DISCORD_OBJECT.exec(path);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  if (!UUID.test(match[1]) || !UUID.test(match[2])) return null;
  return { bookmarkId: match[1], claimToken: match[2] };
}

function assertUuid(value: string, field: string): void {
  if (!UUID.test(value)) throw new Error(`Invalid ${field}`);
}
