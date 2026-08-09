'use client';

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useSelectedCategory, type AdminCategory } from '@/components/admin/CategoryPanel';
import { toast } from '@/components/Toast';
import { REQUEST_FAILED } from '@/lib/constants';
import { isFocusNowhere } from '@/lib/focus';
import { deleteCategory, renameCategory, type ActionResult } from '@/lib/mutations';
import { rendersSomething } from '@/lib/slots';

/** 헤더 줄 — 프로토타입 원문 `display:flex; align-items:center; gap:12px; padding:14px 16px`. */
const ROW = 'flex items-center gap-[12px] px-[16px] py-[14px]';

/**
 * 줄 오른쪽의 글자 버튼들 — 11.5px. 색만 서로 다르다(프로토타입 334–335행).
 *
 * `cursor-pointer` 는 프로토타입 원문 그대로다(`cursor:pointer` — 그쪽은 `<span>` 이라 반드시
 * 필요했다). 우리는 `<button>` 이지만 Tailwind v4 의 preflight 에는 버튼 커서 규칙이 없고
 * 브라우저 기본값이 `default` 라, 적지 않으면 글자 버튼 위에서 화살표로 남는다 — 눌리는 곳이라는
 * 신호가 색밖에 없는 자리다. 잠긴 동안에는 되돌린다(J2 InlineEdit·J3 DeleteConfirm 과 같은 관례).
 */
const LINK_BUTTON = 'flex-none cursor-pointer text-[11.5px] disabled:cursor-default';
/** 검은 확정 버튼(저장·삭제) — 높이 30px, 라운드 6px. 커서 규칙은 위와 같다(프로토타입 333행). */
const SOLID_BUTTON =
  'flex h-[30px] flex-none cursor-pointer items-center rounded-[6px] px-[12px] text-[11.5px] font-semibold text-white disabled:cursor-default disabled:opacity-60';

/**
 * 우측 헤더 패널 — DESIGN_SPEC 6장 "헤더 패널".
 *
 * 선택한 상위 카테고리 한 줄이다. 이름·링크 수를 보여 주고, 이름을 **그 자리에서** 고치고
 * (`renameCategory`), 비어 있는 카테고리를 지운다(`deleteCategory`). 어느 카테고리인지는
 * prop 이 아니라 좌측 패널과 공유하는 선택 상태에서 온다(`useSelectedCategory`).
 *
 * ## 상자를 이 컴포넌트가 갖는다 (I2 와의 계약)
 *
 * 프로토타입에서 흰 패널 하나가 **헤더 줄 + 하위 줄**을 함께 담는다(324–357행). 그래서 상자는
 * 여기 있고, 하위 줄(I2)은 `children` 으로 들어와 같은 상자 안 헤더 줄 **아래**에 붙는다.
 * 헤더 줄의 아래 구분선은 그 아래에 무언가 붙을 때만 그린다 — 혼자 있을 때는 상자 테두리 바로
 * 안쪽에 선이 하나 더 그어져 보인다.
 *
 * 링크 추가 줄(I3)·링크 표(I4)는 이 상자가 아니라 **다음 상자**다(프로토타입 359행부터) —
 * 화면(app/admin/page.tsx)이 이 패널 다음에 나란히 세운다.
 */
