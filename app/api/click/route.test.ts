/**
 * F2. 라우트 레벨 테스트 — **판정이 아니라 배선을 본다.**
 *
 * 쿨다운·상한·body 검증의 *규칙*은 전부 `./logic.test.ts` 가 순수 함수로 덮는다.
 * 여기서 보는 건 순수 함수로 뺄 수 없는 것들이다 — 환경이 무너졌을 때의 응답,
 * DB 결과가 어떤 상태 코드·본문으로 번역되는지, 그리고 **어떤 값이 DB 로 넘어가는지**
 * (해시가 원본 uuid 대신 필터에 실리는지, `is_bulk` 가 insert 에 실리는지 — G4 가 여기 의존한다).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `@/lib/supabase/admin` 은 첫 줄이 `import 'server-only'` 라 RSC 밖(=vitest)에서 로드되는
// 순간 던진다. 팩토리로 통째 대체해 원본을 아예 읽지 않게 한다.
const { createAdminSupabaseClient } = vi.hoisted(() => ({ createAdminSupabaseClient: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient }));

const { POST } = await import('@/app/api/click/route');

const BOOKMARK_ID = '0f9c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const VISITOR_ID = '11111111-1111-4111-8111-111111111111';
const SALT = 'test-salt';
const IP = '203.0.113.7';

/**
 * `sha256(VISITOR_ID:IP:SALT)` — `logic.test.ts` 가 못박은 것과 같은 리터럴이다.
 * 여기서 `visitorHash()` 를 다시 부르지 않는 이유: 이 파일이 확인하려는 건 해시 계산이 아니라
 * **헤더 → ip → 해시 → 필터 인자**로 이어지는 배선이다. 함수를 다시 부르면 배선이 끊겨도 통과한다.
 */
const HASH = 'a57d2b9e286fe908302bd2e35323e605fbef71dbe568e1a31e09f25cbe82fb53';

/** 판정이 시각에 걸리므로 시계를 고정한다 — UTC 자정 경계에서 흔들리지 않게. */
const NOW = new Date('2026-08-09T13:24:05.000Z');

type ClickRow = { clicked_at: string };
type DbError = { code?: string; message: string };

/**
 * PostgREST 쿼리 빌더 흉내 — `.select().eq().eq().gte()` 로 이어지고 await 하면 결과가 나온다.
 * `eq`·`gte`·`insert` 를 스파이로 두어 **DB 에 실제로 넘어간 인자**를 단언할 수 있게 한다.
 */
function stubSupabase(result: {
  rows?: ClickRow[];
  selectError?: DbError;
  insertError?: DbError;
}) {
  const eq = vi.fn();
  const gte = vi.fn();
  const insert = vi.fn(() => Promise.resolve({ error: result.insertError ?? null }));

  const selectResult = {
    data: result.selectError === undefined ? (result.rows ?? []) : null,
    error: result.selectError ?? null,
  };

  const builder = {
    eq: (...args: unknown[]) => {
      eq(...args);
      return builder;
    },
    gte: (...args: unknown[]) => {
      gte(...args);
      return builder;
    },
    then: (resolve: (value: typeof selectResult) => unknown) =>
      Promise.resolve(selectResult).then(resolve),
  };

  const select = vi.fn(() => builder);
  const from = vi.fn(() => ({ select, insert }));
  createAdminSupabaseClient.mockReturnValue({ from });

  return { from, select, eq, gte, insert };
}

function clickRequest(
  body: unknown = { bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID },
): Request {
  return new Request('http://localhost/api/click', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `${IP}, 10.0.0.1` },
    body: JSON.stringify(body),
  });
}

