'use client';

import {
  startTransition,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type FormEvent,
} from 'react';

import { useSelectedCategory, type AdminCategory } from '@/components/admin/CategoryPanel';
import { useLinkFilter, visibleLinks } from '@/components/admin/FilterRow';
import type { AdminSubCategory, SubCategoryMap } from '@/components/admin/SubCategoryRow';
import { EyeIcon } from '@/components/icons';
import { toast } from '@/components/Toast';
import { REQUEST_FAILED } from '@/lib/constants';
import {
  reorderBookmarks,
  togglePin,
  updateBookmark,
  type ActionResult,
} from '@/lib/mutations';
import { moveOnto } from '@/lib/reorder';
import { hostOf } from '@/lib/url';

/**
 * 표가 그리는 링크 한 줄.
 *
 * **화면이 쓸 만큼만 담는다** — 좌측 패널(`AdminCategory`)·하위 줄(`AdminSubCategory`)과 같은
 * 방침이다. 290행짜리 `BookmarkWithCount` 를 그대로 내리지 않고 화면(app/admin/page.tsx)이 표에
 * 필요한 여덟 칸만 접어 온다: 표의 여섯 칸(이름·주소·설명·하위·클릭·고정)과 그것을 서버로
 * 되돌려 보낼 때 쓰는 `id` 다.
 *
 * `sort_order` 는 **일부러 없다.** 순서는 배열의 자리가 이미 들고 있고(`getAllData` 가
 * `sort_order` 로 정렬해 준다), 서버로 되돌려 보낼 때도 `reorderBookmarks` 가 받는 것은 숫자가
 * 아니라 **id 를 순서대로 늘어놓은 배열**이다. 숫자를 함께 내리면 같은 사실이 두 벌이 되어
 * 언젠가 둘이 어긋난다.
 */
export type AdminLink = {
  id: string;
  title: string;
  url: string;
  description: string | null;
  /**
   * 이 링크가 **실제로** 속한 카테고리. 상위 직속이면 상위 id, 하위에 배정됐으면 하위 id 다.
   * 하위 select 의 현재 값이 이 값이고, `—` 로 되돌릴 때 보내는 값이 상위 id 다.
   */
  categoryId: string;
  faviconUrl: string | null;
  clickCount: number;
  isPinned: boolean;
};

/**
 * 상위 카테고리 id → 그 **트리**(직속 + 모든 하위)에 속한 링크들. 화면이 서버에서 접어 넘긴다.
 *
 * **선택한 상위 것만 넘길 수는 없다** — 선택은 클라이언트 상태라 서버가 모른다(CategoryPanel
 * `SelectedCategoryProvider` JSDoc). `SubCategoryMap` 과 같은 모양이고 같은 이유다.
 *
 * 배열 순서가 곧 `sort_order` 순서다(위 `AdminLink` 참조) — 표는 이 순서를 그대로 그리고,
 * 드래그로 바꾼 결과도 이 배열을 다시 늘어놓아 보낸다.
 */
export type LinkRowMap = Readonly<Record<string, readonly AdminLink[]>>;

/** 링크가 없는 카테고리에서 매 렌더 새 배열을 만들지 않기 위한 자리. */
const NO_LINKS: readonly AdminLink[] = [];
/** 하위가 없는 상위에서도 같은 이유로 하나를 돌려쓴다. */
const NO_SUBS: readonly AdminSubCategory[] = [];

/** 표 헤더 — 프로토타입 원문 `display:flex; align-items:center; gap:12px; height:38px; padding:0 16px; background:#f7f5f2; border-bottom:1px solid #e3dfd9; font-size:11px; color:#6d6a65`. */
const HEAD = 'flex items-center gap-[12px] h-[38px] px-[16px] bg-page border-b border-border text-[11px] text-desc';

/** 표 행 — 프로토타입 원문 `flex-wrap:wrap; gap:10px 12px; min-height:52px; padding:8px 16px; border-bottom:1px solid #f2f0ec`, 호버 `#faf9f7`. */
const ROW =
  'flex flex-wrap items-center gap-x-[12px] gap-y-[10px] min-h-[52px] px-[16px] py-[8px] border-b border-line hover:bg-toolbar';

