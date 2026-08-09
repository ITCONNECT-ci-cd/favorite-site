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
 * 지금은 "읽기용 클라이언트 생성"까지만 한다 — 세션 갱신(토큰 리프레시를 응답 쿠키에
 * 돌려쓰는 미들웨어)은 3단계 H1 몫이다.
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