export function CategoryHeader({ children }: { children?: ReactNode }) {
  const { selected } = useSelectedCategory();

  /**
   * 아래에 줄이 붙는가 — 헤더 줄에 구분선을 그릴지 정한다. 혼자 있을 때 그으면 상자 테두리
   * 바로 안쪽에 아무것도 나누지 않는 선이 하나 더 생긴다.
   *
   * 기준은 **React 가 실제로 무언가를 그리는가**이고, 그 판정과 근거(왜 boolean·`''` 까지
   * '없음'인지, 무엇을 쫓지 않는지)는 `lib/slots.ts` 한곳에 있다.
   *
   * 지금 유일한 소비자(app/admin/page.tsx)가 넘기는 `<SubCategoryRow>` 는 상위가 없을 때 null 을
   * 돌려주는데(그 판정은 prop 으로는 보이지 않는다), 그 경우는 아래 M6 갈래가 children 자체를
   * 그리지 않아 여기까지 오지 않는다.
   */
  const hasRowsBelow = rendersSomething(children);

  return (
    <section
      aria-label="선택한 카테고리"
      className="mb-[14px] overflow-hidden rounded-[9px] border border-border bg-card"
    >
      {selected === null ? (
        /* 프로토타입에는 없는 상태다(항상 카테고리가 있었다). 이름 자리가 통째로 비면
           고장으로 보이므로 무엇을 하면 되는지 한 줄로 알린다. 가리키는 자리는 방향("왼쪽")이
           아니라 **패널 이름**이다 — <820px 에서는 그 패널이 왼쪽이 아니라 위에 있다.

           이때 children 은 **그리지 않는다.** 아래 줄들이 다루는 대상은 선택된 상위 카테고리인데
           그것이 없고(하위 줄은 그 상황에서 스스로 null 을 돌려준다 — I2), 안내 문구 줄은
           구분선을 갖지 않으므로 무언가 붙으면 선 없이 맞붙은 두 줄이 된다. */
        <p className={`${ROW} text-[12px] text-fainter`}>
          카테고리가 없습니다. ‘상위 카테고리’에서 먼저 추가하세요.
        </p>
      ) : (
        <>
          {/* `key` 가 이 줄의 상태를 카테고리마다 새로 시작하게 한다 — 고치던 이름·삭제 확인이
              다음 선택으로 새어 나가면 엉뚱한 카테고리를 그 이름으로 바꾸게 된다. */}
          <HeaderRow key={selected.id} category={selected} divided={hasRowsBelow} />
          {children}
        </>
      )}
    </section>
  );
}

/** 헤더 줄의 세 갈래. 한 번에 하나만 보이므로 boolean 두 개가 아니라 값 하나로 든다. */
type Mode = 'view' | 'rename' | 'confirm';

/**
 * 선택된 카테고리 한 줄. 바깥에서 `key={category.id}` 로 다시 마운트하므로 여기서는
 * "선택이 바뀌면 상태를 되돌린다"를 신경 쓰지 않는다.
 */