/** 손잡이 9×12px 두 줄 (`#d8d3cb`). 좌측 패널의 손잡이와 같은 모양이지만 색이 다르다(그쪽은 `#c9c5be`). */
const HANDLE = 'order-0 w-[9px] h-[12px] flex-none border-t-2 border-b-2 border-dash';
/**
 * 끌 수 없는 동안의 손잡이 — 커서를 되돌리고 흐린다.
 *
 * 커서만 바꾸면 마우스를 얹어 본 사람에게만 알려진다. 손잡이는 "여기를 집어라"라고 말하는 유일한
 * 표시라, 집을 수 없게 된 동안에는 눈으로도 물러서 있어야 한다(정렬을 '직접 지정한 순서'로
 * 되돌리면 그대로 돌아온다 — 사라지지 않는 이유가 그것이다: 자리가 비면 행 전체가 흔들린다).
 */
const HANDLE_ON = 'cursor-grab';
const HANDLE_OFF = 'cursor-default opacity-40';

/** 이름 칸 250px — 헤더의 `링크` 칸과 같은 폭이다. */
const NAME_CELL = 'order-1 flex items-center gap-[10px] w-[250px] flex-none min-w-0';
/** 파비콘 타일 24px — 카드(2-1장)의 34px 타일과 달리 표 전용 크기다. 이미지는 15px 로 얹는다. */
const FAVICON = 'w-[24px] h-[24px] flex-none rounded-[6px] bg-card border border-select-hover bg-[length:15px_15px] bg-center bg-no-repeat';

/**
 * 설명 칸 — `flex: 1 1 240px; min-width: 240px` (DESIGN_SPEC 6장). 이 값이 **입력이 아니라 폼**에
 * 붙는 이유는 아래 `Row` 의 주석에 있다(폼이 flex 항목이라 사이즈도 폼이 진다).
 */
const DESC_CELL = 'order-2 flex-[1_1_240px] min-w-[240px]';
const DESC_FIELD = 'h-[32px] w-full rounded-[6px] border border-select-hover bg-card px-[10px] text-[12.5px] text-ink';

/** 하위 select 130px. 테두리가 추가 줄의 입력(`#ddd8d1`)보다 옅다 — 프로토타입 원문 `#e7e3dc`. */
const SUB_FIELD =
  'order-3 w-[130px] flex-none h-[32px] rounded-[6px] border border-select-hover bg-card px-[6px] text-[11.5px] text-ink';

/** 클릭 46px 우측 정렬. `#5a5651` 은 스펙 색상표에 없는 프로토타입 고유값이다(405행). */
const CLICKS = 'order-4 flex items-center justify-end gap-[4px] w-[46px] flex-none text-[11.5px] font-semibold text-[#5a5651]';

/**
 * 고정 토글 56×26px 알약. 켜짐·꺼짐의 세 색(배경·글자·테두리)이 함께 뒤집힌다(프로토타입 1114행).
 *
 * 손가락 커서는 프로토타입 원문 그대로다(406행 `cursor:pointer`). `disabled:cursor-default` 를
 * 함께 달지 않는 것은 이 버튼을 **잠그지 않기** 때문이다 — 이중 제출은 `pinningRef` 가 막는다
 * (아래 버튼의 주석. 잠그는 버튼을 가진 I2·J2 는 그쪽 짝을 함께 단다).
 */
const PIN = 'order-5 flex items-center justify-center w-[56px] h-[26px] flex-none cursor-pointer rounded-[13px] border text-[11px] font-semibold';
const PIN_ON = 'bg-ink text-white border-ink';
const PIN_OFF = 'bg-card text-ghost border-border-strong';

/**
 * 파비콘 주소를 CSS `url()` 안에 안전하게 넣는다. 따옴표가 든 주소를 그대로 이어 붙이면 url()
 * 문자열이 중간에서 닫히고 `background-image` 선언 전체가 무효 처리된다.
 *
 * `components/LinkCard.tsx`·`components/palette/CommandPalette.tsx` 에 같은 함수가 있다 — 세
 * 파일이 각자 들고 있는 것은 지금 이 트랙에서 `lib/` 를 건드리지 않기 때문이다. 넷째 사용처가
 * 생기면 그때 `lib/favicon.ts` 로 올려라(그 파일이 이미 `faviconSrc` 로 같은 값을 다룬다).
 */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, '\\$&')}")`;
}

