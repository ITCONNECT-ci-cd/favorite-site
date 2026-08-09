import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { ADMIN_EMAIL } from '@/lib/admin-config';

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
 * **만료 토큰의 자동 갱신**(리프레시해 응답 쿠키에 돌려쓰는 일)은 이 파일이 아니라
 * 루트 `proxy.ts`(→ `./proxy` 의 `updateSession`)가 맡는다. 렌더 중에는 쿠키를 쓸 수 없어
 * 여기서는 할 수 없는 일이기 때문이다. 그래서 아래 `setAll` 의 catch 가 **렌더 경로에서는**
 * 안전하다 — 서버 컴포넌트가 못 쓴 쿠키는 이미 프록시가 써 둔 것이다.
 * 서버 액션·라우트 핸들러에서는 이야기가 다르다(아래 `setAll` 주석 참조).
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
        // 갱신 쿠키가 나가는 경로는 프록시고(`./proxy`) 그쪽이 이 헤더를 응답에 제대로 붙인다.
        // 이 자리에서 응답을 다루게 되면 그때 인자를 받아라.
        //
        // ⚠️ "쿠키가 나가는 경로는 프록시뿐"은 **렌더 경로에서만** 참이다. 서버 액션과
        // 라우트 핸들러에서는 `cookieStore.set` 이 실제로 성공한다 — H2 의 로그인
        // (`signInWithPassword`)이 세션 쿠키를 굽는 자리가 바로 여기이고, 로그아웃
        // (`signOut`)이 쿠키를 지우는 자리도 여기다. 이 `setAll` 을 no-op 으로 만들면
        // 로그인이 조용히 "성공했는데 로그인 안 된 상태"가 된다.
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없어 Next가 던진다. 그 경우 갱신은
            // 루트 `proxy.ts` 가 이미 했거나 다음 요청에 다시 시도되므로 조용히 넘긴다.
            //
            // ⚠️ 대가: **액션·라우트 핸들러 경로의 진짜 저장 실패도 여기서 함께 사라진다.**
            // 렌더 경로의 정당한 거부와 구별할 방법이 이 자리에는 없어서(둘 다 같은 throw다)
            // 감수한다 — Supabase 공식 SSR 패턴이 이 형태다. 다행히 증상은 숨지 않는다:
            // `app/admin/actions.ts` 는 로그인 성공 후 `/admin` 으로 되돌리고 레이아웃이 세션을
            // 다시 판정하므로, 쿠키가 안 실렸다면 곧바로 로그인 화면이 다시 뜬다.
            // 이 catch 를 지우지는 마라 — 지우면 모든 서버 컴포넌트 렌더가 터진다.
          }
        },
      },
    },
  );
}

/**
 * 로그인한 **관리자**의 세션 요약. 관리자가 아니면 `getAdminSession()` 이 `null` 을 준다.
 *
 * Supabase 의 `Session` 객체를 그대로 흘리지 않는다 — 그 안에는 `access_token` ·
 * `refresh_token` 이 들어 있어서 서버 컴포넌트가 무심코 클라이언트 컴포넌트의 prop 으로
 * 넘기면 토큰이 HTML 페이로드에 박혀 나간다. 화면이 실제로 쓰는 값만 남긴 요약이다.
 */
export type AdminSession = {
  /** `auth.users.id` — 감사 로그·소유자 컬럼에 쓸 UUID. */
  userId: string;
  /**
   * 관리자 이메일. **항상 `ADMIN_EMAIL` 과 같다**(대소문자만 계정에 저장된 그대로다).
   *
   * 게이트를 통과했다는 것 자체가 이 값이 그 하나임을 뜻하므로 nullable 이 아니다.
   * 분기 재료로 쓰지 마라 — 이 값으로 다시 판정할 일이 있다면 그건 게이트가 할 일이다.
   */
  email: string;
};

