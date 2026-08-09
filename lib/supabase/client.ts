import { createBrowserClient } from '@supabase/ssr';

import { requireEnv } from './env';

/**
 * 브라우저(클라이언트 컴포넌트) 전용 Supabase 클라이언트.
 *
 * anon key만 쓰므로 브라우저에 노출돼도 되는 값만 들어간다 — 실제 권한은 DB의 RLS가 정한다.
 * `createBrowserClient`는 브라우저에서 싱글턴을 재사용하므로 렌더마다 불러도 인스턴스가 늘지 않는다.
 *
 * 서버(서버 컴포넌트·라우트 핸들러)에서는 쓰지 마라 — 쿠키를 `document.cookie`로 읽는다.
 * 서버는 `./server`, service role이 필요하면 `./admin`을 쓴다.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
