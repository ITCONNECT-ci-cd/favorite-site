// @vitest-environment node
// 서버 액션이라 DOM 이 필요 없다.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signInAction, signOutAction } from '@/app/admin/actions';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 실제 Supabase 왕복은 이 테스트가 아니라 dev 서버에 실 계정으로 로그인해 보는 통합 검증이
 * 맡는다(H2 완료 기준). 여기서는 액션이 **무엇을 부르고 무엇을 돌려주는지**만 본다 —
 * 특히 "실패 사유를 담아 오지 않는가"와 "쿠키를 쓸 수 있는 클라이언트를 쓰는가".
 */
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  // 진짜 redirect 도 던진다(제어 흐름 예외). 뒤 코드가 안 도는 것까지 흉내 내야 한다.
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

function stubAuth(overrides: {
  signInWithPassword?: ReturnType<typeof vi.fn>;
  signOut?: ReturnType<typeof vi.fn>;
} = {}) {
  const signInWithPassword = overrides.signInWithPassword ?? vi.fn(async () => ({ error: null }));
  const signOut = overrides.signOut ?? vi.fn(async () => ({ error: null }));

  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { signInWithPassword, signOut },
  } as never);

  return { signInWithPassword, signOut };
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);

  return formData;
}

const CREDENTIALS = { email: 'admin@example.com', password: 'pw-1234' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('signInAction', () => {
  it('입력한 자격으로 signInWithPassword 를 부른다', async () => {
    const { signInWithPassword } = stubAuth();

    await expect(signInAction({ failed: false }, form(CREDENTIALS))).rejects.toThrow('NEXT_REDIRECT');

    expect(signInWithPassword).toHaveBeenCalledWith(CREDENTIALS);
  });

  it('성공하면 /admin 으로 보낸다', async () => {
    stubAuth();

    await expect(signInAction({ failed: false }, form(CREDENTIALS))).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith('/admin');
  });

  it('성공하면 redirect 앞에서 셸을 무효화한다 — 도착한 화면이 새 세션을 봐야 한다', async () => {
    stubAuth();

    await expect(signInAction({ failed: false }, form(CREDENTIALS))).rejects.toThrow('NEXT_REDIRECT');

    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(redirect).mock.invocationCallOrder[0]!,
    );
  });

  it('자격이 틀리면 실패만 돌려주고 화면을 떠나지 않는다', async () => {
    stubAuth({
      signInWithPassword: vi.fn(async () => ({
        error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
      })),
    });

    await expect(signInAction({ failed: false }, form(CREDENTIALS))).resolves.toEqual({ failed: true });
    expect(redirect).not.toHaveBeenCalled();
  });

  /**
   * 사유 비구분의 핵심 잠금 — 액션이 돌려주는 객체에 Supabase 의 message·code 가
   * 섞여 나가면 계정 존재 여부가 새어 나간다.
   */
  it('실패 응답에 Supabase 의 사유를 싣지 않는다', async () => {
    stubAuth({
      signInWithPassword: vi.fn(async () => ({
        error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
      })),
    });

    const state = await signInAction({ failed: false }, form(CREDENTIALS));

    expect(Object.keys(state)).toEqual(['failed']);
    expect(JSON.stringify(state)).not.toContain('credential');
  });

  it('Supabase 호출 자체가 터져도 실패로 접는다 (fail-closed)', async () => {
    stubAuth({
      signInWithPassword: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    await expect(signInAction({ failed: false }, form(CREDENTIALS))).resolves.toEqual({ failed: true });
  });

  it('빈 입력은 Supabase 까지 보내지 않고 실패로 접는다', async () => {
    const { signInWithPassword } = stubAuth();

    await expect(signInAction({ failed: false }, form({ email: '  ', password: '' }))).resolves.toEqual({
      failed: true,
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('필드가 아예 없어도 던지지 않는다 — 액션은 폼 밖에서도 POST 될 수 있다', async () => {
    const { signInWithPassword } = stubAuth();

    await expect(signInAction({ failed: false }, new FormData())).resolves.toEqual({ failed: true });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('이메일 앞뒤 공백은 다듬고 비밀번호는 손대지 않는다', async () => {
    const { signInWithPassword } = stubAuth();

    await expect(
      signInAction({ failed: false }, form({ email: '  admin@example.com  ', password: ' pw ' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'admin@example.com', password: ' pw ' });
  });
});

describe('signOutAction', () => {
  it('세션을 끊고 /admin 으로 되돌린다 — 그 자리에 로그인 화면이 선다', async () => {
    const { signOut } = stubAuth();

    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT');

    expect(signOut).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(redirect).toHaveBeenCalledWith('/admin');
  });

  it('로그아웃 호출이 실패해도 화면은 로그인으로 되돌린다', async () => {
    stubAuth({
      signOut: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledWith('/admin');
  });
});
