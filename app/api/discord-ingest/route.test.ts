// @vitest-environment node
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  ingest: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock('@/lib/discord-ingest-db', () => db);

const route = await import('./route');

const SECRET = 'unit-test-hmac-secret';
const NOW = new Date('2026-08-10T06:00:00.000Z');
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1_000));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.stubEnv('DISCORD_INGEST_HMAC_SECRET', SECRET);
  db.ingest.mockReset();
  db.listCategories.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/discord-ingest — route config', () => {
  it('Node runtime, dynamic execution, bounded duration을 명시한다', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(10);
  });
});

describe('POST /api/discord-ingest — 인증/입력 경계', () => {
  it('raw body 그대로 서명한 list_categories 요청만 DB로 전달한다', async () => {
    db.listCategories.mockResolvedValue([
      { id: 'cat-1', name: '기타', parentId: null, sortOrder: 0 },
    ]);
    const raw = '{ "operation" : "list_categories" }';

    const response = await route.POST(signedRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      categories: [{ id: 'cat-1', name: '기타', parentId: null, sortOrder: 0 }],
    });
    expect(db.listCategories).toHaveBeenCalledTimes(1);
    expect(db.ingest).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('ingest field를 바꾸지 않고 adapter로 전달하고 고정 shape 결과를 돌려준다', async () => {
    const operation = {
      operation: 'ingest',
      url: 'https://e.test/',
      title: '제목',
      description: '',
      categoryId: 'cat-1',
      messageId: '1536248705844248606',
    };
    db.ingest.mockResolvedValue({
      resultCode: 'success',
      bookmarkId: 'bookmark-1',
      title: '제목',
      categoryName: '기타',
      retryAt: null,
    });

    const response = await route.POST(signedRequest(JSON.stringify(operation)));

    expect(response.status).toBe(200);
    expect(db.ingest).toHaveBeenCalledWith({
      url: operation.url,
      title: operation.title,
      description: operation.description,
      categoryId: operation.categoryId,
      messageId: operation.messageId,
    });
    expect(await response.json()).toEqual({
      resultCode: 'success',
      bookmarkId: 'bookmark-1',
      title: '제목',
      categoryName: '기타',
      retryAt: null,
    });
  });

  it.each([
    ['서명 없음', null, TIMESTAMP],
    ['서명 오류', `v1=${'00'.repeat(32)}`, TIMESTAMP],
    ['timestamp 없음', null, null],
  ])('%s이면 고정 401이고 DB를 호출하지 않는다', async (_label, signature, timestamp) => {
    const response = await route.POST(
      signedRequest('{"operation":"list_categories"}', { signature, timestamp }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(db.listCategories).not.toHaveBeenCalled();
    expect(db.ingest).not.toHaveBeenCalled();
  });

  it('유효하게 서명했어도 timestamp가 301초 오래되면 401이다', async () => {
    const stale = String(Number(TIMESTAMP) - 301);
    const response = await route.POST(
      signedRequest('{"operation":"list_categories"}', { timestamp: stale }),
    );

    expect(response.status).toBe(401);
    expect(db.listCategories).not.toHaveBeenCalled();
  });

  it('서명 후 JSON/field allowlist가 틀리면 고정 400이고 DB를 호출하지 않는다', async () => {
    const response = await route.POST(
      signedRequest('{"operation":"list_categories","callerSql":"select *"}'),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(db.listCategories).not.toHaveBeenCalled();
    expect(db.ingest).not.toHaveBeenCalled();
  });

  it('16 KiB 초과 body는 서명 전에 고정 413이고 DB를 호출하지 않는다', async () => {
    const response = await route.POST(signedRequest('x'.repeat(16 * 1024 + 1)));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    expect(db.listCategories).not.toHaveBeenCalled();
    expect(db.ingest).not.toHaveBeenCalled();
  });

  it('HMAC secret이 비면 고정 503이고 env 이름/요청 원문을 응답에 싣지 않는다', async () => {
    vi.stubEnv('DISCORD_INGEST_HMAC_SECRET', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await route.POST(signedRequest('{"operation":"list_categories"}'));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: 'service_unavailable' });
    expect(text).not.toContain('DISCORD_INGEST_HMAC_SECRET');
    expect(text).not.toContain('list_categories');
    expect(db.listCategories).not.toHaveBeenCalled();
  });
});

describe('POST /api/discord-ingest — DB transport failure', () => {
  it('오류 원문 없이 고정 503만 응답·로그한다', async () => {
    const leaked = 'password=secret role=discord_ingest_runtime relation=private.receipts';
    db.listCategories.mockRejectedValue(new Error(leaked));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await route.POST(signedRequest('{"operation":"list_categories"}'));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toEqual({ error: 'service_unavailable' });
    expect(responseText).not.toContain(leaked);
    expect(logged).toHaveBeenCalledWith('[api/discord-ingest] database operation failed');
    expect(JSON.stringify(logged.mock.calls)).not.toContain(leaked);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

function signedRequest(
  raw: string,
  overrides: { timestamp?: string | null; signature?: string | null } = {},
): Request {
  const timestamp = Object.hasOwn(overrides, 'timestamp') ? overrides.timestamp : TIMESTAMP;
  const signature =
    Object.hasOwn(overrides, 'signature')
      ? overrides.signature
      : timestamp !== null && timestamp !== undefined
      ? sign(timestamp, raw)
      : null;
  const headers = new Headers({ 'content-type': 'application/json' });
  if (timestamp !== null && timestamp !== undefined) headers.set('x-discord-ingest-timestamp', timestamp);
  if (signature !== null && signature !== undefined) headers.set('x-discord-ingest-signature', signature);

  return new Request('https://example.test/api/discord-ingest', {
    method: 'POST',
    headers,
    body: raw,
  });
}

function sign(timestamp: string, raw: string): string {
  return `v1=${createHmac('sha256', SECRET).update(timestamp).update('.').update(raw).digest('hex')}`;
}
