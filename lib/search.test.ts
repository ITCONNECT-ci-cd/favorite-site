// @vitest-environment node
// 순수 함수 하나만 본다 — DOM 이 필요 없으므로 jsdom 을 띄우지 않는다.
/** G1. ⌘K 검색 팔레트(2단계)가 쓰는 키워드 필터. */
import { describe, expect, it } from 'vitest';

import { SEARCH_RESULT_LIMIT, searchLinks } from '@/lib/search';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { BOOKMARKS, CATEGORIES } from '@/test/fixtures/seed';

/** 실시드 — 프로토타입이 `data/links.json` 을 그대로 훑던 것과 같은 290건. */
const REAL: SiteData = { categories: CATEGORIES, bookmarks: BOOKMARKS };

function makeCategory(over: Partial<Category> & Pick<Category, 'id'>): Category {
  return { name: over.id, parent_id: null, sort_order: 0, ...over };
}

/**
 * 기본값은 검색에 걸리지 않는 중립값이다 — 제목은 id, 주소는 `example.com`.
 * 질의어를 넣고 싶은 필드만 덮어써서 "그 필드 때문에 걸렸다"를 분명히 한다.
 */
function makeBookmark(
  over: Partial<BookmarkWithCount> & Pick<BookmarkWithCount, 'id'>,
): BookmarkWithCount {
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
    click_count: 0,
    ...over,
  };
}

function site(bookmarks: BookmarkWithCount[], categories: Category[] = []): SiteData {
  return { categories, bookmarks };
}

/** 결과에서 북마크 id 만 뽑는다 — 순서까지 그대로 본다. */
function ids(matches: ReturnType<typeof searchLinks>): string[] {
  return matches.map((m) => m.bookmark.id);
}

describe('빈 질의 — 프로토타입 845행 `if (!s) return []`', () => {
  it('빈 문자열이면 빈 배열이다 (전체가 아니다)', () => {
    expect(searchLinks('', site([makeBookmark({ id: 'a' })]))).toEqual([]);
  });

  it('공백만 있어도 빈 배열이다', () => {
    // 프로토타입은 trim() 후 판단한다.
    expect(searchLinks('   ', site([makeBookmark({ id: 'a' })]))).toEqual([]);
    expect(searchLinks('\t\n ', site([makeBookmark({ id: 'a' })]))).toEqual([]);
  });

  it('링크가 하나도 없어도 터지지 않는다', () => {
    expect(searchLinks('아무거나', site([]))).toEqual([]);
  });
});

