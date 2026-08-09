'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { SectionHeader } from '@/components/SectionHeader';
import { toast } from '@/components/Toast';
import { openToastText, recordClick } from '@/lib/clicks';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { favToastText, pickFavorites, useFavorites } from '@/lib/favorites';
import type { Category, SiteData } from '@/lib/types';

export type HomeViewProps = {
  /** 서버(app/page.tsx)가 getAllData 로 읽어 넘긴 전체 데이터. 두 배열 모두 sort_order 순이다. */
  data: SiteData;
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
 * 즐겨찾기는 브라우저에만 있으므로 뷰 전체가 클라이언트 컴포넌트다. `useFavorites` 는 여기서
 * **한 번만** 부르고 카드에는 계산된 값을 내린다 — 카드마다 부르면 렌더 때마다 카드 수만큼
 * 동기 localStorage 읽기가 생긴다(E1 규약).
 *
 * 아직 배선하지 않은 것: 열기 버튼(`onOpenAll`)은 2단계 G4 몫이다.
 */
export function HomeView({ data }: HomeViewProps) {
  const { categories, bookmarks } = data;
  const { favs, toggle } = useFavorites();

  // 담은 순서 유지 · 죽은 id 제외는 `/favorites` 와 같은 규칙이라 lib/favorites 의 순수 함수를 쓴다.
  const favItems = pickFavorites(bookmarks, favs);

  /** 핀 토글 — 담고/빼고 토스트로 알린다(DESIGN_SPEC 7장). 방향은 `toggle` 이 돌려준다. */
  const handleToggleFav = useCallback(
    (id: string) => {
      // 카드가 돌려준 id 라 이 배열에 반드시 있다. 없더라도 토글은 하고 토스트만 건너뛴다.
      const bookmark = bookmarks.find((item) => item.id === id);
      const faved = toggle(id);

      if (bookmark !== undefined) toast(favToastText(bookmark.title, faved));
    },
    [bookmarks, toggle],
  );

  /**
   * 카드 열기 — 클릭을 기록하고(F2 로 보내는 fire-and-forget) 열었다고 알린다. 세 섹션이 모두 이
   * 배선을 쓴다: 즐겨찾기든 관리자가 정한 자리든 클릭 집계 대상인 것은 같다.
   *
   * 가운데 클릭도 여기로 온다(카드가 onClick·onAuxClick 양쪽에서 부른다 — C2).
   * 이동을 가로채지 않으므로 `event` 를 받지 않는다.
   *
   * ⓘ 토스트 스토어는 슬롯이 하나라(Toast.tsx) 이 문구가 직전의 핀 토스트를 밀어낸다.
   *   프로토타입도 토스트가 하나뿐이라 같은 동작이다.
   */
  const handleOpen = useCallback(
    (id: string) => {
      recordClick(id);

      // 카드가 돌려준 id 라 이 배열에 반드시 있다. 없더라도 기록은 하고 토스트만 건너뛴다.
      const bookmark = bookmarks.find((item) => item.id === id);
      if (bookmark !== undefined) toast(openToastText(bookmark.title));
    },
    [bookmarks],
  );

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
      <section aria-label="내 즐겨찾기">
        <SectionHeader
          title="내 즐겨찾기"
          note={
            favItems.length > 0
              ? `핀으로 직접 담은 ${favItems.length}개 · 이 브라우저에만 저장됩니다`
              : undefined
          }
          openLabel={favItems.length > 0 ? `${favItems.length}개 한 번에 열기` : undefined}
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
              />
            ))}
          </CardGrid>
        ) : (
          <EmptyBox>{EMPTY_FAVS_TEXT}</EmptyBox>
        )}
      </section>

      <section aria-label="매일 사용하는 사이트">
        <SectionHeader
          title="매일 사용하는 사이트"
          note={`직접 고정한 ${daily.length}개 · 자리가 바뀌지 않습니다`}
          openLabel={`${daily.length}개 한 번에 열기`}
        />

        {/* 관리자가 정하는 자리라 핀을 노출하지 않는다(DESIGN_SPEC 3장). */}
        <CardGrid>
          {daily.map((bookmark) => (
            <LinkCard
              key={bookmark.id}
              bookmark={bookmark}
              showPin={false}
              onOpen={handleOpen}
            />
          ))}
        </CardGrid>
      </section>

      {operating !== null && (
        <section aria-label="현재 운영 중인 사이트">
          <SectionHeader
            title="현재 운영 중인 사이트"
            note={`회사가 직접 운영하는 서비스 ${operatingItems.length}개`}
            openLabel={`${operatingItems.length}개 한 번에 열기`}
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
              />
            ))}
          </CardGrid>
        </section>
      )}
    </main>
  );
}
