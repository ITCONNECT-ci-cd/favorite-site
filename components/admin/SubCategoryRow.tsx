'use client';

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { useSelectedCategory, type AdminCategory } from '@/components/admin/CategoryPanel';
import { toast } from '@/components/Toast';
import {
  createSubCategory,
  deleteSubCategory,
  renameSubCategory,
  type ActionResult,
} from '@/lib/mutations';

/**
 * 하위 줄이 그리는 칩 하나.
 *
 * **화면이 쓸 만큼만 담는다** — 상위 목록과 같은 방침이다(CategoryPanel `AdminCategory`).
 * 개수는 그 하위에 직접 달린 링크 수다. 하위 아래에는 아무것도 없으므로(2단계 제약)
 * `rollupCounts` 의 "직속 + 하위"와 같은 값이 된다.
 */
export type AdminSubCategory = {
  id: string;
  name: string;
  /** 이 하위에 속한 링크 수. 지울 때 상위로 올라갈 링크 수이기도 하다. */
  linkCount: number;
};

/**
 * 상위 카테고리 id → 그 아래 하위 목록. 화면(app/admin/page.tsx)이 서버에서 접어 넘긴다.
 *
 * **선택한 상위 것만 넘길 수는 없다** — 선택은 클라이언트 상태라 서버가 모른다(CategoryPanel
 * `SelectedCategoryProvider` JSDoc). 그래서 전부 넘기되, 넘어가는 것은 하위 이름과 개수뿐이다
 * (290행짜리 북마크 배열은 여전히 내려가지 않는다).
 */
export type SubCategoryMap = Readonly<Record<string, readonly AdminSubCategory[]>>;

/** 하위가 없는 상위에서 매 렌더 새 배열을 만들지 않기 위한 자리. */
const NO_SUBS: readonly AdminSubCategory[] = [];

/**
 * 요청 자체가 **거부됐을 때** 보여 줄 문구.
 *
 * `lib/mutations.ts` 의 `RETRY_LATER` 와 같은 문장을 일부러 한 벌 더 적었다. 그 파일은
 * `'use server'` 라 상수를 내보낼 수 없다(export 는 전부 async 함수여야 한다). 저쪽 문구를
 * 고치면 여기도 함께 고쳐라 — `components/card/InlineEdit.tsx` 도 같은 사정으로 한 벌 갖고 있다.
 */
const REQUEST_FAILED = '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 줄 — 프로토타입 원문 `display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:12px 16px; background:#faf9f7`. */
const ROW = 'flex flex-wrap items-center gap-[8px] bg-toolbar px-[16px] py-[12px]';
/** "하위" 라벨 — 11px `#9a9791`, 폭 34px 고정(칩들의 시작선을 맞춘다). */
const LABEL = 'w-[34px] flex-none text-[11px] text-fainter';
/** 칩 — 높이 28px, 라운드 7px, 흰 배경 + `#e3dfd9` 테두리, 안쪽 gap 7px. */
const CHIP = 'flex h-[28px] items-center gap-[7px] rounded-[7px] border border-border bg-card px-[9px]';
/**
 * 칩 안의 글자 버튼 — 11px. 색만 서로 다르다(프로토타입 349–350행).
 *
 * 손가락 커서와 잠긴 모습은 프로토타입에 없다. 프로토타입의 수정·삭제는 즉시 끝나는 로컬 상태였지만
 * 여기서는 서버 왕복이라 '누른 것이 먹었는지' 알 수 없는 구간이 생긴다 — 흐리게 + 커서 되돌리기로
 * 그 구간을 보이게만 한다(J2 InlineEdit·J3 DeleteConfirm 의 버튼 몸통과 같은 처리).
 */
const CHIP_BUTTON = 'cursor-pointer text-[11px] disabled:cursor-default disabled:opacity-60';
/** 이름 수정 입력 — 110×20px, 라운드 4px, 테두리 1px `#141516`. */
const NAME_FIELD = 'h-[20px] w-[110px] rounded-[4px] border border-ink bg-card px-[6px] text-[11.5px] text-ink';
/** 새 하위 입력 — 130×28px, 라운드 7px, 테두리 `#ddd8d1`. */
const ADD_FIELD =
  'h-[28px] w-[130px] flex-none rounded-[7px] border border-border-strong bg-card px-[9px] text-[11.5px] text-ink';