/**
 * **모든 관리 진입점의 유일한 인증 관문.**
 *
 * 관리 라우트(`app/admin/*`)·서버 액션(H4 `lib/mutations.ts`)·현장 편집 노출(J1)은
 * 인증 여부를 자기 방식으로 판단하지 말고 반드시 이 함수만 부른다. 판정이 한 곳에
 * 모여 있어야 "여기만 뚫린" 진입점이 안 생긴다.
 *
 * ## 계약: "인증됨"이 아니라 **"그 관리자임"**
 *
 * 반환이 non-null 이면 요청자는 `ADMIN_EMAIL`(`lib/admin-config.ts`) 계정이다.
 * `null` 은 "비로그인 **또는** 다른 계정"을 뜻하며 둘을 구분해 알려 주지 않는다.
 *
 * 이 신원 확인이 왜 필요한가: 이 프로젝트의 Supabase 는 anon 키가 브라우저에 공개되고,
 * public signup 이 켜져 있으면 **누구나 스스로 "인증 사용자"가 될 수 있다.** 게이트를
 * `getUser()` 성공 여부로만 두면 그렇게 만든 아무 계정이나 관리 화면에 들어온다.
 * 그래서 여기서 신원까지 본다. DB 쪽 같은 겹은
 * `supabase/migrations/0002_admin_write_policy.sql` 이 지고, signup 자체를 끄는 것은
 * 대시보드 설정이다(`scripts/verify-schema.ts` 검사 ⑦ 이 확인한다). 세 겹은 서로를
 * 대체하지 못한다 — 앱을 우회한 REST 호출은 게이트를 지나지 않고, RLS 는 화면 노출을
 * 막지 못한다.
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
 * ## `cache()` 로 감싼 이유 — **한 번의 RSC 렌더 패스** 안에서의 중복 제거
 *
 * `getUser()` 는 Supabase Auth 로 나가는 **네트워크 왕복**이다. App Router 에서는 layout 이
 * 받은 값을 children 에 넘길 수 없어 관리 layout 과 page 가 같은 렌더에서 각각 이 함수를
 * 부르고(H2), 3단계 J1 의 편집 노출 컴포넌트도 같은 렌더에서 또 부른다. 감싸지 않으면
 * 화면 하나에 인증 왕복이 여러 번 붙는다. `lib/queries.ts` 의 `getAllData` 와 같은 장치다.
 *
 * **범위는 렌더 패스다.** React 의 `cache()` 는 React 가 깔아 두는 requestStorage 안에서만
 * 산다. Next 16.3 의 **서버 액션은 그 밖에서 실행되므로 액션 안에서는 `cache()` 가 사실상
 * no-op** 이고, 액션 호출마다 Auth 왕복이 한 번 더 붙는다(H4 의 쓰기 액션들). 액션당 한 번은
 * 감수할 만한 비용이라 그대로 둔다 — 액션은 사람이 버튼을 누른 만큼만 일어난다.
 *
 * ⚠️ 그 분리 자체가 **보안 성질**이다. 액션과 그 뒤의 재렌더는 캐시 스코프를 공유하지 않으므로,
 * 로그아웃 액션이 세션을 지운 뒤의 재렌더에는 낡은 non-null 세션이 **보일 수 없다.**
 * 이걸 "왕복을 줄인다"며 액션과 재렌더가 함께 쓰는 스코프(모듈 레벨 메모·전역 캐시 등)로
 * 바꾸면 그 보증이 깨지고, 로그아웃 직후 화면이 관리자로 그려질 수 있다. 바꾸지 마라.
 *
 * 요청 사이에는 어차피 남지 않는다 — 다음 요청은 처음부터 다시 검증한다.
 */
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) return null;

  // 여기서부터가 "인증됨 → 그 관리자임". 이메일은 Supabase 가 소문자로 저장하지만
  // 저장 시점 정책이 바뀌어도 판정이 흔들리지 않게 양쪽을 접어서 비교한다.
  // `typeof` 로 보는 이유: 타입상 `string | undefined` 지만 실제 응답에서 `null` 이 오는
  // 계정도 있다(전화번호·OAuth 로만 만든 계정). 어느 쪽이든 관리자가 아니다.
  const email: unknown = data.user.email;
  if (typeof email !== 'string' || email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return null;

  return { userId: data.user.id, email };
});
