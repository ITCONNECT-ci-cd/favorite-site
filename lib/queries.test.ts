// @vitest-environment node
// 순수 함수 + fs fixture 만 쓰므로 DOM 이 필요 없다. node 환경이라야 import.meta.url 이
// 실제 파일 URL 로 남아(jsdom 은 페이지 URL 로 치환한다) cwd 에 기대지 않고 경로를 잡을 수 있다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import {
  attachCounts,
  faviconCount,
  findOperatingCategoryId,
  rollupCounts,
  type ClickCountRow,
} from '@/lib/queries';
import type { Bookmark, Category } from '@/lib/types';
import { buildSeed, toBookmarkRow, type RawLink } from '@/scripts/seed-mapper';

/**
 * fixture 는 실제 `docs/data/links.json` 을 B3 의 `buildSeed` 로 돌려 만든다.
 * 손으로 적은 숫자가 아니라 시드가 DB 에 넣을 바로 그 형태라, 롤업 기대값(118 등)이
 * 시드와 어긋나면 여기서 먼저 깨진다.
 */
const LINKS_PATH = fileURLToPath(new URL('../docs/data/links.json', import.meta.url));
const RAW: RawLink[] = JSON.parse(readFileSync(LINKS_PATH, 'utf8')) as RawLink[];
const NO_ICONS: ReadonlySet<number> = new Set<number>();

const SEED = buildSeed(RAW, NO_ICONS);
const CATEGORIES: Category[] = SEED.categories;
const BOOKMARKS: Bookmark[] = SEED.bookmarks.map(toBookmarkRow);

/** 상위(부모 없음) 카테고리 id — 이름은 상위끼리 유일하다(DB 의 unique nulls not distinct). */
function topId(name: string): string {
  const found = CATEGORIES.find((c) => c.parent_id === null && c.name === name);
  if (found === undefined) throw new Error(`상위 카테고리 없음: ${name}`);
  return found.id;
}

/** 하위 카테고리 id — 같은 이름이 다른 그룹에도 있을 수 있어 부모까지 지정한다. */
function subId(parentName: string, name: string): string {
  const parent = topId(parentName);
  const found = CATEGORIES.find((c) => c.parent_id === parent && c.name === name);
  if (found === undefined) throw new Error(`하위 카테고리 없음: ${parentName} > ${name}`);
  return found.id;
}

function makeCategory(over: Partial<Category> & Pick<Category, 'id'>): Category {
  return { name: over.id, parent_id: null, sort_order: 0, ...over };
}

