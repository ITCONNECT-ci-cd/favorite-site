import type { Metadata } from 'next';
import { FavoritesView } from '@/components/FavoritesView';
import { getAllData } from '@/lib/queries';

/**
 * 탭 제목 — 화면 이름만 댄다. 꼬리표(`— 내 링크`)는 셸의 title template 이 붙인다.
 * 담긴 개수는 브라우저에만 있어(localStorage) 서버가 모르므로 제목에 넣지 않는다.
 */
export const metadata: Metadata = {
  title: '내 즐겨찾기',
};

/**
 * 내 즐겨찾기 목록 화면 — `/favorites` (DESIGN_SPEC 4장).
 *
 * 담긴 목록은 브라우저에만 있으므로(localStorage) 서버는 **전체 북마크를 넘기기만** 하고,
 * 거르는 일은 FavoritesView(클라이언트)가 한다. 카테고리 화면과 달리 하위 탭이 없다.
 *
 * `export const revalidate` 를 넣지 마라 — 매 요청 렌더가 의도다(근거는 lib/queries.ts).
 */
export default async function FavoritesPage() {
  const { bookmarks } = await getAllData();

  return <FavoritesView bookmarks={bookmarks} />;
}
