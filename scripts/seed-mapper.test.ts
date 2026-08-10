// @vitest-environment node
// 순수 변환 + fs fixture 만 쓰므로 DOM 이 필요 없다. node 환경이라야 import.meta.url 이
// 실제 파일 URL 로 남아(jsdom 은 페이지 URL 로 치환한다) cwd 에 기대지 않고 경로를 잡을 수 있다.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Bookmark } from '@/lib/types';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import {
  buildSeed,
  toBookmarkRow,
  type BookmarkSeed,
  type CategorySeed,
  type RawLink,
} from './seed-mapper';

/** 실제 docs/data/links.json 을 fixture 로 사용한다 (읽기 전용). */
const LINKS_PATH = fileURLToPath(new URL('../docs/data/links.json', import.meta.url));
const RAW: RawLink[] = JSON.parse(readFileSync(LINKS_PATH, 'utf8')) as RawLink[];

/**
 * docs/data/icons 에 실제로 있는 `<id>.png` 목록 = 72개.
 * 실제 스캔은 호출측(B5) 몫이라 여기서만 fs 를 만진다 — buildSeed 는 집합만 받는다.
 */
const ICONS_DIR = fileURLToPath(new URL('../docs/data/icons/', import.meta.url));
const ICON_IDS_FROM_DISK: ReadonlySet<number> = new Set(
  readdirSync(ICONS_DIR)
    .filter((file) => file.endsWith('.png'))
    .map((file) => Number(file.slice(0, -'.png'.length)))
    .filter((id) => Number.isInteger(id)),
);

const NO_ICONS: ReadonlySet<number> = new Set<number>();

const tops = (categories: CategorySeed[]) => categories.filter((c) => c.parent_id === null);
const subs = (categories: CategorySeed[]) => categories.filter((c) => c.parent_id !== null);
const byName = (categories: CategorySeed[], name: string) =>
  categories.filter((c) => c.name === name);

function makeRaw(overrides: Partial<RawLink> & Pick<RawLink, 'id' | 'group' | 'sub'>): RawLink {
  return {
    title: `t${overrides.id}`,
    url: `https://example.com/${overrides.id}`,
    host: 'example.com',
    desc: `d${overrides.id}`,
    tags: [],
    pinned: false,
    added: 1_700_000_000,
    ...overrides,
  };
}

