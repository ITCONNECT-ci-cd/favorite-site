import type { ReactElement } from 'react';
import { headers } from 'next/headers';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminLayout, { metadata } from '@/app/admin/layout';
import { getAdminSession } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
// 서버 액션은 클라이언트 컴포넌트에 prop 으로만 넘어간다 — 실제 구현은 actions.test.ts 가 본다.
vi.mock('@/app/admin/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));

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

describe('AdminLayout — 인증', () => {
  beforeEach(() => {
    vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'admin@example.com' });
  });

  it('children 을 그대로 렌더하고 로그인 화면은 내보내지 않는다', async () => {
    await renderLayout();

    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '관리자 로그인' })).not.toBeInTheDocument();
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
});
