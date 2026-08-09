import { getAdminSession } from '@/lib/supabase/server';

/**
 * 관리자 — 정리 도구 (`/admin/cleanup`, DESIGN_SPEC 6장 "정리 도구").
 *
 * **자리 표시 화면이다. M2 가 이 파일을 통째로 교체한다** — 2열(같은 주소를 두 번 등록 /
 * 같은 도메인·서로 다른 페이지 / 오래 손대지 않은 링크 30·90·180·365일)이 그때 들어온다.
 * 여기에 미리 살을 붙이지 마라.
 *
 * 지금 이 파일이 존재하는 이유는 하나뿐이다: **셸의 '정리 도구' 탭이 404 로 떨어지지 않게
 * 하는 것**(H3). 그래서 안내 한 줄만 둔다 — 스펙에 없는 문구지만, 빈 화면은 고장과
 * 구분되지 않는다.
 *
 * 첫 줄의 세션 확인을 지우지 마라: 레이아웃이 children 을 렌더하지 않아도 Next 는 이 page 를
 * 렌더해 미인증 응답의 RSC 페이로드에 실어 보낸다(H2 실측). M2 가 여기에 링크 목록을 붙이는
 * 순간 그게 로그인 없이 새어 나간다. `app/admin/page.test.tsx` 가 소스에서 강제한다.
 */
export default async function AdminCleanupPage() {
  if ((await getAdminSession()) === null) return null;

  return (
    <main>
      <p className="text-[12.5px] text-desc">정리 도구 화면은 다음 단계에서 들어옵니다.</p>
    </main>
  );
}
