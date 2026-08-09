import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { signInAction } from '@/app/admin/actions';
import { LoginForm } from '@/components/admin/LoginForm';
import { getAdminSession } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: '관리자',
};

/** 로그인 화면 맨 위 주소 표기의 경로 부분. */
const ADMIN_PATH = '/admin';

/**
 * 관리 라우트의 인증 관문 — `/admin` 아래 전부가 이 문을 지난다.
 *
 * 세션이 없으면 **children 을 렌더하지 않고** 로그인 화면만 내보낸다. `getAdminSession()` 이
 * `getUser()` 기반(= Supabase 서버가 서명을 검증한 사용자)이라 쿠키를 위조해도 통과하지
 * 못한다. 판정을 여기서 따로 하지 마라 — 관리 진입점의 인증은 그 함수 하나로 모아 둔다
 * (lib/supabase/server.ts 주석).
 *
 * ## 이 화면이 공개 셸에 감싸이지 않는 이유
 *
 * 관리 라우트는 `app/(public)/` 라우트 그룹 **밖**에 있다. 그래서 사이드바·헤더를 상속하지
 * 않고, 로그인 화면이 스펙대로 화면 전체를 덮는다(DESIGN_SPEC 6장). 이 파일을 `(public)`
 * 안으로 옮기면 그 구조가 그대로 깨진다.
 *
 * ## ⚠️ 레이아웃 가드만으로는 새어 나간다 — 관리 화면은 저마다 다시 확인해야 한다
 *
 * children 을 렌더하지 않아도 **Next 는 page 세그먼트를 렌더해 응답의 RSC 페이로드에
 * 실어 보낸다.** 화면에는 안 보여도 HTML 안에 그 내용이 문자열로 들어 있다는 뜻이다
 * (H2 통합 검증에서 dev·프로덕션 빌드 양쪽에서 실측: 미인증 `/admin` 응답에 관리 화면
 * 본문이 그대로 들어 있었다). 이건 Next 의 동작이지 우리 코드의 실수가 아니다 —
 * 라우터가 세그먼트 단위로 캐시·내비게이션하려면 그 페이로드가 필요하기 때문이다.
 *
 * 그래서 **`app/admin/**` 의 모든 page 는 자기 첫 줄에서 `getAdminSession()` 을 다시 확인하고,
 * 없으면 아무것도 렌더하지 말아야 한다.** 이 규칙은 `app/admin/page.test.tsx` 가 소스에서
 * 강제한다 — H3 가 새 관리 화면을 붙일 때도 같은 줄이 필요하다.
 *
 * 그리고 이 둘을 합쳐도 **데이터를 지키는 것은 아니다.** 서버 액션은 UI 를 거치지 않고
 * POST 될 수 있으므로 쓰기 계층(H4 `lib/mutations.ts`)이 자기 자리에서 또 확인해야 한다.
 * 여기서 통과했다는 사실은 그쪽에 전달되지 않는다.
 */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const session = await getAdminSession();

  if (session === null) {
    return <LoginForm action={signInAction} address={await currentAddress()} />;
  }

  return children;
}

/**
 * 로그인 화면 맨 위 11px 주소 표기 (DESIGN_SPEC 6장).
 *
 * 도메인을 코드에 박지 않고 요청 헤더에서 읽는다 — 프로토타입에 적힌 주소는 시안용 값이고,
 * 실제로 어느 도메인에 붙을지는 배포가 정한다. 박아 두면 배포 주소와 다른 순간부터 거짓말이
 * 된다. 프록시 뒤(Vercel 등)에서는 원래 호스트가 `x-forwarded-host` 로 온다.
 *
 * 헤더 값은 클라이언트가 보낸 것이라 위조할 수 있다. 여기서는 **글자로만** 쓰이고(React 가
 * 이스케이프한다) 어떤 판정에도 관여하지 않으므로 그대로 보여도 된다. 이 값을 인증·링크
 * 생성에 쓰지 마라.
 */
async function currentAddress(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');

  return host === null ? ADMIN_PATH : `${host}${ADMIN_PATH}`;
}
