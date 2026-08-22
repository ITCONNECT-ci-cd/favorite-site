// @vitest-environment node
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileDiscordFaviconOrphans } from '@/lib/discord-favicon-reconcile';
import { reconcileDiscordFaviconStorage } from '@/lib/discord-favicon-storage';
import {
  createServerSupabaseClient,
  getAdminSessionWithSignal,
} from '@/lib/supabase/server';

vi.mock('@/lib/discord-favicon-storage', () => ({
  reconcileDiscordFaviconStorage: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  getAdminSessionWithSignal: vi.fn(),
}));

const BOOKMARK_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_TOKEN = '22222222-2222-4222-8222-222222222222';
const OTHER_BOOKMARK_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_TOKEN = '44444444-4444-4444-8444-444444444444';
const PUBLIC_BASE = 'https://project.supabase.co/storage/v1/object/public/favicons';

const actionSource = readFileSync(new URL('./discord-favicon-reconcile.ts', import.meta.url), 'utf8');
const storageSource = readFileSync(new URL('./discord-favicon-storage.ts', import.meta.url), 'utf8');
const fillSource = readFileSync(new URL('./discord-favicon-fill.ts', import.meta.url), 'utf8');
const imageSource = readFileSync(new URL('./discord-favicon-image.ts', import.meta.url), 'utf8');
const providerSource = readFileSync(new URL('./discord-favicon-provider.ts', import.meta.url), 'utf8');
const enrichmentSource = readFileSync(new URL('./discord-ingest-enrichment.ts', import.meta.url), 'utf8');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.mocked(createServerSupabaseClient).mockReset();
  vi.mocked(getAdminSessionWithSignal).mockReset();
  vi.mocked(reconcileDiscordFaviconStorage).mockReset();
  vi.mocked(getAdminSessionWithSignal).mockResolvedValue({
    userId: 'admin-id',
    email: 'admin@example.com',
  });
  vi.mocked(reconcileDiscordFaviconStorage).mockResolvedValue({
    scanned: 4,
    kept: 2,
    invalid: 1,
    deleted: 1,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('reconcileDiscordFaviconOrphans', () => {
  it('관리자가 아니면 DB reference와 service-role Storage를 전혀 부르지 않는다', async () => {
    vi.mocked(getAdminSessionWithSignal).mockResolvedValue(null);

    await expect(reconcileDiscordFaviconOrphans()).resolves.toEqual({
      ok: false,
      error: '로그인이 필요합니다.',
    });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(reconcileDiscordFaviconStorage).not.toHaveBeenCalled();
  });

  it('쿠키 RPC 결과에서 같은 Supabase discord path와 유효한 active token만 경계로 넘긴다', async () => {
    const { client, rpc, abortSignal } = fakeRpc([
      {
        bookmark_id: BOOKMARK_ID,
        favicon_url: `${PUBLIC_BASE}/discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png?cache=1`,
        active_claim_token: CLAIM_TOKEN,
      },
      {
        bookmark_id: OTHER_BOOKMARK_ID,
        favicon_url: 'https://www.google.com/s2/favicons?domain=example.com',
        active_claim_token: OTHER_TOKEN,
      },
      {
        bookmark_id: OTHER_BOOKMARK_ID,
        favicon_url:
          `https://other.supabase.co/storage/v1/object/public/favicons/discord/` +
          `${OTHER_BOOKMARK_ID}/${OTHER_TOKEN}.ico`,
        active_claim_token: null,
      },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    await expect(reconcileDiscordFaviconOrphans()).resolves.toEqual({
      ok: true,
      scanned: 4,
      kept: 2,
      invalid: 1,
      deleted: 1,
    });

    expect(rpc).toHaveBeenCalledWith('admin_list_discord_favicon_references', {});
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(reconcileDiscordFaviconStorage).toHaveBeenCalledWith(
      [`discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png`],
      [
        { bookmarkId: BOOKMARK_ID, claimToken: CLAIM_TOKEN },
        { bookmarkId: OTHER_BOOKMARK_ID, claimToken: OTHER_TOKEN },
      ],
      expect.any(AbortSignal),
    );
  });

  it('같은 버킷의 path가 row bookmark와 다르면 fail-closed하고 아무것도 삭제하지 않는다', async () => {
    const { client } = fakeRpc([
      {
        bookmark_id: BOOKMARK_ID,
        favicon_url: `${PUBLIC_BASE}/discord/${OTHER_BOOKMARK_ID}/${CLAIM_TOKEN}.png`,
        active_claim_token: null,
      },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(reconcileDiscordFaviconOrphans()).resolves.toEqual({
      ok: false,
      error: '파비콘 고아 객체를 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
    expect(reconcileDiscordFaviconStorage).not.toHaveBeenCalled();
  });

  it('RPC 오류 원문을 client result에 노출하지 않는다', async () => {
    const abortSignal = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'private details' },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      rpc: vi.fn(() => ({ abortSignal })),
    } as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await reconcileDiscordFaviconOrphans();

    expect(result).toEqual({
      ok: false,
      error: '파비콘 고아 객체를 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
    expect(JSON.stringify(result)).not.toContain('private details');
    expect(reconcileDiscordFaviconStorage).not.toHaveBeenCalled();
  });
});

describe('service-role credential boundary guard', () => {
  it('신규 favicon 모듈 중 service-role env를 읽는 곳은 Storage 경계 하나뿐이다', () => {
    const sources = new Map([
      ['fill', fillSource],
      ['image', imageSource],
      ['provider', providerSource],
      ['enrichment', enrichmentSource],
      ['reconcile', actionSource],
      ['storage', storageSource],
    ]);
    expect(
      [...sources]
        .filter(([, source]) => source.includes('SUPABASE_SERVICE_ROLE_KEY'))
        .map(([name]) => name),
    ).toEqual(['storage']);
  });

  it('Storage 경계에는 DB client/import와 DB method가 없고 raw Storage REST만 있다', () => {
    const code = withoutComments(storageSource);

    expect(code).not.toMatch(/(?:from|import\s*\(|require\s*\()\s*['"][^'"]*supabase\/(?:admin|server)['"]/);
    expect(code).not.toMatch(/from\s*['"]@supabase\//);
    expect(code).not.toMatch(/\.(?:from|rpc|insert|update|upsert)\s*\(/);
    expect(code).not.toMatch(/\/rest\/v1|\/auth\/v1/);
    expect(code).toContain('/storage/v1');
  });

  it("action 첫 줄은 'use server'이고 service-role 자격을 읽지 않는다", () => {
    expect(actionSource.split(/\r?\n/)[0]).toBe("'use server';");
    expect(actionSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

function fakeRpc(data: unknown) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error: null });
  const rpc = vi.fn(() => ({ abortSignal }));
  return { client: { rpc }, rpc, abortSignal };
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
