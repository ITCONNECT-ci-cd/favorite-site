import 'server-only';

import {
  claimDiscordIngestFavicon,
  failDiscordIngestFavicon,
  finalizeDiscordIngestFavicon,
  updateDiscordIngestMetadata,
  type DiscordIngestFaviconClaim,
} from '@/lib/discord-ingest-db';
import {
  discordFaviconProviderTarget,
  fetchDiscordFaviconProvider,
} from '@/lib/discord-favicon-provider';
import {
  deleteDiscordFavicon,
  uploadDiscordFavicon,
} from '@/lib/discord-favicon-storage';
import {
  collectDiscordLinkMetadata,
  mergeDiscordLinkMetadata,
} from '@/lib/discord-link-metadata';

const WORK_BUDGET_MS = 15_000;
const METADATA_BUDGET_MS = 6_000;
const ICON_BUDGET_MS = 7_000;
const STORAGE_BUDGET_MS = 4_000;
const CLEANUP_BUDGET_MS = 2_000;

export type DiscordIngestEnrichmentInput = {
  bookmarkId: string;
  url: string;
  title: string;
  description: string;
};

/**
 * ingest 응답 뒤 실행되는 best-effort worker. metadata 실패는 안전한 설명 fallback으로 접고,
 * favicon은 exact id+URL claim과 token CAS를 모두 통과한 경우에만 bookmark에 연결한다.
 */
export async function enrichDiscordIngest(
  input: DiscordIngestEnrichmentInput,
): Promise<void> {
  const work = AbortSignal.timeout(WORK_BUDGET_MS);

  await enrichMetadata(input, work);

  if (process.env.DISCORD_FAVICON_PROVIDER_APPROVED !== 'true' || work.aborted) return;
  await enrichFavicon(input, work);
}

async function enrichMetadata(
  input: DiscordIngestEnrichmentInput,
  work: AbortSignal,
): Promise<void> {
  try {
    const metadata = await collectDiscordLinkMetadata(input.url, {
      signal: limitedSignal(work, METADATA_BUDGET_MS),
    });
    const merged = mergeDiscordLinkMetadata({
      url: input.url,
      title: input.title,
      description: input.description,
      metadata,
    });
    await updateDiscordIngestMetadata({
      bookmarkId: input.bookmarkId,
      claimedUrl: input.url,
      expectedTitle: input.title,
      title: merged.title,
      description: merged.description,
    });
  } catch {
    // URL·DNS·DB 원문은 로그에 남기지 않는다. favicon 처리는 독립적으로 계속 시도한다.
    console.warn('[discord-ingest-enrichment] metadata enrichment failed');
  }
}

async function enrichFavicon(
  input: DiscordIngestEnrichmentInput,
  work: AbortSignal,
): Promise<void> {
  let claim: DiscordIngestFaviconClaim | null = null;
  let uploadedPath: string | null = null;

  try {
    claim = await claimDiscordIngestFavicon(input.bookmarkId, input.url);
    if (claim === null) return;

    const target = discordFaviconProviderTarget(claim.claimedUrl);
    if (target === null) throw new Error('unsafe favicon target');

    const icon = await fetchDiscordFaviconProvider(
      target,
      limitedSignal(work, ICON_BUDGET_MS),
    );
    const stored = await uploadDiscordFavicon(
      claim.bookmarkId,
      claim.claimToken,
      icon.body,
      icon.kind,
      limitedSignal(work, STORAGE_BUDGET_MS),
    );
    uploadedPath = stored.path;

    let finalized: boolean;
    try {
      finalized = await finalizeDiscordIngestFavicon(claim, stored.publicUrl);
    } catch {
      // finalize 응답 유실 뒤에는 commit 여부가 불명확하다. exact token을 아직 해제할 수 있을 때만
      // 미커밋이 확정되므로 그 경우에만 객체를 지운다. 아니면 reconciliation이 참조를 판정한다.
      const uncommitted = await bestEffortFail(claim);
      if (uncommitted) await bestEffortDelete(stored.path);
      console.warn('[discord-ingest-enrichment] favicon finalize status is ambiguous');
      return;
    }

    if (!finalized) {
      await bestEffortDelete(stored.path);
      await bestEffortFail(claim);
    }
  } catch {
    if (uploadedPath !== null) await bestEffortDelete(uploadedPath);
    if (claim !== null) await bestEffortFail(claim);
    console.warn('[discord-ingest-enrichment] favicon enrichment failed');
  }
}

async function bestEffortFail(claim: DiscordIngestFaviconClaim): Promise<boolean> {
  try {
    return await failDiscordIngestFavicon(claim);
  } catch {
    return false;
  }
}

async function bestEffortDelete(path: string): Promise<void> {
  try {
    await deleteDiscordFavicon(path, AbortSignal.timeout(CLEANUP_BUDGET_MS));
  } catch {
    // 일일 reconciliation이 DB 비참조 객체를 다시 확인한다.
  }
}

function limitedSignal(parent: AbortSignal, durationMs: number): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(durationMs)]);
}
