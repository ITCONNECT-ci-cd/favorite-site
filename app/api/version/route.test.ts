/**
 * `GET /api/version` — 배포 검증(`scripts/verify-deploy.ts`)이 기대는 계약 셋을 못박는다.
 *
 * 1. Vercel 이 주입한 커밋 SHA 를 **그대로** 낸다 (스크립트가 로컬 HEAD 와 글자로 대조한다)
 * 2. 그 값이 없으면 `null` — "모른다"를 빈 문자열이나 `'unknown'` 같은 것으로 흐리지 않는다
 * 3. **캐시되지 않는다** — 한 번 CDN 에 얹히면 별칭이 옮겨간 뒤에도 옛 답을 돌려줘, 사고를
 *    잡으라고 만든 장치가 사고를 감춘다
 *
 * 그리고 **세 키 말고는 아무것도 싣지 않는다** — 환경변수를 뱉는 진단 엔드포인트로 자라지 않게
 * 하는 잠금이다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/version/route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/version', () => {
  it('Vercel 이 준 커밋·브랜치·배포 id 를 그대로 낸다', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234def5678');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_xyz');

    await expect(GET().json()).resolves.toEqual({
      sha: 'abc1234def5678',
      ref: 'main',
      deploymentId: 'dpl_xyz',
    });
  });

  it('Vercel 밖(로컬)에서는 세 값이 모두 null 이다 — 검증 대상이 아니라는 신호다', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', '');
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '');

    // 빈 문자열도 '없음'이다 — 스크립트가 `sha === null` 하나로 가른다.
    const body = (await GET().json()) as Record<string, unknown>;

    expect(body).toEqual({ sha: null, ref: null, deploymentId: null });
  });

  it('세 키 말고는 싣지 않는다 (진단 엔드포인트로 자라지 않게)', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc');

    const body = (await GET().json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['deploymentId', 'ref', 'sha']);
  });

  it('캐시되지 않는다 — 옛 답이 CDN 에 얹히면 사고를 감춘다', () => {
    expect(GET().headers.get('cache-control')).toContain('no-store');
  });

  it('force-dynamic 이다 — 빌드 때 값이 굳지 않는다', async () => {
    const route = await import('@/app/api/version/route');

    expect(route.dynamic).toBe('force-dynamic');
  });
});
