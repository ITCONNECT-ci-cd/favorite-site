/** 즐겨찾기 순수 헬퍼 — 저장소는 DB 다(2026-08-11 서버 이전). */
import { describe, expect, it } from 'vitest';
import { favToastText, pickFavorites } from '@/lib/favorites';
import type { BookmarkWithCount } from '@/lib/types';

/**
 * pickFavorites 검증용 최소 북마크 — 이 함수는 `is_favorite`·`fav_order`·`id` 말고는 보지 않는다.
 */
function makeBookmark(id: string, is_favorite: boolean, fav_order: number): BookmarkWithCount {
  return {
    id,
    category_id: null,
    title: `제목 ${id}`,
    url: `https://example.com/${id}`,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    is_favorite,
    fav_order,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    click_count: 0,
  };
}

describe('pickFavorites', () => {
  it('담긴 것만 남긴다', () => {
    const items = pickFavorites([
      makeBookmark('a', true, 0),
      makeBookmark('b', false, 0),
      makeBookmark('c', true, 1),
    ]);

    expect(items.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('fav_order 순으로 세운다 — 배열이 온 차례(sort_order)가 아니다', () => {
    const items = pickFavorites([
      makeBookmark('a', true, 5),
      makeBookmark('b', true, 1),
      makeBookmark('c', true, 3),
    ]);

    expect(items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('fav_order 가 같으면 id 로 가른다 — 순서가 요청마다 흔들리지 않게', () => {
    const items = pickFavorites([makeBookmark('b', true, 0), makeBookmark('a', true, 0)]);

    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('담긴 것이 없거나 링크가 하나도 없으면 빈 배열이다', () => {
    expect(pickFavorites([makeBookmark('a', false, 0)])).toEqual([]);
    expect(pickFavorites([])).toEqual([]);
  });

  it('원본 배열을 건드리지 않는다 — 정렬이 새어 나가지 않는다', () => {
    const input = [makeBookmark('a', true, 2), makeBookmark('b', true, 1)];
    const before = input.map((item) => item.id);

    pickFavorites(input);

    expect(input.map((item) => item.id)).toEqual(before);
  });

  it('같은 북마크 객체를 그대로 돌려준다 (복사하지 않는다)', () => {
    const first = makeBookmark('a', true, 0);

    expect(pickFavorites([first])[0]).toBe(first);
  });
});

describe('favToastText', () => {
  // 프로토타입 `toggleFav` 원문(docs/prototype/링크 대시보드 v2.dc.html 701행):
  //   this.say(on ? (b.title + ' · 홈 즐겨찾기에 담김') : (b.title + ' 즐겨찾기 해제'));
  it('담으면 "<제목> · 홈 즐겨찾기에 담김" 이다', () => {
    expect(favToastText('노션', true)).toBe('노션 · 홈 즐겨찾기에 담김');
  });

  it('빼면 "<제목> 즐겨찾기 해제" 다', () => {
    expect(favToastText('노션', false)).toBe('노션 즐겨찾기 해제');
  });
});
