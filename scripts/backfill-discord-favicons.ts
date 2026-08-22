/**
 * 기존 Discord 행 중 favicon_url이 비어 있는 항목을 provider-only 경로로 복구한다.
 *
 * 기본은 network dry-run이며 `--apply`일 때만 Storage와 DB를 쓴다. 일반 자동 수집은 runtime claim
 * RPC를 사용하고, 이 스크립트의 service-role DB update는 운영 백업 뒤 실행하는 one-time repair다.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import {
  discordFaviconProviderTarget,
  fetchDiscordFaviconProvider,
} from '@/lib/discord-favicon-provider';

import { createServiceRoleClient } from './lib/service-client';

const BUCKET = 'favicons';
const apply = process.argv.includes('--apply');

type BookmarkRow = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  favicon_url: string | null;
  source: string;
};

type Asset = BookmarkRow & {
  body: Uint8Array;
  kind: { contentType: string; extension: string };
};

async function main(): Promise<void> {
  if (process.env.DISCORD_FAVICON_PROVIDER_APPROVED !== 'true') {
    throw new Error('DISCORD_FAVICON_PROVIDER_APPROVED=true가 필요합니다.');
  }

  const supabase = createServiceRoleClient();
  const result = await supabase
    .from('bookmarks')
    .select('id, url, title, description, favicon_url, source')
    .eq('source', 'discord')
    .is('favicon_url', null)
    .order('created_at');
  if (result.error !== null) throw result.error;

  const rows = result.data as BookmarkRow[];
  console.log(`Discord 파비콘 누락 ${rows.length}건`);
  if (rows.length === 0) return;

  const assets: Asset[] = [];
  const failures: Array<{ title: string; reason: string }> = [];
  for (const row of rows) {
    const target = discordFaviconProviderTarget(row.url);
    if (target === null) {
      failures.push({ title: row.title, reason: '안전한 provider 대상이 아님' });
      continue;
    }

    try {
      const icon = await fetchDiscordFaviconProvider(target, AbortSignal.timeout(10_000));
      assets.push({ ...row, body: icon.body, kind: icon.kind });
      console.log(`  확인 ${row.title} · ${icon.kind.extension} ${icon.body.byteLength}B`);
    } catch (error) {
      failures.push({ title: row.title, reason: safeReason(error) });
    }
  }

  if (!apply) {
    console.log(`드라이런: 저장 가능 ${assets.length}건 · 실패 ${failures.length}건 · DB/Storage 쓰기 0건`);
    reportFailures(failures);
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  const snapshot = `discord-favicon-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(snapshot, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  console.log(`되돌림 스냅샷: ${snapshot}`);

  const bucket = supabase.storage.from(BUCKET);
  let written = 0;
  for (const asset of assets) {
    const path = `repair/${asset.id}/${randomUUID()}.${asset.kind.extension}`;
    const uploaded = await bucket.upload(path, asset.body, {
      contentType: asset.kind.contentType,
      upsert: false,
    });
    if (uploaded.error !== null) {
      failures.push({ title: asset.title, reason: 'Storage 업로드 실패' });
      continue;
    }

    const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
    const updated = await supabase
      .from('bookmarks')
      .update({ favicon_url: publicUrl })
      .eq('id', asset.id)
      .eq('url', asset.url)
      .eq('source', 'discord')
      .is('favicon_url', null)
      .select('id');
    if (updated.error !== null || updated.data?.length !== 1) {
      await bucket.remove([path]);
      failures.push({ title: asset.title, reason: 'DB compare-and-set 실패' });
      continue;
    }
    written += 1;
  }

  console.log(`적용 완료: ${written}건 · 실패 ${failures.length}건`);
  reportFailures(failures);
  if (failures.length > 0) process.exitCode = 1;
}

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return 'provider 실패';
  if (/^provider (?:HTTP \d{3}|redirect|response|body)/.test(error.message)) return error.message;
  return error.name;
}

function reportFailures(failures: readonly { title: string; reason: string }[]): void {
  for (const failure of failures) console.log(`  실패 ${failure.title} · ${failure.reason}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Discord 파비콘 복구 실패');
  process.exitCode = 1;
});
