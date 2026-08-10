/**
 * 죽은 링크·중복 카드를 정리하고 옮겨 간 주소를 고친다 (2026-08-10 사용자 승인).
 *
 * ```
 * npx tsx scripts/fix-links.ts            # 드라이런
 * npx tsx scripts/fix-links.ts --apply    # 실제 적용 (되돌림 스냅샷을 먼저 남긴다)
 * ```
 *
 * `enrich.ts`·`import-links.ts` 와 같은 규약이다 — `--apply` 없으면 아무것도 쓰지 않고,
 * 쓰기 전에 `enrich-snapshot-*.json` 으로 지금 상태를 통째로 남긴다.
 *
 * **지우는 것은 여기 적힌 URL 뿐이다.** 패턴이나 조건으로 고르지 않는다 — 한 줄 잘못 쓰면 수백
 * 건이 사라지는 자리라, 지울 대상은 사람이 하나씩 적고 근거를 같이 남긴다.
 */
import { writeFileSync } from 'node:fs';

import { createServiceRoleClient } from './lib/service-client';

/** 카드 설명 칸이 감당하는 한계 — `components/card/geometry.ts` 와 같은 값. */
const MAX_DESCRIPTION = 42;

/** 지울 링크와 그 근거. 근거 없이 한 줄도 늘리지 마라. */
const DELETIONS: { url: string; why: string }[] = [
  {
    url: 'https://jules.google.com/task',
    why: '같은 서비스가 두 카드였다 — 공식 도메인인 https://jules.google/ 쪽을 남긴다.',
  },
  {
    url: 'https://typeset.io/',
    why: 'SciSpace 의 옛 도메인이라 https://scispace.com/ 과 같은 서비스다 — 새 도메인을 남긴다.',
  },
  {
    url: 'https://clova-x.naver.com/',
    why: '네이버가 2026-04-09 로 CLOVA X 서비스를 종료했다. 대체 주소가 없다.',
  },
  {
    url: 'https://gptable.net/',
    why: '도메인이 남의 손에 넘어가 bekwellmaroc.com 으로 301 리디렉션된다(무관한 사이트).',
  },
];

/** 옮겨 간 주소. `url` 로 찾아 `to` 로 바꾸고, 제목·설명도 함께 손본다. */
const MOVES: { url: string; to: string; title: string; description: string; why: string }[] = [
  {
    url: 'https://labs.google/experiments',
    to: 'https://labs.google/',
    title: 'Google Labs',
    description: '구글이 실험 중인 AI 프로젝트를 모아 공개하는 곳',
    why: '/experiments 하위 경로가 404 가 됐다. 루트에 같은 목록이 그대로 있다.',
  },
];

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const tooLong = MOVES.filter((move) => [...move.description].length > MAX_DESCRIPTION);
  if (tooLong.length > 0) {
    console.error(`❌ 설명이 ${MAX_DESCRIPTION}자를 넘는다 — 카드에서 잘린다.`);
    for (const move of tooLong) console.error(`   ${move.title}: ${move.description}`);
    process.exitCode = 1;

    return;
  }

  const supabase = createServiceRoleClient();

  const found = await supabase.from('bookmarks').select('id, url, title, description, category_id');
  if (found.error !== null) throw found.error;
  const bookmarks = found.data as { id: string; url: string; title: string }[];
  const byUrl = new Map(bookmarks.map((row) => [row.url, row]));

  const toDelete = DELETIONS.filter((entry) => byUrl.has(entry.url));
  const missingDelete = DELETIONS.filter((entry) => !byUrl.has(entry.url));
  const toMove = MOVES.filter((entry) => byUrl.has(entry.url));
  const missingMove = MOVES.filter((entry) => !byUrl.has(entry.url));

  console.log(`DB 링크 ${bookmarks.length}건`);
  console.log(`\n지울 것 ${toDelete.length}/${DELETIONS.length}건:`);
  for (const entry of toDelete) console.log(`   − ${byUrl.get(entry.url)?.title}\n     ${entry.why}`);
  for (const entry of missingDelete) console.log(`   (이미 없음) ${entry.url}`);

  console.log(`\n주소를 고칠 것 ${toMove.length}/${MOVES.length}건:`);
  for (const entry of toMove) {
    console.log(`   ${byUrl.get(entry.url)?.title} → ${entry.title}\n     ${entry.url} → ${entry.to}\n     ${entry.why}`);
  }
  for (const entry of missingMove) console.log(`   (이미 없음) ${entry.url}`);

  if (!apply) {
    console.log('\n드라이런이다 — 아무것도 쓰지 않았다. 적용하려면 --apply 를 붙여라.');

    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = `enrich-snapshot-${stamp}.json`;
  writeFileSync(snapshotPath, JSON.stringify({ bookmarks: found.data }, null, 2));
  console.log(`\n되돌림 스냅샷: ${snapshotPath}`);

  for (const entry of toMove) {
    const row = byUrl.get(entry.url);
    if (row === undefined) continue;

    const result = await supabase
      .from('bookmarks')
      .update({ url: entry.to, title: entry.title, description: entry.description })
      .eq('id', row.id)
      .select('id');
    if (result.error !== null) throw result.error;
  }
  console.log(`   ${toMove.length}건 주소 수정 완료.`);

  for (const entry of toDelete) {
    const row = byUrl.get(entry.url);
    if (row === undefined) continue;

    const result = await supabase.from('bookmarks').delete().eq('id', row.id).select('id');
    if (result.error !== null) throw result.error;
  }
  console.log(`   ${toDelete.length}건 삭제 완료.`);

  console.log('\n✅ 정리 끝. 파비콘은 `npx tsx scripts/collect-new-favicons.ts --apply` 로 다시 모은다.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
