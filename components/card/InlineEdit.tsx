'use client';

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { toast } from '@/components/Toast';
import { REQUEST_FAILED } from '@/lib/constants';
import { isFocusNowhere } from '@/lib/focus';
import { updateBookmark, type ActionResult, type BookmarkPatch } from '@/lib/mutations';
import type { BookmarkWithCount } from '@/lib/types';

export type InlineEditProps = {
  /**
   * 지금 고치는 링크. 폼의 처음 값이 여기서 나온다.
   *
   * **읽는 시점은 마운트 한 번뿐이다.** 폼이 열려 있는 동안 이 prop 이 새 값으로 바뀌어도(다른 창의
   * 수정이 revalidate 로 내려오는 경우) 폼은 처음 받은 값을 기준으로 판단한다 — 아래 `baseline`.
   */
  bookmark: BookmarkWithCount;
  /**
   * 폼을 닫는다 — 화면이 든 `editingId` 를 비우는 일이다(저장 성공 · 취소 · Esc).
   *
   * **부르는 쪽은 반드시 이 폼을 언마운트한다.** 저장 성공 경로는 빗장(`sending`)도 잠긴
   * 모습(`saving`)도 되돌리지 않으므로(아래 `save`), 이것을 부르고도 폼을 남겨 두면 입력도 버튼도
   * Esc 도 잠긴 폼이 화면에 남는다. 나갈 길은 새로고침뿐이다.
   *
   * **실패하면 부르지 않는다.** 고치던 값을 그대로 둔 채 문구만 토스트로 알리고, 사용자가 고쳐
   * 다시 저장하거나 취소로 나가게 한다.
   */
  onDone: () => void;
};

/** 두 입력의 공통 몸통 — 높이 30px, 라운드 6px, 좌우 패딩 8px, 흰 배경 (프로토타입 실측). */
const FIELD = 'h-[30px] w-full rounded-[6px] bg-card px-[8px]';
/** 이름 입력 — 테두리 1.5px `#141516`, 12.5px/600 (DESIGN_SPEC 2-1 "인라인 편집"). */
const TITLE_FIELD = `${FIELD} border-[1.5px] border-ink text-[12.5px] font-semibold`;
/** 설명 입력 — 테두리 1px `#ddd8d1`(= --color-border-strong), 12px. */
const DESC_FIELD = `${FIELD} border border-border-strong text-[12px]`;

/**
 * 두 버튼의 공통 몸통 — 높이 28px, 라운드 6px, 11.5px.
 *
 * 잠긴 모습(저장 중)은 프로토타입에 없다. 프로토타입은 저장이 즉시 끝나는 로컬 상태였지만 여기서는
 * 서버 왕복이라 '누른 것이 먹었는지' 알 수 없는 구간이 생긴다 — 흐리게 + 커서 되돌리기로 그 구간을
 * 보이게만 한다(색·크기는 그대로).
 */
const BUTTON =
  'flex h-[28px] cursor-pointer items-center rounded-[6px] text-[11.5px] disabled:cursor-default disabled:opacity-60';
/** 저장 — 검은 버튼, 남는 폭을 다 쓴다(`flex:1`). */
const SAVE = `${BUTTON} flex-1 justify-center bg-ink font-semibold text-white`;
/** 취소 — 흰 버튼. 글자만큼만 차지한다(`flex:none` + 좌우 10px). */
const CANCEL = `${BUTTON} shrink-0 border border-border-strong bg-card px-[10px] text-desc`;

