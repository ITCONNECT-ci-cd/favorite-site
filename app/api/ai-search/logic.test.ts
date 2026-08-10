/**
 * N2. 라우트의 **HTTP 인접 순수 헬퍼** 테스트 — 요청 본문 읽기·질의 검증·클라이언트 IP·
 * 키워드 폴백 만들기. 실제 배선(env 게이트·Gemini 호출·폴백 선택)은 route.test.ts 가 본다.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_QUERY_LENGTH,
  clientIp,
  keywordFallback,
  parseSearchBody,
  readSearchBody,
} from './logic';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';

function bookmark(over: Partial<BookmarkWithCount> & { id: string }): BookmarkWithCount {
  return {
    category_id: null,
    title: '제목',
    url: 'https://example.com',
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    source: 'manual',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    click_count: 0,
    ...over,
  };
}

const CAT: Category = { id: 'c1', name: '디자인', parent_id: null, sort_order: 0 };
const DATA: SiteData = {
  categories: [CAT],
  bookmarks: [
    bookmark({ id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Figma', category_id: 'c1' }),
    bookmark({ id: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Notion' }),
  ],
};

describe('parseSearchBody', () => {
  it('정상 질의는 트림해서 통과시킨다', () => {
    expect(parseSearchBody({ query: '  이미지 도구 ' })).toEqual({ ok: true, query: '이미지 도구' });
  });

  it('객체가 아니면 거부', () => {
    expect(parseSearchBody(null).ok).toBe(false);
    expect(parseSearchBody('hi').ok).toBe(false);
    expect(parseSearchBody([]).ok).toBe(false);
  });

  it('query 가 문자열이 아니면 거부', () => {
    expect(parseSearchBody({ query: 123 }).ok).toBe(false);
    expect(parseSearchBody({}).ok).toBe(false);
  });

  it('빈/공백뿐 질의는 거부', () => {
    expect(parseSearchBody({ query: '' }).ok).toBe(false);
    expect(parseSearchBody({ query: '   ' }).ok).toBe(false);
  });

  it(`${MAX_QUERY_LENGTH}자를 넘는 질의는 거부(과대 프롬프트 방지)`, () => {
    expect(parseSearchBody({ query: 'x'.repeat(MAX_QUERY_LENGTH + 1) }).ok).toBe(false);
    expect(parseSearchBody({ query: 'x'.repeat(MAX_QUERY_LENGTH) }).ok).toBe(true);
  });
});

describe('clientIp', () => {
  it('x-forwarded-for 의 첫 값이 클라이언트 IP', () => {
    expect(clientIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
  });

  it('헤더가 없으면 빈 문자열', () => {
    expect(clientIp(null)).toBe('');
  });
});

describe('readSearchBody', () => {
  it('정상 JSON 을 읽는다', async () => {
    const request = new Request('http://localhost/api/ai-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '이미지' }),
    });

    const read = await readSearchBody(request);

    expect(read).toEqual({ ok: true, value: { query: '이미지' } });
  });

  it('content-length 가 상한을 넘으면 too-large', async () => {
    const request = new Request('http://localhost/api/ai-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(100 * 1024) },
      body: JSON.stringify({ query: '이미지' }),
    });

    const read = await readSearchBody(request);

    expect(read).toEqual({ ok: false, reason: 'too-large' });
  });

  it('content-length 없는 초대형 스트림도 실바이트 층에서 too-large', async () => {
    const oversized = 'x'.repeat(10_000);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/ai-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    expect(request.headers.get('content-length')).toBeNull();
    expect(await readSearchBody(request)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('깨진 본문은 unreadable', async () => {
    const request = new Request('http://localhost/api/ai-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });

    expect(await readSearchBody(request)).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('keywordFallback', () => {
  it('키워드 검색 결과의 id 를 근거 없이(reason=null) 돌려준다', () => {
    const items = keywordFallback('figma', DATA);

    expect(items).toEqual([{ id: 'aaaaaaaa-0000-4000-8000-000000000001', reason: null }]);
  });

  it('맞는 게 없으면 빈 배열', () => {
    expect(keywordFallback('존재하지않는질의zzz', DATA)).toEqual([]);
  });
});
