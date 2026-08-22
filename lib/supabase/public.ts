import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { requireEnv } from './env';

/**
 * 공개 데이터 읽기 전용 Supabase client.
 *
 * categories·bookmarks·bookmark_click_counts 는 anon 역할에 SELECT 권한이 있으므로 사용자
 * 세션이 필요 없다. 요청 쿠키를 읽는 `createServerSupabaseClient` 를 쓰면 프록시가 방금 갱신한
 * 사용자 JWT가 공개 조회에도 붙는다. Supabase Auth와 Data API의 시각이 어긋난 장애에서는 그
 * 첫 요청이 `PGRST303: JWT issued at future` 로 실패하므로, 공개 읽기는 anon 자격으로 분리한다.
 *
 * 브라우저용 `createBrowserSupabaseClient` 와 달리 서버 전용이며 세션을 저장하거나 자동 갱신하지
 * 않는다. 이 client를 관리자 쓰기·인증 판정에 사용하면 RLS가 쓰기를 거부하는 것이 정상이다.
 */
export function createPublicSupabaseClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
