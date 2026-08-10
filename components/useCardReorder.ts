'use client';

import { startTransition, useOptimistic, useRef, type DragEvent } from 'react';

import { toast } from '@/components/Toast';
import { REQUEST_FAILED } from '@/lib/constants';
import { reorderBookmarks } from '@/lib/mutations';
import { moveOnto } from '@/lib/reorder';

/**
 * 카드 한 장에 그대로 스프레드하는 드래그 배선 (`<LinkCard {...dragProps(id)} />`).
 *
 * 통째로 `undefined` 일 수 있다는 것이 이 타입의 핵심이다 — 관리자가 아니면 **속성이 하나도
 * 실리지 않는다**. `draggable={false}` 를 그려 두고 막는 방식이 아니다(README 주의사항 7 과 같은 결).
 */
export type CardDrag = {
  draggable: true;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

export type CardReorder<T> = {
  /** 화면이 그릴 목록. 저장이 끝나기 전에도 새 차례가 반영된 낙관적 순서다. */
  order: readonly T[];
  /** 카드 한 장의 드래그 배선. 정렬이 꺼져 있으면 `undefined`. */
  dragProps: (id: string) => CardDrag | undefined;
};

/**
 * 공개 화면(홈 섹션 · 분류 · 매일)에서 **관리자가 카드를 끌어 순서를 바꾸는** 배선 한 벌.
 *
 * 관리 화면의 링크 표(I4)가 하던 일을 카드 격자로 옮긴 것이라 구조가 같다 — 낙관적 순서 ·
 * 끌고 있는 id 를 담는 ref · 요청 중 두 번째 드롭을 버리는 빗장. 근거는 각 선언에 적어 두었다.
 *
 * ## 넘기는 목록은 **이 화면이 정렬하는 목록 전부**다
 *
 * 걸러진 일부(하위 탭으로 좁힌 화면)를 넘겨도 되는 것은 서버가 **자리를 맞바꾸는** 방식으로
 * 바뀌었기 때문이다(`reorderBookmarks` JSDoc). 그래도 부르는 쪽은 `order` 전체를 넘긴다 —
 * 화면이 방금 계산한 차례와 서버로 가는 차례가 같은 배열이어야 낙관적 순서가 거짓말을 하지 않는다.
 *
 * ## 알려진 한계 — 마우스로만 된다
 *
 * HTML5 `draggable` 은 키보드로 다룰 수 없고 터치에서도 동작하지 않는다(관리 화면과 같은 한계).
 * 순서 바꾸기는 관리자의 정리 작업이고 나머지 편집(이름·설명·삭제·고정)은 전부 키보드로 되므로
 * 이 하나만 마우스 전용으로 남긴다.
 *
 * @param items 서버가 준 목록(정렬된 상태). 낙관적 순서의 밑값이다.
 * @param enabled 관리자인가 — 거짓이면 `dragProps` 가 언제나 `undefined` 다.
 * @param onCommit 저장할 차례를 넘긴다. 주지 않으면 `reorderBookmarks` 로 서버에 보낸다
 *   (즐겨찾기처럼 순서를 브라우저가 들고 있는 목록이 자기 저장소를 넘겨받는 자리다).
 */
export function useCardReorder<T extends { id: string }>(
  items: readonly T[],
  enabled: boolean,
  onCommit?: (orderedIds: string[]) => void,
): CardReorder<T> {
  /**
   * 저장이 끝나기 전에 보여 줄 순서. **완성된 배열이 아니라 리듀서로 든다** — 절대값으로 밀어
   * 넣으면 그 배열이 base 를 통째로 가려, 요청이 나가 있는 동안 도착한 새 서버 데이터(다른 창의
   * 수정·추가)가 응답이 올 때까지 보이지 않는다(관리 화면 LinkTable 과 같은 근거).
   */
  const [order, moveCard] = useOptimistic(items, (current: readonly T[], move: Move) =>
    moveOnto(current, move.sourceId, move.targetId),
  );

  /**
   * 끌고 있는 카드. `dataTransfer` 가 아니라 ref 인 이유는 관리 화면과 같다 — 이 화면 안에서만
   * 오가는 정보이고, dragover 중에는 `dataTransfer.getData()` 가 보안상 빈 문자열을 돌려주는
   * 브라우저가 있어 판정에 쓸 수 없다.
   */
  const draggingId = useRef<string | null>(null);

  /**
   * 정렬 요청이 나가 있는 동안 — 두 번째 드롭을 **버리는** 빗장이다. 겹쳐 놓으면 두 요청이 각각
   * 자기가 본 순서를 보내므로 나중 도착한 쪽이 먼저 도착한 옮김을 지운다.
   */
  const reordering = useRef(false);

  function handleDrop(event: DragEvent<HTMLElement>, targetId: string): void {
    event.preventDefault();

    const sourceId = draggingId.current;
    draggingId.current = null;
    // 이 목록에서 시작한 드래그가 아니면(바깥에서 파일을 끌어다 놓는 등) 아무 일도 하지 않는다.
    if (sourceId === null || sourceId === targetId) return;
    if (reordering.current) return;
    /* 관리자가 아니면 받지 않는다. 카드에 `draggable` 을 걸지 않는 것만으로는 부족하다 —
       바깥에서 시작한 드래그의 drop 은 여전히 이 자리로 들어온다. */
    if (!enabled) return;

    const orderedIds = moveOnto(order, sourceId, targetId).map((item) => item.id);

    reordering.current = true;
    startTransition(async () => {
      moveCard({ sourceId, targetId });

      if (onCommit !== undefined) {
        onCommit(orderedIds);
        reordering.current = false;

        return;
      }

      // **트랜지션 안에서 던지면 가장 가까운 오류 경계로 올라간다** — 공개 화면 위의 경계는
      // `app/global-error.tsx` 하나뿐이라 순서 저장 한 번이 거부된 것으로 화면 전체가 오류
      // 화면이 된다. 잡아서 실패 결과로 접는다(관리 화면의 `run` 과 같은 계약).
      let failed: string | null = null;
      try {
        const result = await reorderBookmarks(orderedIds);
        if (!result.ok) failed = result.error;
      } catch (error) {
        console.error('[useCardReorder] 순서 저장 요청이 거부됐다', error);
        failed = REQUEST_FAILED;
      }

      reordering.current = false;
      if (failed !== null) toast(failed);
    });
  }

  function dragProps(id: string): CardDrag | undefined {
    if (!enabled) return undefined;

    return {
      draggable: true,
      onDragStart: (event) => {
        draggingId.current = id;

        // Firefox 는 dragstart 에서 데이터를 싣지 않으면 드래그를 시작조차 하지 않는다.
        // (jsdom 에는 DragEvent 가 없어 테스트에서는 이 자리가 비어 있다 — 그래서 옵셔널이다.)
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (event) => {
        // 막지 않으면 브라우저가 drop 자체를 일으키지 않는다.
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      },
      onDrop: (event) => handleDrop(event, id),
      onDragEnd: () => {
        draggingId.current = null;
      },
    };
  }

  return { order, dragProps };
}

type Move = { sourceId: string; targetId: string };