/**
 * 카드 안에서 이름·설명을 고치는 폼 — DESIGN_SPEC 2-1 "인라인 편집".
 *
 * **모달이 아니다.** 카드의 본문 블록 + 하단 줄 자리에 그대로 들어앉는다(LinkCard 의 `editSlot`).
 * 그래서 뿌리 요소가 `margin-top:auto` 를 들고 있다 — 교체하기 전 본문 블록이 갖던 값이라,
 * 카드가 min-height 로 늘어나도 폼이 아래에 붙어 카드 높이가 출렁이지 않는다.
 *
 * ## 필드는 이름·설명 둘뿐이다
 *
 * 스펙 2-1 과 프로토타입(`b.editTitle`·`b.editDesc`)이 정한 그대로다. 액션이 받을 수 있는
 * 주소·분류·파비콘까지 여기 두지 않는다 — 카드 한 장 폭(158px)에 들어가는 폼이고, 링크를 다른
 * 분류로 옮기는 일은 관리 화면(I4 링크 표)의 몫이다.
 *
 * ## '동시에 한 장만' 은 이 컴포넌트가 모른다
 *
 * 여러 카드를 아는 화면(HomeView·ListView)이 `editingId` 하나를 들고 그 카드에만 이 폼을
 * 내려보낸다. 이 폼이 아는 것은 자기가 고치는 링크 한 건과 나가는 길(`onDone`)뿐이다.
 *
 * ## 고치던 값(draft)은 **폼 인스턴스가** 든다
 *
 * 프로토타입은 화면 하나가 든 단일 상태였다(`editTitle`·`editDesc` 전역 한 벌). 여기서는 마운트된
 * 폼마다 자기 `useState` 를 갖는다 — 그래서 프로토타입과 두 군데가 갈린다.
 *
 * 1. **같은 링크가 홈의 두 섹션에 놓이면 폼도 두 벌 열린다**(HomeView 의 `editingId` 는 링크 id
 *    하나라 즐겨찾기·매일 양쪽 카드가 함께 편집으로 바뀐다). 두 폼의 draft 는 서로 남남이라 한쪽에
 *    친 글자가 다른 쪽에 보이지 않고, 한쪽을 저장하면 폼이 **둘 다** 닫혀 다른 쪽에 치던 값은
 *    사라진다. 프로토타입은 상태가 한 벌이라 이 어긋남 자체가 없었다.
 * 2. **ListView 에서 탭을 왕복하면 draft 가 초기화된다** — 폼이 언마운트되면 그 안의 상태도 함께
 *    사라지므로, 돌아왔을 때 입력은 저장된 값에서 다시 시작한다(화면이 `editingId` 를 남겨 둬
 *    폼이 다시 열리더라도 마찬가지다).
 *
 * 둘 다 폼 밖(화면이 `editingId` 를 어떻게 들고 있는가)에서 결정되는 성질이라 이 파일에서는
 * 고칠 수 없다. 값을 화면으로 끌어올리면 프로토타입과 같아지지만, 그러면 카드 목록 전체가
 * 글자 한 자마다 다시 그려진다.
 */
