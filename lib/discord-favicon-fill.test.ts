// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED } from '@/lib/constants';
import { fillDiscordFavicons } from '@/lib/discord-favicon-fill';
import { sniffDiscordIcon } from '@/lib/discord-favicon-image';
import {
  deleteDiscordFavicon,
  uploadDiscordFavicon,
} from '@/lib/discord-favicon-storage';
import {
  createServerSupabaseClient,
  getAdminSessionWithSignal,
} from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  getAdminSessionWithSignal: vi.fn(),
}));

vi.mock('@/lib/discord-favicon-storage', () => ({
  uploadDiscordFavicon: vi.fn(),
  deleteDiscordFavicon: vi.fn(),
}));

const BOOKMARK_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_TOKEN = '22222222-2222-4222-8222-222222222222';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

type RpcReply = { data: unknown; error: null | { code?: string; message: string } };
type RpcPlan = RpcReply | { rejectWith: unknown };

function fakeClient(replies: Record<string, RpcPlan>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        const plan = replies[name] ?? { data: null, error: { message: `missing ${name}` } };
        return {
          abortSignal: vi.fn().mockImplementation(() =>
            'rejectWith' in plan ? Promise.reject(plan.rejectWith) : Promise.resolve(plan),
          ),
        };
      },
    },
  };
}

function claim(
  url = 'https://www.example.com/path',
  bookmarkId = BOOKMARK_ID,
  claimToken = CLAIM_TOKEN,
) {
  return { bookmark_id: bookmarkId, claimed_url: url, claim_token: claimToken };
}

