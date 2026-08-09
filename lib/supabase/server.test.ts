// @vitest-environment node
// 서버 전용 헬퍼라 DOM 이 필요 없다 — jsdom 을 띄우지 않는다.
import { createServerClient } from '@supabase/ssr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAdminSession } from '@/lib/supabase/server';

// 실제 Supabase 왕복은 scripts/create-admin.ts 의 로그인 실검증이 맡는다.
// 여기서는 "무엇을 물어보고 무엇을 돌려주는지"만 본다 — 특히 getUser 인지 getSession 인지.
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));

/** getUser 가 줄 응답을 정해 두고 클라이언트를 갈아 끼운다. getSession 은 호출 여부를 감시만 한다. */
function stubAuth(getUserResult: unknown) {
  const getUser = vi.fn(async () => getUserResult);
  const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));

  vi.mocked(createServerClient).mockReturnValue({ auth: { getUser, getSession } } as never);

  return { getUser, getSession };
}

const AUTH_ERROR = { message: 'Auth session missing!', code: 'session_not_found' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon-key';
});

describe('getAdminSession', () => {
  it('로그인한 사용자면 id·이메일 요약을 준다', async () => {
    stubAuth({ data: { user: { id: 'user-1', email: 'contact@itconnect.dev' } }, error: null });

    await expect(getAdminSession()).resolves.toEqual({
      userId: 'user-1',
      email: 'contact@itconnect.dev',
    });
  });

  it('토큰·리프레시 토큰은 요약에 담기지 않는다', async () => {
    // 요약이 아니라 Session 을 그대로 흘리면 서버 컴포넌트가 클라이언트로 넘길 때
    // 토큰이 HTML 에 박힌다. 키 집합을 고정해 그 회귀를 막는다.
    stubAuth({
      data: {
        user: {
          id: 'user-1',
          email: 'contact@itconnect.dev',
          // 실제 응답에는 이런 필드가 잔뜩 붙어 온다 — 통째로 새어 나가면 안 된다.
          role: 'authenticated',
          app_metadata: { provider: 'email' },
        },
      },
      error: null,
    });

    const session = await getAdminSession();

    expect(Object.keys(session ?? {}).sort()).toEqual(['email', 'userId']);
  });

  it('세션이 없으면 null 이다', async () => {
    stubAuth({ data: { user: null }, error: AUTH_ERROR });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('사용자가 없는데 오류도 없는 응답도 null 로 접는다', async () => {
    // 방어적 분기다. user 가 null 이면 error 유무와 무관하게 로그인이 아니다.
    stubAuth({ data: { user: null }, error: null });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('토큰이 위조·만료라 검증에 실패하면 null 이다 (fail-closed)', async () => {
    stubAuth({ data: { user: null }, error: { message: 'invalid JWT', code: 'bad_jwt' } });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('이메일이 없는 계정이면 email 은 null 이다', async () => {
    stubAuth({ data: { user: { id: 'user-1' } }, error: null });

    await expect(getAdminSession()).resolves.toEqual({ userId: 'user-1', email: null });
  });

  it('getSession 이 아니라 getUser 로 판정한다', async () => {
    // 이 프로젝트에서 가장 중요한 인증 회귀 방지선이다. getSession 은 쿠키 속 JWT 를
    // 서명 검증 없이 파싱만 하므로, 그걸로 권한을 정하면 쿠키를 위조한 누구나 관리자가 된다.
    const { getUser, getSession } = stubAuth({
      data: { user: { id: 'user-1', email: 'contact@itconnect.dev' } },
      error: null,
    });

    await getAdminSession();

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('anon 키로 붙는다 — service role 키를 쓰지 않는다', async () => {
    // service role 로 붙으면 RLS 가 통째로 무력화된다. 관문이 쓰는 키는 anon 이어야 한다.
    stubAuth({ data: { user: null }, error: AUTH_ERROR });

    await getAdminSession();

    expect(createServerClient).toHaveBeenCalledWith(
      'https://stub.supabase.co',
      'stub-anon-key',
      expect.anything(),
    );
  });
});
