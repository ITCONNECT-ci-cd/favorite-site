export type Category = {
  id: string; name: string; parent_id: string | null; sort_order: number;
};
export type Bookmark = {
  id: string; category_id: string | null; title: string; url: string;
  description: string | null; tags: string[]; favicon_url: string | null;
  is_pinned: boolean; source: 'manual' | 'discord'; sort_order: number; created_at: string;
  /** 홈·`/favorites` 에 담긴 링크인가 (2026-08-11 — 관리자가 담는 공용 한 벌). */
  is_favorite: boolean;
  /** 즐겨찾기 안에서의 차례. `sort_order`(분류 안에서의 차례)와 **다른 축**이다. */
  fav_order: number;
};
export type BookmarkWithCount = Bookmark & { click_count: number };

/** 모든 공개 화면이 서버에서 받는 데이터 묶음 */
export type SiteData = {
  categories: Category[];              // sort_order 순
  bookmarks: BookmarkWithCount[];      // sort_order 순
};