/** 추가 버튼 — 28px, 라운드 7px, 배경 `#e4e0d8`(호버 `#d8d3cb`). 헤더의 검은 버튼과 달리 회색이다. */
const ADD_BUTTON =
  'flex h-[28px] flex-none cursor-pointer items-center rounded-[7px] bg-select px-[11px] text-[11.5px] font-semibold text-ink hover:bg-dash disabled:cursor-default disabled:opacity-60';

/**
 * 하위 카테고리 줄 — DESIGN_SPEC 6장 "하위 줄", 프로토타입 338–356행.
 *
 * 선택한 상위 카테고리의 하위를 칩으로 늘어놓고, 그 자리에서 이름을 고치고(`renameSubCategory`),
 * 지우고(`deleteSubCategory`), 새로 만든다(`createSubCategory`). 어느 상위인지는 prop 이 아니라
 * 좌측 패널과 공유하는 선택 상태에서 온다(`useSelectedCategory`).
 *
 * ## 자리 — 헤더 패널 **안**이다
 *
 * 프로토타입에서 흰 상자 하나가 헤더 줄과 이 줄을 함께 담는다. 그래서 이 컴포넌트는 상자를 만들지
 * 않고 `<CategoryHeader>` 의 children 으로 들어간다(그쪽 JSDoc "I2 와의 계약") — 헤더 줄과 이 줄
 * 사이의 구분선은 CategoryHeader 가 그린다.
 *
 * ## 카테고리는 2단계까지 (I2 시스템 제약)
 *
 * 이 줄에는 **추가 진입점이 하나뿐**이고, 그 하나는 칩 **밖**에 있다. 칩 안에서 열리는 것은 이름
 * 수정과 삭제 확인뿐이라 "하위의 하위"를 만들 길이 화면에 없다. 그리고 추가는 언제나
 * `selected.id` 로 나가는데, 그 선택은 상위만 담긴 목록에서 나온다(CategoryPanel `AdminCategory`).
 * 서버도 같은 것을 막는다(`createSubCategory` 의 깊이 검사) — 액션은 공개 엔드포인트라 화면만
 * 막아서는 부족하고, 화면만 열려 있으면 사람이 서버 거절 문구를 보게 되므로 양쪽에 다 있다.
 *
 * ## 서버와의 계약
 *
 * 세 액션을 직접 부른다(`lib/mutations.ts`). 인자가 positional 이라 `<form action>` 에 그대로 걸
 * 수 없고, 돌아오는 `{ ok:false, error }` 의 `error` 는 **그대로 토스트에 넣는다** — 화면이 문구를
 * 다시 적으면 서버와 조용히 갈라진다(I1·J2 와 같은 방침). 삭제할 때 소속 링크를 상위로 올리는 것도
 * 서버 몫이다(`deleteSubCategory` — 재배속 후 삭제 순서까지 그쪽이 지킨다).
 */
export function SubCategoryRow({ subsByCategory }: { subsByCategory: SubCategoryMap }) {
  const { selected } = useSelectedCategory();

  // 상위가 하나도 없으면 줄 자체가 없다 — 헤더가 "먼저 카테고리를 추가하세요"를 이미 알리고 있고,
  // 여기에 부모 없는 추가 입력을 남기면 눌러도 아무 데도 안 붙는 자리가 된다.
  if (selected === null) return null;

  /* `key` 가 이 줄의 상태를 상위마다 새로 시작하게 한다 — 고치던 이름·삭제 확인이 다음 선택으로
     새어 나가면 엉뚱한 하위를 그 이름으로 바꾸게 된다(CategoryHeader 와 같은 장치). */
  return (
    <Row key={selected.id} parent={selected} subs={subsByCategory[selected.id] ?? NO_SUBS} />
  );
}

