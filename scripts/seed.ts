import { readFile, readdir } from 'node:fs/promises';

import type { SupabaseClient } from '@supabase/supabase-js';

import { rollupCounts } from '@/lib/queries';
import type { Bookmark, Category } from '@/lib/types';
import { collectFavicons, formatTally, reportFailures } from '@/scripts/collect-favicons';
import { createServiceRoleClient } from '@/scripts/lib/service-client';
import { buildSeed, toBookmarkRow, type BookmarkSeed, type RawLink } from '@/scripts/seed-mapper';

/**
 * B5 — 시드 실행. `npm run seed` (내부적으로 `tsx scripts/seed.ts`).
 *
 * 🚨 **파괴적이다. 운영 데이터가 쌓인 뒤에는 절대 실행하지 마라.**
 * idempotent 를 만드는 방식이 "지우고 다시 넣기"라, 시작하자마자
 * `clicks → bookmarks → categories` 순으로 **전체 삭제**한다(FK 역순).
 * 관리자 화면(3단계)에서 손으로 추가한 링크·수정한 카테고리·그동안 모인 클릭 로그가
 * 통째로 사라진다. 재실행이 안전한 것은 "links.json 이 유일한 진실"인 1단계 동안뿐이다.
 *
 * 실행: `npx tsx scripts/seed.ts` — plain node 는 `@/…` 별칭을 못 푼다
 * (scripts/lib/service-client.ts 주석 참조).
 */

/** 삽입 배치 크기 — PostgREST 요청 하나가 지나치게 커지지 않게 자른다. */
const BATCH_SIZE = 100;

/** 완료 기준(계획서 B5) — 실측으로 확인해야 하는 숫자들. */
const EXPECTED = {
  categories: 22,
  topCategories: 10,
  subCategories: 12,
  bookmarks: 290,
  pinned: 12,
  /** D1 게이트 잔여 검증: `AI 도구 모음` 상위의 rollup(직속 0 + 하위 10개 합) */
  aiToolsRollup: 118,
  /** 실패분은 null 허용 — 이 밑으로 떨어지면 실패로 본다. */
  minFavicons: 280,
} as const;

const AI_TOOLS_CATEGORY = 'AI 도구 모음';

const LINKS_FILE = new URL('../docs/data/links.json', import.meta.url);
const ICONS_DIR = new URL('../docs/data/icons/', import.meta.url);

type Check = { label: string; ok: boolean; detail: string };

