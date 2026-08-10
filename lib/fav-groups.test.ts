/**
 * 홈의 즐겨찾기를 세 묶음으로 가르는 규칙 (2026-08-10 사용자 요청).
 *
 * 이 파일이 잠그는 계약은 하나다: **묶음을 정하는 것은 링크가 속한 상위 분류다.** 사용자가
 * 담을 때 고르는 것이 아니므로, 분류가 바뀌면 묶음도 따라 바뀐다.
 */
import { describe, expect, it } from 'vitest';

import { AI_TOOLS_CATEGORY_NAME, NEWS_CATEGORY_NAME } from '@/lib/constants';
import { FAV_GROUPS, favGroupOf, groupFavorites, topCategoryNames } from '@/lib/fav-groups';
import type { Bookmark, Category } from '@/lib/types';

const CATEGORIES: Category[] = [
  { id: 'ai', name: AI_TOOLS_CATEGORY_NAME, parent_id: null, sort_order: 0 },
  { id: 'ai-chat', name: '대화·챗봇', parent_id: 'ai', sort_order: 0 },
  { id: 'news', name: NEWS_CATEGORY_NAME, parent_id: null, sort_order: 1 },
  { id: 'news-ai', name: 'AI 뉴스', parent_id: 'news', sort_order: 0 },
  { id: 'work', name: '업무 워크스페이스', parent_id: null, sort_order: 2 },
];

const link = (id: string, categoryId: string | null): Pick<Bookmark, 'category_id'> & { id: string } => ({
  id,
  category_id: categoryId,
});

describe('FAV_GROUPS', () => {
  it('세 묶음이고, 배열 차례가 곧 홈에 놓이는 차례다', () => {
    expect([...FAV_GROUPS]).toEqual(['AI 소식', 'AI 서비스', '업무용 서비스']);
  });
});

describe('topCategoryNames', () => {
  it('하위 id 를 넣어도 상위 이름이 나온다', () => {
    const names = topCategoryNames(CATEGORIES);

    expect(names.get('ai-chat')).toBe(AI_TOOLS_CATEGORY_NAME);
    expect(names.get('news-ai')).toBe(NEWS_CATEGORY_NAME);
  });

  it('상위 id 는 자기 이름을 그대로 돌려준다', () => {
    expect(topCategoryNames(CATEGORIES).get('work')).toBe('업무 워크스페이스');
  });

  it('부모가 목록에 없으면 자기 이름으로 떨어진다 — 조용히 undefined 가 되지 않는다', () => {
    const orphan: Category = { id: 'x', name: '떠도는 하위', parent_id: '없는-부모', sort_order: 0 };

    expect(topCategoryNames([orphan]).get('x')).toBe('떠도는 하위');
  });
});

describe('favGroupOf', () => {
  const names = topCategoryNames(CATEGORIES);

  it("'뉴스·인사이트' 아래는 하위까지 'AI 소식'이다", () => {
    expect(favGroupOf(link('a', 'news'), names)).toBe('AI 소식');
    expect(favGroupOf(link('b', 'news-ai'), names)).toBe('AI 소식');
  });

  it("'AI 도구 모음' 아래는 하위까지 'AI 서비스'다", () => {
    expect(favGroupOf(link('a', 'ai'), names)).toBe('AI 서비스');
    expect(favGroupOf(link('b', 'ai-chat'), names)).toBe('AI 서비스');
  });

  it('그 밖의 상위는 전부 업무용 서비스다', () => {
    expect(favGroupOf(link('a', 'work'), names)).toBe('업무용 서비스');
  });

  it('분류가 없거나 없는 분류를 가리켜도 던지지 않고 업무용 서비스로 떨어진다', () => {
    expect(favGroupOf(link('a', null), names)).toBe('업무용 서비스');
    expect(favGroupOf(link('b', '지워진-분류'), names)).toBe('업무용 서비스');
  });
});

describe('groupFavorites', () => {
  it('세 묶음으로 가르고, 담긴 차례를 묶음 안에서 유지한다', () => {
    const items = [
      link('n1', 'news-ai'),
      link('w1', 'work'),
      link('a1', 'ai-chat'),
      link('n2', 'news'),
      link('a2', 'ai'),
    ];

    const grouped = groupFavorites(items, CATEGORIES);

    expect(grouped['AI 소식'].map((item) => item.id)).toEqual(['n1', 'n2']);
    expect(grouped['AI 서비스'].map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(grouped['업무용 서비스'].map((item) => item.id)).toEqual(['w1']);
  });

  it('비어 있는 묶음도 키로 남는다 — 부르는 쪽이 `?? []` 를 몰라도 된다', () => {
    const grouped = groupFavorites([link('a', 'ai')], CATEGORIES);

    expect(Object.keys(grouped).sort()).toEqual([...FAV_GROUPS].sort());
    expect(grouped['AI 소식']).toEqual([]);
    expect(grouped['업무용 서비스']).toEqual([]);
  });

  it('빈 목록에도 세 키를 그대로 돌려준다', () => {
    const grouped = groupFavorites([], CATEGORIES);

    for (const group of FAV_GROUPS) expect(grouped[group]).toEqual([]);
  });

  it('분류 이름이 바뀌면 그 분류의 링크는 업무용 서비스로 밀린다 (이름 결합의 대가)', () => {
    // `OPERATING_CATEGORY_NAME` 과 같은 성질이다 — 개명하면 상수도 함께 고쳐야 한다.
    const renamed = CATEGORIES.map((category) =>
      category.id === 'ai' ? { ...category, name: 'AI 도구' } : category,
    );

    expect(groupFavorites([link('a', 'ai')], renamed)['업무용 서비스'].map((i) => i.id)).toEqual(['a']);
    expect(groupFavorites([link('a', 'ai')], renamed)['AI 서비스']).toEqual([]);
  });
});