describe('필드별 매칭 — PRD P4 "이름·설명·태그·분류·주소 전부 대상"', () => {
  it('이름(title)으로 찾는다', () => {
    const data = site([makeBookmark({ id: 'a', title: '노션' }), makeBookmark({ id: 'b' })]);

    expect(searchLinks('노션', data)).toEqual([
      { bookmark: data.bookmarks[0], matchedIn: 'title' },
    ]);
  });

  it('설명(description)으로 찾는다', () => {
    const data = site([makeBookmark({ id: 'a', description: '팀 문서를 모아 두는 곳' })]);

    expect(searchLinks('문서', data)).toEqual([{ bookmark: data.bookmarks[0], matchedIn: 'desc' }]);
  });

  it('주소(host)로 찾는다', () => {
    const data = site([makeBookmark({ id: 'a', url: 'https://www.notion.so/team' })]);

    expect(searchLinks('notion', data)).toEqual([{ bookmark: data.bookmarks[0], matchedIn: 'url' }]);
  });

  it('주소는 host 만 본다 — 스킴·경로·쿼리는 대상이 아니다', () => {
    // 프로토타입 846행이 훑는 것은 전체 URL 이 아니라 `b.host` 다.
    // 전체 URL 을 넣으면 'https'·'com' 같은 질의가 사실상 전건을 끌고 온다.
    const data = site([makeBookmark({ id: 'a', url: 'https://claude.ai/login?returnTo=%2F%3F' })]);

    expect(searchLinks('claude.ai', data)).toHaveLength(1);
    expect(searchLinks('https', data)).toEqual([]);
    expect(searchLinks('returnTo', data)).toEqual([]);
  });

  it('태그로 찾는다', () => {
    const data = site([makeBookmark({ id: 'a', tags: ['Video Editor', '무료'] })]);

    expect(searchLinks('무료', data)).toEqual([{ bookmark: data.bookmarks[0], matchedIn: 'tag' }]);
  });

  it('상위 카테고리 이름으로 찾는다', () => {
    const categories = [makeCategory({ id: 'top', name: 'AI 도구 모음' })];
    const data = site([makeBookmark({ id: 'a', category_id: 'top' })], categories);

    expect(searchLinks('도구', data)).toEqual([
      { bookmark: data.bookmarks[0], matchedIn: 'category' },
    ]);
  });

  it('하위 카테고리에 속하면 하위 이름으로도, 상위 이름으로도 찾는다', () => {
    // 프로토타입 846행의 건초더미에는 `b.group` 과 `b.sub` 이 둘 다 들어 있다.
    const categories = [
      makeCategory({ id: 'top', name: 'AI 도구 모음' }),
      makeCategory({ id: 'sub', name: '대화·검색', parent_id: 'top' }),
    ];
    const data = site([makeBookmark({ id: 'a', category_id: 'sub' })], categories);

    expect(ids(searchLinks('대화·검색', data))).toEqual(['a']);
    expect(ids(searchLinks('AI 도구 모음', data))).toEqual(['a']);
    expect(searchLinks('AI 도구 모음', data)[0].matchedIn).toBe('category');
  });
});

describe('대소문자 무시', () => {
  it('질의가 대문자여도 찾는다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'chatgpt' })]);

    expect(ids(searchLinks('ChatGPT', data))).toEqual(['a']);
  });

  it('데이터가 대문자여도 찾는다 — 이름·설명·태그·분류·주소 모두', () => {
    const categories = [makeCategory({ id: 'top', name: 'DESIGN' })];
    const data = site(
      [
        makeBookmark({ id: 'title', title: 'FIGMA' }),
        makeBookmark({ id: 'desc', description: 'UI DESIGN 도구' }),
        makeBookmark({ id: 'url', url: 'https://FIGMA.com/' }),
        makeBookmark({ id: 'cat', category_id: 'top' }),
        makeBookmark({ id: 'tag', tags: ['DESIGN'] }),
      ],
      categories,
    );

    expect(ids(searchLinks('figma', data))).toEqual(['title', 'url']);
    expect(ids(searchLinks('design', data))).toEqual(['desc', 'cat', 'tag']);
  });

  it('설명도 대소문자를 무시한다 — 프로토타입 997행의 취급 차이를 고친 지점', () => {
    // 프로토타입은 매칭 위치를 고를 때 설명만 `b.desc.includes(q)`(원문 그대로)로 봐서
    // 소문자 'ai' 질의가 설명 'AI …' 를 못 알아보고 '주소'/'분류' 배지로 새는 자리가 있었다.
    const data = site([makeBookmark({ id: 'a', title: 'ChatGPT', description: 'AI 대화' })]);

    expect(searchLinks('ai', data)).toEqual([{ bookmark: data.bookmarks[0], matchedIn: 'desc' }]);
  });
});