/** 오늘(UTC) 안에 있고 쿨다운 밖인 시각 — 일일 상한만 건드리는 행을 만들 때 쓴다. */
function todayRows(count: number): ClickRow[] {
  return Array.from({ length: count }, (_, index) => ({
    clicked_at: new Date(NOW.getTime() - 60_000 * (index + 1)).toISOString(),
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.stubEnv('CLICK_SALT', SALT);
  // 기본값은 "붙으면 실패" — DB 를 쳐서는 안 되는 갈래가 조용히 통과하지 않도록.
  createAdminSupabaseClient.mockReset();
  createAdminSupabaseClient.mockImplementation(() => {
    throw new Error('이 갈래는 Supabase 에 붙기 전에 끝나야 한다');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
});

describe('POST /api/click — 400 (body)', () => {
  it('본문이 비어 있으면 400 이고 DB 를 치지 않는다', async () => {
    const response = await POST(
      new Request('http://localhost/api/click', { method: 'POST' }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'body 를 JSON 으로 읽을 수 없습니다.' });
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it('salt 가 없어도 body 형식 오류가 먼저다 (검증 → 환경 순서)', async () => {
    vi.stubEnv('CLICK_SALT', '');

    const response = await POST(clickRequest({ bookmarkId: 'nope', visitorId: VISITOR_ID }));

    expect(response.status).toBe(400);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });
});

describe('POST /api/click — 판정 결과의 번역', () => {
  it('쿨다운이면 200 이고 insert 하지 않는다', async () => {
    const { insert } = stubSupabase({ rows: [{ clicked_at: '2026-08-09T13:24:00.000Z' }] });

    const response = await POST(clickRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ counted: false, reason: 'cooldown' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('일일 상한이면 200 이고 insert 하지 않는다', async () => {
    const { insert } = stubSupabase({ rows: todayRows(10) });

    const response = await POST(clickRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ counted: false, reason: 'daily-cap' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('조회가 실패하면 500 이고 insert 로 넘어가지 않는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { insert } = stubSupabase({ selectError: { code: '42501', message: 'denied' } });

    const response = await POST(clickRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '클릭 기록을 조회하지 못했습니다.' });
    expect(insert).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
  });
});

describe('POST /api/click — 기록', () => {
  it('정상 클릭이면 200 이고, 해시·isBulk 가 그대로 DB 로 넘어간다', async () => {
    const { from, select, eq, gte, insert } = stubSupabase({ rows: [] });

    const response = await POST(
      clickRequest({ bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID, isBulk: true }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ counted: true });

    expect(from).toHaveBeenCalledWith('clicks');
    expect(select).toHaveBeenCalledWith('clicked_at');

    // 조회는 (북마크 × 방문자 해시) 로 좁히고, 창의 하한은 UTC 오늘 자정이다.
    expect(eq).toHaveBeenCalledWith('bookmark_id', BOOKMARK_ID);
    expect(eq).toHaveBeenCalledWith('visitor_hash', HASH);
    expect(gte).toHaveBeenCalledWith('clicked_at', '2026-08-09T00:00:00.000Z');

    // 원본 uuid 는 필터에도 저장값에도 등장하지 않는다.
    expect(eq).not.toHaveBeenCalledWith('visitor_hash', VISITOR_ID);
    expect(insert).toHaveBeenCalledWith({
      bookmark_id: BOOKMARK_ID,
      visitor_hash: HASH,
      is_bulk: true, // G4 "전체 열기" 가 이 왕복에 의존한다
    });
  });

  it('isBulk 를 안 보내면 is_bulk:false 로 기록한다', async () => {
    const { insert } = stubSupabase({ rows: [] });

    await POST(clickRequest());

    expect(insert).toHaveBeenCalledWith({
      bookmark_id: BOOKMARK_ID,
      visitor_hash: HASH,
      is_bulk: false,
    });
  });

  it('없는 bookmarkId(외래키 위반)는 500 이 아니라 400 + code 다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubSupabase({ rows: [], insertError: { code: '23503', message: 'FK violation' } });

    const response = await POST(clickRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: '존재하지 않는 bookmarkId 입니다.',
      code: 'unknown-bookmark', // F3 가 문구 대신 이 값을 본다
    });
    // 클라이언트가 낡은 id 를 든 상황이라 서버 로그를 더럽히지 않는다.
    expect(logged).not.toHaveBeenCalled();
  });

  it('그 밖의 insert 실패는 500 이고 서버 로그에 남는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubSupabase({ rows: [], insertError: { code: '08006', message: 'connection failure' } });

    const response = await POST(clickRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: '클릭을 기록하지 못했습니다.' });
    expect(logged).toHaveBeenCalled();
  });
});
