import { CategoryHeader } from '@/components/admin/CategoryHeader';
import {
  CategoryPanel,
  SelectedCategoryProvider,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { FilterRow, LinkFilterProvider } from '@/components/admin/FilterRow';
import { LinkAddRow } from '@/components/admin/LinkAddRow';
import { LinkTable, type AdminLink, type LinkRowMap } from '@/components/admin/LinkTable';
import {
  SubCategoryRow,
  type AdminSubCategory,
  type SubCategoryMap,
} from '@/components/admin/SubCategoryRow';
import { getAllData, rollupCounts } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';
import type { BookmarkWithCount, Category } from '@/lib/types';

/** 이 page가 사용하는 favicon Server Action의 플랫폼 상한. 내부 deadline은 50초로 더 짧다. */
export const maxDuration = 60;

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

  // 공개 client component에는 secret이 아니라 exact-match로 파생한 승인 boolean만 넘긴다.
  const faviconProviderApproved = process.env.DISCORD_FAVICON_PROVIDER_APPROVED === 'true';
  const { categories, bookmarks } = await getAllData();
  /* 하위 목록은 두 곳이 쓴다 — 하위 칩 줄(I2)과 링크 표의 하위 select(I4). 같은 값이므로 한 번만
     접는다. 두 벌을 따로 만들어도 화면은 같지만, 그러면 "칩과 select 가 같은 목록"이라는 사실이
     우연이 된다(둘 중 하나만 다른 함수로 갈아 끼워도 아무도 눈치채지 못한다). */
  const subs = subRows(categories, bookmarks);
  /* 링크 목록도 두 곳이 쓴다 — 표(I4)가 그리고, 필터 줄(I5)의 칩이 같은 목록을 센다. 위 `subs` 와
     같은 이유로 한 번만 접는다: 두 벌을 따로 만들면 "칩이 세는 것과 표가 그리는 것이 같은 목록"
     이라는 사실이 우연이 된다. */
  const links = linkRows(categories, bookmarks);

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

              **조건부로 넘기지 마라.** 헤더는 children 이 있을 때만 구분선을 그린다. 그 판정은
              이제 falsy 를 전부 '없음'으로 치므로(`false`·`null`·`''` — 그쪽 JSDoc) `{조건 && <줄/>}`
              을 넘겨도 선만 남지는 않지만, 그렇다고 여기서 조건을 세우지는 않는다. **줄이 스스로
              접는 것이 이 트랙의 계약**이고 화면은 언제나 넘긴다 — 조건을 화면이 들면 "무엇이 빈
              상태인가"의 판단이 줄과 화면 둘로 갈라져, 줄만 고친 사람이 화면을 함께 고쳐야 하는
              것을 모른다(하위가 0개여도 '하위' 라벨과 추가 입력은 프로토타입에 그대로 있고, 상위가
              하나도 없을 때만 줄 전체가 사라진다 — 그때는 헤더도 안내 문구라 구분선을 그리지 않는다). */}
          <CategoryHeader>
            <SubCategoryRow subsByCategory={subs} />
          </CategoryHeader>

          {/* 헤더 패널 **다음 상자**다(프로토타입 359행부터). 상자는 `LinkAddRow` 가 갖고,
              필터 줄(I5)·링크 표(I4)는 그 `children` 으로 들어와 추가 줄 아래에 붙는다
              (그쪽 JSDoc "I4·I5 와의 계약" — 위 `CategoryHeader` 와 같은 모양이고, 구분선 판정도
              같은 falsy-safe 규칙이다). 여기서도 조건부로 넘기지 마라 — 위와 같은 이유다: 빈 상태를
              아는 것은 표이고(카테고리는 있는데 링크가 0개면 표가 한 줄로 알린다), 화면은 그
              판단을 나눠 갖지 않는다.

              필터 줄은 표 **앞**에 형제로 들어간다 — 프로토타입의 상자 안 차례가 추가 줄(360행)
              → 필터 줄(367행) → 표(382행)다. 그 줄이 정한 검색어·하위 칩·정렬은 prop 이 아니라
              `LinkFilterProvider` 를 거쳐 표에 닿는다: 둘은 형제라 prop 으로는 닿지 않고, 값을
              여기서 들면 "필터가 무엇인가"의 소유자가 화면으로 올라온다(선택 상태와 같은 판단 —
              `SelectedCategoryProvider`). provider 는 DOM 을 만들지 않아 상자 안의 차례도 그대로다. */}
          <LinkAddRow>
            <LinkFilterProvider>
              <FilterRow
                linksByCategory={links}
                subsByCategory={subs}
                faviconProviderApproved={faviconProviderApproved}
              />
              <LinkTable linksByCategory={links} subsByCategory={subs} />
            </LinkFilterProvider>
          </LinkAddRow>
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
 * 링크 표(I4)가 그릴 목록 — 상위 카테고리 id → 그 **트리 전체**(직속 + 모든 하위)의 링크 행들.
 *
 * ## 왜 여기서 접는가
 *
 * 표가 그리는 것은 "선택한 상위와 그 하위에 속한 링크"인데 **선택은 클라이언트 상태라 서버가
 * 모른다**(`SelectedCategoryProvider` JSDoc). 그래서 서버가 골라 줄 수 없고, 상위별로 미리 갈라
 * 놓아 클라이언트가 자기 선택으로 하나만 꺼내 쓰게 한다(`subRows` 와 같은 모양·같은 이유).
 *
 * ## 무엇이 내려가고 무엇이 안 내려가는가
 *
 * `BookmarkWithCount` 를 통째로 넘기지 않는다 — 표에 그려지는 여섯 칸과 그것을 서버로 되돌려
 * 보낼 `id` 뿐이다(`AdminLink` JSDoc). 좌측 패널·하위 줄이 개수만 내리는 것과 같은 원칙이되,
 * 표는 링크 하나하나를 그리는 화면이라 행 자체는 내려갈 수밖에 없다. 공개 화면도 카드에 필요한
 * 만큼을 클라이언트에 내리므로(components/CardGrid.tsx) 새로 여는 길은 아니다.
 *
 * `tags`·`created_at`·`sort_order` 는 표가 쓰지 않아 빠진다. 특히 `sort_order` 는 **배열의 자리가
 * 이미 같은 사실을 들고 있어서** 뺐다(`AdminLink` JSDoc) — `getAllData` 가 `sort_order` 순으로
 * 주므로 여기서 다시 정렬하지 않는다.
 *
 * ## 어디에도 못 놓는 링크
 *
 * `category_id` 가 null 이거나 없는 카테고리를 가리키는 링크는 **어느 목록에도 들어가지 않는다**
 * (`rollupCounts` 가 그런 링크를 세지 않는 것과 같은 판단 — 그릴 자리가 없다). 지금 그런 링크가
 * 생길 길은 없다: `deleteCategory` 는 직속 링크가 남아 있으면 거부하고, `deleteSubCategory` 는
 * 지우기 전에 링크를 상위로 올린다(lib/mutations.ts).
 */
