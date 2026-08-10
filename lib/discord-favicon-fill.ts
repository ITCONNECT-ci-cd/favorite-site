'use server';

import { isIP } from 'node:net';

import { getDomain } from 'tldts';

import { parseBookmarkUrlV1 } from '@/lib/bookmark-url';
import { DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED } from '@/lib/constants';
import {
  sniffDiscordIcon,
  type DiscordIconKind,
} from '@/lib/discord-favicon-image';
import {
  deleteDiscordFavicon,
  uploadDiscordFavicon,
} from '@/lib/discord-favicon-storage';
import {
  createServerSupabaseClient,
  getAdminSessionWithSignal,
} from '@/lib/supabase/server';

const ACTION_BUDGET_MS = 50_000;
const START_STOP_BEFORE_MS = 6_000;
const WORK_ABORT_BEFORE_MS = 5_000;
const ITEM_BUDGET_MS = 10_000;
const UPLOAD_BUDGET_MS = 4_000;
const MAX_ICON_BYTES = 1_000_000;
const MAX_CLAIMS = 10;
const CONCURRENCY = 3;
const PROVIDER_HOSTS = new Set(['www.google.com']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Claim = { bookmark_id: string; claimed_url: string; claim_token: string };

export type DiscordFaviconFillResult =
  | { ok: true; filled: number; failed: number; remaining: number }
  | { ok: false; error: string };

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** 관리자 버튼 한 번의 전체 favicon pass. client가 보낸 URL이나 ID는 받지 않는다. */
export async function fillDiscordFavicons(): Promise<DiscordFaviconFillResult> {
  // Hostname이 외부 provider로 나가는 작업이다. 누락·오타·대소문자 변형은 승인으로 보지 않는다.
  // UI의 비활성은 안내일 뿐이므로 공개 server action 자신이 네트워크 전에 다시 fail-closed한다.
  if (process.env.DISCORD_FAVICON_PROVIDER_APPROVED !== 'true') {
    return { ok: false, error: DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED };
  }

  const startedAt = Date.now();
  const deadline = startedAt + ACTION_BUDGET_MS;
  const startStopsAt = deadline - START_STOP_BEFORE_MS;
  const workAbortsAt = deadline - WORK_ABORT_BEFORE_MS;
  const workController = new AbortController();
  const workTimer = setTimeout(
    () => workController.abort(new Error('favicon action work deadline')),
    Math.max(1, workAbortsAt - Date.now()),
  );

  try {
    const authSignal = limitedSignal(workController.signal, Math.min(10_000, workAbortsAt - Date.now()));
    if ((await getAdminSessionWithSignal(authSignal)) === null) {
      return { ok: false, error: '로그인이 필요합니다.' };
    }

    // 각 work RPC에는 아래에서 work signal을 직접 건다. client 전역 fetch에는 묶지 않아야
    // 45초 work abort 뒤 남은 5초 동안 release/count cleanup RPC를 별도 signal로 보낼 수 있다.
    const client = await createServerSupabaseClient();
    const claims = validateClaims(
      await rpc<unknown>(client, 'admin_claim_discord_favicons', { limit_n: MAX_CLAIMS }, authSignal),
    );

    let cursor = 0;
    let filled = 0;
    const settled = new Set<string>();

    async function worker(): Promise<void> {
      while (Date.now() < startStopsAt) {
        const index = cursor;
        cursor += 1;
        const claim = claims[index];
        if (claim === undefined) return;

        const outcome = await processClaim(client, claim, workController.signal, workAbortsAt, deadline);
        if (outcome.settled) settled.add(claim.claim_token);
        if (outcome.filled) filled += 1;
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, claims.length) }, () => worker()),
    );

    // 시작하지 못했거나 item failure RPC가 끝나지 않은 lease를 자기 token으로만 해제한다.
    for (const claim of claims) {
      if (settled.has(claim.claim_token)) continue;
      await bestEffortRelease(client, claim, deadline);
    }

    const remaining = await pendingCount(client, deadline, claims.length - filled);
    return { ok: true, filled, failed: claims.length - filled, remaining };
  } catch (error) {
    console.error('Discord 파비콘 pass 실패', safeError(error));
    return { ok: false, error: '자동 파비콘을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  } finally {
    clearTimeout(workTimer);
    workController.abort();
  }
}

