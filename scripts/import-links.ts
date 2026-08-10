/**
 * `scripts/import-data.ts` 의 반입표대로 링크를 **새로 만들고**, 기존 링크 일부를 새 하위로 **옮긴다**.
 *
 * ```
 * npx tsx scripts/import-links.ts            # 드라이런
 * npx tsx scripts/import-links.ts --apply    # 실제 반영 (되돌림 스냅샷을 먼저 남긴다)
 * ```
 *
 * `scripts/enrich.ts` 와 같은 규약이다 — `--apply` 없으면 아무것도 쓰지 않고, 쓰기 전에
 * `enrich-snapshot-*.json`(gitignore 대상)으로 지금 상태를 통째로 남긴다.
 *
 * ## 스스로 막는 것
 *
 * 1. **설명 42자** — 넘치면 한 건도 쓰지 않고 멈춘다(카드에서 잘리기 때문 · geometry.ts).
 * 2. **이미 있는 URL** — 반입표에 있는데 DB 에도 있으면 **만들지 않고 건너뛴다**(중복 카드 금지).
 * 3. **표 안의 중복 URL** — 같은 주소가 두 번 있으면 거부한다.
 * 4. **근거 없는 새 분류** — `NEW_CATEGORIES` 에 적어 두지 않은 이름은 만들지 않는다.
 * 5. **상위 신설은 허용하되 명시적으로** — `'투자·창업 지원'` 처럼 ' > ' 가 없는 경로도
 *    `NEW_CATEGORIES` 에 있으면 상위로 만든다(enrich 는 하위만 만들었다).
 *
 * ## 정렬
 *
 * 새 링크의 `sort_order` 는 **표에 적힌 차례 그대로** 각 분류 안에서 이어 붙인다. 표를 분류별로
 * 묶어 두었으므로 화면에 보이는 차례가 곧 이 파일의 차례다("Sorting 해서 반영" 요청).
 */
import { writeFileSync } from 'node:fs';

import { IMPORTS, MOVES, NEW_CATEGORIES } from './import-data';
import { createServiceRoleClient } from './lib/service-client';

/** `components/card/geometry.ts` 와 같은 값. */
const MAX_DESCRIPTION = 42;

