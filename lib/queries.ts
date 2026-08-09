import { faviconSrc } from '@/lib/favicon';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Bookmark, BookmarkWithCount, Category, SiteData } from '@/lib/types';

/** `bookmark_click_counts` 뷰의 한 행. 클릭이 한 번도 없는 북마크는 아예 행이 없다. */
export type ClickCountRow = {
  bookmark_id: string;
  click_count: number;
};

/** categories 에서 읽는 컬럼 — `Category` 와 1:1 로 맞춘다. */
const CATEGORY_COLUMNS = 'id, name, parent_id, sort_order';

/**
 * bookmarks 에서 읽는 컬럼 — `Bookmark` 와 1:1 로 맞춘다.
 * `updated_at` 은 화면이 쓰지 않으므로 일부러 뺐다.
 */
const BOOKMARK_COLUMNS =
  'id, category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, created_at';

/**
 * 공개 화면이 쓰는 데이터를 한 번에 읽는다 — 전체 290행 규모라 페이지네이션 없이 통째로 받는다.
 *
 * **이 페이지들은 의도적으로 매 요청 렌더된다(dynamic).** anon 클라이언트가 `cookies()` 를
 * 읽으므로 Next 는 라우트를 dynamic 으로 잡는다. ISR(`revalidate`) 로 60초 캐싱하는 선택지도
 * 있었지만, 3단계 J1 이 공개 화면 서버 컴포넌트에서 관리자 세션을 확인해 편집 버튼을
 * 조건부로 렌더해야 하고(클라이언트 플래그로 감추는 방식은 금지) 그 순간 어차피 모든 공개
 * 페이지가 쿠키를 읽어 dynamic 이 된다. 지금 캐싱을 켜 봐야 3단계에 걷어낼 일시적 최적화다.
 * 사내 트래픽·290행 규모에서 요청당 조회 비용은 무시할 수 있고, 클릭 수가 항상 최신인 이득이 있다.
 * 그러니 이 함수를 쓰는 페이지에 `export const revalidate = ...` 를 넣지 마라.
 *
 * 정렬은 DB 에 맡긴다(`sort_order`). 하위 카테고리의 `sort_order` 는 부모 안에서만 유일하지만,
 * 화면이 필요로 하는 것도 '같은 부모 안에서의 순서' 뿐이라 이 정렬로 충분하다.
 */
export async function getAllData(): Promise<SiteData> {
  const supabase = await createServerSupabaseClient();

  const [categoriesResult, bookmarksResult, countsResult] = await Promise.all([
    supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order'),
    supabase.from('bookmarks').select(BOOKMARK_COLUMNS).order('sort_order'),
    supabase.from('bookmark_click_counts').select('bookmark_id, click_count'),
  ]);

  const categories = unwrap<Category>('categories', categoriesResult);
  const bookmarks = unwrap<Bookmark>('bookmarks', bookmarksResult);
  const counts = unwrap<ClickCountRow>('bookmark_click_counts', countsResult);

  return { categories, bookmarks: attachCounts(bookmarks, counts) };
}

/**
 * Supabase 응답에서 행 배열만 꺼낸다. 실패는 삼키지 않고 던진다 —
 * 빈 화면으로 조용히 넘어가면 "링크가 없다"와 "DB 가 죽었다"를 구분할 수 없다.
 *
 * 생성된 Database 타입이 아직 없어 supabase-js 가 행 타입을 알 수 없으므로 여기서 한 번만 못박는다.
 * `select()` 컬럼 목록과 타입이 어긋나면 런타임에 드러나므로 위 상수와 `lib/types.ts` 를 같이 고쳐라.
 */
function unwrap<T>(
  table: string,
  result: { data: unknown; error: { message: string } | null },
): T[] {
  if (result.error !== null) {
    throw new Error(`Supabase ${table} 조회 실패: ${result.error.message}`);
  }

  return (result.data ?? []) as T[];
}

/**
 * 카테고리 id → 링크 수. **상위 값은 직속 + 모든 하위의 합**이다(사이드바 숫자가 이 값이다).
 *
 * 실측: `AI 도구 모음` 은 직속 0 + 하위 10개 합 118, `마케팅` 처럼 하위가 없는 상위는 직속 21.
 *
 * - 모든 카테고리가 키로 남는다(링크가 없으면 0) — 호출부가 `?? 0` 을 몰라도 된다.
 * - `category_id` 가 null 이거나 없는 카테고리를 가리키는 북마크는 세지 않는다
 *   (화면에 그릴 자리가 없는 링크라 어느 숫자에도 넣을 수 없다).
 * - 부모를 따라 위로 올라가며 더한다. 깊이 제한이 없고, 만에 하나 부모 관계가 순환해도
 *   이미 지난 카테고리는 건너뛰어 멈춘다.
 */
export function rollupCounts(
  categories: readonly Category[],
  bookmarks: readonly Pick<Bookmark, 'category_id'>[],
): Record<string, number> {
  const parentOf = new Map<string, string | null>(
    categories.map((category) => [category.id, category.parent_id]),
  );

  const counts: Record<string, number> = {};
  for (const category of categories) counts[category.id] = 0;

  for (const bookmark of bookmarks) {
    const seen = new Set<string>();
    let current = bookmark.category_id;

    while (current !== null && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      counts[current] += 1;
      current = parentOf.get(current) ?? null;
    }
  }

  return counts;
}

/**
 * 북마크에 뷰의 클릭 수를 붙인다. 순서와 나머지 필드는 그대로 두고 새 객체를 만든다.
 *
 * 뷰에 행이 없는 북마크(= 아직 아무도 안 누른 링크)는 0 이다.
 * 반대로 뷰에만 있고 북마크 목록에 없는 행은 무시한다.
 */
export function attachCounts(
  bookmarks: readonly Bookmark[],
  countRows: readonly ClickCountRow[],
): BookmarkWithCount[] {
  const countOf = new Map(countRows.map((row) => [row.bookmark_id, row.click_count]));

  return bookmarks.map((bookmark) => ({
    ...bookmark,
    click_count: countOf.get(bookmark.id) ?? 0,
  }));
}

/**
 * 파비콘을 가진 링크 수 — 헤더의 "290개 · 파비콘 262개 내장" 중 뒤쪽 숫자.
 *
 * 판정은 카드가 실제로 이미지를 그리는 기준(`faviconSrc`)을 그대로 쓴다.
 * 빈 문자열을 세면 헤더 숫자와 화면에 보이는 타일 수가 어긋난다.
 */
export function faviconCount(bookmarks: readonly Pick<Bookmark, 'favicon_url'>[]): number {
  return bookmarks.filter((bookmark) => faviconSrc(bookmark) !== null).length;
}

/**
 * `현재 운영 중인 사이트` 상위 카테고리의 id — 홈 3번째 섹션과 사이드바 빠른 접근이 쓴다.
 *
 * 이름으로 찾는다(id 를 코드에 박을 수 없다 — 시드마다 uuid 가 새로 생성된다).
 * 상위(`parent_id === null`)만 본다: 상위끼리는 DB 의 unique 제약으로 이름이 유일하지만,
 * 다른 그룹의 하위로 같은 이름이 생길 수는 있어서다. 없으면 null — 호출부는 이 섹션을 접는다.
 */
export function findOperatingCategoryId(categories: readonly Category[]): string | null {
  const found = categories.find(
    (category) => category.parent_id === null && category.name === OPERATING_CATEGORY_NAME,
  );

  return found?.id ?? null;
}