async function processClaim(
  client: UserClient,
  claim: Claim,
  workSignal: AbortSignal,
  workAbortsAt: number,
  actionDeadline: number,
): Promise<{ filled: boolean; settled: boolean }> {
  let uploadedPath: string | null = null;
  let uploadedUrl: string | null = null;

  try {
    const itemSignal = limitedSignal(workSignal, Math.min(ITEM_BUDGET_MS, workAbortsAt - Date.now()));
    const target = providerTarget(claim.claimed_url);
    if (target === null) throw new Error('unsafe favicon target');

    const icon = await fetchProviderIcon(target, itemSignal);
    const uploadSignal = limitedSignal(itemSignal, Math.min(UPLOAD_BUDGET_MS, workAbortsAt - Date.now()));
    const stored = await uploadDiscordFavicon(
      claim.bookmark_id,
      claim.claim_token,
      icon.body,
      icon.kind,
      uploadSignal,
    );
    uploadedPath = stored.path;
    uploadedUrl = stored.publicUrl;

    let finalized: boolean;
    try {
      finalized = await rpc<boolean>(
        client,
        'admin_finalize_discord_favicon',
        {
          bookmark_id: claim.bookmark_id,
          claim_token: claim.claim_token,
          claimed_url: claim.claimed_url,
          favicon_url: stored.publicUrl,
        },
        itemSignal,
      );
    } catch (error) {
      // 응답 유실은 commit 실패와 같지 않다. finalize가 DB에서 성공한 뒤 HTTP/AbortSignal만
      // 끊겼다면 객체를 지우는 순간 bookmark가 404를 가리킨다. 별도 authoritative RPC가
      // exact URL을 확인할 때만 성공으로 회복하고, 기존 claim이 그대로일 때만 미커밋으로
      // 확정한다. 상태 조회도 불명확하면 객체를 남겨 일일 reconciliation이 처리하게 한다.
      console.warn('Discord 파비콘 finalize 응답 확인 실패', {
        bookmarkId: claim.bookmark_id,
        reason: safeError(error),
      });
      const status = await resolveAmbiguousFinalize(
        client,
        claim,
        stored.publicUrl,
        actionDeadline,
      );
      if (status === 'finalized') return { filled: true, settled: true };
      if (status !== 'uncommitted') return { filled: false, settled: false };

      await bestEffortDelete(stored.path, actionDeadline);
      const settled = await bestEffortFailure(client, claim, actionDeadline);
      return { filled: false, settled };
    }

    if (!finalized) {
      await bestEffortDelete(uploadedPath, actionDeadline);
      return { filled: false, settled: false };
    }

    return { filled: true, settled: true };
  } catch (error) {
    console.warn('Discord 파비콘 항목 실패', {
      bookmarkId: claim.bookmark_id,
      reason: safeError(error),
    });
    // finalize의 ambiguous transport failure는 위에서 이미 분기되어 여기로 오지 않는다.
    // 따라서 이 catch의 uploaded object는 DB가 참조하지 않는다고 확정할 수 있다.
    if (uploadedPath !== null && uploadedUrl !== null) {
      await bestEffortDelete(uploadedPath, actionDeadline);
    }

    const settled = await bestEffortFailure(client, claim, actionDeadline);
    return { filled: false, settled };
  }
}

type AmbiguousFinalizeStatus = 'finalized' | 'uncommitted' | 'unknown';

async function resolveAmbiguousFinalize(
  client: UserClient,
  claim: Claim,
  uploadedUrl: string,
  deadline: number,
): Promise<AmbiguousFinalizeStatus> {
  try {
    const value = await rpc<unknown>(
      client,
      'admin_get_discord_favicon_reference',
      { bookmark_id: claim.bookmark_id },
      cleanupSignal(deadline),
    );
    if (!Array.isArray(value) || value.length > 1) return 'unknown';
    const row = value[0];
    if (typeof row !== 'object' || row === null) return 'unknown';
    const record = row as Record<string, unknown>;
    if (
      (record.favicon_url !== null && typeof record.favicon_url !== 'string') ||
      (record.active_claim_token !== null && typeof record.active_claim_token !== 'string')
    ) {
      return 'unknown';
    }
    if (record.favicon_url === uploadedUrl) return 'finalized';
    if (record.active_claim_token === claim.claim_token) return 'uncommitted';
    return 'unknown';
  } catch (error) {
    console.warn('Discord 파비콘 authoritative 상태 조회 실패', safeError(error));
    return 'unknown';
  }
}

type ProviderTarget = { origin: string; host: string };

function providerTarget(rawUrl: string): ProviderTarget | null {
  if (rawUrl.length > 2048 || /[^\x00-\x7f]/.test(rawUrl)) return null;

  const parsed = parseBookmarkUrlV1(rawUrl.trim());
  if (parsed === null || isIP(parsed.host) !== 0) return null;

  const host = parsed.host.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /\.(?:local|internal|home|lan|test|invalid|example|onion|arpa)$/.test(host)
  ) {
    return null;
  }
  if (getDomain(host, { allowPrivateDomains: false }) === null) return null;

  const port = parsed.port === null ? '' : `:${parsed.port}`;
  return { host, origin: `${parsed.scheme}://${host}${port}` };
}

