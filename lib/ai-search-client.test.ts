/**
 * N3. AI 의미 검색의 클라이언트 호출 경로 — `POST /api/ai-search`(N2) 로 보내는 요청의 모양과
 * status code 분기를 못박는다. 실제 Gemini 호출은 서버(N2)가 하고 여기선 fetch 를 모킹한다.
 *
 * 계약 원본은 app/api/ai-search/route.ts JSDoc: 200 `AiSearchResponse` · 비200(400/413) `{ error }`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAiSearch, type AiSearchResponse } from '@/lib/ai-search-client';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const AI_OK: AiSearchResponse = {
  ok: true,
  source: 'ai',
  reason: 'ok',
  results: [{ id: 'a', reason: '화상 회의에 쓰는 도구입니다' }],
  tookMs: 742,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestAiSearch — 요청의 모양', () => {
  it('POST 로 /api/ai-search 를 부르고 body 에 질의만 싣는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(AI_OK));

    await requestAiSearch('화상 회의');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ai-search');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ query: '화상 회의' });
  });

  it('넘겨받은 AbortSignal 을 그대로 fetch 에 전달한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(AI_OK));
    const controller = new AbortController();

    await requestAiSearch('x', controller.signal);

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

describe('requestAiSearch — status code 분기', () => {
  it('200 이면 응답 본문을 그대로 담아 ok:true 로 준다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(AI_OK));

    const result = await requestAiSearch('화상 회의');

    expect(result).toEqual({ ok: true, response: AI_OK });
  });

  it('400 은 http 오류로 가른다 (본문을 AiSearchResponse 로 읽지 않는다)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'query 가 비어 있습니다.' }, 400));

    const result = await requestAiSearch('x');

    expect(result).toEqual({ ok: false, kind: 'http', status: 400 });
  });

  it('413 도 http 오류다 (body 크기 상한 초과)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'body 가 너무 큽니다.' }, 413));

    const result = await requestAiSearch('x');

    expect(result).toEqual({ ok: false, kind: 'http', status: 413 });
  });

  it('fetch 가 던지면 network 오류다 (오프라인·요청 중단)', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const result = await requestAiSearch('x');

    expect(result).toEqual({ ok: false, kind: 'network' });
  });

  it('200 인데 본문이 JSON 이 아니면 network 오류로 떨어진다', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));

    const result = await requestAiSearch('x');

    expect(result).toEqual({ ok: false, kind: 'network' });
  });
});