function HeaderRow({ category, divided }: { category: AdminCategory; divided: boolean }) {
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState(category.name);
  /** 서버 왕복 중 — 버튼들을 잠그는 **보이는** 상태다. */
  const [busy, setBusy] = useState(false);
  /**
   * 같은 것을 가리키는 **빗장**. 상태 하나로 겸하지 않는 이유는 React 의 일괄 처리다 — 한 틱 안에
   * 제출(또는 삭제 클릭) 둘이 들어오면 둘 다 같은 렌더의 클로저를 보므로 `busy` 는 아직 false 이고,
   * 화면도 다시 그려지기 전이라 `disabled` 도 걸리지 않았다. 그 사이로 나간 두 번째 삭제 요청은
   * "카테고리를 찾을 수 없습니다."로 돌아와 **지워 놓고 실패를 말하는** 화면이 된다. ref 는 그
   * 자리에서 바뀌므로 같은 틱의 두 번째 호출이 곧바로 막힌다(J3 DeleteConfirm 의 `sending`).
   */
  const sending = useRef(false);

  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  /** 실패로 잠금이 풀렸을 때 포커스를 돌려줄 두 자리 — 각 갈래에서 **다시 누를** 버튼이다. */
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);
  /** 직전 갈래. 보기 줄로 **어디서** 돌아왔는지가 포커스를 돌려줄 버튼을 정한다. */
  const cameFrom = useRef<Mode>(mode);

  /**
   * 갈래가 바뀔 때 포커스를 옮긴다 — 사라진 버튼에 얹혀 있던 포커스는 `<body>` 로 떨어지고,
   * 키보드 사용자는 화면 맨 앞에서 이 줄까지 다시 걸어와야 한다.
   *
   * - `rename`·`confirm` 을 열면 그것을 연 버튼이 그 자리에서 사라진다(같은 자리에 다른 것이
   *   들어선다). 여는 쪽 포커스는 `rename` 이면 입력의 `autoFocus` 가, `confirm` 이면 아래
   *   `취소` 가 받는다 — **되돌릴 수 없는 동작을 묻는 자리라 기본 포커스는 덜 위험한 쪽**이다
   *   (WAI-ARIA APG alertdialog · J3 DeleteConfirm 과 같은 판단). '카테고리 삭제'를 누른 직후의
   *   Enter 한 번이 그대로 삭제가 되면 확인을 거치게 한 의미가 없다.
   * - 보기 줄로 돌아올 때(취소 · Esc · 저장 성공 · 삭제 응답)는 **그 갈래를 연 버튼**으로
   *   돌려준다. 나갔던 자리로 돌아오는 것이 사람이 기억하는 위치다.
   *
   * 되돌릴 때 `null` 과 `isConnected` 를 **함께** 보는 것은 삭제 성공 경로 때문이다 — 그때는
   * 카테고리가 목록에서 빠져 이 줄이 통째로 사라진다. 언마운트된 버튼의 ref 는 React 가 null 로
   * 되돌리므로 대개 앞엣것에서 걸리고, `isConnected` 는 ref 가 아직 살아 있는데 노드만 문서에서
   * 떨어진 창을 막는 두 번째 그물이다(J3 DeleteConfirm 은 트리거가 남의 컴포넌트 것이라 그쪽이
   * 유일한 그물이다). 떨어져 나간 노드에 `focus()` 를 불러 봐야 포커스는 문서 뿌리로 간다.
   */
  useEffect(() => {
    const from = cameFrom.current;
    cameFrom.current = mode;
    // 마운트 직후에는 아무것도 하지 않는다 — 선택이 바뀌면 이 줄은 `key` 로 **다시 마운트**되므로
    // (바깥 CategoryHeader), 여기서 포커스를 잡으면 좌측 패널에서 카테고리를 고를 때마다 포커스가
    // 방금 누른 그 행에서 이 줄로 끌려온다.
    if (from === mode) return;

    if (mode === 'confirm') {
      cancelDeleteRef.current?.focus();

      return;
    }

    if (mode !== 'view') return;

    const trigger = from === 'rename' ? renameButtonRef.current : deleteButtonRef.current;
    if (trigger !== null && trigger.isConnected) trigger.focus();
  }, [mode]);

  /**
   * 요청이 **실패해 잠금이 풀린 순간** 포커스를 다시 누를 버튼으로 돌려준다.
   *
   * 잠긴 동안 브라우저는 **잠긴 요소에서 포커스를 떼어** 문서 뿌리로 보낸다. 저장이나 삭제를
   * 눌러 실패한 사용자는 줄이 그대로 남았는데도 포커스가 여기에 없어, 다시 시도하려면 화면 맨
   * 앞에서 Tab 으로 걸어와야 한다(J3 DeleteConfirm·J2 InlineEdit 과 같은 처방 — 받는 쪽만 다르다).
   *
   * 위 갈래 effect 와 나눠 두는 이유는 **갈래가 바뀌지 않는 실패**를 다루기 때문이다. 서버가
   * 답한 삭제 거절은 확인 줄을 걷으므로(`remove`) 갈래가 `view` 로 바뀌어 위쪽이 처리하고,
   * 여기서 남는 것은 이름 저장 실패·거부와 삭제 요청 거부 — 갈래가 그대로인 셋이다.
   *
   * 가드가 둘이다.
   *
   * 1. **잠금이 풀린 그 순간에만** 움직인다(`wasBusy`). 전이를 보지 않으면 `rename`·`confirm`
   *    으로 갓 들어선 커밋(그때도 `busy` 는 false 다)에서 이 effect 가 먼저 돌아, 입력의
   *    `autoFocus` 나 위 effect 가 `취소` 에 준 포커스를 뺏는다.
   * 2. 그때도 포커스가 정말 떨어져 있을 때만 가져온다 — 이름 칸에서 Enter 로 저장한 사용자의
   *    포커스는 입력에 그대로 남아 있는데, 뺏으면 이어 고칠 자리를 잃는다.
   */
  const wasBusy = useRef(false);

  useEffect(() => {
    const before = wasBusy.current;
    wasBusy.current = busy;

    if (busy || !before) return;
    if (!isFocusNowhere(document.activeElement)) return;

    if (mode === 'rename') saveButtonRef.current?.focus();
    else if (mode === 'confirm') confirmDeleteRef.current?.focus();
  }, [busy, mode]);

  const rowClass = `${ROW} ${divided ? 'border-b border-line' : ''}`;

  async function save(): Promise<void> {
    if (sending.current) return;

    const cleanName = draft.trim();
    // 바뀐 것이 없으면 서버까지 가지 않는다 — 액션은 이런 요청도 성공으로 처리하지만,
    // 고치지 않고 저장을 누른 사람에게는 그냥 닫히는 것이 맞다.
    // (여기는 트랜지션이 필요 없다 — 기다릴 새 데이터가 없다. 아래 성공 경로 참조.)
    if (cleanName === category.name.trim()) {
      setMode('view');

      return;
    }

    // 빈 이름을 여기서 막지 않는 것은 의도다 — 사용자에게 보일 문구는 액션이 한곳에서 정한다
    // (`이름을 입력하세요.`). 화면이 한 벌 더 적으면 둘이 조용히 갈라진다.
    sending.current = true;
    setBusy(true);

    let result: ActionResult;
    try {
      result = await renameCategory(category.id, cleanName);
    } catch (error) {
      // 액션이 **거부로 끝난** 경우다 — 네트워크가 끊겼거나 배포로 액션 id 가 바뀌어 요청이 더는
      // 닿지 않는 상황. 잡지 않으면 이 함수가 거부로 끝나 빗장도 잠긴 버튼도 선 채 남는다:
      // 저장·취소·Esc 가 전부 막혀 나갈 길이 새로고침뿐인 줄이 된다. 진단은 로그로만 남기고
      // (사용자에게 보일 문장이 아니다) 고치던 이름은 그대로 둔 채 다시 시도할 수 있게 되돌린다.
      console.error('[CategoryHeader] 카테고리 이름 수정 요청이 거부됐다', error);
      sending.current = false;
      setBusy(false);
      toast(REQUEST_FAILED);

      return;
    }

    sending.current = false;

    if (!result.ok) {
      // 고치던 이름을 그대로 둔다 — 거절 사유를 보고 이어서 고칠 값이다.
      setBusy(false);
      toast(result.error);

      return;
    }

    // 닫힘을 **새 데이터와 한 커밋으로 묶는다.** `await` 뒤의 상태 갱신은 저절로 트랜지션에
    // 들어가지 않는다(React 의 알려진 한계 — Next `interactive-apps.md` Step 6 이 이 우회를
    // 권한다). 그냥 닫으면 액션의 revalidatePath 로 새 이름이 도착하기 전까지 이 줄에 **옛 이름이
    // 한 프레임 스친다**(I2 SubCategoryRow 와 같은 처리). 잠긴 모습(`busy`)도 같은 커밋까지
    // 끌고 간다 — 버튼만 먼저 열리면 그 구간이 같은 값을 한 번 더 낼 수 있는 창이 된다.
    startTransition(() => {
      setBusy(false);
      setMode('view');
    });
    // 토스트는 트랜지션 **밖**이다 — React 상태를 건드리지 않는 곁가지라 함께 묶을 커밋이 없다
    // (Next `interactive-apps.md`: side effects don't need a transition).
    toast(`${category.name} → ${cleanName}으로 바꿈`);
  }

  async function remove(): Promise<void> {
    if (sending.current) return;

    sending.current = true;
    setBusy(true);

    let result: ActionResult;
    try {
      result = await deleteCategory(category.id);
    } catch (error) {
      // 요청이 **닿지도 않은** 경우다(위 `save` 와 같은 사정). 확인 줄은 이때만 걷지 않는다 —
      // 서버가 판단한 결과가 아니므로 같은 자리에서 그대로 다시 누르는 것이 맞다.
      console.error('[CategoryHeader] 카테고리 삭제 요청이 거부됐다', error);
      sending.current = false;
      setBusy(false);
      toast(REQUEST_FAILED);

      return;
    }

    sending.current = false;
    // 성공이든 (서버가 준) 실패든 확인 줄은 걷는다. 실패는 "하위를 먼저 지워라"·"링크가 남아
    // 있다" 같은 **다른 화면에서 할 일**이라, 같은 자리에서 다시 누르게 두면 같은 거절만 반복된다.
    // 닫힘을 트랜지션에 넣는 이유는 위 `save` 와 같다 — 성공 경로에서 이 줄은 새 데이터가
    // 도착하며 사라지므로, 그 전에 먼저 닫으면 지워진 카테고리의 보기 줄이 한 프레임 보인다.
    startTransition(() => {
      setBusy(false);
      setMode('view');
    });

    toast(result.ok ? `${category.name} 카테고리 삭제됨` : result.error);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    void save();
  }

  /**
   * Esc 취소. 저장 중에는 듣지 않는다 — 요청은 이미 떠났으므로 여기서 닫으면 '취소했는데 이름이
   * 바뀌어 있는' 화면이 된다(J2 InlineEdit 과 같은 판단).
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape' || sending.current) return;

    setMode('view');
  }

  if (mode === 'rename') {
    return (
      /* Enter 로 저장되는 것은 폼의 암묵적 제출이다 — 조합 입력(IME) 확정 Enter 를 저장으로
         오해하지 않는 판정을 브라우저에 맡긴다. */
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className={rowClass}>
        {/* `autoFocus` 는 사람이 '이름 수정'을 눌러 연 입력이라 정당하다 — 초점이 여기로 오는 것이
            그 클릭의 뜻이고, 방금 사라진 '이름 수정' 버튼에 초점이 남으면 키보드 사용자는 갈 곳을
            잃는다. 화면이 바뀌지 않는 인라인 편집이라 초점이 멀리 튀지도 않는다. */}
        <input
          autoFocus
          aria-label="카테고리 이름"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="h-[34px] w-[240px] flex-none rounded-[6px] border-[1.5px] border-ink bg-card px-[10px] text-[15px] font-bold text-ink"
        />
        {/* `aria-busy` 는 '눌렀고 지금 처리 중'을 보조 기술에도 알린다 — 흐려지는 모습만으로는
            화면을 볼 수 없는 사용자에게 아무 일도 일어나지 않은 것과 같다(J2 InlineEdit·I3
            LinkAddRow·LoginForm 과 같은 짝). 짝인 `취소` 에는 붙이지 않는다: 도는 요청은 저장
            하나이고, 취소는 그 요청의 주인이 아니라 그동안 잠겨 있을 뿐이다. */}
        <button
          ref={saveButtonRef}
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className={`${SOLID_BUTTON} bg-ink`}
        >
          저장
        </button>
        {/* `type="button"` 이어야 한다 — 폼 안의 버튼 기본값은 submit 이라 그대로 두면 취소가 저장이 된다. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode('view')}
          className={`${LINK_BUTTON} text-faint hover:text-ink`}
        >
          취소
        </button>
      </form>
    );
  }

  return (
    <div className={rowClass}>
      <span className="text-[16px] font-bold tracking-[-0.01em] text-ink">{category.name}</span>

      {mode === 'confirm' ? (
        <>
          {/* 누른 뒤에 나타나는 안내라 스크린 리더가 그 자리에서 읽어야 한다.
              문구가 "지우려면 비워라" 규칙(lib/mutations.ts deleteCategory)을 미리 알려 준다 —
              하위나 링크가 남아 있으면 서버가 거절하고, 그 이유는 토스트로 온다. */}
          <p role="alert" className="text-[11.5px] text-desc">
            비어 있는 카테고리만 삭제됩니다. 삭제할까요?
          </p>
          {/* 위 `저장` 과 같은 짝 — 도는 요청의 주인에게만 `aria-busy` 를 붙인다. */}
          <button
            ref={confirmDeleteRef}
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void remove()}
            className={`${SOLID_BUTTON} ml-auto bg-danger`}
          >
            삭제
          </button>
          <button
            ref={cancelDeleteRef}
            type="button"
            disabled={busy}
            onClick={() => setMode('view')}
            className={`${LINK_BUTTON} text-faint hover:text-ink`}
          >
            취소
          </button>
        </>
      ) : (
        <>
          <span className="text-[11.5px] text-fainter">{category.linkCount}개 링크</span>
          <button
            ref={renameButtonRef}
            type="button"
            onClick={() => setMode('rename')}
            className={`${LINK_BUTTON} ml-auto text-sub hover:text-ink`}
          >
            이름 수정
          </button>
          <button
            ref={deleteButtonRef}
            type="button"
            onClick={() => setMode('confirm')}
            className={`${LINK_BUTTON} text-faint hover:text-danger`}
          >
            카테고리 삭제
          </button>
        </>
      )}
    </div>
  );
}
