import { HomeView } from "@/components/HomeView";
import { getAllData } from "@/lib/queries";

/**
 * 홈 (DESIGN_SPEC 3장). 데이터를 서버에서 한 번 읽어 화면(HomeView)에 넘기기만 한다 —
 * 섹션을 나누는 규칙은 즐겨찾기(localStorage)와 함께 봐야 하므로 클라이언트 쪽에 둔다.
 *
 * `export const revalidate` 를 넣지 마라 — 이 페이지는 매 요청 렌더되는 것이 의도다.
 * 근거는 lib/queries.ts 의 getAllData JSDoc 에 있다.
 */
export default async function Home() {
  return <HomeView data={await getAllData()} />;
}
