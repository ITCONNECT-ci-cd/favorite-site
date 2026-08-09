'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { toast } from '@/components/Toast';
import { useFavorites } from '@/lib/favorites';
import { deleteBookmark } from '@/lib/mutations';
import type { BookmarkWithCount } from '@/lib/types';

export type DeleteConfirmProps = {
  /** 지울 링크. id 는 액션으로 나가고, 제목은 어느 카드의 확인인지 알리는 이름이 된다. */
  bookmark: BookmarkWithCount;
  /**
   * 오버레이를 닫는다 — 화면이 든 `deletingId` 를 비우는 일이다(삭제 성공 · 취소 · Esc).
   *
   * **실패하면 부르지 않는다.** 문구만 토스트로 알리고 오버레이는 그대로 남겨, 다시 누르거나
   * 취소로 나가게 한다(InlineEdit 의 `onDone` 과 같은 규약).
   *
   * 성공했을 때 카드가 사라지는 것은 이 콜백이 하는 일이 아니다 — 액션의
   * `revalidatePath('/', 'layout')` 가 목록을 다시 그린다.
   */
  onDone: () => void;
};

/**
 * 카드를 덮는 오버레이 (DESIGN_SPEC 2-1 "삭제 확인" · 프로토타입 150행).
 *
 * `absolute inset-0 z-[6]` 은 **오버레이 자신의 것이다** — 카드는 자리만 주고 위치도 크기도
 * 강제하지 않는다(LinkCard 의 `deleteSlot` JSDoc). 기준 상자는 카드 컨테이너(`relative`)다.
 *
 * 프로토타입이 함께 적은 `border-radius:10px` 은 옮기지 않았다. 카드가
 * `rounded-[10px] overflow-hidden` 이라 모서리는 이미 잘리고, 같은 값을 두 곳에 적으면 카드의
 * 라운드를 바꿀 때 여기만 남는다.
 */
const OVERLAY =
  'absolute inset-0 z-[6] flex flex-col items-center justify-center gap-[7px] p-[8px] bg-[rgba(251,250,248,.97)]';

/**
 * 두 버튼의 공통 몸통 — 높이 26px, 좌우 11px, 라운드 6px, 11.5px (프로토타입 153·154행).
 *
 * 잠긴 모습(삭제 중)은 프로토타입에 없다. 프로토타입의 삭제는 로컬 상태 갱신이라 즉시 끝나지만
 * 여기서는 서버 왕복이라 '누른 것이 먹었는지' 알 수 없는 구간이 생긴다 — 흐리게 + 커서 되돌리기로
 * 그 구간을 보이게만 한다(J2 InlineEdit 과 같은 처리).
 */
const BUTTON =
  'flex h-[26px] cursor-pointer items-center rounded-[6px] px-[11px] text-[11.5px] disabled:cursor-default disabled:opacity-60';
/** 삭제 — 배경 `#a8443a`(= --color-danger) + 흰 글자. 되돌릴 수 없는 동작이라는 신호다. */
const DELETE = `${BUTTON} bg-danger font-semibold text-white`;
/** 취소 — 흰 버튼. 프로토타입 154행에 글자색 선언이 없어 본문 잉크를 그대로 물려받는다. */
const CANCEL = `${BUTTON} border border-border-strong bg-card`;

/** 오버레이 안에서 포커스를 받을 수 있는 것 — 버튼 둘뿐이고, 삭제 중에는 둘 다 잠긴다. */
const FOCUSABLE = 'button:not([disabled])';