function linkRows(
  categories: readonly Category[],
  bookmarks: readonly BookmarkWithCount[],
): LinkRowMap {
  const topOf = topLevelIds(categories);

  const rows: Record<string, AdminLink[]> = {};
  for (const bookmark of bookmarks) {
    const top = bookmark.category_id === null ? undefined : topOf.get(bookmark.category_id);
    if (top === undefined || bookmark.category_id === null) continue;

    (rows[top] ??= []).push({
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      description: bookmark.description,
      categoryId: bookmark.category_id,
      faviconUrl: bookmark.favicon_url,
      clickCount: bookmark.click_count,
      isPinned: bookmark.is_pinned,
      source: bookmark.source,
    });
  }

  return rows;
}

/**
 * 카테고리 id → 그 카테고리가 매달린 **상위** id. 상위 자신은 자기 id 를 가리킨다.
 *
 * 부모를 따라 올라가다 `parent_id` 가 null 인 곳에서 멈춘다. 지금 구조는 2단계뿐이지만
 * (`createSubCategory` 의 깊이 검사) 걸음 자체는 `rollupCounts` 와 같게 두어 깊이가 늘어도
 * 같은 답이 나오게 했다. 부모가 목록에 없거나 관계가 순환하면 **키를 만들지 않는다** — 그
 * 카테고리에 달린 링크는 어느 목록에도 들어가지 않고 조용히 빠진다(위 `linkRows` 참조).
 */
function topLevelIds(categories: readonly Category[]): Map<string, string> {
  const parentOf = new Map<string, string | null>(
    categories.map((category) => [category.id, category.parent_id]),
  );

  const tops = new Map<string, string>();
  for (const category of categories) {
    const seen = new Set<string>();
    let current: string | null = category.id;

    while (current !== null && parentOf.has(current) && !seen.has(current)) {
      seen.add(current);

      const parent: string | null = parentOf.get(current) ?? null;
      if (parent === null) {
        tops.set(category.id, current);
        break;
      }
      current = parent;
    }
  }

  return tops;
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
