import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없어 Next가 던진다.
            // 세션 갱신은 H1의 미들웨어가 맡으므로 여기서는 조용히 넘긴다.
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
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) return null;

  return { userId: data.user.id, email: data.user.email ?? null };
}
