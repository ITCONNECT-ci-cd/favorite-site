import { signOutAction } from '@/app/admin/actions';
import { getAdminSession } from '@/lib/supabase/server';

/**
 * 관리자 화면 — `/admin` (DESIGN_SPEC 6장).
 *
 * **임시 자리다.** 로그인을 통과한 사람이 도착하는 곳이 있어야 로그인 흐름이 완성되므로
 * 최소한만 세워 뒀다. 상단 탭(60px)·카테고리/링크 2단·통계·정리 도구는 H3 부터 들어오고,
 * 그때 이 파일은 통째로 갈린다 — 여기에 살을 붙이지 마라.
 *
 * 로그아웃 버튼만은 지금 둔다. 이게 없으면 **한 번 로그인한 뒤 나갈 방법이 없다**(세션 쿠키를
 * 직접 지우는 것 말고는). H3 가 이 버튼을 상단 탭 줄 우측의 제자리로 옮긴다.
 *
 * ## 첫 줄의 세션 확인을 지우지 마라
 *
 * 레이아웃이 이미 막고 있는데 왜 또 보나 싶지만, **레이아웃이 children 을 렌더하지 않아도
 * Next 는 이 page 를 렌더해 응답의 RSC 페이로드에 실어 보낸다.** 화면에는 안 보여도
 * 미인증 요청의 HTML 안에 본문이 문자열로 들어간다(H2 통합 검증에서 dev·프로덕션 양쪽 실측).
 * 지금은 안내 문구뿐이라 손해가 없지만, H3 가 여기에 링크·통계를 넣는 순간 그게 전부
 * 로그인 없이 새어 나간다. 조회 비용도 미인증 요청마다 그대로 나간다.
 *
 * 그러니 관리 화면은 **자기가 다시 확인하고 아무것도 그리지 않는다.** 이 규칙은
 * `app/admin/page.test.tsx` 가 `app/admin/**` 의 모든 page 에 대해 소스에서 강제한다.
 */
export default async function AdminPage() {
  if ((await getAdminSession()) === null) return null;

  return (
    <main className="flex items-start justify-between gap-[12px] p-[28px]">
      <div>
        <h1 className="text-[15px] font-bold tracking-[-0.02em] text-ink">관리자</h1>
        <p className="mt-[8px] text-[12.5px] text-desc">관리 도구는 다음 단계에서 들어옵니다.</p>
      </div>

      {/* 서버 액션을 form 에 직접 건다 — 로그아웃은 상태가 없어 useActionState 가 필요 없다.
          GET 링크가 아니라 POST 여야 한다: 브라우저·프록시가 미리 훑는 링크로 로그아웃이
          일어나면 안 된다. */}
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex h-[32px] items-center rounded-[7px] border border-border-strong bg-card px-[12px] text-[12.5px] font-semibold text-sub hover:bg-side"
        >
          로그아웃
        </button>
      </form>
    </main>
  );
}