/**
 * 휴지통을 누르면 카드 위에 뜨는 삭제 확인 — DESIGN_SPEC 2-1 "삭제 확인".
 *
 * **누르는 즉시 지우지 않는다**(스펙 7장). 휴지통이 하는 일은 '삭제를 묻기'까지이고, 실제 삭제는
 * 이 오버레이의 `삭제` 를 눌렀을 때 한 번 일어난다.
 *
 * ## 교체가 아니라 덧대기다
 *
 * 편집 폼(J2)과 달리 본문을 지우지 않는다 — 배경 `rgba(251,250,248,.97)` 로 덮을 뿐이라 지우려는
 * 링크가 무엇인지 뒤로 비쳐 보인다. 그래서 카드는 이 노드를 **마지막 자식으로 덧댄다**.
 *
 * ## 키보드를 붙드는 일은 이 컴포넌트의 몫이다
 *
 * 오버레이가 덮는 것은 **포인터까지다.** 그 아래 본문 앵커·핀·연필은 여전히 DOM 에 있고 탭 순서에도
 * 남아 있다 — 카드는 형제들에게 `inert` 를 걸지 않는다(LinkCard 의 `deleteSlot` JSDoc). 그래서
 * 마운트 시 포커스 이동과 Tab 가둠·Esc 를 여기서 한다. 없으면 "지울까요"를 띄워 둔 채 Tab 한 번에
 * 뒤 카드의 링크로 새어 나가고, 확인창은 화면에 남는데 키보드는 이미 딴 데 가 있다.
 *
 * 키는 **오버레이 자신에게** 건다(문서 전역 리스너가 아니다). 같은 링크가 홈의 두 섹션에 놓이면
 * 오버레이도 두 자리에 뜨는데, 전역 리스너였다면 두 개가 같은 Esc·Tab 을 듣고 서로의 포커스를
 * 뺏는다. 대신 포인터로 오버레이 밖을 눌러 포커스가 빠져나간 뒤에는 가둠이 풀린다 — 카드 하나짜리
 * 확인창에 문서 전체를 감시하게 하는 것보다 이 편이 안전하다고 보았다.
 *
 * ## '어느 카드가 열려 있는가'는 이 컴포넌트가 모른다
 *
 * 편집과의 상호 배제('삭제를 물으면 편집이 닫힌다')를 포함해, 여러 카드를 아는 화면
 * (HomeView·ListView)이 `deletingId` 하나로 정한다. 여기가 아는 것은 지울 링크 한 건과
 * 나가는 길(`onDone`)뿐이다.
 *
 * 그래서 같은 링크가 홈의 두 섹션(매일 · 운영 중)에 놓이면 **오버레이도 두 자리에 뜬다** —
 * 상태가 링크 id 하나라서다(프로토타입 `st.confirmId === b.id` 와 같다). 인스턴스가 둘이어도
 * 잃을 것은 없다: 이 컴포넌트가 드는 상태는 `deleting` 빗장 하나뿐이고 사용자가 쳐 둔 값이
 * 없다. (J2 인라인 편집은 사정이 다르다 — 두 폼에 서로 다른 값을 치고 한쪽을 저장하면 다른
 * 쪽 입력이 조용히 사라진다.) 게다가 어느 쪽에서 확인하든 지우는 링크가 같고, 한쪽이
 * 성공하면 화면이 `deletingId` 를 비워 두 자리가 함께 닫히므로 액션이 두 번 갈 길도 없다.
 */
