import type { Metadata } from 'next';
import { ListView } from '@/components/ListView';
import { DAILY_TITLE, EMPTY_LIST_MESSAGE } from '@/lib/constants';
import { getAllData } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';

/**
 * 화면 머리말. 프로토타입 원문(`직접 고정한 링크만 모입니다. 순서가 바뀌지 않습니다.`)을
 * **사실에 맞게 고쳤다**(2026-08-10 사용자 지적) — 고정을 켜는 곳은 홈이 아니라 관리 화면이고,
 * 순서는 관리 화면에서도 이 화면에서도 끌어서 바꿀 수 있다. 근거는 `components/HomeView.tsx`
 * 의 `dailyNote` 에 한 번만 적어 두었다.
 *
 * 제목은 홈 섹션과 같은 이름이라 `lib/constants` 가 든다(DAILY_TITLE 주석).
 */
const DESCRIPTION = '관리자가 고정해 전사가 함께 쓰는 목록입니다. 분류와 상관없이 여기 모입니다.';

/** 탭 제목 — 화면 이름만 댄다. 꼬리표(`— 내 링크`)는 셸의 title template 이 붙인다. */
export const metadata: Metadata = {
  title: DAILY_TITLE,
};

/**
 * 매일 사용하는 사이트 목록 화면 — `/daily` (DESIGN_SPEC 4장).
 *
 * 홈의 '매일' 섹션과 같은 링크(`is_pinned`)를 보여 주지만 **핀을 노출한다** — 홈 섹션은 관리자가
 * 정하는 자리라 핀을 감추고(D2), 홈 밖의 모든 화면에서는 담기/빼기가 열려 있다(PRD P10).
 * ListView 의 기본값이 곧 이 규칙이라 따로 넘기지 않는다.
 *
 * 순서는 서버가 준 `sort_order` 를 그대로 쓰고, 관리자는 카드를 끌어 바꿀 수 있다 (J5).
 * 여러 분류가 섞인 목록이지만 `reorderBookmarks` 가 **이 목록이 쥔 자리끼리만** 맞바꾸므로
 * 다른 분류 화면의 차례는 흔들리지 않는다(그 액션의 JSDoc).
 * 하위 탭은 없다 — 분류가 아니라 고정 여부로 모은 목록이라 나눌 축이 없다.
 *
 * 연필·휴지통의 노출 여부는 서버에서만 정한다 (J1) — 홈과 같은 배선이라 근거는
 * `app/(public)/page.tsx` 의 JSDoc 에 한 번만 적어 뒀다.
 *
 * `export const revalidate` 를 넣지 마라 — 매 요청 렌더가 의도다(근거는 lib/queries.ts).
 */
export default async function DailyPage() {
  const [{ bookmarks }, session] = await Promise.all([getAllData(), getAdminSession()]);

  return (
    <ListView
      title={DAILY_TITLE}
      description={DESCRIPTION}
      bookmarks={bookmarks.filter((bookmark) => bookmark.is_pinned)}
      emptyMessage={EMPTY_LIST_MESSAGE}
      isAdmin={session !== null}
    />
  );
}
