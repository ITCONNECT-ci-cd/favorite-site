import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { requireEnv } from './env';

/**
 * service role 키로 붙는 Supabase 클라이언트 — **RLS를 통째로 우회한다.**
 *
 * 라우트 핸들러(예: `/api/click`)처럼 익명 사용자가 직접 할 수 없는 쓰기를
 * 서버가 대신할 때만 쓴다. 서버 컴포넌트에서 목록을 읽는 데 쓰지 마라 — 그건 `./server`다.
 *
 * 첫 줄의 `import 'server-only'`는 이 모듈이 클라이언트 번들에 섞여 들어가면
 * **빌드가 실패하도록** 만드는 장치다. service role 키가 브라우저로 새는 사고를
 * 런타임이 아니라 빌드 타임에 막는다.
 *
 * ⚠️ 그 대가로 **plain Node 스크립트에서는 이 모듈을 import할 수 없다**
 * (`server-only`는 `react-server` 조건이 없는 런타임에서 즉시 throw한다).
 * B4·B5 같은 스크립트는 이 파일 대신 `scripts/lib/service-client.ts`를 써라.
 */
export function createAdminSupabaseClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      // 서버에는 저장할 브라우저 스토리지도, 갱신할 사용자 세션도 없다.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}
