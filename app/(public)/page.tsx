import { HomeView } from "@/components/HomeView";
import { getAllData } from "@/lib/queries";
import { getAdminSession } from "@/lib/supabase/server";

/**
 * 홈 (DESIGN_SPEC 3장). 데이터를 서버에서 한 번 읽어 화면(HomeView)에 넘기기만 한다 —
 * 즐겨찾기 분류와 드래그·편집 상태를 한 화면에서 다루므로 섹션 구성은 클라이언트 쪽에 둔다.
 *
 * **연필·휴지통의 노출 여부도 여기서 정한다** (J1): 세션 판정은 서버에서만 하고, 화면은
 * boolean 하나만 받는다. 셸(layout)이 이미 같은 함수를 부르지만 layout 은 받은 값을 children 에
 * 넘길 수 없어 화면이 다시 부른다 — React `cache()` 덕에 Auth 왕복은 요청당 한 번이다
 * (lib/supabase/server.ts 의 getAdminSession JSDoc).
 *
 * 두 조회를 `Promise.all` 로 묶는 것은 서로 무관하기 때문이다. 이어서 await 하면 DB 왕복이
 * 끝나야 Auth 왕복이 시작되는 폭포가 생긴다.
 *
 * `export const revalidate` 를 넣지 마라 — 이 페이지는 매 요청 렌더되는 것이 의도다.
 * 근거는 lib/queries.ts 의 getAllData JSDoc 에 있다.
 */
export default async function Home() {
  const [data, session] = await Promise.all([getAllData(), getAdminSession()]);

  return <HomeView data={data} isAdmin={session !== null} />;
}
