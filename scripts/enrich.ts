/**
 * 링크 249건의 제목·설명·분류를 `scripts/enrich-data.ts` 의 교정표대로 라이브 DB 에 적용한다.
 *
 * ```
 * npx tsx scripts/enrich.ts            # 드라이런 — 무엇이 바뀔지만 보여 준다
 * npx tsx scripts/enrich.ts --apply    # 실제 적용 (되돌림 스냅샷을 먼저 남긴다)
 * ```
 *
 * `scripts/reclassify.ts` 의 규약을 그대로 따른다: **`--apply` 가 없으면 아무것도 쓰지 않고**,
 * 쓰기 전에 되돌림 스냅샷(`enrich-snapshot-*.json`, gitignore 대상)을 남긴다.
 *
 * ## 적용 전에 스스로 막는 것 넷
 *
 * 1. **설명 길이** — 42자를 넘으면 카드에서 잘린다(`components/card/geometry.ts`). 한 건이라도
 *    넘치면 **아무것도 쓰지 않고** 멈춘다. 자르지 않는 이유: 문장 끝이 잘린 설명은 없는 것만
 *    못하고, 어느 것이 잘렸는지 나중에 알 수 없다.
 * 2. **키 대조** — 표에 있는데 DB 에 없는 URL, DB 에 있는데 표에 없는 링크를 둘 다 보고한다.
 *    전자는 오타이거나 그사이 지워진 링크이고, 후자는 손대지 않고 남겨 둔 링크다.
 * 3. **새 분류** — `NEW_CATEGORIES` 에 근거와 함께 적어 둔 이름만 만든다. 분류명 오타가 조용히
 *    링크 한 건짜리 유령 분류가 되는 것을 막는다.
 * 4. **URL 중복** — 표 안에 같은 URL 이 두 번 오면 나중 것이 앞엣것을 덮으므로 거부한다.
 */
import { writeFileSync } from 'node:fs';

import { ENRICHMENTS, NEW_CATEGORIES, type Enrichment } from './enrich-data';
import { createServiceRoleClient } from './lib/service-client';

/** 카드 설명 칸(3줄 × 약 11자)이 감당하는 한계. `components/card/geometry.ts` 와 같은 값이다. */
const MAX_DESCRIPTION = 42;

