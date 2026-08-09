import 'client-only';

import { createBrowserClient } from '@supabase/ssr';

import { requireEnv } from './env';

/**
 * 브라우저(클라이언트 컴포넌트) 전용 Supabase 클라이언트.
 *
 * anon key만 쓰므로 브라우저에 노출돼도 되는 값만 들어간다 — 실제 권한은 DB의 RLS가 정한다.
 * `createBrowserClient`는 브라우저에서 싱글턴을 재사용하므로 렌더마다 불러도 인스턴스가 늘지 않는다.
 *
 * 첫 줄의 `import 'client-only'`는 `admin.ts`의 `server-only`와 대칭인 장치다 — 이 모듈이
 * 서버 컴포넌트에 섞여 들어가면 빌드가 실패한다. 서버에서 이걸 부르면 세션 쿠키를
 * `document.cookie`로 찾다가 조용히 로그아웃 상태로 동작하는데, 그 사고를 런타임이 아니라
 * 빌드 타임에 막는다. 서버는 `./server`, service role이 필요하면 `./admin`을 쓴다.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
