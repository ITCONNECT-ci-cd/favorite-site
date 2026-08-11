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
 *
 * ## ⚠️ env 가 비면 공개 화면까지 500 이다 (의도된 fail-loud)
 *
 * `updateSession` 은 `requireEnv` 를 지나므로 `NEXT_PUBLIC_SUPABASE_URL`·ANON_KEY 가
 * 비면 던진다. 이 파일은 matcher 상 **거의 모든 경로**를 타므로, 그 순간 관리 화면뿐
 * 아니라 공개 화면까지 통째로 500 이 된다. env 누락이 조용히 "로그아웃 상태"로 둔갑해
 * 원인 모를 인증 버그로 번지는 것보다, 배포 즉시 크게 실패하는 편이 낫다고 보고 그대로 둔다.
 *
 * 대신 이 실패는 **우아한 오류 화면으로 감쌀 수 없다** — 프록시는 layout·error 경계보다
 * 앞단이라 `app/error.tsx` 가 잡지 못한다. 배포 전 env 확인이 유일한 방어선이다.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /**
   * Discord ingest API와 정적 자산을 뺀 전 경로.
   *
   * `/api/discord-ingest`는 사용자 session이 아니라 raw-body HMAC로 인증한다. 이 경로가 proxy를 타면
   * 크기·서명 검사보다 먼저 Supabase Auth `getUser()` 네트워크 요청이 나가므로 matcher 단계에서
   * 완전히 제외한다(하위 path와 trailing slash도 함께 제외).
   *
   * matcher 가 없으면 `_next/static` 과 `public/` 의 이미지까지 전부 이 함수를 타는데,
   * 세션 갱신은 Supabase Auth 로 나가는 네트워크 호출이라 파비콘 한 장마다 왕복이 붙는다.
   * 이미지 확장자를 빼는 것도 같은 이유다 — `public/` 아래 파일은 `_next` 접두사가 없어서
   * 앞의 두 패턴에 안 걸린다.
   */
  matcher: [
    '/((?!api/discord-ingest(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