function numberedClaim(index: number, url = `https://site-${index}.example.com/path`) {
  const suffix = String(index).padStart(12, '0');
  return claim(
    url,
    `11111111-1111-4111-8111-${suffix}`,
    `22222222-2222-4222-8222-${suffix}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DISCORD_FAVICON_PROVIDER_APPROVED', 'true');
  vi.mocked(getAdminSessionWithSignal).mockResolvedValue({
    userId: 'admin',
    email: 'contact@itconnect.dev',
  });
  vi.mocked(uploadDiscordFavicon).mockResolvedValue({
    path: `discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png`,
    publicUrl: 'https://project.supabase.co/storage/v1/object/public/favicons/icon.png',
  });
  vi.mocked(deleteDiscordFavicon).mockResolvedValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sniffDiscordIcon', () => {
  it('지원 이미지 magic만 허용하고 SVG/HTML은 거부한다', () => {
    expect(sniffDiscordIcon(PNG)).toEqual({ contentType: 'image/png', extension: 'png' });
    expect(sniffDiscordIcon(new TextEncoder().encode('<svg></svg>'))).toBeNull();
    expect(sniffDiscordIcon(new TextEncoder().encode('<html></html>'))).toBeNull();
  });
});

describe('fillDiscordFavicons', () => {
  it.each([undefined, '', 'false', 'TRUE', '1'])(
    'provider 승인이 %s이면 auth·claim·외부 네트워크 전에 fail-closed한다',
    async (approval) => {
      vi.stubEnv('DISCORD_FAVICON_PROVIDER_APPROVED', approval);

      await expect(fillDiscordFavicons()).resolves.toEqual({
        ok: false,
        error: DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED,
      });
      expect(getAdminSessionWithSignal).not.toHaveBeenCalled();
      expect(createServerSupabaseClient).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('인증 실패는 claim과 네트워크 전에 거부한다', async () => {
    vi.mocked(getAdminSessionWithSignal).mockResolvedValue(null);

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: false,
      error: '로그인이 필요합니다.',
    });

    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bookmark origin 대신 고정 Google provider만 호출하고 triple-CAS로 finalize한다', async () => {
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_finalize_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 0, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: true,
      filled: 1,
      failed: 0,
      remaining: 0,
    });

    const endpoint = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(endpoint.hostname).toBe('www.google.com');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain('www.example.com/path');
    expect(fake.calls).toContainEqual({
      name: 'admin_finalize_discord_favicon',
      args: {
        bookmark_id: BOOKMARK_ID,
        claim_token: CLAIM_TOKEN,
        claimed_url: 'https://www.example.com/path',
        favicon_url: 'https://project.supabase.co/storage/v1/object/public/favicons/icon.png',
      },
    });
  });

  it('IP literal은 provider에도 보내지 않고 failure CAS로 lease를 정리한다', async () => {
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: [claim('http://127.0.0.1/admin')], error: null },
      admin_fail_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 1, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: true,
      filled: 0,
      failed: 1,
      remaining: 1,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(uploadDiscordFavicon).not.toHaveBeenCalled();
    expect(fake.calls).toContainEqual({
      name: 'admin_fail_discord_favicon',
      args: {
        bookmark_id: BOOKMARK_ID,
        claim_token: CLAIM_TOKEN,
        claimed_url: 'http://127.0.0.1/admin',
      },
    });
  });

  it('stale finalize는 자기 token Storage 객체를 삭제하고 실패로 센다', async () => {
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_finalize_discord_favicon: { data: false, error: null },
      admin_release_discord_favicon: { data: false, error: null },
      admin_count_pending_discord_favicons: { data: 1, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(fillDiscordFavicons()).resolves.toMatchObject({ ok: true, filled: 0, failed: 1 });

    expect(deleteDiscordFavicon).toHaveBeenCalledWith(
      `discord/${BOOKMARK_ID}/${CLAIM_TOKEN}.png`,
      expect.any(AbortSignal),
    );
  });

  it('finalize commit 뒤 응답만 유실되면 authoritative URL을 확인하고 live 객체를 지우지 않는다', async () => {
    const publicUrl = 'https://project.supabase.co/storage/v1/object/public/favicons/icon.png';
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_finalize_discord_favicon: { rejectWith: new DOMException('response lost', 'AbortError') },
      admin_get_discord_favicon_reference: {
        data: [{ favicon_url: publicUrl, active_claim_token: null }],
        error: null,
      },
      admin_count_pending_discord_favicons: { data: 0, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: true,
      filled: 1,
      failed: 0,
      remaining: 0,
    });

    expect(deleteDiscordFavicon).not.toHaveBeenCalled();
    expect(fake.calls.map(({ name }) => name)).not.toContain('admin_fail_discord_favicon');
    expect(fake.calls.map(({ name }) => name)).not.toContain('admin_release_discord_favicon');
  });

  it('finalize와 authoritative 상태가 모두 불명확하면 객체를 보존하고 lease만 best-effort 해제한다', async () => {
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_finalize_discord_favicon: { rejectWith: new DOMException('response lost', 'AbortError') },
      admin_get_discord_favicon_reference: { rejectWith: new TypeError('network unavailable') },
      admin_release_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 1, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: true,
      filled: 0,
      failed: 1,
      remaining: 1,
    });

    expect(deleteDiscordFavicon).not.toHaveBeenCalled();
    expect(fake.calls.map(({ name }) => name)).toContain('admin_release_discord_favicon');
  });

  it('허용된 provider redirect만 따르고 외부 host redirect는 거부한다', async () => {
    const accepted = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_finalize_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 0, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(accepted.client as never);
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://www.gstatic.com/favicon-v2.png' },
        }),
      )
      .mockResolvedValueOnce(new Response(PNG, { status: 200 }));

    await expect(fillDiscordFavicons()).resolves.toMatchObject({ ok: true, filled: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    vi.mocked(getAdminSessionWithSignal).mockResolvedValue({
      userId: 'admin',
      email: 'contact@itconnect.dev',
    });
    const rejected = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_fail_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 1, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(rejected.client as never);
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.invalid/favicon.png' },
      }),
    );

    await expect(fillDiscordFavicons()).resolves.toMatchObject({ ok: true, filled: 0, failed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(uploadDiscordFavicon).not.toHaveBeenCalled();
  });

  it('1 MB 이미지는 허용하고 1 MB + 1 byte 응답은 streaming 중 거부한다', async () => {
    const exact = new Uint8Array(1_000_000);
    exact.set(PNG);
    const accepted = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_finalize_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 0, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(accepted.client as never);
    vi.mocked(fetch).mockResolvedValue(new Response(exact, { status: 200 }));

    await expect(fillDiscordFavicons()).resolves.toMatchObject({ ok: true, filled: 1 });
    expect(uploadDiscordFavicon).toHaveBeenCalledWith(
      BOOKMARK_ID,
      CLAIM_TOKEN,
      expect.objectContaining({ byteLength: 1_000_000 }),
      expect.anything(),
      expect.any(AbortSignal),
    );

    vi.clearAllMocks();
    vi.mocked(getAdminSessionWithSignal).mockResolvedValue({
      userId: 'admin',
      email: 'contact@itconnect.dev',
    });
    const rejected = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_fail_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 1, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(rejected.client as never);
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array(1_000_001), { status: 200 }));

    await expect(fillDiscordFavicons()).resolves.toMatchObject({ ok: true, filled: 0, failed: 1 });
    expect(uploadDiscordFavicon).not.toHaveBeenCalled();
  });

  it('항목 작업은 동시에 최대 3개만 실행하고 일부 실패를 나머지와 격리한다', async () => {
    const claims = [
      numberedClaim(1),
      numberedClaim(2, 'http://127.0.0.1/private'),
      numberedClaim(3),
      numberedClaim(4),
      numberedClaim(5),
    ];
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: claims, error: null },
      admin_finalize_discord_favicon: { data: true, error: null },
      admin_fail_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 1, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    let active = 0;
    let maximum = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(PNG, { status: 200 });
    });

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: true,
      filled: 4,
      failed: 1,
      remaining: 1,
    });
    expect(maximum).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('새 작업 마감 뒤에는 fetch하지 않고 별도 cleanup signal로 lease와 count를 정리한다', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(45_000);
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: [claim()], error: null },
      admin_release_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: { data: 1, error: null },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: true,
      filled: 0,
      failed: 1,
      remaining: 1,
    });

    expect(createServerSupabaseClient).toHaveBeenCalledWith();
    expect(fetch).not.toHaveBeenCalled();
    expect(fake.calls.map(({ name }) => name)).toEqual([
      'admin_claim_discord_favicons',
      'admin_release_discord_favicon',
      'admin_count_pending_discord_favicons',
    ]);
    now.mockRestore();
  });

  it('남은 수 RPC가 실패하면 0으로 오보하지 않고 이번 pass의 미완료 수를 반환한다', async () => {
    const fake = fakeClient({
      admin_claim_discord_favicons: { data: [claim('http://127.0.0.1/private')], error: null },
      admin_fail_discord_favicon: { data: true, error: null },
      admin_count_pending_discord_favicons: {
        data: null,
        error: { code: '57014', message: 'timeout' },
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(fillDiscordFavicons()).resolves.toEqual({
      ok: true,
      filled: 0,
      failed: 1,
      remaining: 1,
    });
  });
});