export function InlineEdit({ bookmark, onDone }: InlineEditProps) {
  const [title, setTitle] = useState(bookmark.title);
  const [description, setDescription] = useState(bookmark.description ?? '');
  /** 서버 왕복 중 — 입력·버튼을 잠그고 Esc 를 막는 **보이는** 상태다. */
  const [saving, setSaving] = useState(false);
  /**
   * 같은 것을 가리키는 **빗장**. 상태 하나로 겸하지 않는 이유는 React 의 일괄 처리다 — 한 틱 안에
   * 제출 둘이 들어오면 둘 다 같은 렌더의 클로저를 보므로 `saving` 은 아직 false 이고, 화면도 다시
   * 그려지기 전이라 `disabled` 조차 걸리지 않았다. 그 사이로 두 번째 요청이 나가면 같은 patch 가
   * 두 번 저장되고 revalidate 도 두 번 돈다. ref 는 그 자리에서 바뀌므로 같은 틱의 두 번째 호출이
   * 곧바로 막힌다 (J3 DeleteConfirm 의 `sending` 과 같은 처리 — 그쪽에서 실측으로 확인된 구멍이다).
   */
  const sending = useRef(false);
  /**
   * 비교 기준선 — **폼을 연 순간의 링크**를 그대로 붙든다(`useState` 초기값은 첫 렌더에서 한 번만 읽힌다).
   *
   * 입력의 출발값은 마운트 시점인데 비교만 지금 prop 과 하면, 열려 있는 사이에 다른 창의 수정이
   * 내려온 순간 **사용자가 손대지도 않은 필드가 patch 에 실린다** — 그 필드의 입력에는 옛 값이
   * 그대로 있으므로, 저장은 남이 방금 고친 값을 우리가 읽어 온 옛 값으로 되돌려 버린다.
   * 기준선을 고정하면 patch 에는 "이 폼에서 사용자가 바꾼 것"만 남는다.
   *
   * 쓰기 대상 id 도 여기서 가져온다 — 무엇과 비교했는지와 어디에 쓰는지가 갈라지면 안 된다.
   */
  const [baseline] = useState(bookmark);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  /** 실패로 잠금이 풀렸을 때 포커스를 돌려줄 자리 — 다시 누를 컨트롤이다(아래 두 번째 effect). */
  const saveRef = useRef<HTMLButtonElement>(null);
  /**
   * 이 폼을 **연 자리** — 렌더 시점의 `document.activeElement` 다. 정상 경로에서는 방금 누른
   * 연필이고(클릭이 포커스를 옮긴 직후에 이 렌더가 일어난다), 아래 두 가지의 근거가 된다:
   * 닫힐 때 돌려줄 곳, 그리고 "이 카드가 눌린 카드인가"(`owned`).
   *
   * **effect 에서 읽으면 늦는다.** 카드 A 의 폼이 열려 있는데 카드 B 의 연필을 누르면 화면의
   * `editingId` 가 한 번에 바뀌어 **한 커밋에서** A 가 사라지고 B 가 뜬다. React 는 사라지는 쪽의
   * cleanup 을 새로 뜨는 쪽의 effect 보다 먼저 돌리므로, 그 순간 `activeElement` 는 A 가 되돌려
   * 놓은 **A 의 연필**이다 — effect 에서 읽은 B 는 남의 트리거를 붙들고, 닫힐 때 포커스를 엉뚱한
   * 카드로 보낸다. 렌더는 그 cleanup 보다 앞서 일어나므로 여기서 잡는다(J3 DeleteConfirm 과 같은
   * 처리).
   *
   * 렌더 중에 `document` 를 읽어도 되는 것은 이 폼이 **서버에서 렌더되지 않기** 때문이다 —
   * 화면의 `editingId` 는 null 로 시작하므로 SSR·하이드레이션 첫 렌더에는 이 컴포넌트가 없다.
   */
  const [trigger] = useState<Element | null>(() => document.activeElement);

  /**
   * 뜨는 순간 이름 입력으로 포커스를 데려오고, 닫힐 때 열어 준 자리로 돌려준다
   * (J3 DeleteConfirm 의 오버레이와 같은 처리).
   *
   * 데려오지 않으면 포커스가 연필 버튼에 남는다. 이 폼의 Esc 취소는 폼 안에서 올라오는 keydown 을
   * 듣는 것이라(아래 `handleKeyDown`), 연필에 포커스가 있는 채로 Esc 를 누르면 아무 일도
   * 일어나지 않는다 — 키보드 사용자에게는 나가는 길이 막힌 것과 같다.
   *
   * 돌려줄 자리는 위 `trigger` 다. 폼은 연필의 ref 를 모르므로(그 버튼은 LinkCard 의 것이고 J1b 의
   * 병렬 계약상 이 트랙이 건드리지 않는다) 붙들어 둔 것으로 가늠한다. 그래서 한계가 둘 남는다.
   *
   * - 클릭으로 버튼에 포커스가 가지 않는 환경(macOS Safari 기본값 · jsdom)에서는 붙들 것이 문서
   *   뿌리라 되돌릴 것도 없다. 포커스는 폼이 사라진 자리에 그대로 남는다. 그 "아무 데도 아닌
   *   자리"(`<body>`·`<html>`·없음)의 판정은 `lib/focus.ts` 의 `isFocusNowhere` 한곳에 있다.
   * - 되돌릴 때 `isConnected` 를 본다 — 그 사이 카드가 사라졌다면(다른 창의 삭제 등) 떨어져 나간
   *   노드에 `focus()` 를 불러 봐야 포커스는 `<body>` 로 간다.
   *
   * ⚠️ 같은 링크가 홈의 두 섹션에 놓이면 폼도 두 벌 열린다(위 draft 소유권). 그때 이름 입력을
   * 데려가는 것은 **연필이 눌린 카드의 폼 하나**다 — 트리거를 렌더 시점에 붙들어 두었으므로
   * "그 연필이 내 카드 안에 있는가"로 가릴 수 있다. 기준 상자는 폼의 부모, 곧 카드다(LinkCard 는
   * 본문 블록 자리에 `editSlot` 을 끼우고 연필은 같은 카드의 상단 줄에 있다). 붙든 것이 문서
   * 뿌리뿐이면 누가 눌렀는지 알 길이 없으므로 가리지 않고 데려온다 — 그때는 종전대로 나중에
   * 마운트된 쪽이 이긴다.
   */
  useEffect(() => {
    const card = formRef.current?.parentElement;
    const owned = trigger instanceof HTMLElement && card?.contains(trigger) === true;
    const orphan = !(trigger instanceof HTMLElement) || isFocusNowhere(trigger);

    if (owned || orphan) titleRef.current?.focus({ preventScroll: true });

    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  /**
   * 저장이 **실패해 잠금이 풀린 순간** 포커스를 저장 버튼으로 돌려준다.
   *
   * 저장 중에는 두 버튼이 잠기는데 브라우저는 **잠긴 요소에서 포커스를 떼어** 문서 뿌리로
   * 보낸다. 저장을 눌러 실패한 사용자는 고치던 값이 그대로 남은 폼을 보면서도 포커스는 카드
   * 밖에 있어, 다시 시도하려면 화면 맨 앞에서 Tab 으로 걸어와야 한다 — 실패 문구를 읽고 곧바로
   * 다시 누를 수 있어야 하는 자리다(J3 DeleteConfirm 이 실패 경로에서 `취소` 로 되돌리는 것과
   * 같은 처방이고, 받는 쪽만 다르다: 여기는 되돌릴 수 없는 동작을 묻는 자리가 아니라 **재시도할
   * 컨트롤**인 저장이 맞다).
   *
   * 가드가 둘이다.
   *
   * 1. **잠금이 풀린 그 순간에만** 움직인다(`wasSaving`). 마운트 때도 `saving` 은 false 라,
   *    전이를 보지 않으면 남의 카드에서 열린 폼(위 `owned` 가 거르는 경우)이 포커스를 채 간다.
   * 2. 그때도 포커스가 정말 떨어져 있을 때만 가져온다. 이름 칸에서 Enter 로 저장한 사용자의
   *    포커스는 입력이 `readOnly` 라 그 자리에 남아 있는데, 뺏으면 고치던 곳을 잃는다.
   */
  const wasSaving = useRef(false);

  useEffect(() => {
    const before = wasSaving.current;
    wasSaving.current = saving;

    if (saving || !before) return;
    if (!isFocusNowhere(document.activeElement)) return;

    saveRef.current?.focus({ preventScroll: true });
  }, [saving]);

  /**
   * **바뀐 키만** 담는다. `updateBookmark` 는 준 키만 쓰므로(BookmarkPatch), 건드리지 않은
   * 필드를 굳이 실어 보내면 그 사이 다른 창이 고친 값을 우리가 읽어 온 옛 값으로 되돌린다.
   * 그래서 비교 상대는 지금 prop 이 아니라 위 `baseline` 이다.
   *
   * 다듬은 값끼리 비교하는 것은 액션도 `asText` 로 다듬어 저장하기 때문이다 — 공백만 더 찍은
   * 입력을 '바뀌었다'고 보면 서버에 가서 같은 값을 다시 쓰게 된다.
   */
  function buildPatch(): BookmarkPatch {
    const patch: BookmarkPatch = {};
    const nextTitle = title.trim();
    const nextDescription = description.trim();

    if (nextTitle !== baseline.title.trim()) patch.title = nextTitle;
    if (nextDescription !== (baseline.description ?? '').trim()) patch.description = nextDescription;

    return patch;
  }

  /**
   * 저장. 빈 이름을 여기서 막지 않는 것은 의도다 — 사용자에게 보일 문구는 액션이 한곳에서
   * 정하고(`이름을 입력하세요.`), 화면은 결과만 표시한다. 문구를 여기에 한 벌 더 적으면
   * 둘이 조용히 갈라진다.
   */
  async function save(): Promise<void> {
    if (sending.current) return;

    const patch = buildPatch();
    // 바뀐 것이 없으면 서버까지 가지 않는다. 액션은 이런 요청에 '수정할 내용이 없습니다.' 를
    // 돌려주는데, 아무것도 고치지 않고 저장을 누른 사람에게는 오류가 아니라 그냥 닫히는 것이 맞다.
    // (여기는 트랜지션이 필요 없다 — 기다릴 새 데이터가 없다. 아래 성공 경로 참조.)
    if (Object.keys(patch).length === 0) {
      onDone();

      return;
    }

    sending.current = true;
    setSaving(true);

    let result: ActionResult;
    try {
      result = await updateBookmark(baseline.id, patch);
    } catch (error) {
      // 액션이 **거부로 끝난** 경우다 — 네트워크 단절로 fetch 자체가 실패했거나, 배포로 액션 id 가
      // 바뀌어 요청이 더는 닿지 않는 상황. 잡지 않으면 이 함수가 거부로 끝나 빗장도 `saving` 도
      // 선 채로 남는다: 버튼 둘과 Esc 가 전부 잠기고 나갈 길이 새로고침뿐인 폼이 된다.
      // 진단은 로그로만 남기고(사용자에게 보일 문장이 아니다) 다시 시도할 수 있게 빗장을 푼다.
      console.error('[InlineEdit] 링크 수정 요청이 거부됐다', error);
      sending.current = false;
      setSaving(false);
      toast(REQUEST_FAILED);

      return;
    }

    if (result.ok) {
      // 폼이 닫히는 것과 새 데이터가 그려지는 것을 **한 커밋으로 묶는다.** `await` 뒤의 상태 갱신은
      // 저절로 트랜지션에 들어가지 않는다(React 의 알려진 한계 — Next `interactive-apps.md` Step 6 이
      // 이 우회를 권한다). 그냥 부르면 폼이 먼저 닫히고, 액션의 revalidatePath 로 새 값이 도착하기
      // 전까지 카드에 **옛 이름이 한 프레임 스친다.**
      //
      // 그때까지 빗장(`sending`)도 잠긴 모습(`saving`)도 그대로 둔다 — 닫힘이 새 데이터와 같은
      // 커밋에 묶일 때까지 폼은 아직 화면에 있으므로, 여기서 되돌리면 그 지연 구간이 두 번째
      // 제출을 받는 창이 된다. 되돌리지 않아도 되는 이유는 `onDone` 이 이 폼을 언마운트하기
      // 때문이다(`onDone` JSDoc 의 계약).
      startTransition(() => {
        onDone();
      });

      return;
    }

    // 실패했으니 다시 누를 수 있어야 한다 — 빗장과 잠긴 모습을 함께 되돌린다.
    sending.current = false;
    setSaving(false);
    toast(result.error);
  }

  /**
   * 폼 제출 = 저장 버튼 클릭 + **입력에서 Enter**(HTML 암묵적 제출).
   *
   * Enter 를 keydown 으로 직접 듣지 않는 이유는 조합 입력(IME)이다 — 한글을 확정하는 Enter 로
   * 저장이 일어나면 안 되는데, 브라우저는 조합 중 Enter 를 제출로 바꾸지 않는다. 그 판정을
   * 우리가 다시 구현하지 않고 그대로 쓴다.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    void save();
  }

  /**
   * Esc 취소 (DESIGN_SPEC 2-1). 저장 중에는 듣지 않는다 — 요청은 이미 떠났으므로 여기서 닫으면
   * '취소했는데 값이 바뀌어 있는' 화면이 된다. 실패했을 때 문구를 보여 줄 폼도 사라진다.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape' || saving) return;

    onDone();
  }

  return (
    <form
      ref={formRef}
      // 카드마다 폼이 하나씩 열릴 수 있으므로 어느 링크의 폼인지 이름에 담는다
      // (카드 액션 버튼의 `${title} 수정`·`${title} 삭제` 와 같은 방식).
      //
      // 낱말은 **'수정' 하나다.** 이 폼을 여는 연필의 이름이 `${title} 수정` 이고(LinkCard),
      // 같은 것을 가리키는 두 이름이 갈리면 화면을 볼 수 없는 사용자는 방금 연필로 연 것이 이
      // 폼인지 알 수 없다. 원조 관례가 연필 쪽이라 폼을 그리로 맞췄다 — J2 시점에는 LinkCard 가
      // 다른 트랙의 파일이라 '편집' 으로 두고 이월했던 것이다.
      aria-label={`${bookmark.title} 수정`}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="mt-auto flex flex-col gap-[5px]"
    >
      {/* placeholder 는 프로토타입 원문이고, 접근성 이름은 따로 준다 — placeholder 는 값을 입력하면
          사라져 이름 역할을 하지 못한다. 카드 폭이 좁아 눈에 보이는 라벨 줄은 두지 않는다.

          저장 중 잠금이 `disabled` 가 아니라 `readOnly` 인 것은 포커스 때문이다 — 브라우저는
          disabled 가 된 요소에서 포커스를 떼어 `<body>` 로 보낸다. Enter 로 저장한 사용자의
          포커스가 그 순간 카드 밖으로 튀고, 실패해서 폼이 남아도 이어 고칠 자리를 잃는다.
          readOnly 는 값만 잠그고 포커스·선택·복사는 그대로 둔다. */}
      <input
        ref={titleRef}
        aria-label="이름"
        placeholder="이름"
        value={title}
        readOnly={saving}
        onChange={(event) => setTitle(event.target.value)}
        className={TITLE_FIELD}
      />
      <input
        aria-label="한 줄 설명"
        placeholder="한 줄 설명"
        value={description}
        readOnly={saving}
        onChange={(event) => setDescription(event.target.value)}
        className={DESC_FIELD}
      />

      <div className="flex gap-[5px]">
        {/* `aria-busy` 는 '눌렀고 지금 처리 중'을 보조 기술에도 알린다 — 흐려지는 모습만으로는
            화면을 볼 수 없는 사용자에게 아무 일도 일어나지 않은 것과 같다(LoginForm 과 같은 짝). */}
        <button ref={saveRef} type="submit" disabled={saving} aria-busy={saving} className={SAVE}>
          저장
        </button>
        {/* `type="button"` 이어야 한다 — 폼 안의 버튼 기본값은 submit 이라 그대로 두면 취소가 저장이 된다. */}
        <button type="button" disabled={saving} onClick={() => onDone()} className={CANCEL}>
          취소
        </button>
      </div>
    </form>
  );
}
