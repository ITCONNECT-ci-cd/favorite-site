'use client';

import { useCallback } from 'react';
import { toast } from '@/components/Toast';
import { bulkOpenToastText, openToastText, recordClick } from '@/lib/clicks';
import { favToastText, useFavorites } from '@/lib/favorites';
import type { BookmarkWithCount } from '@/lib/types';

export type CardHandlers = {
  /** 즐겨찾기에 담긴 id 집합 — 카드에 내려줄 켜짐 상태를 여기서 뽑는다. */
  favs: ReadonlySet<string>;
  /** 카드 핀 클릭 (D6) */
  handleToggleFav: (id: string) => void;
  /** 카드 열기 — 사람이 카드 하나를 누른 경우 (F3) */
  handleOpen: (id: string) => void;
  /** '한 번에 열기' (G4) — 대상 목록과 탭 그룹 명칭을 받는다 */
  openMany: (items: readonly BookmarkWithCount[], groupLabel: string) => void;
};

/**
 * 카드 그리드를 그리는 화면(HomeView·ListView)이 공유하는 콜백 묶음.
 *
 * **왜 훅으로 뺐나**: 두 화면이 핀 토글(D6)·카드 열기(F3)·한 번에 열기(G4) 세 벌을 글자 하나까지
 * 같게 들고 있었다. 세 번째가 붙는 시점에 복제를 접었다 — 어느 한쪽만 고쳐 두 화면의 동작이
 * 갈라지는 것이 이 코드가 실제로 겪을 수 있는 유일한 고장이기 때문이다.
 *
 * `useFavorites` 는 여기서 **한 번만** 부른다. 화면이 자기 몫으로 또 부르지 않도록 결과(`favs`)를
 * 돌려준다 — 카드마다 부르면 렌더당 카드 수만큼 동기 localStorage 읽기가 생긴다(E1 사용 규칙).
 *
 * 토스트를 여기서 띄우는 것은 이 파일이 `components` 에 있기 때문이다. 문구 자체는 `lib` 의 순수
 * 함수(`favToastText`·`openToastText`·`bulkOpenToastText`)가 갖는다 — lib 이 components 를
 * 끌어오면 레이어가 뒤집힌다(lib/clicks.ts 규약).
 *
 * ⓘ 토스트 스토어는 슬롯이 하나라(Toast.tsx) 뒤에 오는 문구가 앞 문구를 밀어낸다. 프로토타입도
 *   토스트가 하나뿐이라 같은 동작이다.
 *
 * @param bookmarks 그 화면이 아는 링크 전부. 카드가 돌려준 id 로 제목을 찾는 데만 쓴다.
 */
export function useCardHandlers(bookmarks: readonly BookmarkWithCount[]): CardHandlers {
  const { favs, toggle } = useFavorites();

  /**
   * 핀 토글 — 담고/빼고 토스트로 알린다(DESIGN_SPEC 7장). 방향은 `toggle` 이 돌려준다.
   *
   * `/favorites` 에서는 뺀 카드가 곧바로 목록에서 사라진다 — 그 화면이 넘기는 `bookmarks` 자체가
   * 담긴 것만 골라낸 배열이기 때문이다(FavoritesView).
   */
  const handleToggleFav = useCallback(
    (id: string) => {
      // 카드가 돌려준 id 라 이 배열에 반드시 있다. 없더라도 토글은 하고 토스트만 건너뛴다.
      const bookmark = bookmarks.find((item) => item.id === id);
      const faved = toggle(id);

      if (bookmark !== undefined) toast(favToastText(bookmark.title, faved));
    },
    [bookmarks, toggle],
  );

  /**
   * 카드 열기 — 클릭을 기록하고(F2 로 보내는 fire-and-forget) 열었다고 알린다.
   *
   * 하위 탭으로 좁혀 놓은 화면에서도 `bookmarks`(화면 전체)에서 찾는다 — 보이는 카드는 언제나 그
   * 부분집합이라 못 찾는 일이 없다. 가운데 클릭도 여기로 온다(카드가 양쪽에서 부른다 — C2).
   * 이동을 가로채지 않으므로 `event` 를 받지 않는다.
   */
  const handleOpen = useCallback(
    (id: string) => {
      recordClick(id);

      // 카드가 돌려준 id 라 이 배열에 반드시 있다. 없더라도 기록은 하고 토스트만 건너뛴다.
      const bookmark = bookmarks.find((item) => item.id === id);
      if (bookmark !== undefined) toast(openToastText(bookmark.title));
    },
    [bookmarks],
  );

  /**
   * 한 번에 열기 (G4) — 목록의 순서대로 새 탭을 열고 하나씩 **bulk 로** 기록한다.
   *
   * `handleOpen` 을 재사용하지 않는 이유가 둘이다. 기록의 `isBulk` 가 달라야 하고(PRD — 일괄
   * 열기가 인기 순위를 왜곡하지 않게), 링크마다 토스트를 띄우면 마지막 하나만 남는다.
   *
   * **반드시 사용자 제스처 핸들러 안에서 동기적으로 돈다.** `await` 하나만 끼어도 그 뒤의
   * `window.open` 은 브라우저가 사용자 행동과 잇지 못해 팝업으로 막는다. 그래서 기록
   * (`recordClick`)도 응답을 기다리지 않는 fire-and-forget 이어야 한다(F3).
   *
   * `noopener,noreferrer` 는 카드 앵커의 `rel` 과 같은 값이다(C2) — 여는 경로가 둘이어도 새 탭이
   * 이 창을 되잡지 못하는 것은 같아야 한다. 그 대가로 `window.open` 이 창 참조 대신 null 을
   * 돌려주므로 차단 여부는 알 수 없고, 안내는 토스트가 무조건 한다(bulkOpenToastText).
   *
   * 기록이 118건까지 늘어도 keepalive 쿼터(64KiB)에는 닿지 않는다 — 본문이 건당 ~120B 다(F2 리뷰).
   */
  const openMany = useCallback((items: readonly BookmarkWithCount[], groupLabel: string) => {
    for (const item of items) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      recordClick(item.id, true);
    }

    toast(bulkOpenToastText(items.length, groupLabel));
  }, []);

  return { favs, handleToggleFav, handleOpen, openMany };
}