export function DeleteConfirm({ bookmark, onDone }: DeleteConfirmProps) {
  /** 서버 왕복 중 — 두 버튼을 잠그고 Esc 를 막는 **보이는** 상태다. */
  const [deleting, setDeleting] = useState(false);
  /**
   * 같은 것을 가리키는 **빗장**. 상태 하나로 겸하지 않는 이유는 React 의 일괄 처리다 — 한 틱 안에
   * 클릭 둘이 들어오면 둘 다 같은 렌더의 클로저를 보므로 `deleting` 은 아직 false 이고, 화면도
   * 다시 그려지기 전이라 `disabled` 도 아직 걸리지 않았다. 그 사이로 두 번째 요청이 나가면
   * 두 번째는 "링크를 찾을 수 없습니다."로 돌아와, 지워 놓고 실패를 말하는 화면이 된다.
   * ref 는 그 자리에서 바뀌므로 같은 틱의 두 번째 호출이 곧바로 막힌다.
   */
  const sending = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  /**
   * 지운 링크를 **이 브라우저의 즐겨찾기에서도 뺀다** (아래 `confirm`).
   *
   * E1 의 사용 규칙("카드 안에서 부르지 말고 뷰에서 한 번만")을 어기는 것처럼 보이지만 아니다 —
   * 그 규칙이 막는 것은 렌더당 카드 수(118장)만큼 도는 동기 localStorage 읽기이고, 이 컴포넌트는
   * 확인창이 열려 있는 동안에만, 많아야 두 자리에 산다(같은 링크가 홈 두 섹션에 놓인 경우).
   *
   * 화면(HomeView·ListView)에서 하지 않는 이유는 `onDone` 이 성공과 취소를 구분하지 않기
   * 때문이다. "그 링크는 이제 없다"를 아는 시점은 액션의 응답을 받은 여기 한 곳뿐이다.
   */
  const { favs, toggle } = useFavorites();

  /**
   * 뜨는 순간 포커스를 데려오고, 닫힐 때 열어 준 곳(휴지통)으로 돌려준다.
   *
   * **받는 쪽은 `취소`다.** 되돌릴 수 없는 동작을 묻는 자리라 기본 포커스는 덜 위험한 쪽에 둔다
   * (WAI-ARIA APG alertdialog). 휴지통을 누른 직후의 Enter 한 번이 그대로 삭제가 되면 확인을
   * 거치게 한 의미가 없다.
   *
   * 돌려줄 때 `isConnected` 를 보는 것은 삭제 성공 경로 때문이다 — 그때는 카드가 통째로 사라져
   * 휴지통도 문서에 없다. 떨어져 나간 노드에 `focus()` 를 불러 봐야 포커스는 `<body>` 로 간다.
   */
  useEffect(() => {
    const trigger = document.activeElement;

    cancelRef.current?.focus();

    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  /**
   * 삭제 중에는 두 버튼이 잠기는데, 브라우저는 **잠긴 요소에서 포커스를 떼어** `<body>` 로 보낸다.
   * 그대로 두면 그 구간의 Tab 이 아래 `handleKeyDown` 에 닿지도 못하고 카드 뒤로 새어 나가므로
   * 오버레이 자신이 받아 둔다(그래서 뿌리가 `tabIndex={-1}` 이다).
   */
  useEffect(() => {
    if (deleting) overlayRef.current?.focus();
  }, [deleting]);

  /**
   * 삭제. 실패는 액션이 정한 문구를 그대로 토스트에 넣고 오버레이를 남긴다 — 무엇이 잘못됐는지
   * 말하는 것은 한곳(`lib/mutations.ts`)의 일이고, 화면은 결과만 표시한다.
   */
  async function confirm(): Promise<void> {
    if (sending.current) return;

    sending.current = true;
    setDeleting(true);
    const result = await deleteBookmark(bookmark.id);

    // 성공하면 오버레이가 사라지므로 빗장을 되돌리지 않는다. 목록 갱신은 액션의
    // revalidatePath('/', 'layout') 가 하고, 이 오버레이는 닫히기만 한다.
    if (result.ok) {
      // 사이드바의 '내 즐겨찾기' 개수는 저장된 id 를 그대로 세고(SidebarContainer), 화면의 목록은
      // 실존 링크만 골라 센다(`pickFavorites`). 지운 링크의 id 를 남겨 두면 그 순간부터 두 숫자가
      // 갈라지므로, 어긋남을 표시 단계에서 가리는 대신 **원인이 생기는 자리에서** 지운다.
      //
      // `toggle` 은 없으면 담는 함수라 반드시 담긴 것을 확인하고 부른다. `favs` 는 구독으로
      // 받은 지금 값이다(useSyncExternalStore).
      if (favs.has(bookmark.id)) toggle(bookmark.id);

      onDone();

      return;
    }

    // 실패했으니 다시 누를 수 있어야 한다 — 빗장과 잠긴 모습을 함께 되돌린다.
    sending.current = false;
    setDeleting(false);
    toast(result.error);
  }

  /**
   * Tab 가둠 — 경계(첫·끝)에서만 반대편으로 돌리고 가운데는 브라우저 순서에 맡긴다
   * (CommandPalette 의 `trapTab` 과 같은 규칙). 지금 버튼이 둘이라 모든 Tab 이 경계다.
   */
  function trapTab(event: KeyboardEvent<HTMLDivElement>): void {
    const overlay = overlayRef.current;
    if (overlay === null) return;

    const focusable = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)];
    // 삭제 중 — 갈 곳이 없으면 오버레이 자신이 붙든다. 여기서 놓아 주면 요청이 도는 동안
    // 사용자가 카드 뒤의 링크를 짚게 된다.
    if (focusable.length === 0) {
      event.preventDefault();
      overlay.focus();

      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const edge = event.shiftKey ? first : last;

    if (active !== edge && overlay.contains(active)) return;

    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }

  /**
   * Esc 취소. **프로토타입에는 없는 키다**(931행 `cancelDel` 은 클릭뿐) — 포커스를 가두고
   * `aria-modal` 로 "뒤는 없는 셈"이라고 알린 이상, 나가는 길을 키보드에도 열어 두어야 한다
   * (APG dialog 규약). 편집 폼의 Esc 취소(DESIGN_SPEC 2-1)와도 같은 결이다.
   *
   * 삭제 중에는 듣지 않는다 — 요청은 이미 떠났으므로 여기서 닫으면 '취소했는데 지워진' 화면이
   * 되고, 실패 문구를 보여 줄 오버레이도 사라진다(InlineEdit 과 같은 판단).
   */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Tab') {
      trapTab(event);

      return;
    }

    if (event.key !== 'Escape' || deleting) return;

    event.preventDefault();
    onDone();
  }

  return (
    <div
      ref={overlayRef}
      // 되돌릴 수 없는 동작을 묻는 자리라 `alertdialog` 다 — 포커스가 들어오는 순간 보조 기술이
      // 문구(aria-describedby)까지 함께 읽는다. `aria-modal` 은 위 Tab 가둠과 짝이다.
      role="alertdialog"
      aria-modal="true"
      // 카드마다 오버레이가 하나씩 뜰 수 있으므로 어느 링크의 확인인지 이름에 담는다
      // (카드 액션 버튼의 `${title} 삭제` · 편집 폼의 `${title} 편집` 과 같은 방식).
      aria-label={`${bookmark.title} 삭제 확인`}
      aria-describedby={messageId}
      // 버튼이 잠기는 구간에 포커스를 받아 둘 자리 (위 두 번째 useEffect).
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={OVERLAY}
    >
      <span id={messageId} className="text-center text-[11.5px] leading-[1.4] font-semibold">
        이 링크를 삭제할까요
      </span>

      <span className="flex flex-wrap justify-center gap-[5px]">
        <button type="button" disabled={deleting} onClick={() => void confirm()} className={DELETE}>
          삭제
        </button>
        <button
          ref={cancelRef}
          type="button"
          disabled={deleting}
          onClick={() => onDone()}
          className={CANCEL}
        >
          취소
        </button>
      </span>
    </div>
  );
}
