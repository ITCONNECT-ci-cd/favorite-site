export type Category = {
  id: string; name: string; parent_id: string | null; sort_order: number;
};
export type Bookmark = {
  id: string; category_id: string | null; title: string; url: string;
  description: string | null; tags: string[]; favicon_url: string | null;
  is_pinned: boolean; source: 'manual' | 'discord'; sort_order: number; created_at: string;
};
export type BookmarkWithCount = Bookmark & { click_count: number };

/** 모든 공개 화면이 서버에서 받는 데이터 묶음 */
export type SiteData = {
  categories: Category[];              // sort_order 순
  bookmarks: BookmarkWithCount[];      // sort_order 순
};
