import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

/**
 * 요청마다 Supabase 세션을 갱신한다. 실제 로직은 `lib/supabase/proxy.ts` 에 있다.
 *
 * ## 파일 이름이 `middleware.ts` 가 아닌 이유
 *
 * Next 16 에서 `middleware` 파일 컨벤션은 **폐기되고 `proxy` 로 이름이 바뀌었다.**
 * `middleware.ts` 로 두면 빌드마다 폐기 경고가 찍히고, 둘 다 있으면 빌드가 아예 실패한다
 * (`node_modules/next/dist/build/index.js` 의 E900). 그러니 세션 가드를 추가하고 싶어도
 * `middleware.ts` 를 새로 만들지 말고 이 파일을 고쳐라.
 * 참고: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /**
   * 정적 자산을 뺀 전 경로.
   *
   * matcher 가 없으면 `_next/static` 과 `public/` 의 이미지까지 전부 이 함수를 타는데,
   * 세션 갱신은 Supabase Auth 로 나가는 네트워크 호출이라 파비콘 한 장마다 왕복이 붙는다.
   * 이미지 확장자를 빼는 것도 같은 이유다 — `public/` 아래 파일은 `_next` 접두사가 없어서
   * 앞의 두 패턴에 안 걸린다.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
