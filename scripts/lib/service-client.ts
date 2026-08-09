import { createClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/supabase/env';

/**
 * 스크립트(B4 파비콘 업로드·B5 시드)용 service role 클라이언트.
 *
 * ⚠️ **이 파일과 이를 쓰는 스크립트는 반드시 `npx tsx <script>` 로 실행한다.**
 * 맨 위의 `@/lib/supabase/env` 는 tsconfig 의 `paths` 별칭인데, Node 네이티브 TS 실행은
 * tsconfig 를 읽지 않아 `ERR_MODULE_NOT_FOUND` 로 죽는다. `tsx` 는 별칭을 해석한다.
 * (`package.json` 에 tsx 가 devDependency 로 들어 있다.)
 *
 * `lib/supabase/admin.ts` 와 권한은 같지만 소비 환경이 다르다 — admin 쪽은 첫 줄의
 * `import 'server-only'` 때문에 Next 의 RSC 레이어 밖에서는 import 하는 순간 throw 한다.
 * 그래서 스크립트 전용 진입점을 따로 둔다.
 * 앱 코드(서버 컴포넌트·라우트 핸들러)에서는 이 파일을 쓰지 말고 `lib/supabase/admin.ts` 를 써라.
 *
 * 스크립트는 Next 런타임 밖에서 돌아 `.env.local` 이 자동으로 로드되지 않으므로 직접 읽는다.
 */
export function createServiceRoleClient() {
  loadEnvLocal();

  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}

/**
 * 저장소 루트의 `.env.local`을 `process.env`로 올린다(Node 내장 파서 — 의존성 없음).
 *
 * 파일이 없어도 조용히 넘어간다 — CI처럼 환경변수를 직접 주입하는 곳이 있기 때문이다.
 * 값이 정말 없으면 위의 `requireEnv`가 무엇이 비었는지 알려 주며 던진다.
 */
function loadEnvLocal(): void {
  const envPath = new URL('../../.env.local', import.meta.url);

  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
}
