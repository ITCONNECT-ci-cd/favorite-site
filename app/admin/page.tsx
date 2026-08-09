import { CategoryHeader } from '@/components/admin/CategoryHeader';
import {
  CategoryPanel,
  SelectedCategoryProvider,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import {
  SubCategoryRow,
  type AdminSubCategory,
  type SubCategoryMap,
} from '@/components/admin/SubCategoryRow';
import { getAllData, rollupCounts } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';
import type { BookmarkWithCount, Category } from '@/lib/types';

/**
 * 관리자 — 카테고리 · 링크 (`/admin`, DESIGN_SPEC 6장).
 *
 * 상단 탭의 첫 번째 자리이자 로그인 뒤 도착하는 화면이다. 상단 바(60px)·탭·로그아웃은
 * 셸(`components/admin/AdminShell.tsx`)이 지므로 여기서는 **본문만** 만든다. 본문 패딩과
 * 스크롤도 셸이 갖는다(그쪽 JSDoc "화면과의 계약") — 여기서 다시 주면 이중으로 먹는다.
 *
 * ## 이 화면이 하는 일 = 읽어서 넘기기
 *
 * 서버에서 한 번 읽어(`getAllData` — 요청 단위로 cache 된다) 좌측 패널이 그릴 만큼으로 접은 뒤
 * 클라이언트 컴포넌트에 넘긴다. 290행짜리 북마크 배열을 통째로 내려보내지 않는 이유이자,
 * 개수·클릭 합계가 **사이드바와 같은 숫자**(직속 + 모든 하위)인 이유다.
 *
 * 쓰기는 여기 없다. 서버 액션(`lib/mutations.ts`)은 인자가 positional 이라 `<form action>` 에
 * 걸리지 않고, 눌린 결과를 토스트로 알려야 하므로 클라이언트 컴포넌트가 직접 부른다. 액션이
 * `revalidatePath('/', 'layout')` 를 부르면 이 화면이 다시 렌더돼 새 목록이 내려온다.
 *
 * ## 2단 배치는 여기가 갖는다
 *
 * 좌 270px(CategoryPanel) / 우 flex-1. 그 사이의 선택 상태는 `SelectedCategoryProvider` 가 들고,
 * 우측에 붙는 I2·I3·I4 는 `useSelectedCategory()` 로 읽는다 — 선택 id 를 prop 으로 타고 내려
 * 보내지 마라(같은 값의 출처가 둘이 된다).
 *
 * **첫 줄의 세션 확인을 지우지 마라** — 이 화면의 내용이 미인증 응답에 실려 나간다.
 * 근거는 `app/admin/layout.tsx` 주석에 한 번만 적어 뒀다(`page.test.tsx` 가 강제).
 */
export default async function AdminPage() {
  if ((await getAdminSession()) === null) return null;

  const { categories, bookmarks } = await getAllData();

  return (
    /* 프로토타입 원문 `display:flex; gap:20px; align-items:flex-start` + `adminDir`(narrow 면 column).
       <820px 에서 2단이 1단으로 접히는 것은 DESIGN_SPEC 1장 브레이크포인트 표의 관리자 규칙이다.
       세로로 접힐 때는 `items-start` 를 걸지 않는다 — 걸면 두 칸이 내용 폭으로 쪼그라든다. */
    <main className="flex flex-col gap-[20px] min-[820px]:flex-row min-[820px]:items-start">
      <SelectedCategoryProvider categories={topLevelRows(categories, bookmarks)}>
        <CategoryPanel totalLinkCount={bookmarks.length} />

        {/* 우측 칸. `min-w-0` 이 없으면 안의 긴 주소·이름이 flex 칸을 밀어내 좌측 패널을 찌그러뜨린다. */}
        <div className="w-full min-w-0 min-[820px]:flex-1">
          {/* 하위 칩 줄(I2)은 이 패널 **안**이다 — 프로토타입에서 흰 상자 하나가 헤더 줄과 하위
              줄을 함께 담는다(그쪽 JSDoc "I2 와의 계약").

              **조건부로 넘기지 마라.** 헤더는 children 이 있을 때만 구분선을 그리는데, 그 판정이
              `!== undefined` 라 `{조건 && <줄/>}` 로 넘기면 거짓일 때 `false` 가 들어가 아무것도
              없는 아래에 선만 남는다. 여기서는 **언제나** 넘기고 빈 상태는 줄이 스스로 접는다
              (하위가 0개여도 '하위' 라벨과 추가 입력은 프로토타입에 그대로 있고, 상위가 하나도
              없을 때만 줄 전체가 사라진다 — 그때는 헤더도 안내 문구라 구분선을 그리지 않는다). */}
          <CategoryHeader>
            <SubCategoryRow subsByCategory={subRows(categories, bookmarks)} />
          </CategoryHeader>

          {/* 여기부터는 헤더 패널 **다음 상자**다(프로토타입 359행부터):
              I3 링크 추가 줄 · I5 필터 줄 · I4 표 헤더와 행. 순서대로 이 자리에 붙인다. */}
        </div>
      </SelectedCategoryProvider>
    </main>
  );
}

/**
 * 좌측 패널이 그릴 상위 카테고리 목록. 하위는 **들어가지 않는다** — 목록이 곧 정렬 대상이고,
 * `reorderCategories` 에 하위 id 가 섞이면 서버가 거부한다(lib/mutations.ts).
 *
 * 순서는 `getAllData` 가 준 그대로다(`sort_order`, 동점이면 id) — 공개 사이드바와 같은 순서여야
 * 드래그로 바꾼 결과가 그쪽에 그대로 나타난다.
 */
function topLevelRows(
  categories: readonly Category[],
  bookmarks: readonly BookmarkWithCount[],
): AdminCategory[] {
  const linkCounts = rollupCounts(categories, bookmarks);
  const clickTotals = rollupClicks(categories, bookmarks);

  return categories
    .filter((category) => category.parent_id === null)
    .map((category) => ({
      id: category.id,
      name: category.name,
      linkCount: linkCounts[category.id] ?? 0,
      clickTotal: clickTotals[category.id] ?? 0,
    }));
}

/**
 * 하위 줄이 그릴 목록 — 상위 카테고리 id → 그 아래 하위들 `{id, name, linkCount}`.
 *
 * **선택한 상위 것만 접어 보낼 수는 없다** — 선택은 클라이언트 상태라 서버가 모른다
 * (`SelectedCategoryProvider` JSDoc). 그래서 전부 넘기되 넘어가는 것은 이름과 개수뿐이다:
 * 좌측 패널과 같은 원칙으로 북마크 배열 자체는 여전히 내려가지 않는다.
 *
 * 개수는 `rollupCounts` 로 센다 — 하위 아래에는 아무것도 없으므로(2단계 제약) 직속 링크 수와
 * 같은 값이지만, 규칙을 손으로 다시 적지 않으면 사이드바·좌측 패널과 갈라질 일도 없다.
 *
 * 부모가 하위인 카테고리(있을 수 없다 — `createSubCategory` 가 막는다)는 그 하위의 id 를 키로
 * 얹혀 갈 뿐, 조회하는 쪽이 **상위 id 로만** 찾으므로 화면에 나오지 않는다.
 */
function subRows(
  categories: readonly Category[],
  bookmarks: readonly BookmarkWithCount[],
): SubCategoryMap {
  const linkCounts = rollupCounts(categories, bookmarks);

  const rows: Record<string, AdminSubCategory[]> = {};
  for (const category of categories) {
    if (category.parent_id === null) continue;

    (rows[category.parent_id] ??= []).push({
      id: category.id,
      name: category.name,
      linkCount: linkCounts[category.id] ?? 0,
    });
  }

  return rows;
}

/**
 * 카테고리 id → 그 트리(직속 + 모든 하위)의 **클릭 합계**. 값은 `bookmark_click_counts` 뷰에서
 * 온다(`getAllData` 가 `attachCounts` 로 붙여 준다).
 *
 * `lib/queries.ts` 의 `rollupCounts` 와 같은 걸음이되 1 대신 클릭 수를 더한다 — 두 함수를 하나로
 * 합치려면 가중치를 받는 시그니처가 되어야 해서, 지금은 화면 전용 계산으로 여기 둔다. 부모를
 * 따라 올라가며 더하고, 없는 카테고리를 가리키는 링크는 세지 않으며, 부모 관계가 순환해도
 * 멈춘다(그쪽 주석과 같은 이유).
 */
function rollupClicks(
  categories: readonly Category[],
  bookmarks: readonly BookmarkWithCount[],
): Record<string, number> {
  const parentOf = new Map(categories.map((category) => [category.id, category.parent_id]));

  const totals: Record<string, number> = {};
  for (const category of categories) totals[category.id] = 0;

  for (const bookmark of bookmarks) {
    const seen = new Set<string>();
    let current = bookmark.category_id;

    while (current !== null && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);
      totals[current] += bookmark.click_count;
      current = parentOf.get(current) ?? null;
    }
  }

  return totals;
}
