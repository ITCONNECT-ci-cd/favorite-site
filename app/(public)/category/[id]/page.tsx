import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ListView } from '@/components/ListView';
import { EMPTY_LIST_MESSAGE } from '@/lib/constants';
import { findOperatingCategoryId, getAllData, rollupCounts } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';
import type { Category } from '@/lib/types';

/**
 * Next 16 에서 `params` 는 Promise 다 — 반드시 await 해서 쓴다.
 * (생성 타입 `PageProps<'/category/[id]'>` 는 빌드가 한 번 돌아야 생기므로, 빌드 전에도
 *  타입 검사가 도는 이 저장소에서는 형태를 직접 적는다. 라우트 계약은 빌드가 검증한다.)
 */
type CategoryPageProps = {
  params: Promise<{ id: string }>;
};

/**
 * 탭 제목 — 분류 이름만 댄다. 꼬리표(`— 내 링크`)는 셸의 title template 이 붙인다 (D5).
 *
 * 화면 제목과 같은 규칙을 쓴다: 하위 id 로 들어와도 **상위 이름**이다(`rootOf`).
 * 없는 id 면 아무것도 돌려주지 않는다 — 셸의 default 가 그대로 남고, 404 판정은 본문 한 곳에서만
 * 한다(여기서 notFound() 를 부르면 같은 결정을 두 곳에서 하게 된다).
 *
 * `getAllData` 는 React `cache()` 로 감싸여 있어(lib/queries.ts) 페이지 본문과 같은 요청에서는
 * 조회가 한 번만 나간다 — 이 함수가 데이터를 다시 읽어도 쿼리가 늘지 않는다.
 */
export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { id } = await params;
  const { categories } = await getAllData();

  const target = categories.find((category) => category.id === id);
  if (target === undefined) return {};

  return { title: rootOf(target, categories).name };
}

/**
 * 분류 목록 화면 — `/category/<id>`.
 *
 * **id 는 상위·하위 어느 쪽이든 온다.** 사이드바의 하위 항목이 `/category/<하위id>` 로 링크하기
 * 때문이다. 하위로 들어오면 상위 페이지를 그대로 그리고 그 하위 탭만 선택해 둔다(404 아님).
 *
 * 서버 컴포넌트다 — 데이터는 여기서 한 번 읽고, 탭 전환 같은 화면 상태만 ListView 가 들고 있다.
 * 연필·휴지통의 노출 여부도 여기서 정한다 (J1) — 홈과 같은 배선이라 근거는
 * `app/(public)/page.tsx` 의 JSDoc 에 한 번만 적어 뒀다.
 *
 * `export const revalidate` 를 넣지 마라(근거는 lib/queries.ts 의 getAllData JSDoc).
 */
export default async function CategoryPage({ params }: CategoryPageProps) {
  const [{ id }, { categories, bookmarks }, session] = await Promise.all([
    params,
    getAllData(),
    getAdminSession(),
  ]);

  const target = categories.find((category) => category.id === id);
  if (target === undefined) notFound();

  const root = rootOf(target, categories);
  const subs = categories.filter((category) => category.parent_id === root.id);
  const counts = rollupCounts(categories, bookmarks);

  // 상위 직속 + 모든 하위가 '전체'다. 하위 탭은 ListView 가 이 배열 안에서 걸러 낸다.
  const ownIds = new Set([root.id, ...subs.map((sub) => sub.id)]);
  const own = bookmarks.filter(
    (bookmark) => bookmark.category_id !== null && ownIds.has(bookmark.category_id),
  );

  return (
    <ListView
      // 분류가 바뀌면 화면의 정체성도 바뀐다 — 키로 리마운트해 앞 분류에서 고른 하위 탭이
      // 남지 않게 한다(프로토타입도 이동할 때마다 sub 를 비웠다).
      // 왕복 회귀(cdae2eb) 방지용이다 — ListView 안의 다른 두 장치로는 대체되지 않으니 지우지 마라.
      key={root.id}
      title={root.name}
      description={descriptionOf(root, categories, subs.length > 0)}
      bookmarks={own}
      // 칩의 개수는 사이드바와 같은 값이어야 하므로 D1 의 롤업을 그대로 쓴다.
      // rollupCounts 는 모든 카테고리를 키로 남기므로(D1 계약) 없는 키를 걱정하지 않는다.
      subTabs={subs.map((sub) => ({ id: sub.id, name: sub.name, count: counts[sub.id] }))}
      initialSubId={target.id === root.id ? null : target.id}
      emptyMessage={EMPTY_LIST_MESSAGE}
      isAdmin={session !== null}
    />
  );
}

/**
 * 화면의 주인이 되는 상위 카테고리. 하위로 들어왔으면 그 부모다.
 *
 * 부모가 목록에 없는 하위(스키마상 생길 수 없지만 데이터가 깨졌을 때)는 404 로 막지 않고
 * 자기 자신을 상위처럼 그린다 — 링크가 있는데 열 수 없는 화면이 더 나쁘다.
 */
function rootOf(target: Category, categories: readonly Category[]): Category {
  if (target.parent_id === null) return target;

  return categories.find((category) => category.id === target.parent_id) ?? target;
}

/**
 * 제목 아래 설명 한 줄 (DESIGN_SPEC 4장, 문구는 프로토타입 `listDesc`).
 * 하위도 없고 운영 중 분류도 아니면 설명이 없다 — 마케팅 화면이 그렇다(스크린샷 01-shot).
 */
function descriptionOf(
  root: Category,
  categories: readonly Category[],
  hasSubs: boolean,
): string | undefined {
  if (root.id === findOperatingCategoryId(categories)) {
    return '회사가 직접 운영하는 서비스와 관리 도구';
  }

  // 프로토타입 원문의 오타('좀혀서')만 바로잡았다.
  return hasSubs ? '아래 탭으로 좁혀서 봅니다.' : undefined;
}
