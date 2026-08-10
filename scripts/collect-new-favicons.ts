/**
 * **파비콘이 비어 있는 링크만** 골라 아이콘을 모아 Storage 에 올린다.
 *
 * ```
 * npx tsx scripts/collect-new-favicons.ts            # 드라이런 — 대상만 센다
 * npx tsx scripts/collect-new-favicons.ts --apply
 * ```
 *
 * `scripts/collect-favicons.ts` 는 **시드(B5)가 부르는 함수**라 단독 진입점이 없고, 시드가 만든
 * 배열을 그대로 받아야 한다(그 파일 상단 경고). 반입(`import-links.ts`)으로 새로 생긴 링크에는
 * 그 경로가 없으므로, 이미 DB 에 있는 행을 그 함수가 아는 모양(`BookmarkSeed`)으로 접어 넘긴다.
 *
 * **`purge` 는 절대 켜지 않는다** — 기존 249건의 아이콘이 통째로 날아간다(CollectOptions 주석).
 * `legacyId` 는 실패 리포트 정렬에만 쓰이는 값이라 순번을 넣는다.
 */
import type { Bookmark } from '@/lib/types';

import { collectFavicons, formatTally, reportFailures } from './collect-favicons';
import { createServiceRoleClient } from './lib/service-client';

const COLUMNS = 'id, category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, created_at';

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();

  const found = await supabase.from('bookmarks').select(COLUMNS).is('favicon_url', null);
  if (found.error !== null) throw found.error;

  const rows = found.data as Bookmark[];
  console.log(`파비콘이 비어 있는 링크 ${rows.length}건`);
  if (rows.length === 0) return;

  if (!apply) {
    for (const row of rows.slice(0, 20)) console.log(`   ${row.title}  ${row.url}`);
    if (rows.length > 20) console.log(`   … 외 ${rows.length - 20}건`);
    console.log('\n드라이런이다 — 반영하려면 --apply 를 붙여라.');

    return;
  }

  /* `iconFile` 은 **반드시 null 이어야 한다** — 빠뜨리면 undefined 가 되고, 수집기는 그것을
     "보유분이 있다"로 읽어 `docs/data/icons/undefined` 를 열려다 전건 실패한다(실측). */
  const seeds = rows.map((row, index) => ({ ...row, iconFile: null, legacyId: index }));

  const { urls, failures, uploaded } = await collectFavicons(supabase, seeds);

  let written = 0;
  for (const [id, publicUrl] of urls) {
    const result = await supabase.from('bookmarks').update({ favicon_url: publicUrl }).eq('id', id);
    if (result.error !== null) throw result.error;
    written += 1;
  }

  console.log(`\n✅ ${written}건에 파비콘을 붙였다. ${formatTally(uploaded)}`);
  reportFailures(failures);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