describe('여러 토큰은 AND — 모든 토큰이 어딘가에 걸려야 한다', () => {
  it('토큰이 서로 다른 필드에 흩어져 있어도 전부 걸리면 매칭이다', () => {
    const categories = [makeCategory({ id: 'top', name: '디자인' })];
    const data = site(
      [makeBookmark({ id: 'a', title: 'Figma', description: '화면 시안', category_id: 'top' })],
      categories,
    );

    expect(ids(searchLinks('figma 디자인', data))).toEqual(['a']);
  });

  it('토큰 하나라도 없으면 결과에서 빠진다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', description: '화면 시안' })]);

    expect(searchLinks('figma 노션', data)).toEqual([]);
  });

  it('앞뒤 공백과 연속 공백을 정규화한다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', description: '화면 시안' })]);

    expect(ids(searchLinks('  figma   시안  ', data))).toEqual(['a']);
  });

  it('프로토타입이 리터럴 부분열로 잡던 질의도 그대로 잡는다', () => {
    // 프로토타입은 질의 전체를 한 덩어리로 `includes` 했다(846행). 토큰 AND 는 그 상위집합이라
    // — 부분열이 걸리면 토큰도 전부 걸린다 — 프로토타입이 찾던 것을 잃지 않는다.
    const data = site([makeBookmark({ id: 'a', description: 'AI 대화·문서 초안' })]);

    expect(ids(searchLinks('AI 대화', data))).toEqual(['a']);
  });
});

describe('matchedIn 우선순위 — 이름 → 설명 → 주소 → 분류 → 태그', () => {
  const categories = [makeCategory({ id: 'top', name: 'zeta 분류' })];

  it('이름이 걸리면 다른 필드가 다 걸려도 이름이다', () => {
    const data = site(
      [
        makeBookmark({
          id: 'a',
          title: 'zeta 이름',
          description: 'zeta 설명',
          url: 'https://zeta.example.com/',
          category_id: 'top',
          tags: ['zeta'],
        }),
      ],
      categories,
    );

    expect(searchLinks('zeta', data)[0].matchedIn).toBe('title');
  });

  it('이름이 안 걸리면 설명이다', () => {
    const data = site(
      [
        makeBookmark({
          id: 'a',
          title: '이름',
          description: 'zeta 설명',
          url: 'https://zeta.example.com/',
          category_id: 'top',
          tags: ['zeta'],
        }),
      ],
      categories,
    );

    expect(searchLinks('zeta', data)[0].matchedIn).toBe('desc');
  });

  it('이름·설명이 안 걸리면 주소다', () => {
    const data = site(
      [
        makeBookmark({
          id: 'a',
          title: '이름',
          description: '설명',
          url: 'https://zeta.example.com/',
          category_id: 'top',
          tags: ['zeta'],
        }),
      ],
      categories,
    );

    expect(searchLinks('zeta', data)[0].matchedIn).toBe('url');
  });

  it('이름·설명·주소가 안 걸리면 분류다', () => {
    const data = site(
      [
        makeBookmark({
          id: 'a',
          title: '이름',
          description: '설명',
          category_id: 'top',
          tags: ['zeta'],
        }),
      ],
      categories,
    );

    expect(searchLinks('zeta', data)[0].matchedIn).toBe('category');
  });

  it('남은 곳이 태그뿐이면 태그다', () => {
    // 프로토타입에는 태그 배지가 없어 '분류'로 뭉뚱그려졌다(997행의 마지막 else).
    // DESIGN_SPEC 5장이 적은 배지 넷(이름·설명·주소·분류)을 먼저 두고, 태그는 그 뒤에 붙인다.
    const data = site([makeBookmark({ id: 'a', title: '이름', tags: ['zeta'] })]);

    expect(searchLinks('zeta', data)[0].matchedIn).toBe('tag');
  });

  it('토큰이 여럿이면 우선순위가 가장 높은 필드를 적는다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', description: '화면 시안' })]);

    expect(searchLinks('시안 figma', data)[0].matchedIn).toBe('title');
  });
});

describe('결과 순서와 상한', () => {
  it('입력 순서(sort_order)를 그대로 지킨다 — 관련도로 다시 정렬하지 않는다', () => {
    const data = site([
      makeBookmark({ id: 'a', description: '문서 편집' }),
      makeBookmark({ id: 'b', title: '문서함' }),
      makeBookmark({ id: 'c', tags: ['문서'] }),
    ]);

    expect(ids(searchLinks('문서', data))).toEqual(['a', 'b', 'c']);
  });

  it('50건에서 자른다 — 프로토타입 846행 `.slice(0, 50)`', () => {
    const data = site(
      Array.from({ length: 60 }, (_, i) => makeBookmark({ id: `b${i}`, title: `문서 ${i}` })),
    );

    expect(SEARCH_RESULT_LIMIT).toBe(50);
    expect(searchLinks('문서', data)).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(ids(searchLinks('문서', data))[49]).toBe('b49');
  });
});