/**
 * 액션 한 번 부르기 — **거부로 끝난 프라미스**를 실패 결과로 접는다.
 *
 * 네트워크가 끊겼거나 배포로 액션 id 가 바뀌면 `await` 가 거부로 끝난다. 잡지 않으면 호출한
 * 핸들러가 거기서 멈춰 빗장이 선 채 남고, 그 줄은 새로고침 말고는 나갈 길이 없어진다
 * (`components/admin/SubCategoryRow.tsx` 의 같은 이름 함수와 같은 계약).
 */
async function run(call: () => Promise<ActionResult>, what: string): Promise<ActionResult> {
  try {
    return await call();
  } catch (error) {
    console.error(`[LinkTable] ${what} 요청이 거부됐다`, error);

    return { ok: false, error: REQUEST_FAILED };
  }
}

/**
 * 링크 표 — DESIGN_SPEC 6장 "표 헤더 38px" · "행 (min-height 52px …)", 프로토타입 382–406행.
 *
 * 선택한 상위 카테고리의 **트리 전체**(직속 + 하위 소속)를 한 목록으로 늘어놓고, 그 자리에서
 * 설명을 고치고(`updateBookmark`), 하위를 옮기고(`updateBookmark`), 매일 고정을 켜고 끄고
 * (`togglePin`), 드래그로 순서를 바꾼다(`reorderBookmarks`). 어느 상위인지는 prop 이 아니라
 * 좌측 패널과 공유하는 선택 상태에서 온다(`useSelectedCategory`).
 *
 * ## 자리 — 링크 추가 줄과 **같은 상자** 안이다
 *
 * 프로토타입에서 흰 상자 하나가 추가 줄 + 필터 줄 + 표를 함께 담는다(359–412행). 그래서 이
 * 컴포넌트는 상자를 만들지 않고 `<LinkAddRow>` 의 children 으로 들어간다(그쪽 JSDoc
 * "I4·I5 와의 계약") — 추가 줄과 이 표 사이의 구분선은 LinkAddRow 가 그린다. 필터 줄(I5)은
 * 이 표 **앞**에 형제로 들어오고, 그 줄이 정한 것은 prop 이 아니라 문맥으로 닿는다
 * (`useLinkFilter` — 선택 상태와 같은 모양이다).
 *
 * ## 그리는 목록과 보내는 목록은 다르다
 *
 * 검색·하위 칩·정렬은 **그리는 쪽에만** 걸린다(`visibleLinks`). 드래그로 바뀐 순서를 서버로
 * 보낼 때 넘기는 것은 언제나 걸러지지 않은 목록 전체다 — `sort_order` 는 테이블이 공유하는 컬럼
 * 하나라 일부만 보내면 나머지와 뒤섞인다(아래 `handleDrop`). 그리고 '직접 지정한 순서'가 아닌
 * 정렬에서는 드래그 자체를 받지 않는다(아래 `sortable`).
 *
 * ## 서버와의 계약
 *
 * 세 액션을 직접 부른다(`lib/mutations.ts`). 인자가 positional 이라 `<form action>` 에 그대로 걸
 * 수 없고, 돌아오는 `{ ok:false, error }` 의 `error` 는 **그대로 토스트에 넣는다** — 화면이 문구를
 * 다시 적으면 서버와 조용히 갈라진다(I1·I2·J2 와 같은 방침).
 *
 * **13번째 고정을 화면이 미리 세지 않는다.** 상한 판정은 DB 트리거 하나가 갖고(`togglePin`
 * JSDoc — `pg_advisory_xact_lock` 으로 경합까지 직렬화한다), 화면이 한 벌 더 세면 두 창에서
 * 동시에 누를 때 조용히 갈라진다. 프로토타입은 자기 상태를 세어 막았지만(689–694행) 그때는
 * 상태가 화면 하나뿐이었다.
 *
 * ## 알려진 한계 — 순서 변경은 마우스로만 된다
 *
 * HTML5 `draggable` 은 키보드로 다룰 수 없다(좌측 패널과 같은 한계·같은 근거). 설명·하위·고정은
 * 전부 키보드로 되므로 정렬만 마우스 전용으로 남는다.
 */
