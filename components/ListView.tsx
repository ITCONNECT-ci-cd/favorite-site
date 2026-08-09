'use client';

import { useCallback, useState } from 'react';
import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { DeleteConfirm } from '@/components/card/DeleteConfirm';
import { InlineEdit } from '@/components/card/InlineEdit';
import { QuickAddCard } from '@/components/card/QuickAddCard';
import type { QuickAddCategory } from '@/components/card/quick-add-options';
import { useCardHandlers } from '@/components/useCardHandlers';
import type { BookmarkWithCount } from '@/lib/types';

/**
 * '+ 링크 추가' 타일(K1)에 필요한 것 — **이 목록이 진짜 분류 목록일 때만** 준다.
 *
 * 이 화면은 카테고리뿐 아니라 즐겨찾기(localStorage 파생)·매일(`is_pinned` 파생)도 그리는데,
 * 그 둘에 '추가'는 의미가 어긋난다: 담는 일은 카드의 핀이 하고(즐겨찾기), 고정은 관리 화면의
 * 몫이라(매일) 여기서 만든 링크는 그 목록에 나타나지도 않는다. 그래서 타일의 유무를
 * `isAdmin` 하나로 정하지 않고 **호출부가 이 값을 주는가**로도 가른다 — 파생 목록을 그리는
 * 화면(app/(public)/favorites·daily)은 주지 않는다.
 */
export type QuickAdd = {
  /** 분류 선택 상자에 세울 목록 — 서버가 `toQuickAddOptions` 로 추려 내려보낸다. */
  categories: readonly QuickAddCategory[];
  /**
   * '전체' 탭에서 열었을 때 미리 골라 둘 분류 = 이 화면의 상위 분류.
   * 하위 탭을 고른 상태에서는 **그 하위**가 기본값이 된다(아래 렌더 참조) — 지금 보이는 목록에
   * 한 건 더 붙이는 것이 가장 흔한 의도다.
   */
  defaultCategoryId: string;
};

/** 칩 하나 = 하위 분류 하나. 개수는 사이드바와 같은 값이어야 하므로 화면(서버)이 계산해 넘긴다. */
export type SubTab = {
  id: string;
  name: string;
  count: number;
};

export type ListViewProps = {
  /** 화면 제목 20px/700 — 하위 id 로 들어와도 **상위 이름**이다. */
  title: string;
  /** 제목 아래 한 줄. 없는 화면(하위 없는 분류)도 있어 선택이다. */
  description?: string;
  /**
   * 화면에 걸린 링크 전부 — 상위 직속 + 모든 하위. 탭 필터는 이 배열 안에서만 일어난다.
   * 정렬은 넘겨준 순서를 그대로 따른다(서버가 sort_order 로 정렬해 준다).
   */
  bookmarks: BookmarkWithCount[];
  /** 하위 분류. 비었거나 없으면 칩 줄 자체를 렌더하지 않는다. */
  subTabs?: SubTab[];
  /** 처음 선택된 하위 id. 상위 id 로 들어왔으면 null(= 전체). */
  initialSubId?: string | null;
  /** 빈 상태 문구 — 분류는 `이 분류에 링크가 없습니다.`, 즐겨찾기는 다른 문구다(DESIGN_SPEC 4장). */
  emptyMessage: string;
  /**
   * 서버가 관리자 세션을 확인했는가 (J1) — 지금 보이는 카드에 그대로 흘린다.
   *
   * 이 화면은 판정하지 않고 나르기만 한다. 참이면 카드가 연필·휴지통을 **렌더**하고,
   * 거짓이면 그 마크업이 응답에 실리지 않는다(LinkCard 의 isAdmin JSDoc).
   *
   * **필수다 — 기본값을 두지 않는다.** 기본값이 있으면 이 화면을 새로 쓰는 서버 컴포넌트가
   * `getAdminSession()` 배선을 빠뜨려도 아무것도 실패하지 않고 조용히 '관리자 아님'으로 그려진다.
   * 그 화면에서는 관리자가 로그인해도 연필이 영영 안 나오는데, 테스트도 타입도 알려 주지 않는다
   * (Header 의 `onSearchClick` 을 필수로 둔 것과 같은 판단이다). 카드(LinkCard)의 같은 이름 prop 은
   * 반대로 선택이다 — 거기서는 기본값 자체가 안전한 쪽(fail-closed)이고, 카드를 쓰는 자리가 많다.
   */
  isAdmin: boolean;
  /**
   * 관리자가 이 목록에서 곧바로 링크를 추가할 수 있게 한다 (K1). 위 `QuickAdd` 참조.
   *
   * **`isAdmin` 과 둘 다 참일 때에만** 타일이 렌더된다 — 이 값만으로 그리면 비로그인 응답에
   * 관리자 전용 마크업이 실린다.
   */
  quickAdd?: QuickAdd;
};