async function fetchProviderIcon(
  target: ProviderTarget,
  signal: AbortSignal,
): Promise<{ body: Uint8Array; kind: DiscordIconKind }> {
  let endpoint = new URL('https://www.google.com/s2/favicons');
  endpoint.searchParams.set('domain_url', target.origin);
  endpoint.searchParams.set('sz', '64');

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      redirect: 'manual',
      signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null || redirects === 3) throw new Error('provider redirect rejected');

      const next = new URL(location, endpoint);
      if (next.protocol !== 'https:' || !isProviderHost(next.hostname)) {
        throw new Error('provider redirect host rejected');
      }
      endpoint = next;
      continue;
    }

    if (!response.ok) throw new Error(`provider HTTP ${response.status}`);

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new Error('provider body too large');
    }

    const body = await readLimitedBody(response, signal);
    const kind = sniffDiscordIcon(body);
    if (kind === null) throw new Error('provider response is not a supported image');

    return { body, kind };
  }

  throw new Error('provider redirect loop');
}

function isProviderHost(host: string): boolean {
  return PROVIDER_HOSTS.has(host) || host === 'gstatic.com' || host.endsWith('.gstatic.com');
}

async function readLimitedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (response.body === null) throw new Error('empty provider response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ICON_BYTES) throw new Error('provider body too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  if (total === 0) throw new Error('empty provider response');

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function pendingCount(client: UserClient, deadline: number, fallback: number): Promise<number> {
  try {
    const data = await rpc<number>(
      client,
      'admin_count_pending_discord_favicons',
      {},
      cleanupSignal(deadline),
    );
    return Number.isSafeInteger(data) && data >= 0 ? data : Math.max(0, fallback);
  } catch (error) {
    console.warn('Discord 파비콘 남은 수 조회 실패', safeError(error));
    return Math.max(0, fallback);
  }
}

async function bestEffortFailure(client: UserClient, claim: Claim, deadline: number): Promise<boolean> {
  try {
    return await rpc<boolean>(
      client,
      'admin_fail_discord_favicon',
      rpcClaimArgs(claim),
      cleanupSignal(deadline),
    );
  } catch (error) {
    console.warn('Discord 파비콘 failure 기록 실패', safeError(error));
    return false;
  }
}

async function bestEffortRelease(client: UserClient, claim: Claim, deadline: number): Promise<void> {
  try {
    await rpc<boolean>(
      client,
      'admin_release_discord_favicon',
      rpcClaimArgs(claim),
      cleanupSignal(deadline),
    );
  } catch (error) {
    console.warn('Discord 파비콘 lease release 실패', safeError(error));
  }
}

async function bestEffortDelete(path: string, deadline: number): Promise<void> {
  try {
    if (!(await deleteDiscordFavicon(path, cleanupSignal(deadline)))) {
      console.warn('Discord 파비콘 orphan 삭제 실패', { path });
    }
  } catch (error) {
    console.warn('Discord 파비콘 orphan 삭제 실패', { path, reason: safeError(error) });
  }
}

async function rpc<T>(
  client: UserClient,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<T> {
  const { data, error } = await client.rpc(name, args).abortSignal(signal);
  if (error !== null) throw new Error(`${name} failed (${error.code ?? 'unknown'})`);
  return data as T;
}

function rpcClaimArgs(claim: Claim): Record<string, unknown> {
  return {
    bookmark_id: claim.bookmark_id,
    claim_token: claim.claim_token,
    claimed_url: claim.claimed_url,
  };
}

function validateClaims(value: unknown): Claim[] {
  if (!Array.isArray(value) || value.length > MAX_CLAIMS) throw new Error('invalid claim response');

  return value.map((row) => {
    if (typeof row !== 'object' || row === null) throw new Error('invalid claim row');
    const record = row as Record<string, unknown>;
    if (
      typeof record.bookmark_id !== 'string' ||
      !UUID.test(record.bookmark_id) ||
      typeof record.claim_token !== 'string' ||
      !UUID.test(record.claim_token) ||
      typeof record.claimed_url !== 'string' ||
      record.claimed_url.length > 2048
    ) {
      throw new Error('invalid claim row');
    }

    return {
      bookmark_id: record.bookmark_id,
      claim_token: record.claim_token,
      claimed_url: record.claimed_url,
    };
  });
}

function limitedSignal(parent: AbortSignal, durationMs: number): AbortSignal {
  if (durationMs <= 0) return AbortSignal.abort(new Error('deadline exceeded'));
  return AbortSignal.any([parent, AbortSignal.timeout(Math.max(1, Math.floor(durationMs)))]);
}

function cleanupSignal(deadline: number): AbortSignal {
  const remaining = Math.max(1, Math.min(3_000, deadline - Date.now() - 250));
  return AbortSignal.timeout(remaining);
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