export function LinkTable({
  linksByCategory,
  subsByCategory,
}: {
  linksByCategory: LinkRowMap;
  subsByCategory: SubCategoryMap;
}) {
  const { selected } = useSelectedCategory();

  // 상위가 하나도 없으면 표도 없다 — 애초에 `LinkAddRow` 가 그 경우 children 을 그리지 않지만
  // (그쪽 JSDoc), 이 컴포넌트를 다른 자리에 놓아도 같은 판단이 서게 여기서도 막는다.
  if (selected === null) return null;

  /* `key` 가 표의 상태를 상위마다 새로 시작하게 한다 — 고치던 설명 초안과 아직 저장되지 않은
     낙관 순서가 다음 선택으로 새어 나가면 엉뚱한 링크를 고치게 된다(I2 와 같은 장치). */
  return (
    <Table
      key={selected.id}
      category={selected}
      links={linksByCategory[selected.id] ?? NO_LINKS}
      subs={subsByCategory[selected.id] ?? NO_SUBS}
    />
  );
}

function Table({
  category,
  links,
  subs,
}: {
  category: AdminCategory;
  links: readonly AdminLink[];
  subs: readonly AdminSubCategory[];
}) {
  /**
   * 저장이 끝나기 전에 보여 줄 순서. **완성된 배열이 아니라 리듀서로 든다** — 절대값으로 밀어
   * 넣으면 그 배열이 base 를 통째로 가려, 요청이 나가 있는 동안 도착한 새 서버 데이터(다른 창의
   * 설명 수정·추가)가 응답이 올 때까지 보이지 않는다(CategoryPanel 과 같은 근거).
   */
  const [order, moveLink] = useOptimistic(
    links,
    (current: readonly AdminLink[], move: { sourceId: string; targetId: string }) =>
      moveOnto(current, move.sourceId, move.targetId),
  );

  /**
   * 필터 줄(I5)이 정한 것 — 검색어 · 하위 칩 · 정렬. **prop 이 아니라 문맥에서** 온다: 줄과 표는
   * 형제라 값이 화면(page)을 거쳐 내려오면 "필터가 무엇인가"의 소유자가 화면으로 올라간다
   * (`components/admin/FilterRow.tsx` `LinkFilterProvider`).
   */
  const filter = useLinkFilter();

  /**
   * **그리는 목록.** 아래 `handleDrop` 이 보내는 목록(`order` 전체)과 다르다 — 그 이유는 그쪽
   * 주석에 있다. 걸러 낼 밑이 `links` 가 아니라 `order` 인 것은 낙관적 순서 때문이다: 저장이
   * 끝나기 전의 새 차례도 걸러진 화면에 그대로 보여야 한다.
   */
  const shown = visibleLinks(order, subs, filter);

  /**
   * 지금 끌어 옮길 수 있는가. **'직접 지정한 순서'일 때만이다.**
   *
   * 다른 정렬에서는 보이는 차례와 저장되는 차례(`sort_order`)가 서로 다르다. 그 상태에서 놓으면
   * 사람은 보이는 차례를 바꿨다고 믿지만 서버로 가는 것은 전혀 다른 결과가 되고(놓은 자리가
   * 보이는 목록에서는 2번이어도 실제 목록에서는 5번일 수 있다), 화면에는 되돌릴 길이 없다.
   */
  const sortable = filter.sort === 'order';

  /**
   * 끌고 있는 행. `dataTransfer` 가 아니라 ref 인 이유는 프로토타입(`_drag`)과 같다 — 이 화면
   * 안에서만 오가는 정보이고, dragover 중에는 `dataTransfer.getData()` 가 보안상 빈 문자열을
   * 돌려주는 브라우저가 있어 판정에 쓸 수 없다.
   */
  const draggingId = useRef<string | null>(null);
  /**
   * 정렬 요청이 나가 있는 동안 — 두 번째 드롭을 **버리는** 빗장이다. 겹쳐 놓으면 두 요청이 각각
   * 자기가 본 순서 전체를 보내므로 나중 도착한 쪽이 먼저 도착한 옮김을 지운다(부분 갱신이 아니라
   * 통째로 덮어쓰기라서다 — `reorderBookmarks` JSDoc).
   */
  const reordering = useRef(false);

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
    // 이 표에서 시작한 드래그가 아니면(바깥에서 파일을 끌어다 놓는 등) 아무 일도 하지 않는다.
    if (sourceId === null || sourceId === targetId) return;
    if (reordering.current) return;
    /* 정렬이 '직접 지정한 순서'가 아니면 받지 않는다(위 `sortable`). 행에 `draggable` 을 걸지
       않는 것만으로는 부족하다 — 바깥에서 시작한 드래그의 drop 은 여전히 이 자리로 들어온다. */
    if (!sortable) return;

    /* **이 카테고리 목록 전체**를 보낸다 — `sort_order` 는 테이블 전체가 공유하는 컬럼 하나라
       일부만 보내면 보낸 것들이 0..k 로 앞당겨져 나머지와 뒤섞인다(`reorderBookmarks` JSDoc).
       그래서 기준은 언제나 `order`(= 이 카테고리 트리의 링크 전부)이지 화면에 보이는 일부가
       아니다 — I5 가 검색·필터를 붙여도 이 줄은 걸러지지 않은 목록을 넘겨야 한다. */
    const orderedIds = moveOnto(order, sourceId, targetId).map((link) => link.id);

    reordering.current = true;
    startTransition(async () => {
      moveLink({ sourceId, targetId });

      // **트랜지션 안에서 던지면 가장 가까운 오류 경계로 올라간다** — 이 화면 위의 경계는
      // `app/global-error.tsx` 하나뿐이라 순서 저장 한 번이 거부된 것으로 관리 화면 전체가
      // 오류 화면이 된다(CategoryPanel 과 같은 근거). `run` 이 잡아 실패 결과로 접는다.
      const result = await run(() => reorderBookmarks(orderedIds), '링크 정렬');
      reordering.current = false;

      if (!result.ok) toast(result.error);
    });
  }

  return (
    <>
      {/* 헤더는 링크가 없어도 그린다(프로토타입에서도 목록 밖이다). 다섯 칸의 폭은 행의 같은
          칸과 짝이 맞지만 손잡이 자리만큼 어긋나 있다 — 프로토타입 원문 그대로다. */}
      <div className={HEAD}>
        <span className="w-[250px] flex-none">링크</span>
        <span className="flex-1 min-w-0">한 줄 설명 — 눌러서 바로 고칩니다</span>
        <span className="w-[130px] flex-none">하위 카테고리</span>
        <span className="w-[46px] flex-none text-right">클릭</span>
        <span className="w-[56px] flex-none text-right">고정</span>
      </div>

      {order.length === 0 ? (
        /* 프로토타입에는 없는 상태다(항상 링크가 있었다). 헤더만 남으면 고장으로 보이므로 다음
           할 일을 가리킨다 — 가리키는 곳은 같은 상자 바로 위의 추가 줄이다. */
        <p className="px-[16px] py-[14px] text-[12px] text-fainter">
          아직 링크가 없습니다. 위 줄에서 첫 링크를 추가하세요.
        </p>
      ) : shown.length === 0 ? (
        /* 링크는 있는데 걸러 낸 결과가 비었다 — 위 문장은 여기서 **거짓말**이고(추가하라고 하면
           같은 이름의 링크가 하나 더 생긴다), 가리켜야 할 곳도 추가 줄이 아니라 바로 위 필터 줄이다. */
        <p className="px-[16px] py-[14px] text-[12px] text-fainter">
          조건에 맞는 링크가 없습니다. 검색어나 하위 필터를 지워 보세요.
        </p>
      ) : (
        /* 목록으로 낸다 — 스크린 리더가 몇 개인지, 지금 몇 번째인지 읽어 준다. 표(`role="table"`)로
           내지 않는 것은 이 행이 좁아지면 **줄바꿈**하기 때문이다(DESIGN_SPEC 6장 flex-wrap) —
           칸이 아래로 흐르는 배치에 표 역할을 씌우면 보조기기에 없는 격자를 알리게 된다. */
        <ul aria-label="링크 목록">
          {shown.map((link) => (
            <Row
              key={link.id}
              link={link}
              parent={category}
              subs={subs}
              sortable={sortable}
              onDragStart={(event) => handleDragStart(event, link.id)}
              onDragOver={handleDragOver}
              onDrop={(event) => handleDrop(event, link.id)}
              onDragEnd={() => {
                draggingId.current = null;
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function Row({
  link,
  parent,
  subs,
  sortable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  link: AdminLink;
  parent: AdminCategory;
  subs: readonly AdminSubCategory[];
  /** 지금 이 행을 끌어 옮길 수 있는가 — 정렬이 '직접 지정한 순서'일 때만 참이다(`Table` 참조). */
  sortable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  /**
   * 고치는 중인 설명. **읽는 시점은 마운트 한 번뿐이다** — 표가 열려 있는 동안 prop 이 새 값으로
   * 바뀌어도(다른 창의 수정이 revalidate 로 내려오는 경우) 여기서 적던 글자를 덮어쓰지 않는다
   * (J2 `InlineEdit` 의 baseline 과 같은 판단). 카테고리를 바꾸면 표 전체가 `key` 로 새로 서므로
   * 초안도 그때 사라진다.
   */
  const [draft, setDraft] = useState(link.description ?? '');
  /**
   * **마지막으로 서버에 넣은 설명.** 떠날 때마다 이 값과 견주어 바뀐 것이 없으면 서버까지 가지
   * 않는다 — 표를 훑으며 탭으로 지나가기만 해도 매번 저장이 나가면 안 된다. prop 이 아니라 이
   * 값과 견주는 이유: 저장이 끝난 직후에는 아직 새 prop 이 도착하지 않아 prop 은 옛 값이고,
   * 그때 blur 가 한 번 더 일어나면 같은 저장이 두 번 나간다.
   */
  const [saved, setSaved] = useState(link.description ?? '');
  /** 설명 저장이 나가 있는 동안 — 보조기기에 알리는 **보이는** 상태다. */
  const [savingDesc, setSavingDesc] = useState(false);

  /**
   * 세 동작이 각자 빗장을 갖는다. 하나로 합치지 않는 이유는 **떠나면서 누르는 길** 때문이다:
   * 설명 칸에서 고정 토글을 누르면 blur(저장 시작)와 click 이 잇달아 일어나는데, 빗장이 하나면
   * 그 클릭이 조용히 버려진다.
   *
   * 상태가 아니라 ref 인 것은 React 의 일괄 처리 때문이다 — 한 틱 안에 둘이 들어오면 둘 다 같은
   * 렌더의 클로저를 보므로 상태 가드는 아직 false 다(I1·J2·J3 와 같은 장치).
   */
  const savingDescRef = useRef(false);
  const movingRef = useRef(false);
  const pinningRef = useRef(false);

  /** 고정 토글이 나가 있는 동안. `disabled` 를 걸지 않는 이유는 아래 버튼의 주석에 있다. */
  const [pinning, setPinning] = useState(false);
  /**
   * 하위 이동이 나가 있는 동안. 여기만 상태가 아니라 **트랜지션의 pending** 인 이유는 아래
   * 낙관값 때문이다 — 트랜지션 안에서 `setState` 를 하면 그 갱신이 트랜지션의 일부가 되어
   * 낙관값이 걷히는 시점이 한 틱 밀린다(거절당했는데 고른 값이 남아 있는 구간이 생긴다).
   * `isPending` 은 트랜지션 자체가 알려 주는 값이라 그 문제가 없다.
   */
  const [moving, startMove] = useTransition();

  const icon = link.faviconUrl !== null && link.faviconUrl.trim() !== '' ? link.faviconUrl : null;

  /**
   * select 에 보일 값. 목록에 없는 하위를 가리키고 있으면 `—` 로 접는다 — 하위를 지우면 서버가
   * 그 안의 링크를 상위로 올리는데(`deleteSubCategory`), 새 목록과 새 링크 행이 도착하는 사이에
   * 옛 값이 한 프레임 남을 수 있다. 그때 select 의 value 가 어느 option 과도 맞지 않으면 브라우저는
   * **아무것도 고르지 않은** 빈 칸을 보여 준다 — 있지도 않은 하위에 속한 것처럼 보이는 대신
   * 사실(상위 직속)을 그린다.
   */
  const subValue = subs.some((sub) => sub.id === link.categoryId) ? link.categoryId : '';

  /**
   * select 가 실제로 그리는 값. **고른 것을 그 자리에서 보여 주기 위해** 낙관값을 하나 얹는다 —
   * 값이 prop 에서만 오면 React 는 다시 그릴 때 고른 값을 되돌려 놓아, 사람은 옮겼는데 칸은
   * 옛 하위를 가리키는 구간이 서버 왕복 내내 이어진다(고정 토글에는 이 문제가 없다: 그쪽은
   * 늦게 따라올 뿐 다른 값으로 **되돌아가지** 않는다).
   *
   * 트랜지션이 끝나면 이 값은 걷히고 서버가 이긴다 — 성공했으면 그때 새 prop 이 함께 도착해
   * 눈에는 이어져 보이고, 거절당했으면 원래 하위로 돌아간다(좌측 패널의 낙관 순서와 같은 성질).
   */
  const [shownSub, showSub] = useOptimistic(subValue, (_current: string, next: string) => next);

  async function saveDescription(): Promise<void> {
    if (savingDescRef.current) return;

    // 서버가 `asText` 로 다듬으므로 여기서도 다듬은 값끼리 견준다 — 앞뒤 공백만 붙였다 떼는
    // 왕복을 만들지 않는다(SubCategoryRow 의 이름 수정과 같은 판단).
    const clean = draft.trim();
    if (clean === saved.trim()) return;

    savingDescRef.current = true;
    setSavingDesc(true);

    const result = await run(() => updateBookmark(link.id, { description: clean }), '설명 저장');

    savingDescRef.current = false;
    setSavingDesc(false);

    if (!result.ok) {
      // 적은 것은 지우지 않는다 — 거절 사유를 보고 이어서 고칠 값이다.
      toast(result.error);

      return;
    }

    // 기준선을 옮기는 것과 알리는 것뿐이라 화면에서 사라지는 것이 없다 — 트랜지션으로 묶을
    // 커밋이 따로 없다(닫히는 폼이 있는 I2·J2 와 다른 점).
    setSaved(clean);
    toast(`${link.title} 설명 저장됨`);
  }

  function handleDescSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    void saveDescription();
  }

  function moveToSub(nextValue: string): void {
    if (movingRef.current) return;

    // `—` 는 "하위 없음"이지 "카테고리 없음"이 아니다 — 링크는 언제나 어딘가에 속하므로
    // 상위 자신으로 되돌린다(`updateBookmark` 는 빈 categoryId 를 거부한다).
    const categoryId = nextValue === '' ? parent.id : nextValue;
    if (categoryId === link.categoryId) return;

    const target = subs.find((sub) => sub.id === categoryId);

    movingRef.current = true;

    /* 낙관값과 요청이 **한 트랜지션 안**에 있어야 한다 — `await` 가 트랜지션을 붙들고 있는
       동안만 위 `shownSub` 가 살아 있고, 끝나는 순간 서버 값으로 정리된다. 밖에서 부르면
       React 가 "트랜지션·액션 밖의 낙관 갱신"이라고 경고하고 값도 곧바로 걷힌다. */
    startMove(async () => {
      showSub(nextValue);

      const result = await run(() => updateBookmark(link.id, { categoryId }), '하위 카테고리 지정');

      movingRef.current = false;

      // 토스트는 React 상태가 아니라 곁가지라 트랜지션에 얹혀도 낙관값 해제를 미루지 않는다.
      toast(result.ok ? `${link.title} → ${target?.name ?? parent.name}` : result.error);
    });
  }

  async function toggle(): Promise<void> {
    if (pinningRef.current) return;

    pinningRef.current = true;
    setPinning(true);

    const result = await run(() => togglePin(link.id), '매일 고정');

    pinningRef.current = false;
    setPinning(false);

    // 프로토타입 693–694행의 두 문장 그대로다. 실패 문구는 서버가 준 것을 그대로 쓴다
    // (13번째 고정을 막는 `매일 고정은 최대 12개입니다.` 가 이 길로 나온다).
    if (!result.ok) {
      toast(result.error);

      return;
    }

    toast(link.isPinned ? `${link.title} 고정 해제` : `${link.title} 매일 보는 곳에 고정`);
  }

  return (
    <li
      draggable={sortable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={ROW}
    >
      {/* 손잡이는 장식이라 이름을 주지 않는다 — 집는 자리를 알려 줄 뿐, 행 전체가 draggable 이다.
          끌 수 없는 동안에도 자리는 지킨다(위 `HANDLE_OFF` 주석). */}
      <span
        aria-hidden="true"
        data-testid="handle"
        className={`${HANDLE} ${sortable ? HANDLE_ON : HANDLE_OFF}`}
      />

      <span data-testid="name-cell" className={NAME_CELL}>
        {/* 파비콘은 배경 이미지다(프로토타입·카드와 같은 방식) — 없으면 선언 자체를 걸지 않는다.
            `url("null")` 이 나가면 깨진 이미지가 되고, 회색 타일이라는 빈 상태가 사라진다. */}
        <span
          aria-hidden="true"
          data-testid="favicon"
          className={FAVICON}
          style={icon === null ? undefined : { backgroundImage: cssUrl(icon) }}
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-ink truncate">{link.title}</span>
          {/* 주소 표기는 카드 하단 줄과 같은 규칙이다(`hostOf` — 맨 앞 `www.` 만 뗀다). */}
          <span className="block text-[10.5px] text-muted truncate">{hostOf(link.url)}</span>
        </span>
      </span>

      {/* 폼으로 낸다 — 칸에서 Enter 가 곧 저장이다(HTML 암묵적 제출). keydown 으로 직접 듣지
          않는 이유는 조합 입력(IME)이다: 한글을 확정하는 Enter 로 저장이 일어나면 안 되는데,
          그 판정은 브라우저가 이미 한다(I1·I2·I3·J2 와 같은 근거).
          **폭 규칙이 입력이 아니라 폼에 붙는다** — flex 항목이 된 것이 폼이라 `flex:1 1 240px;
          min-width:240px`(DESIGN_SPEC 6장)를 폼이 져야 그 자리에서 줄바꿈이 일어난다. 입력은
          그 안을 가득 채우므로(`w-full`) 눈에 보이는 크기는 스펙 값 그대로다. */}
      <form onSubmit={handleDescSubmit} className={DESC_CELL}>
        {/* placeholder 는 값이 들어가면 사라져 이름 역할을 못 하고, 같은 칸이 행마다 반복되므로
            접근성 이름에 어느 링크의 설명인지 담는다(하위 칩의 `${sub.name} 이름 수정` 과 같은 방식). */}
        {/* 저장이 나가 있는 동안에는 값을 잠근다. `disabled` 가 아니라 `readOnly` 인 것은 포커스
            때문이다 — 브라우저는 disabled 가 된 요소에서 포커스를 body 로 떨어뜨려 적던 사람이
            자리를 잃는다(J2 `InlineEdit` 과 같은 짝).
            **잠그는 이유는 조용한 유실이다**: 왕복 중에 더 적고 떠나면 그 blur 가 부른 저장을
            `savingDescRef` 가 버리는데, 방금 적은 글자는 초안에만 남아 다시 나갈 길이 없다
            (초안은 prop 이 새로 와도 덮이지 않는다 — 위 `draft` 주석). */}
        <input
          aria-label={`${link.title} 한 줄 설명`}
          aria-busy={savingDesc}
          readOnly={savingDesc}
          placeholder="설명을 직접 적으세요"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void saveDescription()}
          className={DESC_FIELD}
        />
      </form>

      {/* 잠그지 않는다(`disabled` 없음) — 잠긴 select 는 초점을 잃어, 키보드로 고른 사람이 방금
          자기가 있던 자리에서 튕겨 나간다. 이중 제출은 위 `movingRef` 가 막는다. */}
      <select
        aria-label={`${link.title} 하위 카테고리`}
        aria-busy={moving}
        value={shownSub}
        onChange={(event) => moveToSub(event.target.value)}
        className={SUB_FIELD}
      >
        {/* `—` 가 "하위 미지정"이다(프로토타입 1118행 `['—'].concat(...)`). 값은 빈 문자열이라
            하위 id 와 섞이지 않는다. */}
        <option value="">—</option>
        {subs.map((sub) => (
          <option key={sub.id} value={sub.id}>
            {sub.name}
          </option>
        ))}
      </select>

      <span data-testid="clicks" className={CLICKS}>
        <EyeIcon />
        {link.clickCount}
      </span>

      {/* 이름은 상태에 따라 바뀌지 않는다 — 눌린 상태는 `aria-pressed` 가 알리고, 이름이 함께
          바뀌면 스크린 리더에 같은 사실이 두 번 실린다. 눈에 보이는 글자(`고정`/`☆`)는
          프로토타입 그대로다.
          여기도 `disabled` 를 걸지 않는다 — 방금 누른 버튼이 잠기면 초점이 문서로 튕겨 나가
          키보드 사용자가 자리를 잃는다. 이중 제출은 `pinningRef` 가 막는다. */}
      <button
        type="button"
        aria-label={`${link.title} 매일 고정`}
        aria-pressed={link.isPinned}
        aria-busy={pinning}
        onClick={() => void toggle()}
        className={`${PIN} ${link.isPinned ? PIN_ON : PIN_OFF}`}
      >
        {link.isPinned ? '고정' : '☆'}
      </button>
    </li>
  );
}
