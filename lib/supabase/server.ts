import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { requireEnv } from './env';

/**
 * 서버 컴포넌트·라우트 핸들러용 Supabase 클라이언트.
 *
 * anon key로 붙고 권한은 RLS가 정한다. 요청마다 새로 만들어야 한다 —
 * 모듈 레벨에 하나 만들어 두고 돌려쓰면 다른 사용자의 세션이 섞인다.
 *
 * Next 16의 `cookies()`는 Promise라 `await`가 필요하고, 그래서 이 함수도 async다.
 * 쿠키 메서드는 `getAll`/`setAll`만 쓴다(`get`/`set`/`remove`는 폐기 예정 API다).
 *
 * 세션 갱신(만료 토큰을 리프레시해 응답 쿠키에 돌려쓰는 일)은 이 파일이 아니라
 * 루트 `proxy.ts`(→ `./proxy` 의 `updateSession`)가 맡는다. 그래서 아래 `setAll` 의
 * catch 가 안전하다 — 서버 컴포넌트가 못 쓴 쿠키는 이미 프록시가 써 둔 것이다.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // `SetAllCookies` 의 두 번째 인자는 auth 쿠키와 함께 응답에 실어야 하는 캐시 방지
        // 헤더(`Cache-Control: private, no-store…`)다. **여기서는 반영할 방법이 없어**
        // 아예 받지 않는다 — 서버 컴포넌트에는 손댈 응답 객체가 없고, 인자만 선언해 두면
        // 미사용 경고만 남는다(인자가 적은 함수도 타입상 대입된다).
        // 실제로 쿠키가 나가는 경로는 프록시뿐이고(아래 catch 참조) 그쪽(`./proxy`)이
        // 이 헤더를 응답에 제대로 붙인다. 이 자리에서 응답을 다루게 되면 그때 인자를 받아라.
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없어 Next가 던진다.
            // 세션 갱신은 루트 `proxy.ts` 가 맡으므로 여기서는 조용히 넘긴다.
          }
        },
      },
    },
  );
}

/**
 * 로그인한 관리자의 세션 요약. 없으면 `getAdminSession()` 이 `null` 을 준다.
 *
 * Supabase 의 `Session` 객체를 그대로 흘리지 않는다 — 그 안에는 `access_token` ·
 * `refresh_token` 이 들어 있어서 서버 컴포넌트가 무심코 클라이언트 컴포넌트의 prop 으로
 * 넘기면 토큰이 HTML 페이로드에 박혀 나간다. 화면이 실제로 쓰는 값만 남긴 요약이다.
 */
export type AdminSession = {
  /** `auth.users.id` — 감사 로그·소유자 컬럼에 쓸 UUID. */
  userId: string;
  /** 관리자 이메일. Supabase 타입상 optional 이라 없을 수 있다. */
  email: string | null;
};

/**
 * **모든 관리 진입점의 유일한 인증 관문.**
 *
 * 관리 라우트(`app/admin/*`)·서버 액션(H4 `lib/mutations.ts`)·현장 편집 노출(J1)은
 * 인증 여부를 자기 방식으로 판단하지 말고 반드시 이 함수만 부른다. 판정이 한 곳에
 * 모여 있어야 "여기만 뚫린" 진입점이 안 생긴다. 반환이 `null` 이면 비로그인이다.
 *
 * ## `getSession()` 이 아니라 `getUser()` 인 이유
 *
 * `getSession()` 은 **쿠키에 든 JWT 를 파싱만 하고 서명을 검증하지 않는다.** 쿠키는
 * 클라이언트가 보내는 값이라 위조할 수 있고, 그래서 서버에서 `getSession()` 으로 권한을
 * 정하면 아무나 관리자가 된다(supabase-js 도 서버에서 쓰면 경고를 찍는다).
 * `getUser()` 는 Supabase Auth 서버에 토큰을 보내 검증받은 사용자만 돌려준다.
 * **이 호출을 `getSession()` 으로 바꾸지 마라 — 그 순간 인증이 사라진다.**
 *
 * ## 실패는 전부 비로그인으로 접는다
 *
 * 토큰 만료·위조·네트워크 오류를 구분하지 않고 `null` 이다. 인증 게이트에서 모르는
 * 상태는 "통과"가 아니라 "거부"여야 한다(fail-closed). 사유를 화면에 나눠 보여 주는 것도
 * 계정 존재 여부를 알려 주는 단서가 되므로 H2 의 "사유 비구분" 방침과 어긋난다.
 *
 * ## `cache()` 로 감싼 이유 — 요청 단위 중복 제거
 *
 * `getUser()` 는 Supabase Auth 로 나가는 **네트워크 왕복**이다. App Router 에서는 layout 이
 * 받은 값을 children 에 넘길 수 없어 관리 layout 과 page 가 같은 요청에서 각각 이 함수를
 * 부르고(H2), 서버 액션마다도 다시 부른다(H4). 감싸지 않으면 화면 하나에 인증 왕복이 여러 번
 * 붙는다. `lib/queries.ts` 의 `getAllData` 와 같은 장치이며 **요청 안에서만** 사는
 * 메모이제이션이라 다음 요청은 다시 검증한다 — 로그아웃이 늦게 반영될 걱정은 없다.
 */
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) return null;

  return { userId: data.user.id, email: data.user.email ?? null };
});
