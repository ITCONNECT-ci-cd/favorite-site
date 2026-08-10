'use server';

import {
  reconcileDiscordFaviconStorage,
  type ActiveDiscordFaviconClaim,
} from '@/lib/discord-favicon-storage';
import { requireEnv } from '@/lib/supabase/env';
import {
  createServerSupabaseClient,
  getAdminSessionWithSignal,
} from '@/lib/supabase/server';

const ACTION_BUDGET_MS = 50_000;
const MAX_REFERENCES = 100_000;
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_PATTERN}$`, 'i');
const DISCORD_OBJECT = new RegExp(
  `^discord/(${UUID_PATTERN})/(${UUID_PATTERN})\\.(png|ico|jpg|gif|webp)$`,
  'i',
);

export type DiscordFaviconReconcileResult =
  | { ok: true; scanned: number; kept: number; invalid: number; deleted: number }
  | { ok: false; error: string };

type SanitizedReferences = {
  livePaths: string[];
  activeClaims: ActiveDiscordFaviconClaim[];
};

/** client 인자를 받지 않는 관리자 전용 작업이다. DB 조회는 쿠키 자격, 삭제는 Storage 경계가 맡는다. */
export async function reconcileDiscordFaviconOrphans(): Promise<DiscordFaviconReconcileResult> {
  const signal = AbortSignal.timeout(ACTION_BUDGET_MS);

  try {
    if ((await getAdminSessionWithSignal(signal)) === null) {
      return { ok: false, error: '로그인이 필요합니다.' };
    }

    const client = await createServerSupabaseClient();
    const { data, error } = await client
      .rpc('admin_list_discord_favicon_references', {})
      .abortSignal(signal);
    if (error !== null) {
      throw new Error(
        `admin_list_discord_favicon_references failed (${error.code ?? 'unknown'})`,
      );
    }

    const references = sanitizeReferences(data);
    const result = await reconcileDiscordFaviconStorage(
      references.livePaths,
      references.activeClaims,
      signal,
    );
    return { ok: true, ...result };
  } catch (error) {
    console.error('Discord 파비콘 orphan reconciliation 실패', safeError(error));
    return { ok: false, error: '파비콘 고아 객체를 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

function sanitizeReferences(value: unknown): SanitizedReferences {
  if (!Array.isArray(value) || value.length > MAX_REFERENCES) {
    throw new Error('Invalid Discord favicon reference response');
  }

  const livePaths = new Set<string>();
  const activeClaims = new Map<string, ActiveDiscordFaviconClaim>();
  const base = new URL(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  );
  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
  const storagePrefix = `${basePath}/storage/v1/object/public/favicons/`;

  for (const row of value) {
    if (typeof row !== 'object' || row === null) {
      throw new Error('Invalid Discord favicon reference row');
    }
    const record = row as Record<string, unknown>;
    if (typeof record.bookmark_id !== 'string' || !UUID.test(record.bookmark_id)) {
      throw new Error('Invalid Discord favicon reference row');
    }
    if (record.favicon_url !== null && typeof record.favicon_url !== 'string') {
      throw new Error('Invalid Discord favicon reference row');
    }
    if (record.active_claim_token !== null && typeof record.active_claim_token !== 'string') {
      throw new Error('Invalid Discord favicon reference row');
    }

    const bookmarkId = record.bookmark_id;
    if (typeof record.favicon_url === 'string') {
      const path = liveDiscordPath(record.favicon_url, base, storagePrefix, bookmarkId);
      if (path !== null) livePaths.add(path);
    }

    if (typeof record.active_claim_token === 'string') {
      if (!UUID.test(record.active_claim_token)) {
        throw new Error('Invalid Discord favicon reference row');
      }
      const key = `${bookmarkId}/${record.active_claim_token}`.toLowerCase();
      activeClaims.set(key, { bookmarkId, claimToken: record.active_claim_token });
    }
  }

  return { livePaths: [...livePaths], activeClaims: [...activeClaims.values()] };
}

function liveDiscordPath(
  value: string,
  base: URL,
  storagePrefix: string,
  bookmarkId: string,
): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.origin !== base.origin ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith(storagePrefix)
  ) {
    return null;
  }

  const path = url.pathname.slice(storagePrefix.length);
  const match = DISCORD_OBJECT.exec(path);
  if (match === null || match[1] === undefined || match[1].toLowerCase() !== bookmarkId.toLowerCase()) {
    throw new Error('Invalid Discord favicon reference path');
  }
  return path;
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
