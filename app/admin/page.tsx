import { getAdminSession } from '@/lib/supabase/server';

/**
 * 관리자 — 카테고리 · 링크 (`/admin`, DESIGN_SPEC 6장).
 *
 * 상단 탭의 첫 번째 자리이자 로그인 뒤 도착하는 화면이다. 상단 바(60px)·탭·로그아웃은
 * 셸(`components/admin/AdminShell.tsx`)이 지므로 여기서는 **본문만** 만든다.
 *
 * **지금은 빈 자리다.** 좌 270px 카테고리 패널과 우측 헤더 패널(2단)은 I1 이 채우고,
 * 하위 줄·링크 추가 줄·링크 표는 I2~I4 가 이어 붙인다. 여기에 임시 내용을 채우지 마라 —
 * 곧 통째로 갈릴 자리라 그 내용은 어차피 지워지고, 지워지기 전까지는 스펙에 없는 화면이 된다.
 *
 * 본문 패딩과 스크롤은 셸이 갖는다(그쪽 JSDoc "화면과의 계약"). 랜드마크 `<main>` 만
 * 화면이 든다 — 공개 화면의 HomeView·ListView 와 같은 분담이라 I1 이 그 안을 채우면 된다.
 *
 * ## 첫 줄의 세션 확인을 지우지 마라
 *
 * 레이아웃이 이미 막고 있는데 왜 또 보나 싶지만, **레이아웃이 children 을 렌더하지 않아도
 * Next 는 이 page 를 렌더해 응답의 RSC 페이로드에 실어 보낸다.** 화면에는 안 보여도
 * 미인증 요청의 HTML 안에 본문이 문자열로 들어간다(H2 통합 검증에서 dev·프로덕션 양쪽 실측).
 * 지금은 빈 컨테이너라 손해가 없지만, I 시리즈가 여기에 카테고리·링크 전체를 그리는 순간
 * 그게 전부 로그인 없이 새어 나간다. 조회 비용도 미인증 요청마다 그대로 나간다.
 *
 * 그러니 관리 화면은 **자기가 다시 확인하고 아무것도 그리지 않는다.** 이 규칙은
 * `app/admin/page.test.tsx` 가 `app/admin/**` 의 모든 page 에 대해 소스에서 강제한다.
 */
export default async function AdminPage() {
  if ((await getAdminSession()) === null) return null;

  // I1 이 여기에 2단(좌 270px 카테고리 패널 / 우 flex:1 헤더 패널)을 세운다.
  return <main />;
}
