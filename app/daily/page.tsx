import type { Metadata } from 'next';
import { ListView } from '@/components/ListView';
import { getAllData } from '@/lib/queries';

/** 제목·설명은 프로토타입의 `listTitle`·`listDesc` 그대로다. */
const TITLE = '매일 사용하는 사이트';
const DESCRIPTION = '직접 고정한 링크만 모입니다. 순서가 바뀌지 않습니다.';

/** 탭 제목 — 셸(app/layout.tsx)의 '내 링크' 를 화면 이름으로 덮는다. */
export const metadata: Metadata = {
  title: `${TITLE} — 내 링크`,
};

/** DESIGN_SPEC 4장 빈 상태 문구 — 즐겨찾기만 전용 문구고, 그 밖의 목록은 모두 이 문구다. */
const EMPTY_MESSAGE = '이 분류에 링크가 없습니다.';

/**
 * 매일 사용하는 사이트 목록 화면 — `/daily` (DESIGN_SPEC 4장).
 *
 * 홈의 '매일' 섹션과 같은 링크(`is_pinned`)를 보여 주지만 **핀을 노출한다** — 홈 섹션은 관리자가
 * 정하는 자리라 핀을 감추고(D2), 홈 밖의 모든 화면에서는 담기/빼기가 열려 있다(PRD P10).
 * ListView 의 기본값이 곧 이 규칙이라 따로 넘기지 않는다.
 *
 * 순서는 서버가 준 `sort_order` 를 그대로 쓴다(고른 자리가 바뀌지 않는 것이 이 화면의 약속이다).
 * 하위 탭은 없다 — 분류가 아니라 고정 여부로 모은 목록이라 나눌 축이 없다.
 *
 * `export const revalidate` 를 넣지 마라 — 매 요청 렌더가 의도다(근거는 lib/queries.ts).
 */
export default async function DailyPage() {
  const { bookmarks } = await getAllData();

  return (
    <ListView
      title={TITLE}
      description={DESCRIPTION}
      bookmarks={bookmarks.filter((bookmark) => bookmark.is_pinned)}
      emptyMessage={EMPTY_MESSAGE}
    />
  );
}
