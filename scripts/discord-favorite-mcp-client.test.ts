// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  FavoriteIngestClientError,
  ingestFavorite,
  inspectFavoriteUrl,
  listFavoriteCategories,
  signFavoriteIngestBody,
} from './discord-favorite-mcp-client';

const ENDPOINT = 'https://favorite.example/api/discord-ingest';
const SECRET = 'a'.repeat(64);
const NOW_MS = Date.parse('2026-08-10T06:00:00.000Z');
const TIMESTAMP = String(Math.floor(NOW_MS / 1_000));

describe('discord favorite signing client', () => {
  it('inspect_url을 서명하고 분류에 필요한 제한된 메타데이터를 읽는다', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body);
      expect(JSON.parse(body)).toEqual({ operation: 'inspect_url', url: 'https://jiro.build/' });
      expect(new Headers(init?.headers).get('x-discord-ingest-signature')).toBe(signFavoriteIngestBody(SECRET, TIMESTAMP, body));
      return Response.json({ status: 'available', title: 'Jiro', description: 'UI design prompts' });
    });
    await expect(inspectFavoriteUrl({ url: 'https://jiro.build/' }, { endpoint: ENDPOINT, secret: SECRET, nowMs: NOW_MS, fetchImpl }))
      .resolves.toEqual({ status: 'available', title: 'Jiro', description: 'UI design prompts' });
  });

  it('unavailable은 성공 응답이며, 본문/과도한 길이/모순된 상태는 거부한다', async () => {
    const options = { endpoint: ENDPOINT, secret: SECRET, nowMs: NOW_MS };
    await expect(inspectFavoriteUrl({ url: 'https://example.com/' }, { ...options,
      fetchImpl: vi.fn(async () => Response.json({ status: 'unavailable', title: null, description: null })),
    })).resolves.toMatchObject({ status: 'unavailable' });
    for (const response of [
      { status: 'available', title: 'Jiro', description: null, html: '<script>unsafe</script>' },
      { status: 'available', title: 'x'.repeat(121), description: null },
      { status: 'available', title: null, description: null },
      { status: 'unavailable', title: 'Jiro', description: null },
    ]) await expect(inspectFavoriteUrl({ url: 'https://example.com/' }, { ...options,
      fetchImpl: vi.fn(async () => Response.json(response)),
    })).rejects.toBeInstanceOf(FavoriteIngestClientError);
  });

  it('raw JSON body와 timestamp를 정확히 서명해 category를 읽는다', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const rawBody = String(init?.body);
      expect(rawBody).toBe('{"operation":"list_categories"}');
      expect(new Headers(init?.headers).get('x-discord-ingest-timestamp')).toBe(TIMESTAMP);
      expect(new Headers(init?.headers).get('x-discord-ingest-signature')).toBe(
        signFavoriteIngestBody(SECRET, TIMESTAMP, rawBody),
      );
      expect(init?.redirect).toBe('error');

      return Response.json({
        categories: [
          {
            id: '4ecfe0f4-6707-4d57-b3ea-f6ca7343ecde',
            name: '기타',
            parentId: null,
            sortOrder: 1,
          },
        ],
      });
    });

    await expect(
      listFavoriteCategories({ endpoint: ENDPOINT, secret: SECRET, fetchImpl, nowMs: NOW_MS }),
    ).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(new URL(ENDPOINT), expect.any(Object));
  });

  it('ingest body의 message ID를 string으로 보존하고 고정 result를 검증한다', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        operation: 'ingest',
        url: 'https://example.com/path',
        title: 'example.com',
        description: '',
        categoryId: '4ecfe0f4-6707-4d57-b3ea-f6ca7343ecde',
        messageId: '1536248705844248606',
      });
      return Response.json({
        resultCode: 'success',
        bookmarkId: 'bbd08527-5cf0-4976-a5cc-0498f0ee6f10',
        title: 'example.com',
        categoryName: '기타',
        retryAt: null,
      });
    });

    await expect(
      ingestFavorite(
        {
          url: 'https://example.com/path',
          title: 'example.com',
          description: '',
          categoryId: '4ecfe0f4-6707-4d57-b3ea-f6ca7343ecde',
          messageId: '1536248705844248606',
        },
        { endpoint: ENDPOINT, secret: SECRET, fetchImpl, nowMs: NOW_MS },
      ),
    ).resolves.toMatchObject({ resultCode: 'success' });
  });

  it.each([
    'http://favorite.example/api/discord-ingest',
    'https://favorite.example/other',
    'https://user:pass@favorite.example/api/discord-ingest',
    'https://favorite.example/api/discord-ingest?secret=x',
  ])('HTTPS exact endpoint 밖 값은 network 전에 거부한다: %s', async (endpoint) => {
    const fetchImpl = vi.fn();

    await expect(
      listFavoriteCategories({ endpoint, secret: SECRET, fetchImpl, nowMs: NOW_MS }),
    ).rejects.toBeInstanceOf(FavoriteIngestClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('짧은 secret, HTTP 오류, 잘못된 response shape를 원문 없이 generic error로 접는다', async () => {
    await expect(
      listFavoriteCategories({
        endpoint: ENDPOINT,
        secret: 'short',
        fetchImpl: vi.fn(),
        nowMs: NOW_MS,
      }),
    ).rejects.toThrow('favorite ingest API is unavailable');

    await expect(
      listFavoriteCategories({
        endpoint: ENDPOINT,
        secret: SECRET,
        fetchImpl: vi.fn(async () => new Response('database password leaked', { status: 503 })),
        nowMs: NOW_MS,
      }),
    ).rejects.toThrow('favorite ingest API is unavailable');

    await expect(
      listFavoriteCategories({
        endpoint: ENDPOINT,
        secret: SECRET,
        fetchImpl: vi.fn(async () => Response.json({ categories: [{ id: 'bad' }] })),
        nowMs: NOW_MS,
      }),
    ).rejects.toThrow('favorite ingest API is unavailable');
  });
});
