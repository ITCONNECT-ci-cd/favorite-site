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
   * 한 번에 열기 (G4) — 목록의 순서대로 새 탭을 열고, **실제로 열린 것만** bulk 로 기록한다.
   *
   * `items` 는 **화면에 보이는 것의 부분집합이어야 한다** — 이 함수는 거르지 않고 받은 대로 연다.
   * 거르는 일은 부르는 쪽 몫이다(ListView 의 `checkedItems` 가 `shown` 과 교차시킨다).
   *
   * `handleOpen` 을 재사용하지 않는 이유가 둘이다. 기록의 `isBulk` 가 달라야 하고, 링크마다
   * 토스트를 띄우면 마지막 하나만 남는다.
   *
   * ## 팝업 차단을 감지하려고 `noopener,noreferrer` 를 뺐다 — 무엇을 맞바꿨나
   *
   * 예전에는 카드 앵커의 `rel` 과 같은 값(`noopener,noreferrer`)으로 열었다. 그런데 규격상
   * **`noopener` 로 연 창은 `window.open` 이 참조 대신 언제나 null 을 돌려준다**(`noreferrer` 는
   * `noopener` 를 함의한다). 즉 차단됐을 때와 열렸을 때의 반환값이 똑같아, 열린 것이 하나도 없어도
   * 화면은 "N개를 새 탭으로 엽니다" 라고 말하고 기록까지 남겼다 — 사용자가 신고한 고장이 정확히
   * 그것이었다(탭은 0개, 기록은 28건). **감지하지 못하면 사용자에게 거짓말을 하고 통계까지
   * 오염된다**는 것이 이 맞바꿈의 이유다.
   *
   * 그래서 기능 문자열 없이 열어 창 핸들을 돌려받고, 핸들이 null 인지로 링크마다 열림/차단을
   * 가른다. 잃은 것과 되찾은 것:
   *
   * - **되찾음(보안)**: 핸들을 받는 즉시 `tab.opener = null` 로 끊는다. `noopener` 를 뺀 대가로
   *   생기는 것은 열린 페이지가 `window.opener` 로 이 창을 되잡아 주소를 바꿔치기하는 경로
   *   (reverse tabnabbing)인데, 이 대입이 바로 그것을 닫는다 — `rel=noopener` 가 생기기 전부터
   *   쓰이던 표준 완화이고, 상대가 크로스 오리진이어도 `opener` 는 쓰기가 허용된 몇 안 되는
   *   속성이다. 대입은 `window.open` 이 돌아온 **직후·동기적으로** 해야 한다.
   * - **잃음(사생활)**: `noreferrer` 가 빠져 대상 사이트에 이 대시보드의 Referer 가 간다. 사내
   *   대시보드에서 **이미 아는 사이트**로 가는 이동이고, 같은 링크를 카드로 하나씩 열 때와 달리
   *   이 경로만의 추가 노출이므로 수용한다. (카드 앵커는 그대로 `rel="noopener noreferrer"` 다 —
   *   거기는 브라우저가 막지 않으므로 감지할 것이 없다.)
   *
   * **`isBulk` 가 지금 무엇을 하고 무엇을 하지 않는지**: 이 플래그는 *이후* 순위 산정이 일괄
   * 열기를 제외할 수 있도록 기록에 남겨 두는 표시다(PRD — 순위 왜곡 방지). 지금 카드에 보이는
   * 클릭 수는 bulk 를 **포함한** 값이다 — PRD 가 절대값을 참고용으로 두므로 그대로 수용한다.
   * 걸러 내는 일은 순위를 실제로 매기는 화면(3단계 통계)이 이 플래그로 한다.
   *
   * **반드시 사용자 제스처 핸들러 안에서 동기적으로 돈다.** `await` 하나만 끼어도 그 뒤의
   * `window.open` 은 브라우저가 사용자 행동과 잇지 못해 팝업으로 막는다. 그래서 기록
   * (`recordClick`)도 응답을 기다리지 않는 fire-and-forget 이어야 한다(F3). 차단을 만나도 루프를
   * 멈추지 않는 이유도 같다 — 브라우저는 앞의 몇 개만 허용하고 나머지를 막기도 하지만, 반대로
   * 중간 것만 막는 경우도 있어 시도 자체는 목록 끝까지 해야 한다.
   *
   * 기록이 118건까지 늘어도 keepalive 쿼터(64KiB)에는 닿지 않는다 — 본문이 건당 ~120B 다(F2 리뷰).
   */
  const openMany = useCallback((items: readonly BookmarkWithCount[], groupLabel: string) => {
    let opened = 0;
    let blocked = 0;

    for (const item of items) {
      // 기능 문자열을 넘기지 않는다 — `noopener`/`noreferrer` 중 하나라도 있으면 핸들 대신 null 이
      // 와서 아래 판정이 통째로 '전부 차단'이 된다(위 맞바꿈 설명).
      const tab = window.open(item.url, '_blank');

      if (tab === null) {
        blocked += 1;
        continue;
      }

      // 되잡는 경로를 여기서 끊는다. 이 한 줄이 `noopener` 의 자리를 대신한다.
      tab.opener = null;
      opened += 1;

      // 열린 링크만 기록한다 — 차단된 것까지 세면 카드의 클릭 수가 열리지도 않은 유령 클릭으로
      // 부풀고, 그것이 실제로 한 번 일어났다(28건을 손으로 지웠다).
      recordClick(item.id, true);
    }

    toast(bulkOpenToastText({ opened, blocked, groupLabel }));
  }, []);

  return { favs, handleToggleFav, handleOpen, openMany };
}
