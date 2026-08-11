'use client';

import Link from 'next/link';
import { useState } from 'react';

import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { SectionHeader } from '@/components/SectionHeader';
import { DeleteConfirm } from '@/components/card/DeleteConfirm';
import { InlineEdit } from '@/components/card/InlineEdit';
import { QuickAddCard } from '@/components/card/QuickAddCard';
import { toQuickAddOptions } from '@/components/card/quick-add-options';
import { useCardHandlers } from '@/components/useCardHandlers';
import { useCardReorder } from '@/components/useCardReorder';
import { FAVORITES_TITLE, OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { FAV_GROUPS, groupFavorites } from '@/lib/fav-groups';
import { pickFavorites } from '@/lib/favorites';
import { reorderFavorites } from '@/lib/mutations';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';

export type HomeViewProps = {
  /** 서버(app/page.tsx)가 getAllData 로 읽어 넘긴 전체 데이터. 두 배열 모두 sort_order 순이다. */
  data: SiteData;
  /**
   * 서버가 관리자 세션을 확인했는가 (J1) — 모든 섹션의 카드에 그대로 흘린다.
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
};

/**
 * 담은 즐겨찾기가 **하나도 없을 때만** 나오는 안내. 원문(DESIGN_SPEC 3장)에서 '매일 사용하는
 * 사이트와 달리…' 대목을 뺐다 — 그 목록이 없어져(2026-08-10) 비교 대상이 사라졌다.
 *
 * 세 묶음이 각자 빈 상자를 그리지 않고 **전체가 비었을 때 한 번만** 그린다. 담긴 것이 없는 사람
 * 화면에 똑같은 안내가 셋 쌓이면 그건 안내가 아니라 벽이다.
 */
const EMPTY_FAVS_TEXT =
  '다른 화면에서 카드 오른쪽 위의 핀을 누르면 이 자리에 모입니다. 담고 빼는 것은 관리자 몫이고, 담긴 목록은 모두에게 같습니다.';

/**
 * '현재 운영 중인 사이트' 상위 카테고리와 그 하위까지의 id 집합. 없으면 null(섹션을 접는다).
 *
 * 판정은 D1 `findOperatingCategoryId` 와 같다(상위 중 이름이 상수와 같은 것). 그 함수를 그대로
 * 쓰지 못하는 것은 `lib/queries` 가 `next/headers` 를 끌고 와 클라이언트 컴포넌트에서 import 할
 * 수 없기 때문이다 — 홈은 즐겨찾기(localStorage) 때문에 클라이언트 컴포넌트여야 한다.
 *
 * 하위까지 포함하는 것은 사이드바 개수(D1 rollupCounts — 하위 합산)와 이 섹션의 "N개"가
 * 어긋나지 않게 하기 위해서다. 시드 실측으로는 이 카테고리에 하위가 없어 둘 다 16개다.
 */
function findOperatingIds(categories: readonly Category[]): { id: string; ids: Set<string> } | null {
  const top = categories.find(
    (category) => category.parent_id === null && category.name === OPERATING_CATEGORY_NAME,
  );
  if (top === undefined) return null;

  const ids = new Set([top.id]);
  for (const category of categories) {
    if (category.parent_id === top.id) ids.add(category.id);
  }

  return { id: top.id, ids };
}

/**
 * 홈 — 즐겨찾기 세 묶음(AI 소식 · AI 서비스 · 업무용 서비스)과 '현재 운영 중인 사이트'를
 * 위에서 아래로 둔다.
 *
 * DESIGN_SPEC 3장의 원래 구성은 '내 즐겨찾기 / 매일 사용하는 사이트 / 현재 운영 중인 사이트'
 * 였다. 2026-08-10 사용자 결정으로 **'매일'은 통째로 걷어내고**(실제로 쓰지 않았다) 즐겨찾기를
 * 세 묶음으로 나눴다. 스펙만 보고 되살리지 마라.
 *
 * 스펙 3장 "하단 안내"(`나머지 N개는 왼쪽 사이드바에서…` 점선 박스)는 **의도적으로 빼 둔 것**이다
 * (계획서 V6 편차 — 사용자 결정). 스펙만 보고 되살리지 마라.
 *
 * 즐겨찾기는 브라우저에만 있으므로 뷰 전체가 클라이언트 컴포넌트다. 핀 토글(D6)·카드 열기(F3)·
 * 한 번에 열기(G4) 배선은 목록 화면과 공유하는 `useCardHandlers` 가 들고 있고, 그 훅이
 * `useFavorites` 를 **한 번만** 불러 결과를 돌려준다 — 카드마다 부르면 렌더 때마다 카드 수만큼
 * 동기 localStorage 읽기가 생긴다(E1 규약).
 *
 * 모든 섹션이 같은 배선을 쓴다: 즐겨찾기든 분류에서 온 것이든 클릭 집계 대상인 것은 같다.
 *
 * `isAdmin` 도 모든 섹션에 같이 준다 — 관리자가 고칠 수 있는 대상은 '어느 섹션에 놓였는가'와
 * 무관하다. 연필이 하는 일(J2 인라인 편집)은 아래 `editingId` 가, 휴지통이 하는 일(J3 삭제 확인)은
 * `deletingId` 가 든다. 두 상태는 서로를 밀어낸다 — 그 이유는 각 선언에 적어 두었다.
 *
 * **추가(K1)만은 고루 두지 않는다** — '현재 운영 중인 사이트' 섹션 하나에만 선다.
 * 근거는 그 섹션의 `lead` 주석에 있다.
 */
export function HomeView({ data, isAdmin }: HomeViewProps) {
  const { categories, bookmarks } = data;
  const { handleToggleFav, handleOpen, openMany } = useCardHandlers(bookmarks);

  /**
   * 지금 편집 중인 카드 (J2). **'동시에 한 장만'은 이 값이 하나뿐이라는 데서 그대로 나온다** —
   * 다른 카드의 연필을 누르면 id 가 덮여 앞 카드의 폼이 사라진다. 카드는 이 규칙을 모른다
   * (LinkCard 의 isEditing JSDoc: 판정도 상태도 여러 카드를 아는 화면이 든다).
   *
   * 섹션이 여럿이어도 상태는 **하나**다. 같은 화면 안에서 섹션을 넘나들어도 폼은 한 장이어야 한다.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * 지금 삭제를 묻고 있는 카드 (J3). `editingId` 와 같은 모양이고, 같은 이유로 하나뿐이다 —
   * 확인 오버레이도 동시에 한 링크에만 뜬다.
   *
   * **편집과는 서로를 밀어낸다**(아래 두 헬퍼). 프로토타입이 `askDel` 에서 `editId: null` 을,
   * `startEdit` 에서 `confirmId: null` 을 함께 넣는 것과 같다(930·928행). 한 카드에 폼과
   * 오버레이가 겹쳐 뜨면 오버레이가 자기 폼을 덮어 버리고, 다른 카드에 남는 확인창은 아무도
   * 닫지 않는 유령이 된다.
   */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /**
   * 모든 섹션이 카드에 똑같이 내려보내는 편집 배선 한 벌. 렌더 지점이 여럿이라 여기 모아 둔다 —
   * 한 곳만 고쳐지면 그 섹션에서만 '한 장만' 규칙이 깨진다.
   *
   * 플래그와 노드를 **함께** 넘긴다. 하나만 주면 카드가 무시하도록 되어 있는데(폼 없는 빈 카드
   * 금지), 그 계약에 기대지 않고 애초에 같은 조건에서 둘 다 만든다.
   */
  function editing(bookmark: BookmarkWithCount) {
    const isEditing = editingId === bookmark.id;

    return {
      onEdit: (id: string) => {
        setEditingId(id);
        // 편집을 열면 묻고 있던 삭제는 닫는다 (프로토타입 928행 `startEdit`).
        setDeletingId(null);
      },
      isEditing,
      editSlot: isEditing ? (
        <InlineEdit bookmark={bookmark} onDone={() => setEditingId(null)} />
      ) : undefined,
    };
  }

  /**
   * 같은 자리의 삭제 배선 한 벌 — 위 `editing` 과 나란히 모든 렌더 지점에 스프레드한다.
   *
   * 카드에는 플래그가 없다(`isEditing` 같은 짝이 없다) — 오버레이는 교체가 아니라 **덧대기**라
   * 노드가 곧 상태다(LinkCard 의 `deleteSlot` 계약).
   */
  function deleting(bookmark: BookmarkWithCount) {
    return {
      onDelete: (id: string) => {
        // 휴지통은 '삭제'가 아니라 '삭제를 묻기'다 — 여기서 지우지 않는다(DESIGN_SPEC 2-1).
        setDeletingId(id);
        // 삭제를 물으면 열려 있던 편집은 닫는다 (프로토타입 930행 `askDel`).
        setEditingId(null);
      },
      deleteSlot:
        deletingId === bookmark.id ? (
          <DeleteConfirm bookmark={bookmark} onDone={() => setDeletingId(null)} />
        ) : undefined,
    };
  }

  // 담은 순서 유지 · 죽은 id 제외는 `/favorites` 와 같은 규칙이라 lib/favorites 의 순수 함수를 쓴다.
  const favItems = pickFavorites(bookmarks);

  /**
   * 즐겨찾기를 세 묶음으로 가른다 (2026-08-10). 판정은 링크가 속한 **상위 분류**가 하고
   * (`lib/fav-groups.ts`), 이 화면은 나온 대로 그리기만 한다.
   */
  const favGroups = groupFavorites(favItems, categories);

  const operating = findOperatingIds(categories);
  const operatingItems =
    operating === null
      ? []
      : bookmarks.filter(
          (bookmark) => bookmark.category_id !== null && operating.ids.has(bookmark.category_id),
        );

  /* 섹션마다 드래그 정렬을 **따로** 든다 (J5) — 낙관적 순서도 '요청 중' 빗장도 목록 하나에 대한
     것이라, 하나로 묶으면 한 섹션을 끌던 도중의 빗장이 다른 섹션의 드롭까지 삼킨다.

     즐겨찾기 세 묶음은 축이 다르다: 순서가 `sort_order`(분류 안의 차례)가 아니라 `fav_order` 에
     있으므로 `reorderBookmarks` 대신 `reorderFavorites` 를 넘긴다. **한 묶음의 차례만 넘겨도
     안전하다** — 그 액션은 받은 id 들이 지금 쥐고 있는 자리들만 서로 맞바꾸므로 다른 두 묶음이
     쓰는 사잇값을 건드리지 않는다(그 함수의 JSDoc).

     훅은 `FAV_GROUPS` 가 상수 튜플이라 **언제나 세 번, 같은 차례로** 불린다 — 목록 길이에 따라
     호출 수가 달라지면 훅 규칙이 깨진다. */
  const favOrders = {
    'AI 소식': useCardReorder(favGroups['AI 소식'], isAdmin, reorderFavorites),
    'AI 서비스': useCardReorder(favGroups['AI 서비스'], isAdmin, reorderFavorites),
    '업무용 서비스': useCardReorder(favGroups['업무용 서비스'], isAdmin, reorderFavorites),
  };
  const operatingOrder = useCardReorder(operatingItems, isAdmin);

  // 섹션 간격은 프로토타입 sectionGap 그대로다 — narrow 20px · 데스크톱 26px (D5).
  return (
    <main className="flex flex-col gap-[20px] min-[820px]:gap-[26px]">
      {/* 담긴 것이 하나도 없으면 묶음 셋 대신 안내 한 장만 (EMPTY_FAVS_TEXT 주석). */}
      {favItems.length === 0 ? (
        <section aria-label={FAVORITES_TITLE}>
          <SectionHeader title={FAVORITES_TITLE} />
          <EmptyBox>{EMPTY_FAVS_TEXT}</EmptyBox>
        </section>
      ) : (
        /* 빈 묶음은 그리지 않는다 — 'AI 소식'만 담은 사람에게 빈 상자 둘을 보여 줄 이유가 없다.
           차례는 `FAV_GROUPS` 가 정한다(그 배열을 바꾸면 홈도 함께 바뀐다). */
        FAV_GROUPS.filter((group) => favGroups[group].length > 0).map((group) => {
          const items = favGroups[group];
          const order = favOrders[group];

          return (
            <section key={group} aria-label={group}>
              <SectionHeader
                title={group}
                note={`핀으로 담은 ${items.length}개`}
                openLabel={`${items.length}개 한 번에 열기`}
                onOpenAll={() => openMany(items, group)}
              />

              <CardGrid>
                {/* 담긴 것만 골라낸 목록이라 핀은 언제나 켜짐이고(카드가 `is_favorite` 을 읽는다)
                    누르면 빼는 동작뿐이다 — 빼면 다시 그려질 때 이 묶음에서 사라진다. */}
                {order.order.map((bookmark) => (
                  <LinkCard
                    key={bookmark.id}
                    bookmark={bookmark}
                    onToggleFav={handleToggleFav}
                    onOpen={handleOpen}
                    isAdmin={isAdmin}
                    drag={order.dragProps(bookmark.id)}
                    {...editing(bookmark)}
                    {...deleting(bookmark)}
                  />
                ))}
              </CardGrid>
            </section>
          );
        })
      )}

      {operating !== null && (
        <section aria-label={OPERATING_CATEGORY_NAME}>
          <SectionHeader
            title={OPERATING_CATEGORY_NAME}
            note={`회사가 직접 운영하는 서비스 ${operatingItems.length}개`}
            openLabel={`${operatingItems.length}개 한 번에 열기`}
            onOpenAll={() => openMany(operatingItems, OPERATING_CATEGORY_NAME)}
            aside={
              <Link
                href={`/category/${operating.id}`}
                className="text-[11.5px] text-[#5a5651] underline underline-offset-[3px]"
              >
                전체 보기
              </Link>
            }
          />

          {/* '+ 링크 추가' 타일 (K1) — **홈에서는 이 섹션에만** 둔다.

              앞의 즐겨찾기 묶음들은 **파생 목록**이라 추가가 의미와 어긋난다: 이 브라우저의
              localStorage 에서 오고(담는 일은 카드의 핀이 한다) 어느 묶음에 들어갈지는 분류가
              정한다 — 거기에 링크를 만들면 왜 그 자리에 나타나지 않는지 설명할 수 없다.
              이 섹션만이 실제 분류('현재 운영 중인 사이트') 하나를 그대로 비추는 목록이라
              새 카드가 곧바로 제자리에 선다.

              기본 분류가 이 섹션의 분류인 것도 같은 이유다 — 보고 있는 목록에 한 건 더 붙이는
              것이 가장 흔한 의도다. 다른 분류로 넣고 싶으면 폼의 분류 상자에서 고른다(그때는
              새 카드가 이 섹션에 보이지 않지만, 어디에 들어갔는지는 알림이 이름으로 말한다).

              ⚠️ 운영 중 분류가 없는 데이터에서는 이 섹션 자체가 접히므로 홈에 타일이 서지 않는다.
              그때는 분류 화면(ListView)의 타일로 추가한다. */}
          <CardGrid
            lead={
              isAdmin ? (
                <QuickAddCard
                  categories={toQuickAddOptions(categories)}
                  defaultCategoryId={operating.id}
                />
              ) : undefined
            }
          >
            {operatingOrder.order.map((bookmark) => (
              <LinkCard
                key={bookmark.id}
                bookmark={bookmark}
                showPin={false}
                onOpen={handleOpen}
                isAdmin={isAdmin}
                drag={operatingOrder.dragProps(bookmark.id)}
                {...editing(bookmark)}
                {...deleting(bookmark)}
              />
            ))}
          </CardGrid>
        </section>
      )}
    </main>
  );
}