function makeBookmark(over: Partial<Bookmark> & Pick<Bookmark, 'id'>): Bookmark {
  return {
    category_id: null,
    title: over.id,
    url: `https://example.com/${over.id}`,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('fixture — 시드 실측치가 그대로 들어왔는지 먼저 확인한다', () => {
  it('카테고리 22개(상위 10·하위 12), 북마크 290건이다', () => {
    expect(CATEGORIES).toHaveLength(22);
    expect(CATEGORIES.filter((c) => c.parent_id === null)).toHaveLength(10);
    expect(CATEGORIES.filter((c) => c.parent_id !== null)).toHaveLength(12);
    expect(BOOKMARKS).toHaveLength(290);
  });
});

describe('rollupCounts — 실측 데이터', () => {
  it('하위가 있는 상위는 하위 합이다 — AI 도구 모음 118 = 하위 10개 합', () => {
    const counts = rollupCounts(CATEGORIES, BOOKMARKS);
    const subsOfAi = CATEGORIES.filter((c) => c.parent_id === topId('AI 도구 모음'));

    expect(subsOfAi).toHaveLength(10);
    expect(counts[topId('AI 도구 모음')]).toBe(118);
    expect(subsOfAi.reduce((sum, c) => sum + counts[c.id], 0)).toBe(118);
  });

  it('참고자료 47 = 도구·서비스 30 + 학습·리서치 17', () => {
    const counts = rollupCounts(CATEGORIES, BOOKMARKS);

    expect(counts[subId('참고자료', '도구·서비스')]).toBe(30);
    expect(counts[subId('참고자료', '학습·리서치')]).toBe(17);
    expect(counts[topId('참고자료')]).toBe(47);
  });

  it('하위가 없는 상위는 직속 링크 수 그대로다', () => {
    const counts = rollupCounts(CATEGORIES, BOOKMARKS);

    expect(counts[topId('마케팅')]).toBe(21);
    expect(counts[topId('웹 도구')]).toBe(22);
    expect(counts[topId('강의 및 출강')]).toBe(7);
    expect(counts[topId('자사 포트폴리오')]).toBe(21);
    expect(counts[topId('UI/UX 디자인')]).toBe(13);
    expect(counts[topId('기타')]).toBe(7);
    expect(counts[topId('구글 서비스')]).toBe(18);
    expect(counts[topId(OPERATING_CATEGORY_NAME)]).toBe(16);
  });

  it('하위 카테고리 값은 자기 직속 수다 — 대화·검색 26', () => {
    const counts = rollupCounts(CATEGORIES, BOOKMARKS);
    expect(counts[subId('AI 도구 모음', '대화·검색')]).toBe(26);
  });

  it('모든 카테고리가 키로 존재하고, 상위들의 합이 전체 290이다', () => {
    const counts = rollupCounts(CATEGORIES, BOOKMARKS);

    expect(Object.keys(counts).sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
    const topSum = CATEGORIES.filter((c) => c.parent_id === null).reduce(
      (sum, c) => sum + counts[c.id],
      0,
    );
    expect(topSum).toBe(290);
  });
});

describe('rollupCounts — 규칙', () => {
  it('상위 값 = 직속 + 하위 합 (둘이 섞인 경우)', () => {
    const categories = [
      makeCategory({ id: 'top' }),
      makeCategory({ id: 'sub', parent_id: 'top' }),
    ];
    const bookmarks = [
      makeBookmark({ id: 'a', category_id: 'top' }),
      makeBookmark({ id: 'b', category_id: 'top' }),
      makeBookmark({ id: 'c', category_id: 'sub' }),
      makeBookmark({ id: 'd', category_id: 'sub' }),
      makeBookmark({ id: 'e', category_id: 'sub' }),
    ];

    expect(rollupCounts(categories, bookmarks)).toEqual({ top: 5, sub: 3 });
  });

  it('링크가 없는 카테고리도 0으로 키를 남긴다', () => {
    expect(rollupCounts([makeCategory({ id: 'empty' })], [])).toEqual({ empty: 0 });
  });

  it('category_id 가 null 인 북마크는 어디에도 세지 않는다', () => {
    const categories = [makeCategory({ id: 'top' })];
    const bookmarks = [
      makeBookmark({ id: 'a', category_id: 'top' }),
      makeBookmark({ id: 'orphan', category_id: null }),
    ];

    expect(rollupCounts(categories, bookmarks)).toEqual({ top: 1 });
  });

  it('없는 카테고리를 가리키는 북마크는 무시하고 키도 만들지 않는다', () => {
    const categories = [makeCategory({ id: 'top' })];
    const bookmarks = [makeBookmark({ id: 'a', category_id: 'ghost' })];

    expect(rollupCounts(categories, bookmarks)).toEqual({ top: 0 });
  });

  it('3단계로 중첩돼도 최상위까지 올려 합산한다', () => {
    const categories = [
      makeCategory({ id: 'a' }),
      makeCategory({ id: 'b', parent_id: 'a' }),
      makeCategory({ id: 'c', parent_id: 'b' }),
    ];
    const bookmarks = [makeBookmark({ id: 'x', category_id: 'c' })];

    expect(rollupCounts(categories, bookmarks)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('부모 관계에 순환이 있어도 멈추고 한 번씩만 센다', () => {
    // DB 스키마상 생길 수 없지만, 여기서 무한 루프가 나면 페이지 전체가 멈춘다.
    const categories = [
      makeCategory({ id: 'a', parent_id: 'b' }),
      makeCategory({ id: 'b', parent_id: 'a' }),
    ];
    const bookmarks = [makeBookmark({ id: 'x', category_id: 'a' })];

    expect(rollupCounts(categories, bookmarks)).toEqual({ a: 1, b: 1 });
  });

  it('빈 입력은 빈 객체다', () => {
    expect(rollupCounts([], [])).toEqual({});
  });

  it('입력을 변경하지 않는다', () => {
    const categories = [
      makeCategory({ id: 'top' }),
      makeCategory({ id: 'sub', parent_id: 'top' }),
    ];
    const bookmarks = [makeBookmark({ id: 'a', category_id: 'sub' })];
    const snapshot = JSON.stringify({ categories, bookmarks });

    rollupCounts(categories, bookmarks);
    expect(JSON.stringify({ categories, bookmarks })).toBe(snapshot);
  });
});

describe('attachCounts', () => {
  it('뷰 행의 click_count 를 붙인다', () => {
    const bookmarks = [makeBookmark({ id: 'a' }), makeBookmark({ id: 'b' })];
    const rows: ClickCountRow[] = [
      { bookmark_id: 'b', click_count: 7 },
      { bookmark_id: 'a', click_count: 3 },
    ];

    expect(attachCounts(bookmarks, rows).map((b) => [b.id, b.click_count])).toEqual([
      ['a', 3],
      ['b', 7],
    ]);
  });

  it('뷰에 없는 북마크는 click_count 0 이다 (클릭이 한 번도 없으면 뷰에 행이 없다)', () => {
    const bookmarks = [makeBookmark({ id: 'a' }), makeBookmark({ id: 'b' })];
    const result = attachCounts(bookmarks, [{ bookmark_id: 'a', click_count: 5 }]);

    expect(result[0].click_count).toBe(5);
    expect(result[1].click_count).toBe(0);
  });

  it('뷰가 비면 290건 전부 0 이다', () => {
    const result = attachCounts(BOOKMARKS, []);

    expect(result).toHaveLength(290);
    expect(result.every((b) => b.click_count === 0)).toBe(true);
  });

  it('북마크 순서와 나머지 필드를 그대로 보존한다', () => {
    const result = attachCounts(BOOKMARKS, [
      { bookmark_id: BOOKMARKS[2].id, click_count: 11 },
    ]);

    expect(result.map((b) => b.id)).toEqual(BOOKMARKS.map((b) => b.id));
    expect(result[2]).toEqual({ ...BOOKMARKS[2], click_count: 11 });
  });

  it('북마크에 없는 bookmark_id 행은 무시한다', () => {
    const bookmarks = [makeBookmark({ id: 'a' })];
    const result = attachCounts(bookmarks, [
      { bookmark_id: 'ghost', click_count: 99 },
      { bookmark_id: 'a', click_count: 1 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].click_count).toBe(1);
  });

  it('입력 북마크 객체를 변경하지 않는다', () => {
    const bookmarks = [makeBookmark({ id: 'a' })];
    attachCounts(bookmarks, [{ bookmark_id: 'a', click_count: 4 }]);

    expect('click_count' in bookmarks[0]).toBe(false);
  });
});

describe('faviconCount', () => {
  it('favicon_url 을 가진 링크 수를 센다', () => {
    const bookmarks = [
      makeBookmark({ id: 'a', favicon_url: 'https://cdn/a.png' }),
      makeBookmark({ id: 'b', favicon_url: null }),
      makeBookmark({ id: 'c', favicon_url: 'https://cdn/c.png' }),
    ];

    expect(faviconCount(bookmarks)).toBe(2);
  });

  it('빈 문자열·공백만 있는 값은 세지 않는다 (카드가 그리지 않는 값과 기준을 맞춘다)', () => {
    const bookmarks = [
      makeBookmark({ id: 'a', favicon_url: '' }),
      makeBookmark({ id: 'b', favicon_url: '   ' }),
      makeBookmark({ id: 'c', favicon_url: 'https://cdn/c.png' }),
    ];

    expect(faviconCount(bookmarks)).toBe(1);
  });

  it('시드 직후(B4 업로드 전)에는 290건 모두 null 이라 0 이다', () => {
    expect(faviconCount(BOOKMARKS)).toBe(0);
  });

  it('빈 배열은 0 이다', () => {
    expect(faviconCount([])).toBe(0);
  });
});

describe('findOperatingCategoryId', () => {
  it(`상위 카테고리 중 이름이 "${OPERATING_CATEGORY_NAME}" 인 것의 id 를 준다`, () => {
    expect(findOperatingCategoryId(CATEGORIES)).toBe(topId(OPERATING_CATEGORY_NAME));
  });

  it('그런 카테고리가 없으면 null 이다', () => {
    expect(findOperatingCategoryId([makeCategory({ id: 'x', name: '마케팅' })])).toBeNull();
    expect(findOperatingCategoryId([])).toBeNull();
  });

  it('이름이 같아도 하위 카테고리면 고르지 않는다', () => {
    const categories = [
      makeCategory({ id: 'top', name: '기타' }),
      makeCategory({ id: 'sub', name: OPERATING_CATEGORY_NAME, parent_id: 'top' }),
    ];

    expect(findOperatingCategoryId(categories)).toBeNull();
  });

  it('상위·하위에 같은 이름이 있으면 상위를 고른다', () => {
    const categories = [
      makeCategory({ id: 'sub', name: OPERATING_CATEGORY_NAME, parent_id: 'top' }),
      makeCategory({ id: 'top', name: OPERATING_CATEGORY_NAME }),
    ];

    expect(findOperatingCategoryId(categories)).toBe('top');
  });
});
