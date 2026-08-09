/**
 * F3. 카드 클릭 기록 — `POST /api/click`(F2) 로 보내는 클라이언트 경로.
 *
 * 여기서 못박는 것은 **요청의 모양과 fire-and-forget 성질**이다. 판정(쿨다운·상한)은 서버 몫이고
 * (`app/api/click/logic.test.ts`), 이 모듈은 응답을 아예 읽지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// F2 의 검증기를 값으로 가져오는 것은 **테스트라서** 괜찮다 — logic.ts 는 node:crypto 를 끌고 오므로
// 브라우저로 가는 코드(lib/clicks.ts 본체)에서는 여전히 `import type` 만 써야 한다(그 파일 주석 참조).
import { parseClickBody } from '@/app/api/click/logic';
import { openToastText, recordClick } from '@/lib/clicks';
import { VISITOR_KEY } from '@/lib/constants';
import { getVisitorId } from '@/lib/visitor';

/**
 * 서버(`parseClickBody`)가 uuid 만 받으므로 fixture 도 진짜 uuid 여야 한다 —
 * 아무 문자열이나 쓰면 아래 계약 크로스체크가 의미를 잃는다.
 */
const BOOKMARK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BOOKMARK_ID = '22222222-2222-4222-8222-222222222222';

const fetchMock = vi.fn<typeof fetch>();

/** 200 `{ counted: true }` — 이 모듈은 읽지 않지만 실물과 같은 응답을 준다. */
function okResponse(): Response {
  return new Response(JSON.stringify({ counted: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** 마지막 요청의 init — 호출이 없으면 테스트를 실패시킨다. */
function lastInit(): RequestInit {
  const call = fetchMock.mock.calls.at(-1);
  if (call === undefined) throw new Error('fetch 가 불리지 않았다');

  return call[1] ?? {};
}

function lastBody(): unknown {
  return JSON.parse(String(lastInit().body));
}

/** 마이크로태스크를 흘려보낸다 — 삼켜지지 않은 거절이 있으면 vitest 가 여기서 잡는다. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recordClick — 요청의 모양', () => {
  it('/api/click 에 JSON 본문으로 POST 한다', () => {
    recordClick(BOOKMARK_ID);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/click');
    expect(lastInit()).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('keepalive 로 보낸다 — 탭이 이동해도 요청이 끊기지 않아야 한다', () => {
    recordClick(BOOKMARK_ID);

    expect(lastInit().keepalive).toBe(true);
  });

  it('bookmarkId · visitorId · isBulk 를 실어 보낸다', () => {
    const visitorId = getVisitorId();

    recordClick(BOOKMARK_ID);

    expect(lastBody()).toEqual({ bookmarkId: BOOKMARK_ID, visitorId, isBulk: false });
  });

  it('visitorId 는 lib/visitor 가 영속한 값이다 (여러 번 눌러도 같다)', () => {
    recordClick(BOOKMARK_ID);
    recordClick(OTHER_BOOKMARK_ID);

    const stored = localStorage.getItem(VISITOR_KEY);

    expect(stored).not.toBeNull();
    expect(lastBody()).toMatchObject({ bookmarkId: OTHER_BOOKMARK_ID, visitorId: stored });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      visitorId: stored,
    });
  });

  it('isBulk 는 기본 false 이고, 넘기면 그대로 실린다 (G4 의 한 번에 열기)', () => {
    recordClick(BOOKMARK_ID);
    expect(lastBody()).toMatchObject({ isBulk: false });

    recordClick(BOOKMARK_ID, true);
    expect(lastBody()).toMatchObject({ isBulk: true });
  });
});

describe('recordClick — F2 계약 크로스체크', () => {
  /**
   * 서버의 검증기를 그대로 태운다. 여기서 깨지면 실물에서는 400 이 되는데, 응답을 읽지 않는
   * fire-and-forget 이라 화면에는 아무 신호도 남지 않는다 — 그 무성 고장을 이 테스트가 막는다.
   */
  it('보낸 본문이 서버의 parseClickBody 를 그대로 통과한다', () => {
    const visitorId = getVisitorId();

    recordClick(BOOKMARK_ID);

    expect(parseClickBody(lastBody())).toEqual({
      ok: true,
      body: { bookmarkId: BOOKMARK_ID, visitorId, isBulk: false },
    });
  });

  it('한 번에 열기(isBulk) 본문도 통과한다', () => {
    const visitorId = getVisitorId();

    recordClick(OTHER_BOOKMARK_ID, true);

    expect(parseClickBody(lastBody())).toEqual({
      ok: true,
      body: { bookmarkId: OTHER_BOOKMARK_ID, visitorId, isBulk: true },
    });
  });
});

describe('recordClick — fire-and-forget', () => {
  it('기다리지 않는다 — 돌려주는 값이 없다', () => {
    expect(recordClick(BOOKMARK_ID)).toBeUndefined();
  });

  it('요청이 거절돼도(오프라인·차단기) 던지지 않는다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(() => recordClick(BOOKMARK_ID)).not.toThrow();

    // 거절을 삼키지 않았다면 여기서 unhandled rejection 으로 터진다.
    await flush();
  });

  it('fetch 자체를 못 쓰는 환경에서도 호출부를 멈추지 않는다', () => {
    vi.stubGlobal('fetch', undefined);

    expect(() => recordClick(BOOKMARK_ID)).not.toThrow();
  });

  it('본문을 만들다 터져도(방문자 id·직렬화) 호출부를 멈추지 않는다', () => {
    // 인자 평가가 try 밖에 있으면 여기서 예외가 새어 나간다.
    vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new TypeError('cyclic');
    });

    expect(() => recordClick(BOOKMARK_ID)).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('응답을 읽지 않는다 — counted 여부는 화면에 쓰지 않는다', async () => {
    const response = okResponse();
    const json = vi.spyOn(response, 'json');
    fetchMock.mockResolvedValue(response);

    recordClick(BOOKMARK_ID);
    await flush();

    expect(json).not.toHaveBeenCalled();
  });

  it('서버가 400·500 을 돌려줘도 조용히 넘어간다', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: '존재하지 않는 bookmarkId 입니다.' }), { status: 400 }),
    );

    expect(() => recordClick(BOOKMARK_ID)).not.toThrow();
    await flush();
  });
});

describe('openToastText', () => {
  it('프로토타입 open() 의 문구를 그대로 쓴다', () => {
    expect(openToastText('ChatGPT')).toBe('ChatGPT · 새 탭으로 이동');
  });
});
