/**
 * 실제 favicon/provider 수집을 모두 통과하지 못한 수동 링크에 deterministic monogram을 채운다.
 * 공식 아이콘인 척 외부 이미지를 복제하지 않고, null 회색 타일/깨진 이미지 대신 사이트별 식별자를 준다.
 */
import { writeFileSync } from 'node:fs';

import { createServiceRoleClient } from './lib/service-client';

const apply = process.argv.includes('--apply');
const COLORS = ['#4F46E5', '#0F766E', '#B45309', '#BE123C', '#6D28D9', '#0369A1', '#3F6212', '#9F1239'];

type BookmarkRow = {
  id: string;
  url: string;
  title: string;
  favicon_url: string | null;
  source: string;
};

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();
  const result = await supabase
    .from('bookmarks')
    .select('id, url, title, favicon_url, source')
    .eq('source', 'manual')
    .is('favicon_url', null)
    .order('created_at');
  if (result.error !== null) throw result.error;

  const rows = result.data as BookmarkRow[];
  console.log(`실제 favicon을 찾지 못한 수동 링크 ${rows.length}건`);
  for (const row of rows) console.log(`  ${row.title} · ${new URL(row.url).hostname}`);
  if (rows.length === 0) return;

  if (!apply) {
    console.log('드라이런이다 — DB 쓰기 0건');
    return;
  }

  const snapshot = `favicon-placeholder-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(snapshot, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  console.log(`되돌림 스냅샷: ${snapshot}`);

  let written = 0;
  for (const row of rows) {
    const faviconUrl = monogramDataUri(row.title, new URL(row.url).hostname);
    const updated = await supabase
      .from('bookmarks')
      .update({ favicon_url: faviconUrl })
      .eq('id', row.id)
      .eq('url', row.url)
      .eq('source', 'manual')
      .is('favicon_url', null)
      .select('id');
    if (updated.error !== null || updated.data?.length !== 1) {
      throw new Error(`placeholder compare-and-set 실패: ${row.id}`);
    }
    written += 1;
  }
  console.log(`placeholder 적용 완료 ${written}건`);
}

export function monogramDataUri(title: string, host: string): string {
  const label = firstGrapheme(title.trim()) || firstGrapheme(host) || '?';
  const color = COLORS[stableHash(host.toLowerCase()) % COLORS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="15" fill="${color}"/>` +
    `<text x="32" y="34" text-anchor="middle" dominant-baseline="middle" fill="#fff" ` +
    `font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="30" font-weight="700">` +
    `${escapeXml(label)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function firstGrapheme(value: string): string {
  const first = new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value)[Symbol.iterator]().next();
  return first.done ? '' : first.value.segment;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'favicon placeholder 적용 실패');
  process.exitCode = 1;
});
