// @vitest-environment node
// 순수 함수와 조회부만 다루므로 DOM 이 필요 없다 — jsdom 을 띄우지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import {
  attachCounts,
  faviconCount,
  findOperatingCategoryId,
  getAllData,
  rollupCounts,
  type ClickCountRow,
} from '@/lib/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Bookmark, Category } from '@/lib/types';
// 이 파일은 DB 행 그대로(클릭 수 없는 형태)를 본다 — 화면 테스트가 쓰는 BOOKMARKS 와는 다른 배열이다.
import { BOOKMARK_ROWS as BOOKMARKS, CATEGORIES, subId, topId } from '@/test/fixtures/seed';

// getAllData 는 순수 함수가 아니라 얇은 조회부다 — Supabase 클라이언트만 갈아 끼우고
// "무엇을 물어보고 어떻게 합치는지"를 확인한다. 실제 DB 대조는 B5 시드 이후 몫.
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));

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

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
};

/**
 * `supabase.from(t).select(...).order(...)` 체인을 흉내 내는 최소 thenable.
 * `select`·`order` 는 자기 자신을 돌려주고, await 되는 순간 미리 정한 결과를 낸다.
 */
function fakeSupabase(byTable: Record<string, QueryResult>) {
  const requestedTables: string[] = [];

  const client = {
    from(table: string) {
      requestedTables.push(table);
      const result: QueryResult = byTable[table] ?? { data: [], error: null };
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (
          onFulfilled: (value: QueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };

      return builder;
    },
  };

  return { client, requestedTables };
}

function useFakeSupabase(byTable: Record<string, QueryResult>) {
  const fake = fakeSupabase(byTable);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fake.client as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
  );

  return fake;
}

describe('getAllData', () => {
  beforeEach(() => {
    vi.mocked(createServerSupabaseClient).mockReset();
  });

  it('categories·bookmarks·bookmark_click_counts 세 곳을 조회한다', async () => {
    const fake = useFakeSupabase({});

    await getAllData();

    expect(fake.requestedTables).toEqual(['categories', 'bookmarks', 'bookmark_click_counts']);
  });

  it('뷰의 클릭 수를 북마크에 결합해 SiteData 를 만든다 (뷰에 없으면 0)', async () => {
    const category = makeCategory({ id: 'c1', name: '마케팅' });
    const bookmarks = [
      makeBookmark({ id: 'b1', category_id: 'c1' }),
      makeBookmark({ id: 'b2', category_id: 'c1' }),
    ];
    useFakeSupabase({
      categories: { data: [category], error: null },
      bookmarks: { data: bookmarks, error: null },
      bookmark_click_counts: { data: [{ bookmark_id: 'b2', click_count: 9 }], error: null },
    });

    const data = await getAllData();

    expect(data.categories).toEqual([category]);
    expect(data.bookmarks.map((b) => [b.id, b.click_count])).toEqual([
      ['b1', 0],
      ['b2', 9],
    ]);
  });

  it('조회가 실패하면 테이블 이름·진단 코드를 담아 던지고 원본 에러를 cause 로 잇는다', async () => {
    // B2 게이트에서 실제로 만나는 형태: 뷰에 grant 가 빠지면 42501 이 온다.
    const error = {
      message: 'permission denied for view bookmark_click_counts',
      code: '42501',
      details: null,
      hint: 'grant select on bookmark_click_counts to anon',
    };
    useFakeSupabase({ bookmark_click_counts: { data: null, error } });

    await expect(getAllData()).rejects.toThrow(
      'Supabase bookmark_click_counts 조회 실패: permission denied for view ' +
        'bookmark_click_counts (code 42501 · hint: grant select on bookmark_click_counts to anon)',
    );
    await expect(getAllData()).rejects.toMatchObject({ cause: error });
  });
});