/** 칩 — 12.5px, 패딩 6px 12px, 라운드 7px (DESIGN_SPEC 1장 "칩 6~7px" · 4장). */
const CHIP = 'cursor-pointer rounded-[7px] border px-[12px] py-[6px] text-[12.5px]';
const CHIP_ON = 'border-ink bg-ink font-semibold text-white';
/** 비선택 칩의 글자색은 스펙 표에 없는 프로토타입 고유값이라 임의 값으로 옮긴다(사이드바와 같은 처리). */
const CHIP_OFF = 'border-border-strong bg-card font-normal text-[#3a3833]';

/** 툴바 버튼 둘의 공통 몸통 — 높이 32px, 패딩 0 13px, 라운드 7px, 12px/600 (프로토타입 원값). */
const TOOL_BUTTON =
  'flex h-[32px] cursor-pointer items-center rounded-[7px] px-[13px] text-[12px] font-semibold whitespace-nowrap';
/** `전체 N개 열기` — 검은 버튼 (DESIGN_SPEC 4장). */
const OPEN_ALL = `${TOOL_BUTTON} bg-ink text-white hover:bg-ink-hover`;
/** `선택 N개 열기` — 흰 버튼. 호버에서 테두리만 잉크로 바뀐다. */
const OPEN_CHECKED = `${TOOL_BUTTON} border border-border-strong bg-card hover:border-ink`;
/** `선택 해제` — 버튼 모양 없이 글자만. */
const CLEAR_CHECKED = 'cursor-pointer text-[11.5px] text-faint hover:text-ink';

/**
 * 툴바 우측 안내문. 프로토타입 원문(`체크한 것만 열거나, 전체를 크롬 탭 그룹으로 묶어 엽니다`)의
 * 뒷부분을 실제 동작에 맞춘다 — 이 버튼이 하는 일은 새 탭 여러 개를 여는 것까지다
 * (계획서 V7 편차. 근거는 lib/clicks 의 `bulkOpenToastText` JSDoc).
 */
const TOOLBAR_NOTE = '체크한 것만 열거나, 전체를 새 탭으로 한 번에 엽니다';

/**
 * 카테고리 · 내 즐겨찾기 · 매일 사용하는 사이트가 공유하는 목록 화면 (DESIGN_SPEC 4장).
 *
 * 본문은 **홈과 똑같은 카드 그리드**다 — 이 화면만의 행 목록을 따로 만들지 않는다.
 *
 * 하위 탭은 URL 이 아니라 이 컴포넌트의 상태다. 사이드바에서 하위 링크(`/category/<하위id>`)로
 * 들어오면 서버가 `initialSubId` 로 알려 주고, 그 뒤 칩 클릭은 URL 을 건드리지 않는다.
 * 그 귀결로, 칩으로 탭을 옮긴 뒤 지금 활성인 사이드바 하위 링크를 다시 눌러도 URL 이 그대로라
 * 칩은 되돌아오지 않는다(같은 주소로의 이동에는 아무 일도 일어나지 않는다).
 *
 * **선택 상태를 지키는 장치가 셋이고 역할이 다르다. 하나를 지우면 나머지가 대신해 주지 않는다.**
 * 1. 호출부의 `key={분류 id}` (app/category/[id]/page.tsx) — **분류 간 왕복**을 막는다.
 *    A 에서 하위를 고르고 B 에 들렀다 A 로 돌아오면 그 선택은 버려야 한다. 되돌아온 A 에는
 *    그 하위 탭이 그대로 있어 아래 3번으로는 걸러지지 않으므로, 리마운트만이 이 경우를 잡는다.
 * 2. 아래 `seenInitial` 조정 — **같은 분류 안에서 상위↔하위 이동**. 라우트도 화면 정체성도
 *    그대로라 리마운트가 없고, 서버가 준 `initialSubId` 변화만이 신호다.
 * 3. `activeId` 의 fallback — 소비자가 `key` 없이 이 컴포넌트를 재사용해 탭 목록만 갈아 끼우는
 *    경우의 방어선이다. 지금의 앱 경로에서는 1·2 가 먼저 잡아 도달하지 않는다.
 */
