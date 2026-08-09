'use client';

import Link from 'next/link';

import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { SectionHeader } from '@/components/SectionHeader';
import { useCardHandlers } from '@/components/useCardHandlers';
import { DAILY_TITLE, FAVORITES_TITLE, OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { pickFavorites } from '@/lib/favorites';
import type { Category, SiteData } from '@/lib/types';

export type HomeViewProps = {
  /** 서버(app/page.tsx)가 getAllData 로 읽어 넘긴 전체 데이터. 두 배열 모두 sort_order 순이다. */
  data: SiteData;
  /**
   * 서버가 관리자 세션을 확인했는가 (J1) — 세 섹션의 카드 전부에 그대로 흘린다.
   *
   * 이 화면은 판정하지 않고 나르기만 한다. 참이면 카드가 연필·휴지통을 **렌더**하고,
   * 거짓이면 그 마크업이 응답에 실리지 않는다(LinkCard 의 isAdmin JSDoc).
   */
  isAdmin?: boolean;
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
 * 무관하다. 연필·휴지통이 실제로 무엇을 하는지는 J2·J3 이 채운다(그때 콜백은 이 자리에서 카드로
 * 내려간다 — LinkCard 의 onEdit·onDelete).
 */
export function HomeView({ data, isAdmin = false }: HomeViewProps) {
  const { categories, bookmarks } = data;
  const { favs, handleToggleFav, handleOpen, openMany } = useCardHandlers(bookmarks);

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
              />
            ))}
          </CardGrid>
        </section>
      )}
    </main>
  );
}
