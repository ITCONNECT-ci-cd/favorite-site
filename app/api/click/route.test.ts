/**
 * F2. 라우트 레벨 테스트 — **판정이 아니라 "환경이 무너졌을 때의 응답"만 본다.**
 *
 * 쿨다운·상한·body 검증은 전부 `./logic.test.ts` 가 순수 함수로 덮는다.
 * 여기 남은 건 순수 함수로 뺄 수 없는 갈래 하나뿐이다 — CLICK_SALT 부재.
 * 해시를 만들 수 없으니 DB 는 건드리지도 않고 500 으로 끊어야 하고,
 * 그때 **공개 응답과 서버 로그가 담는 정보가 달라야** 한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// `@/lib/supabase/admin` 은 첫 줄이 `import 'server-only'` 라 RSC 밖(=vitest)에서 로드되는
// 순간 던진다. 팩토리로 통째 대체해 원본을 아예 읽지 않게 한다.
// 호출되면 실패하도록 만들어, salt 검사가 DB 접근보다 **앞**이라는 것도 함께 못박는다.
const { createAdminSupabaseClient } = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(() => {
    throw new Error('CLICK_SALT 가 없으면 Supabase 에 붙기 전에 멈춰야 한다');
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient }));

const { POST } = await import('@/app/api/click/route');

const BOOKMARK_ID = '0f9c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const VISITOR_ID = '11111111-1111-4111-8111-111111111111';

function clickRequest(): Request {
  return new Request('http://localhost/api/click', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  createAdminSupabaseClient.mockClear();
});

describe('POST /api/click — CLICK_SALT 부재', () => {
  // 빈 문자열은 `.env.local` 을 복사만 하고 값을 안 채운 상태다 — 없는 것과 똑같이 취급해야 한다.
  it.each([
    ['미설정', undefined],
    ['빈 문자열', ''],
    ['공백뿐', '   '],
  ])('%s 이면 DB 를 건드리지 않고 500 이다', async (_label, value) => {
    vi.stubEnv('CLICK_SALT', value);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(clickRequest());

    expect(response.status).toBe(500);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it('응답 본문은 일반 문구뿐 — 어떤 환경변수가 비었는지 흘리지 않는다', async () => {
    vi.stubEnv('CLICK_SALT', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(clickRequest());
    const body: unknown = await response.json();

    expect(body).toEqual({ error: '서버 설정 오류로 클릭을 기록하지 못했습니다.' });
    expect(JSON.stringify(body)).not.toContain('CLICK_SALT');
  });

  it('무엇이 비었는지는 서버 로그가 담는다 (운영 진단용)', async () => {
    vi.stubEnv('CLICK_SALT', '');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await POST(clickRequest());

    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain('CLICK_SALT');
  });

  it('salt 가 없어도 body 형식 오류는 그대로 400 이다 (검증이 먼저다)', async () => {
    vi.stubEnv('CLICK_SALT', '');

    const response = await POST(
      new Request('http://localhost/api/click', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookmarkId: 'nope', visitorId: VISITOR_ID }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });
});
