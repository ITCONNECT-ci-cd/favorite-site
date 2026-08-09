/**
 * 실시드 fixture — 화면·조회 테스트가 함께 쓰는 단 하나의 원본.
 *
 * 손으로 적은 배열이 아니라 실제 `docs/data/links.json` 을 B3 의 `buildSeed` 로 돌린 결과다.
 * 시드가 DB 에 넣을 바로 그 형태이므로, 화면에 적히는 실측치(AI 118 · 매일 12 · 운영 중 16 …)가
 * 시드와 어긋나면 이 fixture 를 쓰는 테스트에서 먼저 깨진다.
 *
 * 다섯 파일(D1 조회 · D2 홈 · D3 카테고리 · D4 매일/즐겨찾기)에 같은 프렐류드가 복제돼 있던 것을
 * D5 에서 여기로 모았다. **읽기는 fs 가 아니라 import 로 한다** — `import.meta.url` 은 jsdom 에서
 * 파일 URL 이 아니고(jsdom 이 페이지 URL 로 바꾼다) `process.cwd()` 는 실행 위치에 기댄다.
 * 번들러가 해석하는 import 만이 두 환경에서 똑같이 동작한다.
 *
 * 파비콘은 넣지 않는다(빈 집합) — 파비콘 유무는 이 fixture 를 쓰는 어느 테스트의 관심사도 아니고,
 * 넣으려면 실제 수집 결과(scripts/collect-favicons)가 있어야 해서 테스트가 그 산출물에 묶인다.
 */
import type { Bookmark, BookmarkWithCount, Category } from '@/lib/types';
import { buildSeed, toBookmarkRow, type RawLink } from '@/scripts/seed-mapper';
import RAW_LINKS from '@/docs/data/links.json';

const SEED = buildSeed(RAW_LINKS as RawLink[], new Set<number>());

/** 상위 10 · 하위 12, sort_order 순 (getAllData 가 주는 순서와 같다). */
export const CATEGORIES: Category[] = SEED.categories;

/** DB 행 그대로 — 클릭 수는 별도 테이블 집계라 여기 없다. `lib/queries` 테스트가 쓴다. */
export const BOOKMARK_ROWS: Bookmark[] = SEED.bookmarks.map(toBookmarkRow);

/**
 * 화면용 — 카드(C2)가 `click_count` 를 요구하므로 인덱스로 채운다.
 * 값 자체에 뜻은 없다. 자리마다 다른 수가 필요한 테스트가 있어 0 대신 인덱스를 쓴다.
 */
export const BOOKMARKS: BookmarkWithCount[] = BOOKMARK_ROWS.map((bookmark, index) => ({
  ...bookmark,
  click_count: index,
}));

/** 상위(부모 없음) 카테고리 id — 이름은 상위끼리 유일하다(DB 의 unique nulls not distinct). */
export function topId(name: string): string {
  const found = CATEGORIES.find((c) => c.parent_id === null && c.name === name);
  if (found === undefined) throw new Error(`상위 카테고리 없음: ${name}`);

  return found.id;
}

/** 하위 카테고리 id — 같은 이름이 다른 그룹에도 있을 수 있어 부모까지 지정한다. */
export function subId(parentName: string, name: string): string {
  const parent = topId(parentName);
  const found = CATEGORIES.find((c) => c.parent_id === parent && c.name === name);
  if (found === undefined) throw new Error(`하위 카테고리 없음: ${parentName} > ${name}`);

  return found.id;
}