type CategoryRow = { id: string; name: string; parent_id: string | null; sort_order: number };
type BookmarkRow = { id: string; url: string; title: string; description: string | null; category_id: string | null };

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();

  const failures = validateTable();
  if (failures.length > 0) {
    console.error(`❌ 교정표 자체가 통과하지 못했다 (${failures.length}건) — 아무것도 쓰지 않는다.\n`);
    for (const line of failures) console.error(`   ${line}`);
    process.exitCode = 1;

    return;
  }

  const categoriesResult = await supabase
    .from('categories')
    .select('id, name, parent_id, sort_order')
    .order('sort_order');
  if (categoriesResult.error !== null) throw categoriesResult.error;
  const categories = categoriesResult.data as CategoryRow[];

  const bookmarksResult = await supabase
    .from('bookmarks')
    .select('id, url, title, description, category_id');
  if (bookmarksResult.error !== null) throw bookmarksResult.error;
  const bookmarks = bookmarksResult.data as BookmarkRow[];

  const byUrl = new Map(bookmarks.map((row) => [row.url, row]));
  const pathOf = categoryPathResolver(categories);

  // ── 키 대조
  const missing = ENRICHMENTS.filter((entry) => !byUrl.has(entry.url));
  const touched = new Set(ENRICHMENTS.map((entry) => entry.url));
  const untouched = bookmarks.filter((row) => !touched.has(row.url));

  console.log(`DB 링크 ${bookmarks.length}건 · 교정표 ${ENRICHMENTS.length}건`);
  if (missing.length > 0) {
    console.log(`\n⚠️ 표에 있는데 DB 에서 못 찾은 URL ${missing.length}건 (오타이거나 지워진 링크):`);
    for (const entry of missing) console.log(`   ${entry.title}  ${entry.url}`);
  }
  if (untouched.length > 0) {
    console.log(`\n⚠️ 표에 없어 손대지 않는 링크 ${untouched.length}건:`);
    for (const row of untouched) console.log(`   ${row.title}  ${row.url}`);
  }

  // ── 새 분류
  const declared = new Set(NEW_CATEGORIES.map((entry) => entry.path));
  const wanted = new Set(
    ENRICHMENTS.flatMap((entry) => (entry.category === undefined ? [] : [entry.category])),
  );
  const toCreate = [...wanted].filter((path) => pathOf.idOf(path) === null);
  const undeclared = toCreate.filter((path) => !declared.has(path));
  if (undeclared.length > 0) {
    console.error(`\n❌ 근거 없이 새로 만들려는 분류 ${undeclared.length}건 — NEW_CATEGORIES 에 적어라:`);
    for (const path of undeclared) console.error(`   ${path}`);
    process.exitCode = 1;

    return;
  }

  // ── 바뀔 것 세기
  const plan = ENRICHMENTS.flatMap((entry) => {
    const row = byUrl.get(entry.url);
    if (row === undefined) return [];

    const nextCategoryPath = entry.category ?? null;
    const currentPath = pathOf.pathOfId(row.category_id);

    return [
      {
        entry,
        row,
        titleChanged: row.title !== entry.title,
        descriptionChanged: (row.description ?? '') !== entry.description,
        movedTo: nextCategoryPath !== null && nextCategoryPath !== currentPath ? nextCategoryPath : null,
        currentPath,
      },
    ];
  });

  const titleChanges = plan.filter((item) => item.titleChanged);
  const moves = plan.filter((item) => item.movedTo !== null);

  console.log(`\n제목 교정 ${titleChanges.length}건 · 설명 재작성 ${plan.filter((i) => i.descriptionChanged).length}건 · 분류 이동 ${moves.length}건`);
  console.log(`새로 만들 분류 ${toCreate.length}건: ${toCreate.join(' / ') || '없음'}`);

  console.log('\n── 제목이 바뀌는 것');
  for (const item of titleChanges) console.log(`   ${item.row.title}  →  ${item.entry.title}`);

  console.log('\n── 분류가 바뀌는 것');
  for (const item of moves) console.log(`   ${item.entry.title}: ${item.currentPath}  →  ${item.movedTo}`);

  if (!apply) {
    console.log('\n드라이런이다 — 아무것도 쓰지 않았다. 적용하려면 --apply 를 붙여라.');

    return;
  }

  // ── 되돌림 스냅샷
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = `enrich-snapshot-${stamp}.json`;
  writeFileSync(snapshotPath, JSON.stringify({ categories, bookmarks }, null, 2));
  console.log(`\n되돌림 스냅샷: ${snapshotPath}`);

  // ── 새 분류 만들기
  for (const path of toCreate) {
    const [parentName, childName] = path.split(' > ');
    if (childName === undefined) throw new Error(`상위 분류는 새로 만들지 않는다: ${path}`);

    const parentId = pathOf.idOf(parentName);
    if (parentId === null) throw new Error(`상위 분류를 찾지 못했다: ${parentName}`);

    const siblings = categories.filter((row) => row.parent_id === parentId);
    const sortOrder = siblings.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;

    const created = await supabase
      .from('categories')
      .insert({ name: childName, parent_id: parentId, sort_order: sortOrder })
      .select('id, name, parent_id, sort_order')
      .single();
    if (created.error !== null) throw created.error;

    const row = created.data as CategoryRow;
    categories.push(row);
    pathOf.remember(path, row.id);
    console.log(`   + 분류 생성: ${path}`);
  }

  // ── 링크 갱신
  let updated = 0;
  for (const item of plan) {
    const patch: Record<string, unknown> = {};
    if (item.titleChanged) patch.title = item.entry.title;
    if (item.descriptionChanged) patch.description = item.entry.description;
    if (item.movedTo !== null) {
      const id = pathOf.idOf(item.movedTo);
      if (id === null) throw new Error(`분류를 찾지 못했다: ${item.movedTo}`);
      patch.category_id = id;
    }
    if (Object.keys(patch).length === 0) continue;

    const result = await supabase.from('bookmarks').update(patch).eq('id', item.row.id).select('id');
    if (result.error !== null) throw result.error;
    updated += 1;
  }

  console.log(`\n✅ ${updated}건 갱신 완료.`);

  // ── 남은 빈 분류 알림 (지우지는 않는다 — 판단은 사람이 한다)
  const after = await supabase.from('bookmarks').select('category_id');
  if (after.error !== null) throw after.error;
  const used = new Set((after.data as { category_id: string | null }[]).map((row) => row.category_id));
  const empty = categories.filter(
    (row) => row.parent_id !== null && !used.has(row.id),
  );
  if (empty.length > 0) {
    console.log(`\nⓘ 링크가 0건이 된 하위 분류 ${empty.length}건 — 정리 도구나 관리 화면에서 지워라:`);
    for (const row of empty) console.log(`   ${pathOf.pathOfId(row.id)}`);
  }
}

/** 표 자체의 결함 — 하나라도 있으면 DB 에 붙지 않는다. */
function validateTable(): string[] {
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const entry of ENRICHMENTS) {
    if (seen.has(entry.url)) problems.push(`URL 중복: ${entry.url}`);
    seen.add(entry.url);

    if (entry.title.trim() === '') problems.push(`제목이 비었다: ${entry.url}`);
    if (entry.description.trim() === '') problems.push(`설명이 비었다: ${entry.title}`);
    if ([...entry.description].length > MAX_DESCRIPTION) {
      problems.push(
        `설명 ${[...entry.description].length}자 (한계 ${MAX_DESCRIPTION}): ${entry.title} — "${entry.description}"`,
      );
    }
  }

  return problems;
}

/**
 * `'상위'`·`'상위 > 하위'` 경로와 카테고리 id 를 서로 옮겨 준다.
 *
 * 접두사 규칙을 쓰지 않고 **' > ' 로 정확히 나눈다** — `reclassify.ts` 가 접두사 매칭 때문에
 * "더 긴 쪽이 이긴다" 규칙을 따로 둬야 했던 자리다(`GA` 가 `GAD` 의 접두사였다).
 */
function categoryPathResolver(categories: CategoryRow[]) {
  const idByPath = new Map<string, string>();
  const pathById = new Map<string, string>();

  function rebuild(): void {
    idByPath.clear();
    pathById.clear();
    const byId = new Map(categories.map((row) => [row.id, row]));
    for (const row of categories) {
      const parent = row.parent_id === null ? null : byId.get(row.parent_id);
      const path = parent === undefined || parent === null ? row.name : `${parent.name} > ${row.name}`;
      idByPath.set(path, row.id);
      pathById.set(row.id, path);
    }
  }
  rebuild();

  return {
    idOf: (path: string): string | null => idByPath.get(path) ?? null,
    pathOfId: (id: string | null): string | null => (id === null ? null : pathById.get(id) ?? null),
    remember: (path: string, id: string): void => {
      idByPath.set(path, id);
      pathById.set(id, path);
    },
  };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

export type { Enrichment };
