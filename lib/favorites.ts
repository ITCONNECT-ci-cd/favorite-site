/**
 * 즐겨찾기 순수 헬퍼. **저장소는 DB 다** — 2026-08-11 에 브라우저 localStorage 에서 옮겼다
 * (설계: docs/superpowers/specs/2026-08-11-server-favorites-design.md).
 *
 * 담긴 목록은 `bookmarks.is_favorite`·`fav_order` 에 있고 서버가 화면까지 실어 나른다.
 * 그래서 이 파일에는 **상태도 훅도 없다** — 고르는 규칙과 문구뿐이고, `'use client'` 도 없다.
 *
 * 예전에는 여기에 `useFavorites`(useSyncExternalStore + localStorage 스토어)가 있었고, 그것을
 * 떠받치느라 서버 스냅샷·다른 탭 동기화·저장 실패 폴백·죽은 id 청소가 딸려 있었다. 서버가 담긴
 * 목록을 알게 되면서 전부 존재 이유를 잃었다.
 */
import type { BookmarkWithCount } from '@/lib/types';

/**
 * 담긴 링크만 **담긴 차례대로** 골라낸다. 홈의 즐겨찾기 섹션과 `/favorites` 가 공유하는 규칙이라
 * 한곳에 둔다 — 두 화면이 같은 목록을 같은 순서로 보여야 한다.
 *
 * 차례는 `fav_order` 가 정한다(2026-08-11 서버 이전). `sort_order` 로 세우지 않는 이유는 그것이
 * **분류 안에서의** 차례라 즐겨찾기의 차례와 다른 축이기 때문이다.
 *
 * 동점이면 `id` 로 가른다 — 타이브레이커가 없으면 같은 값끼리의 순서가 요청마다 달라져 진단이
 * 어려워진다(`lib/queries.ts` 의 정렬이 `id` 를 붙이는 것과 같은 이유).
 *
 * ⓘ 예전에는 지워진 링크의 id 가 브라우저에 남아 결과 길이가 사이드바 숫자와 어긋났다. 이제
 *   담긴 표시가 링크 행에 실려 있어 행이 지워지면 함께 사라지므로 그 어긋남이 없다.
 *
 * 순수 함수다 — 인자를 건드리지 않고(`filter` 가 새 배열을 만든 뒤 정렬한다) 북마크 객체도
 * 복사하지 않는다.
 */
export function pickFavorites(bookmarks: readonly BookmarkWithCount[]): BookmarkWithCount[] {
  return bookmarks
    .filter((bookmark) => bookmark.is_favorite)
    .sort((left, right) =>
      left.fav_order !== right.fav_order
        ? left.fav_order - right.fav_order
        : left.id.localeCompare(right.id),
    );
}

/**
 * 핀을 눌렀을 때 띄울 토스트 문구. 프로토타입 `toggleFav` 의 원문을 그대로 옮겼다
 * (docs/prototype/링크 대시보드 v2.dc.html 701행):
 *
 * ```js
 * this.say(on ? (b.title + ' · 홈 즐겨찾기에 담김') : (b.title + ' 즐겨찾기 해제'));
 * ```
 *
 * `faved` 는 **토글이 끝난 뒤**의 상태다(담겼으면 true). 배선하는 화면이 둘(HomeView·ListView)이라
 * 문구가 갈라지지 않게 여기서 한 번만 적는다.
 */
export function favToastText(title: string, faved: boolean): string {
  return faved ? `${title} · 홈 즐겨찾기에 담김` : `${title} 즐겨찾기 해제`;
}
