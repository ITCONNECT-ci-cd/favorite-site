'use client';

import Link from 'next/link';

import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { SectionHeader } from '@/components/SectionHeader';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { useFavorites } from '@/lib/favorites';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';

export type HomeViewProps = {
  /** 서버(app/page.tsx)가 getAllData 로 읽어 넘긴 전체 데이터. 두 배열 모두 sort_order 순이다. */
  data: SiteData;
};

/** 빈 즐겨찾기 안내 · 하단 안내 — DESIGN_SPEC 3장의 문구를 그대로 옮긴다. */
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
 * 위에서 아래로 두고 마지막에 하단 안내를 붙인다.
 *
 * 즐겨찾기는 브라우저에만 있으므로 뷰 전체가 클라이언트 컴포넌트다. `useFavorites` 는 여기서
 * **한 번만** 부르고 카드에는 계산된 값을 내린다 — 카드마다 부르면 렌더 때마다 카드 수만큼
 * 동기 localStorage 읽기가 생긴다(E1 규약).
 *
 * 아직 배선하지 않은 것: 열기 버튼(`onOpenAll`)은 2단계 G4, 핀 토글(`onToggleFav`)과 토스트는
 * D6, 클릭 기록(`onOpen`)은 F3 몫이다.
 */
export function HomeView({ data }: HomeViewProps) {
  const { categories, bookmarks } = data;
  const { favs } = useFavorites();

  // 즐겨찾기는 담은 순서(favs)를 그대로 지킨다 — sort_order 로 다시 세우지 않는다.
  // 지워진 링크의 id 가 localStorage 에 남아 있을 수 있으므로 데이터에 있는 것만 남긴다.
  const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const favItems = [...favs]
    .map((id) => byId.get(id))
    .filter((bookmark): bookmark is BookmarkWithCount => bookmark !== undefined);

  const daily = bookmarks.filter((bookmark) => bookmark.is_pinned);

  const operating = findOperatingIds(categories);
  const operatingItems =
    operating === null
      ? []
      : bookmarks.filter(
          (bookmark) => bookmark.category_id !== null && operating.ids.has(bookmark.category_id),
        );

  // 홈에 없는 링크 수. 즐겨찾기는 다른 섹션과 겹치므로 빼지 않는다(프로토타입과 같은 셈).
  const restCount = bookmarks.length - daily.length - operatingItems.length;

  return (
    <main className="flex flex-col gap-[26px]">
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
            {/* favs 에서 뽑은 카드라 핀은 언제나 켜짐이다. */}
            {favItems.map((bookmark) => (
              <LinkCard key={bookmark.id} bookmark={bookmark} isFaved />
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
            <LinkCard key={bookmark.id} bookmark={bookmark} showPin={false} />
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
              <LinkCard key={bookmark.id} bookmark={bookmark} showPin={false} />
            ))}
          </CardGrid>
        </section>
      )}

      {/* 하단 안내 — 빈 즐겨찾기 안내(EmptyBox)와 라운드·패딩·행간이 다르므로 재사용하지 않는다
          (DESIGN_SPEC 3장 "하단 안내": 라운드 9px · 패딩 14px 16px · line-height 1.7). */}
      <p className="rounded-[9px] border border-dashed border-dash bg-side px-[16px] py-[14px] text-[11.5px] leading-[1.7] text-desc">
        나머지 {restCount}개는 왼쪽 사이드바에서 분류별로 들어갑니다. 홈에는 즐겨찾기와 매일
        사용하는 사이트, 현재 운영 중인 사이트를 둡니다.
      </p>
    </main>
  );
}
