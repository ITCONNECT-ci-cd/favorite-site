/**
 * Supabase 헬퍼 3종이 공유하는 환경변수 가드.
 *
 * **값을 직접 넘겨받는 이유** — Next는 클라이언트 번들에서 `process.env.NEXT_PUBLIC_X`라는
 * *리터럴 표현식만* 빌드 타임에 치환한다. 여기서 `process.env[name]`처럼 동적으로 읽으면
 * 브라우저에서 전부 `undefined`가 되므로, 호출부가 리터럴 접근을 유지한 채
 * 이름과 값을 함께 넘기도록 했다.
 *
 * **모듈 로드 시점이 아니라 호출 시점에 던지는 이유** — 로드 시점에 던지면 env가 없는
 * CI·`next build`가 통째로 깨진다. 실제로 Supabase에 붙는 순간에만 실패해야 한다.
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `환경변수 ${name} 가 비어 있습니다. .env.example 을 .env.local 로 복사한 뒤 ` +
        'Supabase 대시보드(Project Settings → API)의 값을 채우세요.',
    );
  }

  return value;
}
