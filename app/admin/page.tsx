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
 * **첫 줄의 세션 확인을 지우지 마라** — I 시리즈가 여기를 채우는 순간 그 내용이 미인증 응답에
 * 실려 나간다. 근거는 `app/admin/layout.tsx` 주석에 한 번만 적어 뒀다(`page.test.tsx` 가 강제).
 */
export default async function AdminPage() {
  if ((await getAdminSession()) === null) return null;

  // I1 이 여기에 2단(좌 270px 카테고리 패널 / 우 flex:1 헤더 패널)을 세운다.
  return <main />;
}