async function main(): Promise<void> {
  const supabase = createServiceRoleClient();

  console.log('시드 시작 — 기존 clicks·bookmarks·categories 를 전부 지우고 다시 넣습니다.');
  console.log('');

  // ── 1. 입력 로드 ────────────────────────────────────────────────────────────
  const raw = await loadLinks();
  const iconIds = await scanIconIds();
  console.log(`links.json ${raw.length}건 · 보유 아이콘 ${iconIds.size}개`);

  // ── 2. 매핑 (한 번만!) ──────────────────────────────────────────────────────
  // ⚠️ buildSeed 는 호출마다 uuid 를 새로 만든다. 아래 파비콘 업로드와 DB 삽입은
  //    **이 한 결과**를 공유해야 한다 — 다시 부르면 스토리지 경로와 북마크 id 가 어긋난다.
  const seed = buildSeed(raw, iconIds);
  console.log(`매핑 완료 — 카테고리 ${seed.categories.length} · 북마크 ${seed.bookmarks.length}`);
  console.log('');

  // ── 3. 초기화 ──────────────────────────────────────────────────────────────
  await resetTables(supabase);
  console.log('');

  // ── 4. 카테고리 삽입 ────────────────────────────────────────────────────────
  // buildSeed 가 상위를 하위보다 먼저 담아 두므로 배열 순서 그대로 넣으면 FK 가 맞는다.
  // id 를 명시해 넣는 이유: 북마크의 category_id 가 이미 그 uuid 를 가리키고 있다.
  await insertBatched(supabase, 'categories', seed.categories, '카테고리');
  console.log('');

  // ── 5. 파비콘 수집·업로드 (B4) ──────────────────────────────────────────────
  console.log('파비콘 수집·업로드 (B4)');
  const favicons = await collectFavicons(supabase, seed.bookmarks, { purge: true });
  console.log(
    `파비콘 업로드 성공 ${favicons.urls.size}건 (${formatTally(favicons.uploaded)}) · ` +
      `실패 ${favicons.failures.length}건 · app/icon.png: ${favicons.appIcon}`,
  );
  reportFailures(favicons.failures);
  console.log('');

  // ── 6. 북마크 삽입 ─────────────────────────────────────────────────────────
  // ⚠️ toBookmarkRow 로 seed 전용 필드(iconFile·legacyId)를 벗긴다.
  //    BookmarkSeed 를 그대로 넣으면 컴파일은 통과하고 런타임에 터진다
  //    (`column "iconFile" does not exist` — scripts/seed-mapper.ts 주석).
  const bookmarkRows = seed.bookmarks.map((bookmark) => ({
    ...toBookmarkRow(bookmark),
    favicon_url: favicons.urls.get(bookmark.id) ?? null,
  }));
  await insertBatched(supabase, 'bookmarks', bookmarkRows, '북마크');
  console.log('');

  // ── 7. 실측 검증 ───────────────────────────────────────────────────────────
  const checks = await verify(supabase, raw, seed.bookmarks);
  const failed = checks.filter((check) => !check.ok);

  console.log('실측 검증');
  for (const check of checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.label} — ${check.detail}`);
  }
  console.log('');

  if (failed.length > 0) {
    console.error(`검증 ${checks.length}종 중 ${failed.length}종 실패 — 시드 결과를 신뢰할 수 없습니다.`);
    process.exit(1);
  }

  console.log(`시드 완료 — 검증 ${checks.length}종 전부 통과.`);
}

/** docs/data/links.json 을 읽는다(읽기 전용 — 이 스크립트는 docs 를 건드리지 않는다). */
async function loadLinks(): Promise<RawLink[]> {
  const text = await readFile(LINKS_FILE, 'utf8');
  const parsed: unknown = JSON.parse(text);

  if (!Array.isArray(parsed)) throw new Error('links.json 이 배열이 아닙니다.');

  return parsed as RawLink[];
}

/**
 * `docs/data/icons/<id>.png` 가 실제로 있는 원본 id 집합.
 * fs 접근을 여기서 하는 이유 — buildSeed 는 I/O 없는 순수 함수로 유지한다(B3 계약).
 */
async function scanIconIds(): Promise<Set<number>> {
  const entries = await readdir(ICONS_DIR);
  const ids = new Set<number>();

  for (const entry of entries) {
    if (!entry.endsWith('.png')) continue;
    const id = Number(entry.slice(0, -'.png'.length));
    if (Number.isInteger(id)) ids.add(id);
  }

  return ids;
}

/**
 * FK 역순으로 전부 비운다 — clicks 는 bookmarks 를, bookmarks 는 categories 를 참조한다.
 * (bookmarks 삭제만으로도 clicks 는 cascade 되지만, 순서를 명시해 의도를 남긴다.)
 *
 * PostgREST 는 조건 없는 delete 를 거부하므로 "id 가 null 이 아닌 행" = 전체로 표현한다.
 */
async function resetTables(supabase: SupabaseClient): Promise<void> {
  for (const table of ['clicks', 'bookmarks', 'categories'] as const) {
    const { count, error } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .not('id', 'is', null);

    if (error !== null) {
      throw new Error(`${table} 비우기 실패: ${error.message}`, { cause: error });
    }

    console.log(`초기화 — ${table} ${count ?? 0}행 삭제`);
  }
}

/** 배치로 나눠 넣고 진행 상황을 찍는다. 한 배치라도 실패하면 즉시 던진다. */
async function insertBatched(
  supabase: SupabaseClient,
  table: 'categories' | 'bookmarks',
  rows: readonly (Category | Bookmark)[],
  label: string,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);

    if (error !== null) {
      throw new Error(
        `${label} 삽입 실패 (${offset + 1}~${offset + batch.length}행): [${error.code ?? '-'}] ${error.message}`,
        { cause: error },
      );
    }

    console.log(`${label} 삽입 ${Math.min(offset + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
}

/**
 * DB 를 다시 읽어 완료 기준을 실측한다. 방금 넣은 메모리 상의 값이 아니라 **서버가 돌려준 값**만 본다.
 *
 * D1(데이터 로딩 계층)의 게이트 잔여분도 여기서 닫는다 — `rollupCounts` 는 lib/queries.ts 의
 * 순수 함수라 스크립트에서 그대로 부를 수 있다(같은 파일의 `getAllData` 는 next/headers 를
 * 끌어오므로 import 하면 안 된다 — named import 로 순수 함수만 가져온다).
 */
async function verify(
  supabase: SupabaseClient,
  raw: readonly RawLink[],
  seeded: readonly BookmarkSeed[],
): Promise<Check[]> {
  const categories = await selectAll<Category>(supabase, 'categories', 'id, name, parent_id, sort_order');
  const bookmarks = await selectAll<Bookmark>(
    supabase,
    'bookmarks',
    'id, category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, created_at',
  );

  const tops = categories.filter((category) => category.parent_id === null);
  const subs = categories.filter((category) => category.parent_id !== null);
  const pinned = bookmarks.filter((bookmark) => bookmark.is_pinned);
  const withFavicon = bookmarks.filter((bookmark) => bookmark.favicon_url !== null);

  const checks: Check[] = [
    {
      label: 'categories 22 (상위 10 + 하위 12)',
      ok:
        categories.length === EXPECTED.categories &&
        tops.length === EXPECTED.topCategories &&
        subs.length === EXPECTED.subCategories,
      detail: `총 ${categories.length} = 상위 ${tops.length} + 하위 ${subs.length}`,
    },
    {
      label: 'bookmarks 290',
      ok: bookmarks.length === EXPECTED.bookmarks,
      detail: `${bookmarks.length}행`,
    },
    {
      label: 'is_pinned 12',
      ok: pinned.length === EXPECTED.pinned,
      detail: `${pinned.length}건`,
    },
    {
      label: `favicon_url not null ≥ ${EXPECTED.minFavicons}`,
      ok: withFavicon.length >= EXPECTED.minFavicons,
      detail: `${withFavicon.length}/${bookmarks.length}건 (null ${bookmarks.length - withFavicon.length})`,
    },
    await checkClickCountsView(supabase),
    checkOrderAndTimestamps(raw, bookmarks),
    checkSeedIdsMatch(seeded, bookmarks),
    ...checkRollup(categories, bookmarks),
  ];

  return checks;
}

/** `bookmark_click_counts` 뷰에 service 클라이언트로 접근된다(클릭 0이라 0행이 정상). */
async function checkClickCountsView(supabase: SupabaseClient): Promise<Check> {
  const { data, error } = await supabase.from('bookmark_click_counts').select('bookmark_id, click_count');

  return {
    label: 'bookmark_click_counts 접근',
    ok: error === null,
    detail: error === null ? `조회 성공 — ${data.length}행(클릭 없음이 정상)` : `[${error.code ?? '-'}] ${error.message}`,
  };
}

/**
 * sort_order 로 정렬한 결과가 links.json 의 원래 순서와 같은지, created_at 이
 * `added × 1000` 인지 본다 — "sort_order 보존 · created_at 명시"를 실제로 확인하는 검사다.
 */
function checkOrderAndTimestamps(raw: readonly RawLink[], bookmarks: readonly Bookmark[]): Check {
  const ordered = [...bookmarks].sort((left, right) => left.sort_order - right.sort_order);
  const mismatches: string[] = [];

  for (const [index, link] of raw.entries()) {
    const row = ordered[index];
    if (row === undefined) {
      mismatches.push(`#${index} 행 없음`);
      continue;
    }
    if (row.sort_order !== index) mismatches.push(`#${index} sort_order=${row.sort_order}`);
    if (row.url !== link.url) mismatches.push(`#${index} url ${row.url} ≠ ${link.url}`);
    if (Date.parse(row.created_at) !== link.added * 1000) {
      mismatches.push(`#${index} created_at ${row.created_at} ≠ added ${link.added}`);
    }
  }

  return {
    label: 'sort_order 보존 · created_at = added×1000',
    ok: mismatches.length === 0,
    detail:
      mismatches.length === 0
        ? `${raw.length}건 전부 links.json 순서·시각과 일치`
        : `불일치 ${mismatches.length}건: ${mismatches.slice(0, 3).join(' / ')}`,
  };
}

/**
 * DB 의 북마크 id 가 buildSeed 결과와 정확히 같은 집합인지 본다.
 * 어긋나면 파비콘 경로(`<uuid>.png`)가 통째로 빗나갔다는 뜻이다 — 조용히 넘어가면 안 되는 사고다.
 */
function checkSeedIdsMatch(seeded: readonly BookmarkSeed[], bookmarks: readonly Bookmark[]): Check {
  const seededIds = new Set(seeded.map((bookmark) => bookmark.id));
  const missing = bookmarks.filter((bookmark) => !seededIds.has(bookmark.id));

  return {
    label: 'DB 북마크 id = buildSeed 결과 (파비콘 경로 정합)',
    ok: missing.length === 0 && seededIds.size === bookmarks.length,
    detail:
      missing.length === 0 && seededIds.size === bookmarks.length
        ? `${bookmarks.length}건 전부 일치`
        : `시드에 없는 id ${missing.length}건 / 시드 ${seededIds.size} vs DB ${bookmarks.length}`,
  };
}

/** D1 게이트 잔여 — 실데이터로 rollupCounts 를 돌려 사이드바 숫자가 계획서 실측치와 맞는지 본다. */
function checkRollup(categories: readonly Category[], bookmarks: readonly Bookmark[]): Check[] {
  const counts = rollupCounts(categories, bookmarks);
  const aiTools = categories.find(
    (category) => category.parent_id === null && category.name === AI_TOOLS_CATEGORY,
  );
  const aiCount = aiTools === undefined ? -1 : counts[aiTools.id];
  const topTotal = categories
    .filter((category) => category.parent_id === null)
    .reduce((sum, category) => sum + counts[category.id], 0);

  return [
    {
      label: `D1: rollupCounts '${AI_TOOLS_CATEGORY}' = ${EXPECTED.aiToolsRollup}`,
      ok: aiCount === EXPECTED.aiToolsRollup,
      detail: aiTools === undefined ? '상위 카테고리를 찾지 못함' : `${aiCount} (직속+하위 합)`,
    },
    {
      label: `D1: 상위 카테고리 합 = 전체 ${EXPECTED.bookmarks}`,
      ok: topTotal === EXPECTED.bookmarks && bookmarks.length === EXPECTED.bookmarks,
      detail: `상위 합 ${topTotal} · 북마크 ${bookmarks.length}`,
    },
    {
      label: `D1: rollupCounts 키 = 카테고리 ${EXPECTED.categories}`,
      ok: Object.keys(counts).length === EXPECTED.categories,
      detail: `${Object.keys(counts).length}개`,
    },
  ];
}

/** 검증용 조회. 290행 규모라 페이지네이션 없이 통째로 받는다(PostgREST 기본 상한 1000). */
async function selectAll<T>(supabase: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select(columns);

  if (error !== null) {
    throw new Error(`${table} 검증 조회 실패: [${error.code ?? '-'}] ${error.message}`, { cause: error });
  }

  return data as T[];
}

main().catch((error: unknown) => {
  console.error(`시드를 끝내지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.cause !== undefined) console.error(error.cause);
  process.exit(1);
});
