'use client';

import { ListView } from '@/components/ListView';
import { useFavorites } from '@/lib/favorites';
import type { BookmarkWithCount } from '@/lib/types';

export type FavoritesViewProps = {
  /** 서버(app/favorites/page.tsx)가 getAllData 로 읽어 넘긴 **전체** 북마크 — sort_order 순. */
  bookmarks: BookmarkWithCount[];
};

/** 제목·설명은 프로토타입의 `listTitle`·`listDesc`, 빈 문구는 DESIGN_SPEC 4장 그대로다. */
const TITLE = '내 즐겨찾기';
const DESCRIPTION = '카드의 핀을 눌러 담은 링크입니다 · 이 브라우저에만 저장됩니다';
const EMPTY_MESSAGE = '아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.';

/**
 * `/favorites` 의 얇은 클라이언트 래퍼 — 목록을 정하는 일만 하고 그리는 일은 ListView 에 맡긴다.
 *
 * **왜 서버 page 가 직접 못 그리는가**: favs 는 브라우저 localStorage 에만 있어 서버가 알 수 없다.
 * 그래서 서버는 전체 북마크를 넘기고, 담긴 것만 골라내는 일은 여기(클라이언트)서 한다.
 * 서버 렌더와 하이드레이션 첫 렌더에서는 favs 가 비어 있어 빈 상태로 그려지고,
 * 하이드레이션이 끝나면 저장된 값으로 채워진다(E1 `useFavorites` 의 SSR 규약).
 *
 * `useFavorites` 는 **뷰마다 한 번**이라는 규칙을 지킨다 — 카드마다 부르지 않는다. 이 화면에서는
 * ListView 도 자기 몫으로 한 번 부르는데(카드에 내려줄 켜짐 상태), 여기서 고른 카드는 전부 favs 에
 * 있으므로 결과는 '핀이 모두 켜짐'으로 맞아떨어진다. 같은 스냅샷을 읽는 호출이라 값이 어긋날 일도
 * 없다(E1 은 원본 문자열이 그대로면 같은 Set 객체를 돌려준다).
 *
 * 코로케이트 테스트가 없는 것은 의도다 — `app/favorites/page.test.tsx` 가 이 컴포넌트를 통과해
 * 검증하므로 같은 계약을 두 번 적지 마라.
 */
export function FavoritesView({ bookmarks }: FavoritesViewProps) {
  const { favs } = useFavorites();

  // 담은 순서(favs)를 그대로 지킨다 — sort_order 로 다시 세우지 않는다(홈의 즐겨찾기 섹션과 같은
  // 규칙이라 두 화면의 순서가 어긋나지 않는다). 지워진 링크의 id 가 localStorage 에 남아 있을 수
  // 있으므로 데이터에 있는 것만 남긴다.
  const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const items = [...favs]
    .map((id) => byId.get(id))
    .filter((bookmark): bookmark is BookmarkWithCount => bookmark !== undefined);

  return (
    <ListView
      title={TITLE}
      description={DESCRIPTION}
      bookmarks={items}
      emptyMessage={EMPTY_MESSAGE}
    />
  );
}