/** 칩이 펼쳐지는 두 갈래. 보기(`null`)까지 세면 칩의 갈래는 셋이다. */
type ChipMode = 'rename' | 'confirm';

/**
 * 지금 펼쳐진 칩 하나. **한 번에 하나만** 열린다 — 프로토타입도 편집 상태를 화면에 하나만 든다
 * (`editCat`). 이름 수정과 삭제 확인이 값 하나를 나눠 쓰므로 둘은 서로를 자동으로 밀어낸다.
 */
type Active = { id: string; kind: ChipMode } | null;

/**
 * 액션 한 번 부르기 — **거부로 끝난 프라미스**를 실패 결과로 접는다.
 *
 * 네트워크가 끊겼거나 배포로 액션 id 가 바뀌면 `await` 가 거부로 끝난다. 잡지 않으면 호출한
 * 핸들러가 거기서 멈춰 빗장(`adding`·`busy`)이 선 채 남고, 그 줄은 새로고침 말고는 나갈 길이
 * 없어진다. 진단은 로그로만 남기고(사용자에게 보일 문장이 아니다) 다시 누를 수 있게 돌려준다.
 */
async function run(call: () => Promise<ActionResult>, what: string): Promise<ActionResult> {
  try {
    return await call();
  } catch (error) {
    console.error(`[SubCategoryRow] ${what} 요청이 거부됐다`, error);

    return { ok: false, error: REQUEST_FAILED };
  }
}

/**
 * 지울 때 알릴 문구. **링크가 있을 때만** 어디로 가는지 말한다.
 *
 * 프로토타입은 개수를 늘 실어 말하지만(`… 삭제 · 링크 0개는 상위로 올라감`), 옮길 링크가 없으면
 * 그 절은 아무것도 설명하지 못한다. 문장의 몫이 "사라진 게 아니라 상위로 갔다"를 알리는 것이라
 * 알릴 것이 없을 때는 뺀다.
 */
function movedNote(sub: AdminSubCategory): string {
  return sub.linkCount > 0 ? ` · 링크 ${sub.linkCount}개는 상위로 올라감` : '';
}