describe('buildSeed — 카테고리 생성', () => {
  it('상위 카테고리 10개, 하위 카테고리 12개를 만든다', () => {
    const { categories } = buildSeed(RAW, NO_ICONS);
    expect(tops(categories)).toHaveLength(10);
    expect(subs(categories)).toHaveLength(12);
    expect(categories).toHaveLength(22);
  });

  it('모든 카테고리 id 는 고유한 uuid 다', () => {
    const { categories } = buildSeed(RAW, NO_ICONS);
    const ids = new Set(categories.map((c) => c.id));
    expect(ids.size).toBe(categories.length);
    for (const c of categories) {
      expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('호출할 때마다 새 uuid 를 생성한다', () => {
    const a = buildSeed(RAW, NO_ICONS);
    const b = buildSeed(RAW, NO_ICONS);
    expect(a.categories[0].id).not.toBe(b.categories[0].id);
    expect(a.bookmarks[0].id).not.toBe(b.bookmarks[0].id);
  });

  it('상위 카테고리 sort_order 는 최초 등장 순서(0부터 연속)다', () => {
    const { categories } = buildSeed(RAW, NO_ICONS);
    expect(tops(categories).map((c) => [c.name, c.sort_order])).toEqual([
      ['AI 도구 모음', 0],
      ['마케팅', 1],
      ['웹 도구', 2],
      ['강의 및 출강', 3],
      ['자사 포트폴리오', 4],
      ['UI/UX 디자인', 5],
      ['기타', 6],
      ['참고자료', 7],
      ['구글 서비스', 8],
      [OPERATING_CATEGORY_NAME, 9],
    ]);
  });

  it('비연속 등장: 참고자료는 상위 카테고리를 1개만 만들고 구글 서비스보다 앞선다', () => {
    // links.json 실측: 참고자료가 209-221 / 240-273 두 구간으로 갈라져 등장하고
    // 그 사이(222-239)에 구글 서비스가 끼어 있다. 연속 구간(run) 단위로 만들면 11개가 된다.
    const groupRuns = RAW.reduce<string[]>((runs, link) => {
      if (runs[runs.length - 1] !== link.group) runs.push(link.group);
      return runs;
    }, []);
    expect(groupRuns).toHaveLength(11);
    expect(groupRuns.filter((g) => g === '참고자료')).toHaveLength(2);

    const { categories } = buildSeed(RAW, NO_ICONS);
    const ref = byName(categories, '참고자료').filter((c) => c.parent_id === null);
    const google = byName(categories, '구글 서비스').filter((c) => c.parent_id === null);
    expect(ref).toHaveLength(1);
    expect(google).toHaveLength(1);
    expect(ref[0].sort_order).toBeLessThan(google[0].sort_order);
  });

  it('비연속 등장 최소 재현: A·B·A 는 상위 2개만 만들고 1·3번째가 같은 카테고리를 쓴다', () => {
    const input: RawLink[] = [
      makeRaw({ id: 1, group: 'A', sub: '' }),
      makeRaw({ id: 2, group: 'B', sub: '' }),
      makeRaw({ id: 3, group: 'A', sub: '' }),
    ];
    const { categories, bookmarks } = buildSeed(input, NO_ICONS);

    expect(categories.map((c) => [c.name, c.sort_order])).toEqual([['A', 0], ['B', 1]]);
    expect(bookmarks[0].category_id).toBe(bookmarks[2].category_id);
    expect(bookmarks[1].category_id).not.toBe(bookmarks[0].category_id);
  });

  it('하위 카테고리는 상위 id 를 parent_id 로 갖고 그룹 내 등장 순서를 sort_order 로 갖는다', () => {
    const { categories } = buildSeed(RAW, NO_ICONS);
    const topById = new Map(tops(categories).map((c) => [c.id, c]));

    const perParent = new Map<string, CategorySeed[]>();
    for (const sub of subs(categories)) {
      expect(sub.parent_id).not.toBeNull();
      expect(topById.has(sub.parent_id as string)).toBe(true);
      const list = perParent.get(sub.parent_id as string) ?? [];
      list.push(sub);
      perParent.set(sub.parent_id as string, list);
    }

    const named = new Map(
      [...perParent].map(([parentId, list]) => [
        topById.get(parentId)?.name,
        list.map((c) => [c.name, c.sort_order] as const),
      ]),
    );
    expect(named.get('AI 도구 모음')).toEqual([
      ['대화·검색', 0], ['이미지', 1], ['영상', 2], ['오디오', 3], ['프롬프트', 4],
      ['문서', 5], ['코딩', 6], ['디자인', 7], ['논문', 8], ['그 외', 9],
    ]);
    expect(named.get('참고자료')).toEqual([['도구·서비스', 0], ['학습·리서치', 1]]);
    expect(named.size).toBe(2);
  });

  it('빈 문자열 sub 로는 하위 카테고리를 만들지 않는다', () => {
    const { categories } = buildSeed(RAW, NO_ICONS);
    expect(subs(categories).some((c) => c.name === '')).toBe(false);
  });
});

describe('buildSeed — 북마크 생성', () => {
  it('북마크 290건, 고정 12건을 만든다', () => {
    const { bookmarks } = buildSeed(RAW, NO_ICONS);
    expect(bookmarks).toHaveLength(290);
    expect(bookmarks.filter((b) => b.is_pinned)).toHaveLength(12);
  });

  it('sub 가 비어 있지 않은 165건은 하위 카테고리, "" 인 125건은 상위 직속이다', () => {
    const { categories, bookmarks } = buildSeed(RAW, NO_ICONS);
    const catById = new Map(categories.map((c) => [c.id, c]));

    expect(RAW.filter((l) => l.sub !== '')).toHaveLength(165);
    expect(RAW.filter((l) => l.sub === '')).toHaveLength(125);

    let underSub = 0;
    let underTop = 0;
    bookmarks.forEach((bookmark, index) => {
      const link = RAW[index];
      const category = catById.get(bookmark.category_id as string);
      expect(category).toBeDefined();
      if (link.sub === '') {
        expect(category?.parent_id).toBeNull();
        expect(category?.name).toBe(link.group);
        underTop += 1;
      } else {
        expect(category?.name).toBe(link.sub);
        expect(catById.get(category?.parent_id as string)?.name).toBe(link.group);
        underSub += 1;
      }
    });
    expect(underSub).toBe(165);
    expect(underTop).toBe(125);
  });

  it('desc → description, title/url/tags/pinned 는 그대로 옮긴다', () => {
    const { bookmarks } = buildSeed(RAW, NO_ICONS);
    bookmarks.forEach((bookmark, index) => {
      const link = RAW[index];
      expect(bookmark.title).toBe(link.title);
      expect(bookmark.url).toBe(link.url);
      expect(bookmark.tags).toEqual(link.tags);
      expect(bookmark.is_pinned).toBe(link.pinned);
      expect(bookmark.description).toBe(link.desc);
    });
    expect(bookmarks.every((b) => typeof b.description === 'string' && b.description.length > 0))
      .toBe(true);
  });

  it('sort_order 는 원본 배열 인덱스다', () => {
    const { bookmarks } = buildSeed(RAW, NO_ICONS);
    expect(bookmarks.map((b) => b.sort_order)).toEqual(RAW.map((_, i) => i));
  });

  it('created_at 은 added × 1000 의 ISO 문자열이다', () => {
    const { bookmarks } = buildSeed(RAW, NO_ICONS);
    bookmarks.forEach((bookmark, index) => {
      expect(bookmark.created_at).toBe(new Date(RAW[index].added * 1000).toISOString());
      expect(Date.parse(bookmark.created_at)).toBe(RAW[index].added * 1000);
    });
    expect(bookmarks[0].created_at).toBe('2024-10-18T06:57:35.000Z');
  });

  it('북마크 id 는 고유한 uuid 이고 legacyId 는 원본 id 다', () => {
    const { bookmarks } = buildSeed(RAW, NO_ICONS);
    expect(new Set(bookmarks.map((b) => b.id)).size).toBe(290);
    expect(bookmarks.map((b) => b.legacyId)).toEqual(RAW.map((l) => l.id));
  });

  it(`${OPERATING_CATEGORY_NAME} 카테고리에 16건이 달린다`, () => {
    const { categories, bookmarks } = buildSeed(RAW, NO_ICONS);
    const operating = byName(categories, OPERATING_CATEGORY_NAME);
    expect(operating).toHaveLength(1);
    expect(operating[0].parent_id).toBeNull();
    expect(bookmarks.filter((b) => b.category_id === operating[0].id)).toHaveLength(16);
  });

  it('버리는 필드(raw/tier/dup/old/cluster/host)는 결과에 남지 않는다', () => {
    const { bookmarks } = buildSeed(RAW, NO_ICONS);
    const keys = Object.keys(bookmarks[0]).sort();
    expect(keys).toEqual([
      'category_id', 'created_at', 'description', 'fav_order', 'favicon_url', 'iconFile', 'id',
      'is_favorite', 'is_pinned', 'legacyId', 'sort_order', 'tags', 'title', 'url',
    ]);
  });
});

describe('buildSeed — 파비콘 파일 부착', () => {
  it('아이콘 집합이 비면 iconFile 은 전부 null 이다', () => {
    const { bookmarks } = buildSeed(RAW, NO_ICONS);
    expect(bookmarks.every((b) => b.iconFile === null)).toBe(true);
  });

  it('주입한 id 에만 "<id>.png" 를 붙인다', () => {
    const available = new Set([0, 5, 289]);
    const { bookmarks } = buildSeed(RAW, available);
    const withIcon = bookmarks.filter((b): b is BookmarkSeed & { iconFile: string } =>
      b.iconFile !== null);
    expect(withIcon).toHaveLength(3);
    expect(withIcon.map((b) => [b.legacyId, b.iconFile])).toEqual([
      [0, '0.png'], [5, '5.png'], [289, '289.png'],
    ]);
  });

  it('실제 docs/data/icons 파일 목록(72개)을 주입하면 72건에 붙는다', () => {
    const { bookmarks } = buildSeed(RAW, ICON_IDS_FROM_DISK);
    expect(bookmarks.filter((b) => b.iconFile !== null)).toHaveLength(72);
    for (const bookmark of bookmarks) {
      if (bookmark.iconFile !== null) {
        expect(bookmark.iconFile).toBe(`${bookmark.legacyId}.png`);
      }
    }
  });
});

describe('toBookmarkRow', () => {
  it('seed 전용 필드만 떼고 DB 컬럼은 전부 보존한다', () => {
    const { bookmarks } = buildSeed(RAW, ICON_IDS_FROM_DISK);
    const seed = bookmarks.find((b) => b.iconFile !== null) as BookmarkSeed;
    const row = toBookmarkRow(seed);

    expect(Object.keys(row).sort()).toEqual([
      'category_id', 'created_at', 'description', 'fav_order', 'favicon_url', 'id',
      'is_favorite', 'is_pinned', 'sort_order', 'tags', 'title', 'url',
    ]);
    expect('iconFile' in row).toBe(false);
    expect('legacyId' in row).toBe(false);

    // 남은 값은 seed 와 동일해야 한다.
    const expected: Bookmark = {
      id: seed.id,
      category_id: seed.category_id,
      title: seed.title,
      url: seed.url,
      description: seed.description,
      tags: seed.tags,
      favicon_url: seed.favicon_url,
      is_pinned: seed.is_pinned,
      is_favorite: seed.is_favorite,
      fav_order: seed.fav_order,
      sort_order: seed.sort_order,
      created_at: seed.created_at,
    };
    expect(row).toEqual(expected);
  });

  it('원본 seed 객체는 그대로 둔다', () => {
    const { bookmarks } = buildSeed(RAW, ICON_IDS_FROM_DISK);
    const seed = bookmarks.find((b) => b.iconFile !== null) as BookmarkSeed;
    toBookmarkRow(seed);
    expect(seed.iconFile).toBe(`${seed.legacyId}.png`);
    expect(seed.legacyId).toBeTypeOf('number');
  });
});

describe('buildSeed — 순수성', () => {
  it('빈 입력은 빈 seed 를 낸다', () => {
    expect(buildSeed([], NO_ICONS)).toEqual({ categories: [], bookmarks: [] });
  });

  it('입력 배열과 tags 를 변경하지 않는다', () => {
    const input: RawLink[] = [
      makeRaw({ id: 1, group: 'G', sub: '', tags: ['a'] }),
      makeRaw({ id: 2, group: 'G', sub: 'S', tags: ['b'] }),
    ];
    const snapshot = JSON.parse(JSON.stringify(input)) as RawLink[];
    const { bookmarks } = buildSeed(input, NO_ICONS);

    bookmarks[0].tags.push('mutated');
    expect(input).toEqual(snapshot);
    expect(input[0].tags).toEqual(['a']);
  });

  it('파일시스템에 접근하지 않고 주입된 아이콘 집합만 사용한다', () => {
    const input: RawLink[] = [makeRaw({ id: 7, group: 'G', sub: '' })];
    expect(buildSeed(input, new Set([7])).bookmarks[0].iconFile).toBe('7.png');
    expect(buildSeed(input, new Set([8])).bookmarks[0].iconFile).toBeNull();
  });

  it('같은 이름의 하위 카테고리가 다른 그룹에 있으면 각각 만든다', () => {
    const input: RawLink[] = [
      makeRaw({ id: 1, group: 'A', sub: '공통' }),
      makeRaw({ id: 2, group: 'B', sub: '공통' }),
    ];
    const { categories, bookmarks } = buildSeed(input, NO_ICONS);
    expect(subs(categories)).toHaveLength(2);
    expect(bookmarks[0].category_id).not.toBe(bookmarks[1].category_id);
  });

  it('여분 필드(raw/tier/dup/old/cluster)가 있어도 무시한다', () => {
    const input = [
      { ...makeRaw({ id: 1, group: 'G', sub: '' }), raw: 'x', tier: 'daily', dup: null, old: true, cluster: '' },
    ] as RawLink[];
    const { bookmarks } = buildSeed(input, NO_ICONS);
    expect(bookmarks[0].title).toBe('t1');
    expect('tier' in bookmarks[0]).toBe(false);
  });
});
