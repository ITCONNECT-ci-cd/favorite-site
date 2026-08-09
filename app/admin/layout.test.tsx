import type { ReactElement } from 'react';
import { headers } from 'next/headers';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminLayout, { metadata } from '@/app/admin/layout';
import { getAdminSession } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
// 서버 액션은 클라이언트 컴포넌트에 prop 으로만 넘어간다 — 실제 구현은 actions.test.ts 가 본다.
vi.mock('@/app/admin/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
// 관리자 셸(H3)이 활성 탭을 usePathname 으로 고른다 — 라우터 컨텍스트가 없는 단위 테스트라 모킹한다.
vi.mock('next/navigation', () => ({ usePathname: () => '/admin' }));

const SECRET = '관리 화면 내용물';

function stubHeaders(entries: Record<string, string>) {
  vi.mocked(headers).mockResolvedValue({
    get: (name: string) => entries[name] ?? null,
  } as never);
}

/** async 서버 컴포넌트라 RTL 로 바로 못 그린다 — 먼저 실행해 element 를 받는다. */
async function renderLayout() {
  const element = (await AdminLayout({
    children: <p>{SECRET}</p>,
    params: Promise.resolve({}),
  })) as ReactElement;

  return render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubHeaders({ host: 'link.example.dev' });
});

describe('AdminLayout — 미인증', () => {
  beforeEach(() => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
  });

  it('로그인 화면만 렌더한다 — children 은 내보내지 않는다', async () => {
    await renderLayout();

    expect(screen.getByRole('heading', { name: '관리자 로그인' })).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('관리자 셸도 내보내지 않는다 — 탭·로그아웃은 로그인 화면에 없다', async () => {
    await renderLayout();

    expect(screen.queryByRole('navigation', { name: '관리 메뉴' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '사이트 보기' })).not.toBeInTheDocument();
  });

  it('세션을 getAdminSession 하나로만 판정한다', async () => {
    await renderLayout();

    expect(getAdminSession).toHaveBeenCalledTimes(1);
  });

  it('주소 표기는 요청 호스트에서 만든다 — 도메인을 코드에 박지 않는다', async () => {
    await renderLayout();

    expect(screen.getByText('link.example.dev/admin')).toBeInTheDocument();
  });

  it('프록시 뒤에서는 x-forwarded-host 를 먼저 본다', async () => {
    stubHeaders({ host: 'internal-7f3a.vercel.app', 'x-forwarded-host': 'link.example.dev' });

    await renderLayout();

    expect(screen.getByText('link.example.dev/admin')).toBeInTheDocument();
  });

  it('호스트를 못 읽어도 화면은 선다', async () => {
    stubHeaders({});

    await renderLayout();

    expect(screen.getByText('/admin')).toBeInTheDocument();
  });
});

/**
 * 세션 확인이 **던지는** 경우 (env 누락·Auth 장애). `getAdminSession()` 자체는 fail-closed 지만
 * 그 앞의 클라이언트 생성이 `requireEnv` 로 던질 수 있다.
 *
 * 레이아웃의 SSR 실패는 global-error 가 잡지 못해 빈 500 이 나간다(공개 셸 O1 게이트 F-1 과
 * 같은 사연). 여기서는 그 실패를 미인증과 똑같이 접는다 — 관리 화면에서 모르는 상태는
 * "통과"가 아니라 "거부"여야 한다.
 */
describe('AdminLayout — 세션 확인이 던질 때', () => {
  it('로그인 화면으로 접고 children 은 절대 그리지 않는다 (fail-closed)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAdminSession).mockRejectedValue(new Error('env 누락'));

    await renderLayout();

    expect(screen.getByRole('heading', { name: '관리자 로그인' })).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '관리 메뉴' })).not.toBeInTheDocument();
    // 삼키지는 않는다 — fail-closed 라 화면에는 신호가 없고, 로그가 유일한 신호다.
    // `error` 여야 한다: 여기서 잡히는 것은 던져진 예외고(env 누락·Auth 장애) 경보는
    // 대개 error 에만 걸린다. 예상된 도메인 실패(warn)와 구분하는 관례를 잠근다.
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });
});

describe('AdminLayout — 인증', () => {
  beforeEach(() => {
    vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'admin@example.com' });
  });

  it('children 을 그대로 렌더하고 로그인 화면은 내보내지 않는다', async () => {
    await renderLayout();

    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '관리자 로그인' })).not.toBeInTheDocument();
  });

  /**
   * 셸을 레이아웃이 지는 이유: 관리 화면 셋이 같은 상단 바를 공유하고, 화면을 오갈 때
   * 바가 다시 그려지지 않아야 한다. 화면마다 셸을 부르는 구조였다면 새 화면이 그 줄을
   * 빼먹는 순간 상단 바가 사라진다.
   */
  it('관리자 셸로 children 을 감싼다 — 상단 바 하나를 셋이 공유한다', async () => {
    await renderLayout();

    const tabs = within(screen.getByRole('navigation', { name: '관리 메뉴' })).getAllByRole('link');

    expect(tabs.map((link) => link.textContent)).toEqual(['카테고리 · 링크', '통계', '정리 도구']);
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '사이트 보기' })).toBeInTheDocument();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  it('로그인한 사람의 이메일·id 를 화면에 흘리지 않는다', async () => {
    const { container } = await renderLayout();

    expect(container.textContent).not.toContain('admin@example.com');
    expect(container.textContent).not.toContain('user-1');
  });
});

describe('AdminLayout — 탭 제목', () => {
  it('화면 이름만 댄다 — 꼬리표는 루트 셸의 template 이 붙인다', () => {
    expect(metadata.title).toBe('관리자');
  });

  /** 색인되면 검색 결과가 관리 화면의 존재를 알린다 — 링크를 지운 이유가 무의미해진다. */
  it('검색 색인을 거부한다', () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