function Row({ parent, subs }: { parent: AdminCategory; subs: readonly AdminSubCategory[] }) {
  const [active, setActive] = useState<Active>(null);
  const [newName, setNewName] = useState('');
  /** 추가 요청이 나가 있는 동안 — 같은 이름이 두 번 들어가는 것을 막는 빗장이다. */
  const [adding, setAdding] = useState(false);
  /**
   * 펼친 칩의 서버 왕복 중 — 버튼들을 잠그고 Esc 를 막는 **보이는** 상태다(I1·J2 와 같은 계약).
   *
   * 잠그는 것은 펼친 칩만이 아니다. 남은 칩들의 `수정`·`×` 도 함께 잠긴다 — 칩 A 가 왕복하는
   * 동안 칩 B 의 수정을 열 수 있으면, A 가 끝나며 `active` 를 비울 때 B 의 입력이 치던 글자째
   * 사라진다(한 번에 하나만 여는 구조라 B 를 남겨 둘 자리가 없다).
   */
  const [busy, setBusy] = useState(false);
  /**
   * 같은 것을 가리키는 **빗장**. 상태 하나로 겸하지 않는 이유는 React 의 일괄 처리다 — 한 틱 안에
   * 제출(또는 삭제 클릭) 둘이 들어오면 둘 다 같은 렌더의 클로저를 보므로 `busy` 는 아직 false 이고,
   * 화면도 다시 그려지기 전이라 `disabled` 조차 걸리지 않았다. 그 사이로 나간 두 번째 요청은 같은
   * 이름을 한 번 더 쓰거나, 이미 지운 하위를 찾다가 "하위 카테고리를 찾을 수 없습니다."로 돌아와
   * **지워 놓고 실패를 말하는** 화면이 된다. ref 는 그 자리에서 바뀌므로 같은 틱의 두 번째 호출이
   * 곧바로 막힌다(I1 CategoryHeader·J3 DeleteConfirm 의 `sending` 과 같은 처리).
   */
  const sending = useRef(false);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (adding) return;

    // 빈 입력은 서버까지 가지 않는다(프로토타입 `if (!n) return`) — 아무것도 적지 않고 누른
    // 사람에게는 오류가 아니라 "아직 아무 일도 없음"이 맞다.
    const cleanName = newName.trim();
    if (cleanName === '') return;

    setAdding(true);
    const result = await run(() => createSubCategory(parent.id, cleanName), '하위 카테고리 추가');
    setAdding(false);

    if (!result.ok) {
      // 이름은 지우지 않는다 — 같은 이름이라 거절당했다면 고쳐서 다시 낼 값이다.
      toast(result.error);

      return;
    }

    setNewName('');
    toast(`${parent.name} → ${cleanName} 하위 카테고리 추가`);
  }

  /**
   * 두 겹으로 막는다 — 하나로는 각각 새는 창이 다르다.
   *
   * - `sending` 은 **같은 틱**을 막는다. 그 틱에는 `busy` 가 아직 false 다(위 JSDoc).
   * - `busy` 는 **커밋된 화면의 잠금**이다. 성공 경로는 닫힘을 트랜지션에 넣으므로, 응답이 온 뒤에도
   *   닫힘이 커밋될 때까지 이 값은 참으로 남는다 — 그 지연 창의 두 번째 제출을 여기서 막는다.
   */
  function locked(): boolean {
    return busy || sending.current;
  }

  async function rename(sub: AdminSubCategory, draft: string): Promise<void> {
    if (locked()) return;

    const cleanName = draft.trim();
    // 바뀐 것이 없으면 서버까지 가지 않는다 — 고치지 않고 저장을 누른 사람에게는 그냥 닫히는
    // 것이 맞다(프로토타입 `if (!n || n === oldName)`).
    if (cleanName === sub.name.trim()) {
      setActive(null);

      return;
    }

    // 빈 이름을 여기서 막지 않는 것은 의도다 — 사용자에게 보일 문구는 액션이 한곳에서 정한다
    // (`이름을 입력하세요.`). 화면이 한 벌 더 적으면 둘이 조용히 갈라진다(CategoryHeader 와 같은 판단).
    sending.current = true;
    setBusy(true);
    const result = await run(() => renameSubCategory(sub.id, cleanName), '하위 카테고리 이름 수정');

    if (!result.ok) {
      // 실패·거부 — 다시 누를 수 있어야 하므로 빗장과 잠긴 모습을 함께 되돌린다. 고치던 이름은
      // 그대로 둔다(거절 사유를 보고 이어서 고칠 값이다).
      sending.current = false;
      setBusy(false);
      toast(result.error);

      return;
    }

    // 성공 경로에서는 **잠금을 트랜지션 앞에서 풀지 않는다**(J2 InlineEdit 의 "성공 시 해제 금지").
    // 먼저 풀면 닫힘이 커밋되기 전 한 프레임 동안 `busy=false` + 폼이 열린 채인 중간 상태가 생기고,
    // 그 창으로 같은 rename 이 한 번 더 나간다.
    //
    // InlineEdit 은 폼 **자신이** 상태를 들고 언마운트되므로 되돌릴 것이 아예 없지만, 여기서는
    // 잠금이 사라지지 않는 **줄**에 있다 — 그대로 두면 남은 칩들이 영영 잠긴 채로 남으므로
    // '풀지 않는다' 대신 **닫힘과 같은 커밋에서 푼다**로 같은 것을 지킨다. 그래서 아래 두 갱신은
    // 반드시 한 트랜지션 안에 함께 있어야 한다.
    //
    // 트랜지션에 넣는 이유는 닫힘을 **새 데이터와 한 커밋으로 묶기** 위해서다. 그냥 닫으면 액션의
    // revalidatePath 로 새 이름이 도착하기 전까지 칩에 옛 이름이 한 프레임 스친다
    // (`await` 뒤의 상태 갱신은 저절로 트랜지션에 들어가지 않는다 — J2 품질 리뷰 이월).
    //
    // 빗장은 여기서 푼다. 같은 틱을 막는 것이 그 몫이고 그 틱은 이미 지났으며, 남은 지연 창은
    // 위 `locked` 의 `busy` 가 이어 막는다(그 값은 아래 커밋 전까지 참이다).
    sending.current = false;
    startTransition(() => {
      setBusy(false);
      setActive(null);
    });
    // 토스트는 트랜지션 **밖**이다 — React 상태를 건드리지 않는 곁가지라 함께 묶을 커밋이 없다
    // (Next `interactive-apps.md`: side effects don't need a transition).
    toast(`${sub.name} → ${cleanName}`);
  }

  async function remove(sub: AdminSubCategory): Promise<void> {
    if (locked()) return;

    sending.current = true;
    setBusy(true);
    const result = await run(() => deleteSubCategory(sub.id), '하위 카테고리 삭제');

    if (!result.ok) {
      // 실패해도 확인 줄은 **곧바로** 걷는다. 실패는 대개 화면이 옛 목록을 들고 있어서 나므로,
      // 같은 자리에서 다시 누르게 두면 같은 거절만 반복된다(CategoryHeader 와 같은 판단).
      // 여기는 기다릴 새 데이터가 없으니 트랜지션도 없다 — 칩은 그대로 남는다.
      sending.current = false;
      setBusy(false);
      setActive(null);
      toast(result.error);

      return;
    }

    // 성공 경로만 트랜지션이다. 지운 칩은 revalidate 로 새 목록이 도착해야 사라지는데, 확인 줄을
    // 그보다 먼저 걷으면 **방금 지운 칩이 보기 갈래로 되살아난다** — 그 창에서 × 를 다시 누르면
    // 이미 없는 하위를 찾다가 "하위 카테고리를 찾을 수 없습니다."로 돌아온다. 잠금을 이 트랜지션
    // 안에서 푸는 이유는 위 `rename` 과 같다.
    sending.current = false;
    startTransition(() => {
      setBusy(false);
      setActive(null);
    });

    toast(`${sub.name} 하위 카테고리 삭제${movedNote(sub)}`);
  }

  return (
    <div role="group" aria-label="하위 카테고리" className={ROW}>
      {/* 프로토타입의 첫 칸. 줄이 무엇인지 눈으로 알리는 라벨이라 폭이 고정돼 있다. */}
      <span className={LABEL}>하위</span>

      {subs.map((sub) => (
        <Chip
          key={sub.id}
          sub={sub}
          mode={active?.id === sub.id ? active.kind : null}
          busy={busy}
          onOpen={(kind) => setActive({ id: sub.id, kind })}
          onClose={() => setActive(null)}
          onSave={(draft) => void rename(sub, draft)}
          onRemove={() => void remove(sub)}
        />
      ))}

      {/* 폼으로 낸다 — 입력에서 Enter 가 곧 추가다(HTML 암묵적 제출). keydown 으로 직접 듣지
          않는 이유는 조합 입력(IME)이다: 한글을 확정하는 Enter 로 추가가 일어나면 안 되는데,
          그 판정은 브라우저가 이미 한다(CategoryPanel·J2 와 같은 근거).
          입력과 버튼을 폼이 감싸므로 줄바꿈도 둘이 함께 한다 — 프로토타입에서는 형제였지만
          떨어져 접히면 '무엇을 추가하는 버튼인지' 알 수 없는 자리가 생긴다. */}
      <form onSubmit={handleAdd} className="flex flex-none items-center gap-[8px]">
        {/* placeholder 는 값이 들어가면 사라져 이름 역할을 못 하므로 접근성 이름을 따로 준다.
            좌측 패널의 '새 카테고리' 입력과 짝을 이루는 이름이다(placeholder 는 프로토타입 문구). */}
        <input
          aria-label="새 하위 카테고리"
          placeholder="하위 추가"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          className={ADD_FIELD}
        />
        {/* 한 화면에 '추가' 버튼이 둘이다(좌측 패널에도 있다). 눈에는 자리로 구분되지만 이름만
            듣는 사람에게는 같은 버튼이라 접근성 이름에 무엇을 추가하는지 담는다. */}
        <button type="submit" disabled={adding} aria-label="하위 카테고리 추가" className={ADD_BUTTON}>
          추가
        </button>
      </form>
    </div>
  );
}

