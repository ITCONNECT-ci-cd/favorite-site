/**
 * `GET /api/version` — **지금 이 도메인이 실행 중인 빌드가 무엇인가.**
 *
 * ## 왜 있는가
 *
 * 2026-08-10, `main` 에 밀고 Vercel 빌드가 `success` 로 끝났는데도 `favorite.itconnect.dev` 가
 * 두 배포 전 코드를 계속 실행했다. 빌드 성공과 도메인 전환이 따로 논 것인데, 그때 배포 여부를
 * **링크 개수 같은 데이터로 판단해서 놓쳤다** — 데이터는 어느 빌드든 같은 라이브 DB 를 읽으므로
 * 옛 코드에서도 최신 숫자가 나온다.
 *
 * 그래서 코드 자신에게 직접 묻는다: "너는 어느 커밋이냐". `scripts/verify-deploy.ts` 가 로컬
 * `HEAD` 와 이 응답을 대조해 붙을 때까지 기다리고, 안 붙으면 실패로 끝낸다.
 *
 * ## 무엇을 돌려주는가
 *
 * 값은 전부 Vercel 이 런타임에 주입하는 환경변수다(로컬에서는 전부 null — 그때는 검증 대상이
 * 아니라는 뜻이라 스크립트가 그렇게 읽는다).
 *
 * - `sha` — 이 빌드가 만들어진 커밋 (`VERCEL_GIT_COMMIT_SHA`)
 * - `ref` — 그 커밋이 있던 브랜치 (`VERCEL_GIT_COMMIT_REF`)
 * - `deploymentId` — **어느 배포가 도메인에 붙어 있는가.** 별칭이 안 옮겨간 이번 같은 사고에서
 *   "성공한 그 배포가 맞는지"를 가르는 값이라 sha 와 함께 낸다.
 *
 * ## 공개해도 되는가
 *
 * 된다. 짧은 커밋 해시와 배포 id 뿐이고, 비공개 저장소의 SHA 하나로는 아무것도 열리지 않는다.
 * 대신 **그 이상은 싣지 않는다** — 환경변수를 통째로 뱉는 진단 엔드포인트로 자라지 않게 한다.
 *
 * `no-store` 를 붙이는 이유: 이 응답이 CDN 에 한 번 얹히면 별칭이 옮겨간 뒤에도 옛 답을 돌려줘,
 * 사고를 잡으라고 만든 장치가 사고를 감추게 된다.
 */
export const dynamic = 'force-dynamic';

/**
 * 값이 없으면 `null`. **빈 문자열도 '없음'으로 접는다** — `??` 만 쓰면 빈 값이 그대로 나가고,
 * 검증 스크립트의 `sha === null` 분기(“여긴 Vercel 이 아니다”)가 빗나가 빈 문자열을 커밋으로
 * 대조하다 영영 실패한다.
 */
function envOrNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value;
}

export function GET(): Response {
  const body = {
    sha: envOrNull(process.env.VERCEL_GIT_COMMIT_SHA),
    ref: envOrNull(process.env.VERCEL_GIT_COMMIT_REF),
    deploymentId: envOrNull(process.env.VERCEL_DEPLOYMENT_ID),
  };

  return Response.json(body, {
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}
