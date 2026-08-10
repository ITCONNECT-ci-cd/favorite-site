import { AI_TOOLS_CATEGORY_NAME, NEWS_CATEGORY_NAME } from '@/lib/constants';
import type { Bookmark, Category } from '@/lib/types';

/**
 * 홈의 즐겨찾기가 나뉘는 세 묶음 (2026-08-10 사용자 요청).
 *
 * **차례가 곧 홈에 놓이는 차례다.** 배열이라 순서를 바꾸면 화면도 함께 바뀐다.
 */
export const FAV_GROUPS = ['AI 소식', 'AI 서비스', '업무용 서비스'] as const;

export type FavGroup = (typeof FAV_GROUPS)[number];

/**
 * 링크 하나가 어느 묶음인가 — **그 링크가 속한 상위 분류가 정한다.**
 *
 * 사용자가 담을 때 고르는 것이 아니라(그러면 핀 한 번이 두 번이 된다) 이미 붙어 있는 분류에서
 * 끌어낸다. 그래서 이미 담아 둔 즐겨찾기도 이 기능이 켜지는 순간 저절로 나뉜다.
 *
 * 규칙은 둘뿐이고 나머지는 전부 '업무용 서비스'로 떨어진다:
 * - `뉴스·인사이트` → **AI 소식** (읽는 것)
 * - `AI 도구 모음` → **AI 서비스** (AI 로 무언가를 만드는 것)
 * - 그 밖의 상위 · 분류 없음 → **업무용 서비스**
 *
 * '그 밖'을 잔여 분류로 두는 것이 분류 규칙(잔여 금지)과 어긋나 보이지만, 여기서 만드는 것은
 * **분류가 아니라 홈의 묶음**이다. 사용자가 고른 이름 셋이 이미 "AI 읽을거리 / AI 도구 / 나머지
 * 업무"라는 축을 뜻하므로 잔여가 아니라 셋 중 하나다.
 *
 * ⚠️ 판정을 **상위 분류의 이름**으로 한다(`lib/constants.ts` 의 두 상수). 분류를 개명하면 그
 * 분류의 즐겨찾기가 조용히 '업무용 서비스'로 밀린다 — `OPERATING_CATEGORY_NAME` 과 같은 성질의
 * 결합이고, 같은 이유로 상수와 분류 이름을 함께 고쳐야 한다.
 */
export function favGroupOf(
  bookmark: Pick<Bookmark, 'category_id'>,
  topNameById: ReadonlyMap<string, string>,
): FavGroup {
  const top = bookmark.category_id === null ? undefined : topNameById.get(bookmark.category_id);

  if (top === NEWS_CATEGORY_NAME) return 'AI 소식';
  if (top === AI_TOOLS_CATEGORY_NAME) return 'AI 서비스';

  return '업무용 서비스';
}

/**
 * 카테고리 id → **그 카테고리가 매달린 상위의 이름**. 하위 id 를 넣어도 상위 이름이 나온다.
 *
 * 부모를 한 단만 따라 올라간다 — 이 제품의 분류는 2단이 전부다(상위 · 하위). 만에 하나 더 깊은
 * 트리가 생기면 그 손자는 부모(=하위)의 이름을 얻어 어느 상수와도 맞지 않고 '업무용 서비스'로
 * 떨어진다. 조용히 틀리는 대신 **안전한 쪽으로** 떨어지는 것이 의도다.
 */
export function topCategoryNames(categories: readonly Category[]): Map<string, string> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const names = new Map<string, string>();

  for (const category of categories) {
    const parent = category.parent_id === null ? undefined : byId.get(category.parent_id);
    names.set(category.id, parent === undefined ? category.name : parent.name);
  }

  return names;
}

/**
 * 즐겨찾기 목록을 세 묶음으로 가른다. **담긴 차례는 묶음 안에서 그대로 유지된다** —
 * 즐겨찾기의 순서는 localStorage 가 들고 있고(`pickFavorites`) 여기서 다시 세우지 않는다.
 *
 * 비어 있는 묶음도 키로 남는다 — 부르는 쪽이 `?? []` 를 몰라도 되게 하기 위해서다
 * (`rollupCounts` 와 같은 방침). 빈 묶음을 그릴지 말지는 화면이 정한다.
 */
export function groupFavorites<T extends Pick<Bookmark, 'category_id'>>(
  items: readonly T[],
  categories: readonly Category[],
): Record<FavGroup, T[]> {
  const topNameById = topCategoryNames(categories);
  const grouped = Object.fromEntries(FAV_GROUPS.map((group) => [group, [] as T[]])) as Record<
    FavGroup,
    T[]
  >;

  for (const item of items) grouped[favGroupOf(item, topNameById)].push(item);

  return grouped;
}
