import type { Metadata } from 'next';
import { ListView } from '@/components/ListView';
import { FAVORITES_TITLE } from '@/lib/constants';
import { pickFavorites } from '@/lib/favorites';
import { getAllData } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';

/**
 * 탭 제목 — 화면 이름만 댄다. 꼬리표(`— 내 링크`)는 셸의 title template 이 붙인다.
 */
export const metadata: Metadata = {
  title: FAVORITES_TITLE,
};

const DESCRIPTION = '홈에 담아 둔 링크입니다';

/**
 * 빈 문구가 둘인 이유: 핀은 관리자에게만 보이므로(LinkCard) 방문자에게 "핀을 눌러보세요"는
 * 할 수 없는 일을 시키는 말이 된다.
 */
const EMPTY_ADMIN = '아직 담긴 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.';
const EMPTY_VISITOR = '아직 담긴 즐겨찾기가 없습니다.';

/**
 * 내 즐겨찾기 목록 화면 — `/favorites` (DESIGN_SPEC 4장).
 *
 * 담긴 목록을 **서버가 안다**(2026-08-11 서버 이전). 예전에는 브라우저에만 있어 클라이언트
 * 래퍼(`FavoritesView`)가 전체 북마크를 받아 골라냈지만, 이제 여기서 고르고 `ListView` 에
 * 그대로 넘긴다 — 그 래퍼는 하는 일이 없어져 지웠다.
 *
 * 연필·휴지통의 노출 여부는 서버에서만 정한다 (J1) — 홈과 같은 배선이라 근거는
 * `app/(public)/page.tsx` 의 JSDoc 에 한 번만 적어 뒀다.
 *
 * `export const revalidate` 를 넣지 마라 — 매 요청 렌더가 의도다(근거는 lib/queries.ts).
 */
export default async function FavoritesPage() {
  const [{ bookmarks }, session] = await Promise.all([getAllData(), getAdminSession()]);
  const isAdmin = session !== null;

  return (
    <ListView
      title={FAVORITES_TITLE}
      description={DESCRIPTION}
      bookmarks={pickFavorites(bookmarks)}
      emptyMessage={isAdmin ? EMPTY_ADMIN : EMPTY_VISITOR}
      isAdmin={isAdmin}
      /* 이 목록의 차례는 `fav_order` 축이다 — `sort_order` 로 보내면 엉뚱한 분류들의 순서가
         흔들린다(ListView 의 reorderStore JSDoc). */
      reorderStore="favorites"
    />
  );
}
