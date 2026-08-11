// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteDiscordFavicon,
  reconcileDiscordFaviconStorage,
  uploadDiscordFavicon,
} from '@/lib/discord-favicon-storage';

const BOOKMARK_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_TOKEN = '22222222-2222-4222-8222-222222222222';
const ACTIVE_TOKEN = '33333333-3333-4333-8333-333333333333';
const YOUNG_TOKEN = '44444444-4444-4444-8444-444444444444';
const BOUNDARY_TOKEN = '55555555-5555-4555-8555-555555555555';
const UNKNOWN_AGE_TOKEN = '66666666-6666-4666-8666-666666666666';
const NOW = Date.parse('2026-08-10T12:00:00.000Z');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-secret');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('discord favicon Storage boundary', () => {
  it('UUID/token으로만 고정 key를 만들고 전달받은 AbortSignal을 실제 fetch에 건다', async () => {
    const signal = AbortSignal.timeout(1000);

    await expect(
      uploadDiscordFavicon(
        BOOKMARK_ID,
        CLAIM_TOKEN,
        new Uint8Array([1, 2, 3]),
        { contentType: 'image/png', extension: 'png' },
        signal,
      ),
    ).resolves.toEqual({
      path: `discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png`,
      publicUrl:
        `https://project.supabase.co/storage/v1/object/public/favicons/discord/` +
        `${BOOKMARK_ID}/${CLAIM_TOKEN}.png`,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(
      `https://project.supabase.co/storage/v1/object/favicons/discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png`,
    );
    expect(init?.signal).toBe(signal);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer service-secret');
  });

  it('임의 id/path는 네트워크 전에 거부한다', async () => {
    await expect(
      uploadDiscordFavicon(
        '../bookmarks',
        CLAIM_TOKEN,
        new Uint8Array([1]),
        { contentType: 'image/png', extension: 'png' },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('Invalid bookmarkId');

    await expect(
      deleteDiscordFavicon('../other-object', AbortSignal.timeout(1000)),
    ).rejects.toThrow('Invalid Discord favicon storage path');

    await expect(
      reconcileDiscordFaviconStorage(
        ['discord/not-a-uuid/object.png'],
        [],
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('Invalid Discord favicon storage path');
    await expect(
      reconcileDiscordFaviconStorage(
        [],
        [{ bookmarkId: BOOKMARK_ID, claimToken: '../other' }],
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('Invalid claimToken');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('단일 stale 객체도 Storage remove 계약의 bucket endpoint와 prefixes body로 삭제한다', async () => {
    const signal = AbortSignal.timeout(1000);
    const path = `discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png`;

    await expect(deleteDiscordFavicon(path, signal)).resolves.toBe(true);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe('https://project.supabase.co/storage/v1/object/favicons');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ prefixes: [path] });
    expect(init?.signal).toBe(signal);
  });

  it('live 참조·active token·24시간 미만·시각 불명 객체는 유지하고 정확히 24시간 된 orphan만 지운다', async () => {
    const old = new Date(NOW - 24 * 60 * 60 * 1_000 - 1).toISOString();
    const boundary = new Date(NOW - 24 * 60 * 60 * 1_000).toISOString();
    const young = new Date(NOW - 24 * 60 * 60 * 1_000 + 1).toISOString();
    const signal = AbortSignal.timeout(1000);

    stubStorage(({ method, body }) => {
      if (method === 'DELETE') return json([]);
      if (body.prefix === 'discord') return json([folder(BOOKMARK_ID)]);
      if (body.prefix === `discord/${BOOKMARK_ID}`) {
        return json([
          object(`${CLAIM_TOKEN}.png`, old),
          object(`${ACTIVE_TOKEN}.ico`, old),
          object(`${YOUNG_TOKEN}.jpg`, young),
          object(`${BOUNDARY_TOKEN}.gif`, boundary),
          object(`${UNKNOWN_AGE_TOKEN}.webp`, 'not-a-date'),
          object('not-a-claim.svg', old),
        ]);
      }
      throw new Error(`unexpected prefix ${String(body.prefix)}`);
    });

    await expect(
      reconcileDiscordFaviconStorage(
        [`discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png`],
        [{ bookmarkId: BOOKMARK_ID, claimToken: ACTIVE_TOKEN }],
        signal,
        NOW,
      ),
    ).resolves.toEqual({ scanned: 6, kept: 4, invalid: 1, deleted: 1 });

    const deletes = storageCalls().filter((call) => call.method === 'DELETE');
    expect(
      storageCalls().every((call) =>
        call.url.startsWith('https://project.supabase.co/storage/v1/object/'),
      ),
    ).toBe(true);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.body).toEqual({
      prefixes: [`discord/${BOOKMARK_ID}/${BOUNDARY_TOKEN}.gif`],
    });
    expect(deletes[0]?.signal).toBe(signal);
  });

  it('한 폴더를 1,000개씩 page하고 삭제도 최대 1,000개씩 나눈다', async () => {
    const old = new Date(NOW - 24 * 60 * 60 * 1_000 - 1).toISOString();
    const objects = Array.from({ length: 1_001 }, (_, index) =>
      object(token(index + 1) + '.png', old),
    );

    stubStorage(({ method, body }) => {
      if (method === 'DELETE') return json([]);
      if (body.prefix === 'discord') return json([folder(BOOKMARK_ID)]);
      if (body.prefix === `discord/${BOOKMARK_ID}`) {
        return json(objects.slice(Number(body.offset), Number(body.offset) + 1_000));
      }
      throw new Error(`unexpected prefix ${String(body.prefix)}`);
    });

    await expect(
      reconcileDiscordFaviconStorage([], [], AbortSignal.timeout(1000), NOW),
    ).resolves.toEqual({ scanned: 1_001, kept: 0, invalid: 0, deleted: 1_001 });

    const calls = storageCalls();
    expect(
      calls
        .filter((call) => call.method === 'POST' && call.body.prefix === `discord/${BOOKMARK_ID}`)
        .map((call) => call.body.offset),
    ).toEqual([0, 1_000]);
    expect(
      calls
        .filter((call) => call.method === 'DELETE')
        .map((call) => (call.body.prefixes as string[]).length),
    ).toEqual([1_000, 1]);
  });

  it('목록 응답이 불완전하면 삭제 후보가 있어도 삭제를 시작하지 않는다', async () => {
    const old = new Date(NOW - 24 * 60 * 60 * 1_000 - 1).toISOString();
    stubStorage(({ body }) => {
      if (body.prefix === 'discord') return json([folder(BOOKMARK_ID)]);
      if (body.prefix === `discord/${BOOKMARK_ID}`) {
        return json([object(`${CLAIM_TOKEN}.png`, old), { id: 'id-without-name' }]);
      }
      throw new Error('unexpected request');
    });

    await expect(
      reconcileDiscordFaviconStorage([], [], AbortSignal.timeout(1000), NOW),
    ).rejects.toThrow('Invalid Storage list entry');
    expect(storageCalls().filter((call) => call.method === 'DELETE')).toEqual([]);
  });
});

type StorageCall = {
  url: string;
  method: string;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
};

function stubStorage(handler: (call: StorageCall) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: StorageCall = {
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
        signal: init?.signal,
      };
      return handler(call);
    }),
  );
}

function storageCalls(): StorageCall[] {
  return vi.mocked(fetch).mock.calls.map(([input, init]) => ({
    url: String(input),
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    signal: init?.signal,
  }));
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function folder(name: string): Record<string, unknown> {
  return { name, id: null, created_at: null };
}

function object(name: string, createdAt: string): Record<string, unknown> {
  return { name, id: `object-${name}`, created_at: createdAt };
}

function token(index: number): string {
  return `77777777-7777-4777-8777-${index.toString(16).padStart(12, '0')}`;
}