/**
 * 칩 하나 — 보기 · 이름 수정 · 삭제 확인 **세 갈래를 한 컴포넌트가** 든다.
 *
 * 갈래가 바뀌면 그것을 연 버튼이 그 자리에서 사라진다(수정을 열면 '수정'이, 확인을 열면 '×'가
 * 없어진다). 그래서 포커스를 옮기고 돌려주는 일이 여기 있고, 세 갈래를 한 컴포넌트로 모은 것도
 * 그 때문이다 — 갈래마다 컴포넌트가 갈리면 돌려줄 버튼의 ref 가 **사라진 쪽**에 남는다.
 *
 * 고치던 이름만은 아래 `RenameChip` 인스턴스가 따로 든다(열고 닫을 때마다 새로 시작해야 한다).
 */
function Chip({
  sub,
  mode,
  busy,
  onOpen,
  onClose,
  onSave,
  onRemove,
}: {
  sub: AdminSubCategory;
  /** 이 칩이 지금 펼쳐진 갈래. `null` 이면 보기다. */
  mode: ChipMode | null;
  busy: boolean;
  onOpen: (kind: ChipMode) => void;
  onClose: () => void;
  onSave: (draft: string) => void;
  onRemove: () => void;
}) {
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  /** 직전 갈래. 보기로 **어디서** 돌아왔는지가 포커스를 돌려줄 버튼을 정한다(I1 헤더와 같은 장치). */
  const cameFrom = useRef<ChipMode | null>(mode);

  /**
   * 갈래가 바뀔 때 포커스를 옮긴다 — 사라진 버튼에 얹혀 있던 포커스는 `<body>` 로 떨어지고,
   * 키보드 사용자는 화면 맨 앞에서 이 줄까지 다시 걸어와야 한다.
   *
   * - `confirm` 을 열면 포커스는 **`취소`** 가 받는다. 되돌릴 수 없는 동작을 묻는 자리라 기본
   *   포커스는 덜 위험한 쪽이다(WAI-ARIA APG alertdialog · I1 헤더 · J3 카드 삭제와 같은 판단).
   *   `rename` 쪽은 입력의 `autoFocus` 가 받으므로 여기서 할 일이 없다.
   * - 보기로 돌아올 때(저장 · Esc · 취소 · 삭제 응답)는 **그 갈래를 연 버튼**으로 돌려준다.
   *   나갔던 자리로 돌아오는 것이 사람이 기억하는 위치다.
   *
   * ## 돌려줄 자리를 **ref 로** 잡는 이유 (J2·J3 의 렌더 시점 캡처와 갈리는 곳)
   *
   * InlineEdit·DeleteConfirm 은 연 순간의 `document.activeElement` 를 붙들었다가 언마운트
   * cleanup 에서 그 노드로 돌려준다. 거기서는 트리거(연필·휴지통)가 폼이 떠 있는 **동안에도 카드에
   * 그대로 남아** 있어 붙든 노드가 여전히 유효하다. 이 칩은 반대다 — 갈래를 열면 트리거 버튼 자체가
   * DOM 에서 빠지고, 닫히면서 React 가 **새 버튼을 만든다.** 그 방식으로는 붙든 노드가 닫힐 때
   * `isConnected === false` 인 떨어져 나간 노드라 `focus()` 가 조용히 아무 일도 하지 않는다.
   * 그래서 노드가 아니라 **자리**를 ref 로 가리켜 다시 그려진 버튼을 잡는다.
   *
   * ## 이미 다른 곳에 가 있는 포커스는 뺏지 않는다
   *
   * 칩 A 를 열어 둔 채 칩 B 의 `수정` 을 누르면 한 커밋에서 A 가 닫히고 B 가 열린다. 그때 A 가
   * 조건 없이 자기 `수정` 을 잡으면 B 의 입력(autoFocus)에서 포커스를 도로 뺏어 온다. 돌려주는
   * 것은 포커스가 **떨어진 경우**뿐이다 — 우리 갈래가 사라지며 `<body>` 로 밀려났거나, 이미
   * 문서에서 빠진 노드에 남아 있을 때.
   *
   * 삭제 **성공** 경로에는 이 effect 가 아예 돌지 않는다 — 새 목록이 도착하며 칩이 통째로
   * 언마운트되기 때문이다. 그때 포커스는 `<body>` 에 남는다(줄에는 돌려줄 자리가 없다).
   */
  useEffect(() => {
    const from = cameFrom.current;
    cameFrom.current = mode;
    // 마운트 직후에는 아무것도 하지 않는다 — 선택이 바뀌면 이 줄은 `key` 로 **다시 마운트**되므로
    // (바깥 SubCategoryRow), 여기서 포커스를 잡으면 좌측 패널에서 카테고리를 고를 때마다 포커스가
    // 방금 누른 그 행에서 칩으로 끌려온다.
    if (from === mode) return;

    if (mode === 'confirm') {
      cancelDeleteRef.current?.focus();

      return;
    }

    if (mode !== null) return;

    const active = document.activeElement;
    const stranded =
      !(active instanceof HTMLElement) || active === document.body || !active.isConnected;
    if (!stranded) return;

    const trigger = from === 'rename' ? renameButtonRef.current : deleteButtonRef.current;
    if (trigger !== null && trigger.isConnected) trigger.focus();
  }, [mode]);

  if (mode === 'rename') {
    return <RenameChip sub={sub} busy={busy} onSave={onSave} onCancel={onClose} />;
  }

  return (
    <span className={CHIP}>
      <span className="text-[12px] font-semibold text-ink">{sub.name}</span>

      {mode === 'confirm' ? (
        <>
          {/* 누른 뒤에 나타나는 안내라 스크린 리더가 그 자리에서 읽어야 한다.
              링크가 사라지는 것이 아니라 상위로 올라간다는 것을 **누르기 전에** 알린다 —
              프로토타입은 지운 뒤 토스트로만 알리지만(784행), 이 자리의 × 는 '수정' 옆
              7px 이고 어느 링크가 이 하위에 있었는지는 되돌릴 수 없다. 확인 한 번을
              두는 판단은 카드 삭제(J3)·카테고리 삭제(I1)와 같다. */}
          <span role="alert" className="text-[11px] text-desc">
            {sub.linkCount > 0
              ? `링크 ${sub.linkCount}개는 상위로 올라갑니다. 삭제할까요?`
              : '삭제할까요?'}
          </span>
          {/* 펼친 칩의 버튼들도 이름을 앞에 단다 — 글자만 보면 '삭제'·'취소'는 헤더 줄(I1)·링크
              표(I4)에도 있어, 이름만 듣는 사람에게는 한 화면에 같은 버튼이 여럿이 된다.
              '× (`${sub.name} 삭제`)'와도 갈라 두어야 무엇을 누르는지가 분명하다. */}
          <button
            type="button"
            aria-label={`${sub.name} 삭제 확인`}
            disabled={busy}
            onClick={onRemove}
            className={`${CHIP_BUTTON} font-semibold text-danger`}
          >
            삭제
          </button>
          <button
            ref={cancelDeleteRef}
            type="button"
            aria-label={`${sub.name} 삭제 취소`}
            disabled={busy}
            onClick={onClose}
            className={`${CHIP_BUTTON} text-faint hover:text-ink`}
          >
            취소
          </button>
        </>
      ) : (
        <>
          <span className="text-[11px] text-fainter">{sub.linkCount}개</span>
          {/* 칩마다 같은 글자가 반복되므로 이름을 접근성 이름에 담는다 — 카드의
              `${title} 삭제` 와 같은 방식이다.

              다른 칩이 왕복하는 동안에는 이 둘도 잠긴다(위 `busy` JSDoc) — 열어 봐야 그 왕복이
              끝나며 닫히므로, 치던 글자가 사라지는 대신 처음부터 열리지 않게 한다. */}
          <button
            ref={renameButtonRef}
            type="button"
            aria-label={`${sub.name} 이름 수정`}
            disabled={busy}
            onClick={() => onOpen('rename')}
            className={`${CHIP_BUTTON} text-faint hover:text-ink`}
          >
            수정
          </button>
          <button
            ref={deleteButtonRef}
            type="button"
            aria-label={`${sub.name} 삭제`}
            disabled={busy}
            onClick={() => onOpen('confirm')}
            className={`${CHIP_BUTTON} text-ghost hover:text-danger`}
          >
            ×
          </button>
        </>
      )}
    </span>
  );
}

