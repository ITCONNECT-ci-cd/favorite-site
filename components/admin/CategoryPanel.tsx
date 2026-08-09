'use client';

import {
  createContext,
  startTransition,
  useContext,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react';

import { toast } from '@/components/Toast';
import { createCategory, reorderCategories } from '@/lib/mutations';

/**
 * 관리 화면의 좌측 패널이 그리는 상위 카테고리 한 줄.
 *
 * **화면이 쓸 만큼만 담는다** — 290행짜리 북마크 배열을 클라이언트로 내리지 않으려고 개수·합계를
 * 서버(app/admin/page.tsx)에서 미리 접어 온다. 두 숫자의 뜻은 사이드바와 같다: **직속 + 모든 하위**
 * (lib/queries.ts `rollupCounts`).
 */
export type AdminCategory = {
  id: string;
  name: string;
  /** 이 카테고리 트리에 속한 링크 수 (직속 + 하위). */
  linkCount: number;
  /** 그 링크들의 클릭 합계 (`bookmark_click_counts` 뷰 경유). */
  clickTotal: number;
};

/**
 * "지금 어느 상위 카테고리를 보고 있는가" — 관리 화면 우측 전체가 이 하나를 본다.
 *
 * `select` 는 좌측 패널만 부르고, `selected` 는 CategoryHeader(I1)와 하위 줄·링크 추가 줄·
 * 링크 표(I2·I3·I4)가 읽는다.
 */
export type SelectedCategoryValue = {
  /** 상위 카테고리 전부, 화면에 보이는 순서(= 서버가 준 `sort_order` 순). */
  categories: readonly AdminCategory[];
  /** 선택된 카테고리. 카테고리가 하나도 없을 때만 `null` 이다. */
  selected: AdminCategory | null;
  select: (id: string) => void;
};

const SelectedCategoryContext = createContext<SelectedCategoryValue | null>(null);

/**
 * 선택 상태를 드는 자리 — **관리 화면 2단의 공통 조상**이다(app/admin/page.tsx 가 마운트한다).
 *
 * ## 왜 URL 이 아니라 클라이언트 상태인가
 *
 * 프로토타입의 선택은 컴포넌트 상태 하나다(`state.catSel`, 초기값 `null` → 첫 카테고리로 대체).
 * 주소는 관리 화면 내내 `/admin` 그대로이고, 새로고침하면 선택은 첫 카테고리로 돌아간다. 그 동작을
 * 그대로 옮긴다:
 *
 * - 카테고리를 고르는 일은 **탐색이 아니라 화면 안의 커서 이동**이다. 주소에 실으면 클릭마다
 *   서버 왕복(전체 데이터 재조회)이 생긴다 — 22개를 훑어보는 화면에서 22번이다.
 * - 되돌아올 주소가 필요한 화면도 아니다(관리자 한 명이 보는 편집 화면).
 * - 반대로 **삭제된 카테고리가 주소에 남는** 상태를 다루지 않아도 된다. 아래 `selected` 는 목록에
 *   없는 id 를 자동으로 첫 카테고리로 접는다.
 *
 * ## DOM 을 만들지 않는다
 *
 * children 을 그대로 돌려준다 — 2단 배치(좌 270px / 우 flex-1)는 화면(page)의 `<main>` 이 갖고,
 * 이 provider 는 그 flex 컨테이너와 자식들 사이에 상자를 끼워 넣지 않는다.
 *
 * ## 왜 이 파일에 있나
 *
 * 선택을 **만드는** 것이 좌측 패널이라 선택 상태도 그 모듈에 둔다 — 헤더·하위 줄·링크 표는 전부
 * 읽기만 한다. 파일을 따로 파면 "패널이 고르고, 제3의 파일이 그 결과를 들고, 아무도 소유하지
 * 않는" 모양이 된다. 읽는 쪽은 `useSelectedCategory()` 하나만 알면 되므로 import 경로가
 * 패널 파일인 것은 소비자에게 부담이 되지 않는다.
 */
export function SelectedCategoryProvider({
  categories,
  children,
}: {
  categories: readonly AdminCategory[];
  children: ReactNode;
}) {
  /** 사람이 고른 id. 아직 아무것도 안 골랐으면 `null` 이고, 그때는 첫 카테고리가 선택이다. */
  const [pickedId, setPickedId] = useState<string | null>(null);

  /**
   * **파생값이라 따로 맞춰 줄 일이 없다.** 고른 카테고리가 사라지면(삭제·이름 변경으로 id 가
   * 목록에서 빠지면) 그 자리에서 첫 카테고리로 접힌다 — 지운 카테고리를 계속 가리키는 상태가
   * 남지 않는다. 효과(useEffect)로 정리하는 방식이었다면 한 프레임 동안 빈 화면이 보인다.
   */
  const selected = categories.find((category) => category.id === pickedId) ?? categories[0] ?? null;

  const value = useMemo<SelectedCategoryValue>(
    () => ({ categories, selected, select: setPickedId }),
    [categories, selected],
  );

  return (
    <SelectedCategoryContext.Provider value={value}>{children}</SelectedCategoryContext.Provider>
  );
}

/**
 * 선택된 상위 카테고리를 읽는 통로. **I2·I3·I4 는 이것만 쓰면 된다** — 화면(page)에서 선택 id 를
 * prop 으로 타고 내려보내지 마라(같은 값의 출처가 둘이 된다).
 *
 * provider 밖에서 부르면 던진다. 조용히 `null` 을 돌려주면 "카테고리가 없다"와 "provider 를
 * 빼먹었다"가 같은 모습이 되어, 화면이 이유 없이 비어 보이는 고장으로 끝난다.
 */
export function useSelectedCategory(): SelectedCategoryValue {
  const value = useContext(SelectedCategoryContext);
  if (value === null) {
    throw new Error('useSelectedCategory 는 SelectedCategoryProvider 안에서만 쓸 수 있습니다.');
  }

  return value;
}

/** 목록 행 — 프로토타입 원문 `height:46px; padding:0 14px; gap:9px; border-bottom:1px solid #f2f0ec`. */
const ROW = 'flex h-[46px] w-full cursor-grab items-center gap-[9px] border-b border-line px-[14px] text-left';
/** 선택 행: 배경 `#141516`. 비선택 행의 호버 `#f5f3ef` 는 스펙 색상표에 없는 프로토타입 고유값이다. */
const ROW_ON = 'bg-ink';
const ROW_OFF = 'hover:bg-[#f5f3ef]';
/** 이름 13px/600. 비선택 글자색 `#3a3833` 도 프로토타입 고유값(상단 탭의 비선택 글자와 같은 값). */
const NAME = 'min-w-0 flex-1 truncate text-[13px] font-semibold';
const NAME_ON = 'text-white';
const NAME_OFF = 'text-[#3a3833]';
/** 개수·클릭 11px — 선택 행에서는 `#c9c5be`, 아니면 `#9a9791`. */
const META_ON = 'text-check-off';
const META_OFF = 'text-fainter';

/**
 * 끌어 온 행을 대상 행 **자리에** 끼워 넣은 새 목록 (프로토타입 `dropOn` 의 `cat` 갈래 그대로).
 *
 * 인덱스는 **빼내기 전에** 잡는다 — 그래서 뒤에서 앞으로 끌면 대상 행 앞에, 앞에서 뒤로 끌면
 * 대상 행 뒤에 놓인다. 눈으로 보는 "그 자리를 차지한다"가 이 계산이다.
 */
function moveOnto(
  categories: readonly AdminCategory[],
  sourceId: string,
  targetId: string,
): AdminCategory[] {
  const next = [...categories];
  const from = next.findIndex((category) => category.id === sourceId);
  const to = next.findIndex((category) => category.id === targetId);
  if (from < 0 || to < 0) return next;

  next.splice(to, 0, ...next.splice(from, 1));

  return next;
}

/**
 * 좌측 상위 카테고리 패널 — DESIGN_SPEC 6장 "좌 270px", 프로토타입 302–321행.
 *
 * 제목 + 새 카테고리 입력 + 목록이 전부다. 목록 행은 클릭으로 선택(우측 전체가 따라 바뀐다),
 * 드래그로 순서 변경(공개 사이드바 순서가 이 값이다)을 한다.
 *
 * ## 서버와의 계약
 *
 * 두 서버 액션을 직접 부른다(`lib/mutations.ts`). 인자가 positional 이라 `<form action>` 에
 * 그대로 걸 수 없고, 돌아오는 `{ ok:false, error }` 의 `error` 는 **그대로 토스트에 넣는다** —
 * 화면이 문구를 다시 적으면 서버와 조용히 갈라진다(J2 InlineEdit 과 같은 방침).
 *
 * `reorderCategories` 에는 **상위 id 만** 실린다. 이 패널이 상위만 알고 있어서 자연히 그렇게 되고,
 * 하위가 섞이면 서버가 거부한다(그쪽 JSDoc).
 *
 * ## 알려진 한계 — 순서 변경은 마우스로만 된다
 *
 * HTML5 `draggable` 은 키보드로 다룰 수 없다. 프로토타입·스펙 모두 드래그만 정의하고(6장),
 * 선택·추가·이름 수정·삭제는 전부 키보드로 되므로 정렬만 마우스 전용으로 남는다. 키보드 정렬을
 * 넣기로 하면 그때 스펙과 함께 정한다(공개 화면에는 이 기능 자체가 없다).
 *
 * @param totalLinkCount 제목 옆 총계에 들어갈 **전체** 링크 수(이 패널 행들의 합이 아니다 —
 *   프로토타입 `catTotalLabel` 이 `links.length` 를 쓴다).
 */
export function CategoryPanel({ totalLinkCount }: { totalLinkCount: number }) {
  const { categories, selected, select } = useSelectedCategory();
  const titleId = useId();

  const [name, setName] = useState('');
  /** 추가 요청이 나가 있는 동안 — 같은 이름이 두 번 들어가는 것을 막는 빗장이다. */
  const [adding, setAdding] = useState(false);

  /**
   * 저장이 끝나기 전에 보여 줄 순서. 서버가 새 순서를 실어 보내면(revalidatePath) 이 값은 걷히고
   * props 가 이긴다 — 실패했을 때 화면이 서버와 어긋난 채 남지 않는 것도 같은 성질 덕이다.
   */
  const [order, setOrder] = useOptimistic<readonly AdminCategory[]>(categories);

  /**
   * 끌고 있는 행. `dataTransfer` 가 아니라 ref 인 이유는 프로토타입(`_drag`)과 같다 — 이 화면
   * 안에서만 오가는 정보이고, dragover 중에는 `dataTransfer.getData()` 가 보안상 빈 문자열을
   * 돌려주는 브라우저가 있어 판정에 쓸 수 없다.
   */
  const draggingId = useRef<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (adding) return;

    // 빈 입력은 서버까지 가지 않는다(프로토타입 `if (!n) return`) — 아무것도 적지 않고 누른
    // 사람에게는 오류가 아니라 "아직 아무 일도 없음"이 맞다.
    const cleanName = name.trim();
    if (cleanName === '') return;

    setAdding(true);
    const result = await createCategory(cleanName);
    setAdding(false);

    if (!result.ok) {
      // 이름은 지우지 않는다 — 같은 이름이라 거절당했다면 고쳐서 다시 낼 값이다.
      toast(result.error);

      return;
    }

    setName('');
    toast(`${cleanName} 카테고리 추가됨`);
  }

  function handleDragStart(event: DragEvent<HTMLElement>, id: string): void {
    draggingId.current = id;

    // Firefox 는 dragstart 에서 데이터를 싣지 않으면 드래그를 시작조차 하지 않는다.
    // (jsdom 에는 DragEvent 가 없어 테스트에서는 이 자리가 비어 있다 — 그래서 옵셔널이다.)
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(event: DragEvent<HTMLElement>): void {
    // 막지 않으면 브라우저가 drop 자체를 일으키지 않는다.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetId: string): void {
    event.preventDefault();

    const sourceId = draggingId.current;
    draggingId.current = null;
    if (sourceId === null || sourceId === targetId) return;

    const next = moveOnto(order, sourceId, targetId);

    startTransition(async () => {
      setOrder(next);

      // 목록 **전체**를 보낸다 — 서버가 `orderedIds[i]` 를 그대로 sort_order 로 쓴다.
      const result = await reorderCategories(next.map((category) => category.id));
      if (!result.ok) toast(result.error);
    });
  }

  return (
    <section
      aria-labelledby={titleId}
      className="w-full min-[820px]:w-[270px] min-[820px]:flex-none"
    >
      {/* 제목 줄 — 프로토타입 `align-items:baseline; gap:8px; margin-bottom:10px`. */}
      <div className="mb-[10px] flex items-baseline gap-[8px]">
        <h2 id={titleId} className="text-[13.5px] font-bold text-ink">
          상위 카테고리
        </h2>
        <p className="text-[11px] text-fainter">
          {categories.length}개 카테고리 · 링크 {totalLinkCount}개
        </p>
      </div>

      {/* 폼으로 낸다 — 입력에서 Enter 가 곧 추가다(HTML 암묵적 제출). keydown 으로 직접 듣지
          않는 이유는 조합 입력(IME)이다: 한글을 확정하는 Enter 로 추가가 일어나면 안 되는데,
          그 판정은 브라우저가 이미 한다(J2 InlineEdit 과 같은 근거). */}
      <form onSubmit={handleAdd} className="mb-[10px] flex gap-[6px]">
        {/* placeholder 는 값이 들어가면 사라져 이름 역할을 못 하므로 접근성 이름을 따로 준다.
            눈에 보이는 라벨 줄은 프로토타입에 없다(바로 위 제목이 그 몫을 한다). */}
        <input
          aria-label="새 카테고리"
          placeholder="새 카테고리"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-[34px] min-w-0 flex-1 rounded-[7px] border border-border-strong bg-card px-[11px] text-[12.5px] text-ink"
        />
        <button
          type="submit"
          disabled={adding}
          className="flex h-[34px] flex-none items-center rounded-[7px] bg-ink px-[13px] text-[12px] font-semibold whitespace-nowrap text-white hover:bg-ink-hover disabled:opacity-60"
        >
          추가
        </button>
      </form>

      {order.length === 0 ? (
        /* 프로토타입에는 없는 상태다(항상 카테고리가 있었다). 빈 흰 상자만 남으면 고장으로 보인다. */
        <p className="rounded-[9px] border border-border bg-card px-[14px] py-[14px] text-[12px] text-fainter">
          아직 카테고리가 없습니다.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-[9px] border border-border bg-card">
          {order.map((category) => {
            const on = category.id === selected?.id;

            return (
              <li key={category.id}>
                <button
                  type="button"
                  draggable
                  onClick={() => select(category.id)}
                  onDragStart={(event) => handleDragStart(event, category.id)}
                  onDragOver={handleDragOver}
                  onDrop={(event) => handleDrop(event, category.id)}
                  onDragEnd={() => {
                    draggingId.current = null;
                  }}
                  /* 색만으로는 선택을 알릴 수 없다 — 스크린 리더는 배경색을 읽지 않는다.
                     목록 안의 '지금 이것'이라 page 가 아니라 true 다(탭의 aria-current="page" 와 다름). */
                  aria-current={on ? true : undefined}
                  className={`${ROW} ${on ? ROW_ON : ROW_OFF}`}
                >
                  {/* 손잡이 9×12px 두 줄 (DESIGN_SPEC 6장). 장식이라 이름을 주지 않는다 —
                      집는 자리를 알려 줄 뿐, 행 전체가 이미 draggable 이다. */}
                  <span
                    aria-hidden="true"
                    className="h-[12px] w-[9px] flex-none border-t-2 border-b-2 border-check-off"
                  />
                  <span className={`${NAME} ${on ? NAME_ON : NAME_OFF}`}>{category.name}</span>
                  <span className={`text-[11px] ${on ? META_ON : META_OFF}`}>
                    {category.linkCount}개
                  </span>
                  {/* 클릭 합계는 폭을 고정해 자릿수가 달라도 오른쪽 끝이 흔들리지 않는다. */}
                  <span className={`w-[38px] text-right text-[11px] ${on ? META_ON : META_OFF}`}>
                    {category.clickTotal}회
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