describe('0건과 결측값', () => {
  it('아무 데도 없는 말이면 빈 배열이다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', description: '화면 시안' })]);

    expect(searchLinks('존재하지않는말', data)).toEqual([]);
  });

  it('설명이 null 이어도 다른 필드로 찾는다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', description: null })]);

    expect(ids(searchLinks('figma', data))).toEqual(['a']);
  });

  it('분류가 없는(category_id null) 링크도 다룬다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', category_id: null })]);

    expect(ids(searchLinks('figma', data))).toEqual(['a']);
  });

  it('categories 에 없는 category_id 를 만나도 터지지 않는다', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', category_id: '사라진분류' })]);

    expect(ids(searchLinks('figma', data))).toEqual(['a']);
    expect(searchLinks('사라진분류', data)).toEqual([]);
  });

  it('입력을 건드리지 않는다 — 순수 함수', () => {
    const data = site([makeBookmark({ id: 'a', title: 'Figma', tags: ['디자인'] })]);
    const snapshot = JSON.stringify(data);

    searchLinks('figma 디자인', data);

    expect(JSON.stringify(data)).toBe(snapshot);
  });
});

describe('실시드 — 프로토타입 스크린샷(docs/screenshots/01-palette.png) 재현', () => {
  it('"문서" 는 9건이고 앞머리 순서가 스크린샷과 같다', () => {
    const found = searchLinks('문서', REAL);

    expect(found).toHaveLength(9);
    expect(found.slice(0, 5).map((m) => m.bookmark.title)).toEqual([
      'ChatGPT',
      'Claude',
      '릴리스',
      'Skywork',
      'Descript',
    ]);
  });

  it('"문서" 결과의 매칭 위치는 스크린샷대로 설명이다 — 분류로 걸린 한 건만 예외', () => {
    const found = searchLinks('문서', REAL);
    const byTitle = Object.fromEntries(found.map((m) => [m.bookmark.title, m.matchedIn]));

    expect(byTitle['ChatGPT']).toBe('desc'); // 'AI 대화·문서 초안'
    expect(byTitle['Descript']).toBe('desc'); // '문서 편집하듯 영상 편집'
    // Beautiful.ai 는 설명('템플릿형 슬라이드')이 아니라 하위 분류 'AI 도구 모음 > 문서' 로 걸린다.
    expect(byTitle['Beautiful.ai']).toBe('category');
    expect(found.filter((m) => m.matchedIn === 'desc')).toHaveLength(8);
  });

  it('하위 분류 이름으로 그 분류의 링크를 전부 끌어온다 — 대화·검색 26건 (PRD 3장 표)', () => {
    expect(searchLinks('대화·검색', REAL)).toHaveLength(26);
  });

  it('실데이터에서도 태그로 찾는다 — "Video Editor" 두 토큰 AND', () => {
    const found = searchLinks('video editor', REAL);
    const byTitle = Object.fromEntries(found.map((m) => [m.bookmark.title, m.matchedIn]));

    expect(found.map((m) => m.bookmark.title)).toEqual([
      'Online Video Editor',
      'Kaiber',
      'Veed',
      'CapCut',
      'Mosaic Video Editor',
    ]);
    expect(byTitle['Online Video Editor']).toBe('title');
    expect(byTitle['Kaiber']).toBe('tag'); // tags: ['Video Editor']
  });

  it('많이 걸리는 질의는 50건에서 끊긴다 — "ai"', () => {
    expect(searchLinks('ai', REAL)).toHaveLength(SEARCH_RESULT_LIMIT);
  });

  it('실데이터에 없는 말은 0건이다', () => {
    expect(searchLinks('노션', REAL)).toEqual([]);
  });
});