type CategoryRow = { id: string; name: string; parent_id: string | null; sort_order: number };
type BookmarkRow = { id: string; url: string; title: string; category_id: string | null; sort_order: number };

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const problems = validate();
  if (problems.length > 0) {
    console.error(`❌ 반입표가 통과하지 못했다 (${problems.length}건) — 아무것도 쓰지 않는다.\n`);
    for (const line of problems) console.error(`   ${line}`);
    process.exitCode = 1;

    return;
  }

  const supabase = createServiceRoleClient();

  const categoriesResult = await supabase
    .from('categories')
    .select('id, name, parent_id, sort_order')
    .order('sort_order');
  if (categoriesResult.error !== null) throw categoriesResult.error;
  const categories = categoriesResult.data as CategoryRow[];

  const bookmarksResult = await supabase
    .from('bookmarks')
    .select('id, url, title, category_id, sort_order');
  if (bookmarksResult.error !== null) throw bookmarksResult.error;
  const bookmarks = bookmarksResult.data as BookmarkRow[];

  const byUrl = new Map(bookmarks.map((row) => [row.url, row]));
  const paths = categoryPaths(categories);

  const fresh = IMPORTS.filter((entry) => !byUrl.has(entry.url));
  const already = IMPORTS.filter((entry) => byUrl.has(entry.url));
  const moves = MOVES.filter((entry) => byUrl.has(entry.url));
  const missingMoves = MOVES.filter((entry) => !byUrl.has(entry.url));

  const declared = new Set(NEW_CATEGORIES.map((entry) => entry.path));
  /* 쓰이는 경로 + **그 부모**. 부모를 함께 넣지 않으면 `'투자·창업 지원 > 벤처캐피털'` 만 만들려다
     상위를 못 찾고 죽는다 — 어느 항목도 상위를 category 로 직접 적지 않기 때문이다. */
  const wanted = new Set(
    [...IMPORTS, ...MOVES].flatMap((entry) => {
      const [top] = entry.category.split(' > ');

      return [top, entry.category];
    }),
  );
  const toCreate = [...wanted].filter((path) => paths.idOf(path) === null);
  const undeclared = toCreate.filter((path) => !declared.has(path));
  if (undeclared.length > 0) {
    console.error(`\n❌ 근거 없이 만들려는 분류 ${undeclared.length}건 — NEW_CATEGORIES 에 적어라:`);
    for (const path of undeclared) console.error(`   ${path}`);
    process.exitCode = 1;

    return;
  }

  console.log(`DB 링크 ${bookmarks.length}건 · 반입표 ${IMPORTS.length}건`);
  console.log(`새로 만들 링크 ${fresh.length} · 이미 있어 건너뜀 ${already.length} · 옮길 링크 ${moves.length}`);
  console.log(`새로 만들 분류 ${toCreate.length}\n`);
  for (const path of toCreate) console.log(`   + ${path}`);
  if (already.length > 0) {
    console.log('\n이미 있어 건너뛰는 것:');
    for (const entry of already) console.log(`   ${entry.title}  ${entry.url}`);
  }
  if (missingMoves.length > 0) {
    console.log('\n⚠️ 옮기려 했는데 DB 에서 못 찾은 URL:');
    for (const entry of missingMoves) console.log(`   ${entry.url}`);
  }

  const byCategory = new Map<string, number>();
  for (const entry of fresh) byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
  console.log('\n분류별 새 링크 수:');
  for (const [path, count] of [...byCategory].sort()) console.log(`   ${path}  ${count}`);

  if (!apply) {
    console.log('\n드라이런이다 — 아무것도 쓰지 않았다. 반영하려면 --apply 를 붙여라.');

    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = `enrich-snapshot-${stamp}.json`;
  writeFileSync(snapshotPath, JSON.stringify({ categories, bookmarks }, null, 2));
  console.log(`\n되돌림 스냅샷: ${snapshotPath}`);

  // ── 분류 만들기. 상위를 먼저 만들어야 하위가 부모를 찾는다.
  for (const path of [...toCreate].sort((left, right) => left.split(' > ').length - right.split(' > ').length)) {
    const [parentName, childName] = path.split(' > ');
    const isTop = childName === undefined;
    const parentId = isTop ? null : paths.idOf(parentName);
    if (!isTop && parentId === null) throw new Error(`상위 분류를 찾지 못했다: ${parentName}`);

    const siblings = categories.filter((row) => row.parent_id === parentId);
    const sortOrder = siblings.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;

    const created = await supabase
      .from('categories')
      .insert({ name: isTop ? parentName : childName, parent_id: parentId, sort_order: sortOrder })
      .select('id, name, parent_id, sort_order')
      .single();
    if (created.error !== null) throw created.error;

    const row = created.data as CategoryRow;
    categories.push(row);
    paths.remember(path, row.id);
    console.log(`   + 분류 생성: ${path}`);
  }

  // ── 옮기기
  for (const move of moves) {
    const target = paths.idOf(move.category);
    if (target === null) throw new Error(`분류를 찾지 못했다: ${move.category}`);

    const row = byUrl.get(move.url);
    if (row === undefined) continue;

    const result = await supabase
      .from('bookmarks')
      .update({ category_id: target })
      .eq('id', row.id)
      .select('id');
    if (result.error !== null) throw result.error;
  }
  console.log(`\n${moves.length}건 이동 완료.`);

  // ── 새 링크. `sort_order` 는 테이블 전체가 공유하는 컬럼이라 지금 최댓값 뒤에 이어 붙인다
  //    (표의 차례가 그대로 분류 안의 차례가 된다 — 파일 상단 '정렬' 참조).
  let next = bookmarks.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
  const rows = fresh.map((entry) => {
    const target = paths.idOf(entry.category);
    if (target === null) throw new Error(`분류를 찾지 못했다: ${entry.category}`);

    return {
      category_id: target,
      title: entry.title,
      url: entry.url,
      description: entry.description,
      favicon_url: null,
      is_pinned: false,
      sort_order: next++,
    };
  });

  for (const chunk of batches(rows, 50)) {
    const result = await supabase.from('bookmarks').insert(chunk).select('id');
    if (result.error !== null) throw result.error;
    console.log(`   + ${result.data?.length ?? 0}건 추가`);
  }

  console.log(`\n✅ 새 링크 ${rows.length}건 · 이동 ${moves.length}건 · 새 분류 ${toCreate.length}개 반영 완료.`);
  console.log('   파비콘은 `npx tsx scripts/collect-favicons.ts` 로 따로 모은다.');
}

function validate(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const entry of IMPORTS) {
    if (seen.has(entry.url)) problems.push(`URL 중복: ${entry.url}`);
    seen.add(entry.url);

    if (entry.title.trim() === '') problems.push(`제목이 비었다: ${entry.url}`);
    if ([...entry.description].length > MAX_DESCRIPTION) {
      problems.push(
        `설명 ${[...entry.description].length}자 (한계 ${MAX_DESCRIPTION}): ${entry.title} — "${entry.description}"`,
      );
    }
    if (!/^https?:\/\//.test(entry.url)) problems.push(`http(s) 주소가 아니다: ${entry.url}`);
  }

  return problems;
}

/** 긴 목록을 나눠 보낸다 — 한 번에 다 넣으면 요청이 커져 거부될 수 있다. */
function batches<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));

  return chunks;
}

/** `'상위'`·`'상위 > 하위'` ↔ id. `enrich.ts` 의 같은 이름 함수와 같은 계산이다. */
function categoryPaths(categories: CategoryRow[]) {
  const idByPath = new Map<string, string>();

  function rebuild(): void {
    idByPath.clear();
    const byId = new Map(categories.map((row) => [row.id, row]));
    for (const row of categories) {
      const parent = row.parent_id === null ? null : byId.get(row.parent_id);
      idByPath.set(parent == null ? row.name : `${parent.name} > ${row.name}`, row.id);
    }
  }
  rebuild();

  return {
    idOf: (path: string): string | null => idByPath.get(path) ?? null,
    remember: (path: string, id: string): void => {
      idByPath.set(path, id);
    },
  };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
