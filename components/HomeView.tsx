'use client';

import Link from 'next/link';
import { useState } from 'react';

import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { SectionHeader } from '@/components/SectionHeader';
import { InlineEdit } from '@/components/card/InlineEdit';
import { useCardHandlers } from '@/components/useCardHandlers';
import { DAILY_TITLE, FAVORITES_TITLE, OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { pickFavorites } from '@/lib/favorites';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';

export type HomeViewProps = {
  /** 서버(app/page.tsx)가 getAllData 로 읽어 넘긴 전체 데이터. 두 배열 모두 sort_order 순이다. */
  data: SiteData;
  /**
   * 서버가 관리자 세션을 확인했는가 (J1) — 세 섹션의 카드 전부에 그대로 흘린다.
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

/** 빈 즐겨찾기 안내 — DESIGN_SPEC 3장의 문구를 그대로 옮긴다. */
const EMPTY_FAVS_TEXT =
  '다른 화면에서 카드 오른쪽 위의 핀을 누르면 이 자리에 모입니다. 매일 사용하는 사이트와 달리 내가 직접 담고 빼는 목록입니다.';

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
 * 홈 — DESIGN_SPEC 3장. 섹션 세 개(내 즐겨찾기 · 매일 사용하는 사이트 · 현재 운영 중인 사이트)를
 * 위에서 아래로 둔다.
 *
 * 스펙 3장 "하단 안내"(`나머지 N개는 왼쪽 사이드바에서…` 점선 박스)는 **의도적으로 빼 둔 것**이다
 * (계획서 V6 편차 — 사용자 결정). 스펙만 보고 되살리지 마라.
 *
 * 즐겨찾기는 브라우저에만 있으므로 뷰 전체가 클라이언트 컴포넌트다. 핀 토글(D6)·카드 열기(F3)·
 * 한 번에 열기(G4) 배선은 목록 화면과 공유하는 `useCardHandlers` 가 들고 있고, 그 훅이
 * `useFavorites` 를 **한 번만** 불러 결과를 돌려준다 — 카드마다 부르면 렌더 때마다 카드 수만큼
 * 동기 localStorage 읽기가 생긴다(E1 규약).
 *
 * 세 섹션이 모두 같은 배선을 쓴다: 즐겨찾기든 관리자가 정한 자리든 클릭 집계 대상인 것은 같다.
 *
 * `isAdmin` 도 세 섹션 모두에 같이 준다 — 관리자가 고칠 수 있는 대상은 '어느 섹션에 놓였는가'와
 * 무관하다. 연필이 하는 일(J2 인라인 편집)은 아래 `editingId` 가 들고, 휴지통(J3)은 아직 no-op 이다.
 */
export function HomeView({ data, isAdmin }: HomeViewProps) {
  const { categories, bookmarks } = data;
  const { favs, handleToggleFav, handleOpen, openMany } = useCardHandlers(bookmarks);

  /**
   * 지금 편집 중인 카드 (J2). **'동시에 한 장만'은 이 값이 하나뿐이라는 데서 그대로 나온다** —
   * 다른 카드의 연필을 누르면 id 가 덮여 앞 카드의 폼이 사라진다. 카드는 이 규칙을 모른다
   * (LinkCard 의 isEditing JSDoc: 판정도 상태도 여러 카드를 아는 화면이 든다).
   *
   * 섹션이 셋이어도 상태는 **하나**다. 같은 화면 안에서 섹션을 넘나들어도 폼은 한 장이어야 한다.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * 세 섹션이 카드에 똑같이 내려보내는 편집 배선 한 벌. 렌더 지점이 셋이라 여기 모아 둔다 —
   * 한 곳만 고쳐지면 그 섹션에서만 '한 장만' 규칙이 깨진다.
   *
   * 플래그와 노드를 **함께** 넘긴다. 하나만 주면 카드가 무시하도록 되어 있는데(폼 없는 빈 카드
   * 금지), 그 계약에 기대지 않고 애초에 같은 조건에서 둘 다 만든다.
   */
  function editing(bookmark: BookmarkWithCount) {
    const isEditing = editingId === bookmark.id;

    return {
      onEdit: setEditingId,
      isEditing,
      editSlot: isEditing ? (
        <InlineEdit bookmark={bookmark} onDone={() => setEditingId(null)} />
      ) : undefined,
    };
  }

  // 담은 순서 유지 · 죽은 id 제외는 `/favorites` 와 같은 규칙이라 lib/favorites 의 순수 함수를 쓴다.
  const favItems = pickFavorites(bookmarks, favs);

  const daily = bookmarks.filter((bookmark) => bookmark.is_pinned);

  const operating = findOperatingIds(categories);
  const operatingItems =
    operating === null
      ? []
      : bookmarks.filter(
          (bookmark) => bookmark.category_id !== null && operating.ids.has(bookmark.category_id),
        );

  // 섹션 간격은 프로토타입 sectionGap 그대로다 — narrow 20px · 데스크톱 26px (D5).
  return (
    <main className="flex flex-col gap-[20px] min-[820px]:gap-[26px]">
      <section aria-label={FAVORITES_TITLE}>
        <SectionHeader
          title={FAVORITES_TITLE}
          note={
            favItems.length > 0
              ? `핀으로 직접 담은 ${favItems.length}개 · 이 브라우저에만 저장됩니다`
              : undefined
          }
          // 0개면 버튼 자체가 없다(DESIGN_SPEC 3장) — 그래서 여기서는 빈 목록 분기를 걱정하지 않는다.
          openLabel={favItems.length > 0 ? `${favItems.length}개 한 번에 열기` : undefined}
          onOpenAll={() => openMany(favItems, FAVORITES_TITLE)}
        />

        {favItems.length > 0 ? (
          <CardGrid>
            {/* favs 에서 뽑은 카드라 핀은 언제나 켜짐이고, 누르면 빼는 동작뿐이다
                (빼는 순간 favItems 에서 사라져 카드도 함께 없어진다). */}
            {favItems.map((bookmark) => (
              <LinkCard
                key={bookmark.id}
                bookmark={bookmark}
                isFaved
                onToggleFav={handleToggleFav}
                onOpen={handleOpen}
                isAdmin={isAdmin}
                {...editing(bookmark)}
              />
            ))}
          </CardGrid>
        ) : (
          <EmptyBox>{EMPTY_FAVS_TEXT}</EmptyBox>
        )}
      </section>

      <section aria-label={DAILY_TITLE}>
        <SectionHeader
          title={DAILY_TITLE}
          note={`직접 고정한 ${daily.length}개 · 자리가 바뀌지 않습니다`}
          openLabel={`${daily.length}개 한 번에 열기`}
          onOpenAll={() => openMany(daily, DAILY_TITLE)}
        />

        {/* 관리자가 정하는 자리라 핀을 노출하지 않는다(DESIGN_SPEC 3장). */}
        <CardGrid>
          {daily.map((bookmark) => (
            <LinkCard
              key={bookmark.id}
              bookmark={bookmark}
              showPin={false}
              onOpen={handleOpen}
              isAdmin={isAdmin}
              {...editing(bookmark)}
            />
          ))}
        </CardGrid>
      </section>

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

          <CardGrid>
            {operatingItems.map((bookmark) => (
              <LinkCard
                key={bookmark.id}
                bookmark={bookmark}
                showPin={false}
                onOpen={handleOpen}
                isAdmin={isAdmin}
                {...editing(bookmark)}
              />
            ))}
          </CardGrid>
        </section>
      )}
    </main>
  );
}