/**
 * 이름을 고치는 중인 칩. 고치던 값은 **이 인스턴스가 든다** — 열 때 마운트되고 닫을 때 사라지므로
 * 다음에 열면 언제나 지금 이름에서 시작한다(줄이 값을 들고 있으면 지우는 일이 따로 필요하다).
 *
 * ## 취소 버튼은 프로토타입에 없다 (343–344행: 입력과 저장 둘뿐)
 *
 * 그래도 둔다. 없으면 마우스만 쓰는 사람이 나가는 길은 `저장`뿐이고 — 고치지 않은 채 저장하면
 * 서버까지 가지 않고 닫히지만, 그것은 화면에 적혀 있지 않다 — 하위가 하나뿐인 상위에서는 다른
 * 칩으로 옮겨 닫을 수조차 없다. 나가는 길을 Esc 하나로 두지 않는 것은 헤더 줄(I1)·인라인
 * 편집(J2)과 같은 판단이고, 낱말·색도 그쪽 `취소` 를 따른다(글자 크기만 칩의 11px 이다).
 * 줄이 `flex-wrap` 이라 칩이 한 칸 넓어져도 다음 줄로 접힐 뿐 레이아웃이 무너지지 않는다.
 */
function RenameChip({
  sub,
  busy,
  onSave,
  onCancel,
}: {
  sub: AdminSubCategory;
  busy: boolean;
  onSave: (draft: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(sub.name);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    onSave(draft);
  }

  /**
   * Esc 취소. 저장 중에는 듣지 않는다 — 요청은 이미 떠났으므로 여기서 닫으면 '취소했는데 이름이
   * 바뀌어 있는' 화면이 된다(I1·J2 와 같은 판단).
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape' || busy) return;

    onCancel();
  }

  return (
    /* Enter 로 저장되는 것은 폼의 암묵적 제출이다 — 조합 입력(IME) 확정 Enter 를 저장으로
       오해하지 않는 판정을 브라우저에 맡긴다. */
    <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className={CHIP}>
      {/* `autoFocus` 는 사람이 '수정'을 눌러 연 입력이라 정당하다 — 초점이 여기로 오는 것이 그
          클릭의 뜻이고, 방금 사라진 '수정' 버튼에 초점이 남으면 키보드 사용자는 갈 곳을 잃는다. */}
      <input
        autoFocus
        aria-label="하위 카테고리 이름"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className={NAME_FIELD}
      />
      {/* 이름을 앞에 다는 이유는 확인 줄의 버튼들과 같다 — 한 화면에 '저장'·'취소'가 여럿이다. */}
      <button
        type="submit"
        aria-label={`${sub.name} 이름 저장`}
        disabled={busy}
        className={`${CHIP_BUTTON} font-semibold text-ink`}
      >
        저장
      </button>
      {/* `type="button"` 이어야 한다 — 폼 안의 버튼 기본값은 submit 이라 그대로 두면 취소가 저장이 된다. */}
      <button
        type="button"
        aria-label={`${sub.name} 이름 수정 취소`}
        disabled={busy}
        onClick={onCancel}
        className={`${CHIP_BUTTON} text-faint hover:text-ink`}
      >
        취소
      </button>
    </form>
  );
}