export function ListView({
  title,
  description,
  bookmarks,
  subTabs,
  initialSubId = null,
  emptyMessage,
  isAdmin,
  quickAdd,
}: ListViewProps) {
  // 핀 토글(D6)·카드 열기(F3)·한 번에 열기(G4)는 홈과 글자 하나까지 같은 배선이라 훅 하나가
  // 들고 있다. `useFavorites` 도 그 안에서 뷰당 한 번만 불린다(lib/favorites.ts 사용 규칙).
  const { favs, handleToggleFav, handleOpen, openMany } = useCardHandlers(bookmarks);

  const tabs = subTabs ?? [];
  const [selected, setSelected] = useState(initialSubId);

  /**
   * 체크한 카드 (DESIGN_SPEC 4장 — '선택 N개 열기'). 탭을 옮길 때마다 비운다.
   *
   * 비우지 않으면 지금 화면에 보이지도 않는 카드가 '선택 N개 열기'에 딸려 열린다. 프로토타입도
   * 탭 이동(`aiTabs.go`)과 화면 이동(`nav`)에서 `checked: {}` 로 되돌린다. 아래 `checkedItems` 가
   * `shown` 과 교차하는 것은 그 위의 이중 안전장치다 — 목록(props)이 통째로 갈리는 경우까지 막는다.
   */
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  // 이미 비어 있으면 **같은 객체를 그대로** 돌려준다 — 렌더 중에도 불리는 함수라(아래 장치 2)
  // 매번 새 Set 을 넣으면 고를 것도 없는데 렌더가 한 번 더 돈다.
  const clearChecked = useCallback(() => {
    setChecked((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  /**
   * 지금 편집 중인 카드 (J2). **'동시에 한 장만'은 이 값이 하나뿐이라는 데서 그대로 나온다** —
   * 다른 카드의 연필을 누르면 id 가 덮여 앞 카드의 폼이 사라진다. 카드는 이 규칙을 모른다
   * (LinkCard 의 isEditing JSDoc: 판정도 상태도 여러 카드를 아는 화면이 든다).
   *
   * 탭을 옮길 때 비우지 않는다 — 체크(`checked`)와 사정이 다르다. 안 보이는 카드의 체크는
   * '선택 N개 열기'가 실제로 집어 가지만(그래서 비운다), 안 보이는 편집 대상은 아무도 집어 가지
   * 않는다. 폼은 그 카드가 목록에서 빠지는 순간 함께 사라진다. 프로토타입도 탭 이동에서
   * `editId` 를 건드리지 않는다.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * 지금 삭제를 묻고 있는 카드 (J3). `editingId` 와 같은 모양·같은 이유로 하나뿐이고, 탭을 옮길 때
   * 비우지 않는 것도 같다 — 안 보이는 카드의 확인창은 아무도 집어 가지 않고, 그 카드가 목록에서
   * 빠지는 순간 오버레이도 함께 사라진다.
   *
   * **편집과는 서로를 밀어낸다**(아래 두 콜백). 프로토타입이 `askDel` 에서 `editId: null` 을,
   * `startEdit` 에서 `confirmId: null` 을 함께 넣는 것과 같다(930·928행).
   */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleToggleCheck = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      // delete 는 지운 것이 있을 때만 true 다 — 있으면 빼고 없으면 담는 토글이 한 줄로 끝난다.
      if (!next.delete(id)) next.add(id);

      return next;
    });
  }, []);

  /**
   * 장치 2 — 같은 분류 안에서 상위↔하위를 오가면 리마운트가 없으므로(위 JSDoc),
   * 서버가 준 선택이 바뀔 때 렌더 중에 맞춘다(렌더 중 상태 조정 패턴 — Sidebar 의 펼침 처리와 같다).
   * 칩 클릭과 같은 '탭 이동'이므로 체크도 함께 비운다.
   */
  const [seenInitial, setSeenInitial] = useState(initialSubId);
  if (seenInitial !== initialSubId) {
    setSeenInitial(initialSubId);
    setSelected(initialSubId);
    clearChecked();
  }

  /**
   * 장치 3 — 고른 하위가 지금 탭 목록에 아예 없으면 전체로 본다.
   * `key` 없이 props 만 갈아 끼우는 소비자를 위한 방어선이지, 분류 간 왕복을 막아 주지는 못한다
   * (돌아온 분류에는 그 하위가 다시 있으므로 이 조건에 걸리지 않는다 — 위 JSDoc 1번 참조).
   */
  const activeId = tabs.some((tab) => tab.id === selected) ? selected : null;
  const activeTab = tabs.find((tab) => tab.id === activeId);
  const shown =
    activeId === null
      ? bookmarks
      : bookmarks.filter((bookmark) => bookmark.category_id === activeId);

  // 보이는 것 중에서만 고른다 — 선택은 탭을 옮길 때 비워지지만(위 `checked` 주석), 목록 자체가
  // 갈리는 경우까지 여기서 잘라 낸다. 순서는 `shown`(sort_order) 을 따라 체크한 차례와 무관하다.
  const checkedItems = shown.filter((bookmark) => checked.has(bookmark.id));

  /** 탭 그룹 명칭 — 프로토타입 `openMany` 의 두 번째 인자(`st.sub ? key + ' · ' + sub : key`). */
  const groupLabel = activeTab === undefined ? title : `${title} · ${activeTab.name}`;

  return (
    <main>
      <div className="mb-[14px]">
        <div className="mb-[3px] flex items-baseline gap-[11px]">
          <h1 className="text-[20px] font-bold tracking-[-0.02em]">{title}</h1>
          {/* 개수는 '지금 보이는 링크 수'다 — 하위 탭을 고르면 함께 줄어든다(프로토타입 listCount). */}
          <span className="text-[12px] text-fainter">{shown.length}개</span>
        </div>
        {description !== undefined && description !== '' && (
          <p className="text-[12.5px] text-desc">{description}</p>
        )}
      </div>

      {tabs.length > 0 && (
        <div
          role="group"
          aria-label="하위 분류"
          className="mb-[14px] flex flex-wrap gap-[6px]"
        >
          {[{ id: null, name: '전체', count: bookmarks.length }, ...tabs].map((tab) => {
            const on = tab.id === activeId;

            return (
              <button
                key={tab.id ?? '전체'}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSelected(tab.id);
                  // 탭을 옮기면 선택을 버린다 — 프로토타입 `aiTabs.go` 와 같다.
                  clearChecked();
                }}
                className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
              >
                {tab.name} <span className="opacity-60">{tab.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 툴바 (DESIGN_SPEC 4장). 목록이 비어도 남는다 — 프로토타입도 목록 화면이면 언제나 그리고,
          '열 것이 없다'는 말은 눌렀을 때 토스트가 한다(lib/clicks 의 bulkOpenToastText).
          칩 줄과 마찬가지로 묶음에 이름을 준다 — 버튼 셋이 한 가지 일(여는 방법 고르기)로 묶인다. */}
      <div
        role="group"
        aria-label="한 번에 열기"
        className="mb-[12px] flex items-center gap-[8px]"
      >
        <button
          type="button"
          onClick={() => openMany(shown, groupLabel)}
          className={OPEN_ALL}
        >
          전체 {shown.length}개 열기
        </button>
        <button
          type="button"
          onClick={() => openMany(checkedItems, groupLabel)}
          className={OPEN_CHECKED}
        >
          선택 {checkedItems.length}개 열기
        </button>
        <button type="button" onClick={clearChecked} className={CLEAR_CHECKED}>
          선택 해제
        </button>
        {/* 프로토타입 `descColDisplay`(narrow ? none : block) 그대로 — <820px 에서는 숨는다. */}
        <span className="ml-auto hidden text-[11.5px] text-fainter min-[820px]:block">
          {TOOLBAR_NOTE}
        </span>
      </div>

      {/* 목록이 비면 안내 박스만 남는다 — 타일도 함께 사라진다. 빈 분류에 링크를 넣는 길이
          막히지는 않는다: 홈 타일의 분류 상자에서 어느 분류든 고를 수 있다(K1). 그 한 경우를
          위해 빈 상태 화면(DESIGN_SPEC 4장)에 격자를 하나 더 세우지 않는다. */}
      {shown.length === 0 ? (
        <EmptyBox>{emptyMessage}</EmptyBox>
      ) : (
        <CardGrid
          /* '+ 링크 추가' 타일 (K1) — 카드보다 앞, 그리드 첫 칸이다.

             기본 분류는 **지금 보고 있는 탭**이다: 하위 탭을 골랐으면 그 하위, '전체'면 화면의
             상위 분류. 탭으로 좁혀 놓고 추가하면 방금 보던 목록에 그대로 한 장이 더 붙는다.
             (`activeId` 는 탭 목록에 실제로 있는 id 만 통과한 값이라 없는 분류로 새지 않는다.) */
          lead={
            isAdmin && quickAdd !== undefined ? (
              <QuickAddCard
                categories={quickAdd.categories}
                defaultCategoryId={activeId ?? quickAdd.defaultCategoryId}
              />
            ) : undefined
          }
        >
          {shown.map((bookmark) => {
            // 같은 판정을 플래그와 슬롯이 나눠 쓰므로 한 번만 계산한다 — 두 자리에 적어 두면
            // 한쪽만 고쳐져 '폼 없는 빈 카드'(LinkCard 의 isEditing JSDoc)가 만들어질 수 있다.
            const isEditing = editingId === bookmark.id;
            const isDeleting = deletingId === bookmark.id;

            return (
              // showPin 은 LinkCard 기본값(true)을 그대로 쓴다 — 목록 화면은 전부 핀이 보인다.
              // 체크는 이 화면들만 켠다(계획서 V3) — 홈에는 없다. 켜진 카드의 잉크 테두리는
              // 카드가 알아서 처리한다(C2).
              <LinkCard
                key={bookmark.id}
                bookmark={bookmark}
                showCheck
                checked={checked.has(bookmark.id)}
                onToggleCheck={handleToggleCheck}
                isFaved={favs.has(bookmark.id)}
                onToggleFav={handleToggleFav}
                onOpen={handleOpen}
                // 관리자 전용 연필·휴지통 (J1).
                isAdmin={isAdmin}
                // 연필 → 이 카드의 본문·하단을 편집 폼으로 교체 (J2). 플래그와 노드를 함께 준다 —
                // 하나만 주면 카드가 무시하도록 되어 있지만(폼 없는 빈 카드 금지) 애초에 어긋나지 않게 한다.
                // 편집을 열면 묻고 있던 삭제는 닫는다 (프로토타입 928행 `startEdit`).
                onEdit={(id) => {
                  setEditingId(id);
                  setDeletingId(null);
                }}
                isEditing={isEditing}
                editSlot={
                  isEditing ? (
                    <InlineEdit bookmark={bookmark} onDone={() => setEditingId(null)} />
                  ) : undefined
                }
                // 휴지통 → 카드 위에 삭제 확인 오버레이 (J3). **여기서 지우지 않는다** — 이 콜백은
                // '삭제'가 아니라 '삭제를 묻기'이고(DESIGN_SPEC 2-1), 지우는 일은 오버레이의 `삭제` 가 한다.
                // 삭제를 물으면 열려 있던 편집은 닫는다 (프로토타입 930행 `askDel`).
                onDelete={(id) => {
                  setDeletingId(id);
                  setEditingId(null);
                }}
                deleteSlot={
                  isDeleting ? (
                    <DeleteConfirm bookmark={bookmark} onDone={() => setDeletingId(null)} />
                  ) : undefined
                }
              />
            );
          })}
        </CardGrid>
      )}
    </main>
  );
}
