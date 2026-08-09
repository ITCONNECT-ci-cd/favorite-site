import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminPage from '@/app/admin/page';
import { signOutAction } from '@/app/admin/actions';
import { getAdminSession } from '@/lib/supabase/server';

vi.mock('@/app/admin/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

async function renderPage() {
  return render((await AdminPage()) as ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'admin@example.com' });
});

/**
 * H3 가 통째로 갈아 끼울 임시 화면이라 잠글 것이 많지 않다.
 * 남는 것들은 갈아 끼운 뒤에도 지켜져야 하는 성질이다.
 */
describe('AdminPage (임시)', () => {
  it('로그아웃을 POST 로 보낸다 — 미리 훑어지는 링크가 아니어야 한다', async () => {
    await renderPage();

    const button = screen.getByRole('button', { name: '로그아웃' });

    expect(button).toHaveAttribute('type', 'submit');
    expect(button.closest('form')).not.toBeNull();
    expect(signOutAction).toBeDefined();
    expect(screen.queryByRole('link', { name: '로그아웃' })).not.toBeInTheDocument();
  });

  it('세션 정보를 화면에 적지 않는다', async () => {
    const { container } = await renderPage();

    expect(container.textContent).not.toMatch(/@|user-|token/i);
  });
});

/**
 * **미인증 요청에는 아무것도 그리지 않는다.**
 *
 * 레이아웃이 children 을 렌더하지 않아도 Next 는 page 를 렌더해 응답의 RSC 페이로드에
 * 실어 보낸다 — 화면에 안 보일 뿐 HTML 안에는 들어간다(H2 통합 검증에서 dev·프로덕션
 * 양쪽 실측). 그래서 화면 스스로 한 번 더 막는다.
 */
describe('AdminPage — 미인증 요청', () => {
  beforeEach(() => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
  });

  it('본문을 만들지 않는다', async () => {
    expect(await AdminPage()).toBeNull();
  });

  it('세션이 없으면 아무 내용도 페이로드에 싣지 않는다', async () => {
    const { container } = render(<>{await AdminPage()}</>);

    expect(container.textContent).toBe('');
  });
});

/**
 * H3·I 시리즈가 붙일 **모든** 관리 화면에 같은 규칙을 건다.
 *
 * 위 두 테스트는 이 파일 하나만 지킨다. 새 관리 화면이 이 줄을 빼먹으면 그 화면의 내용이
 * 미인증 요청의 HTML 로 새어 나가는데, 화면에는 보이지 않아 눈으로는 절대 안 잡힌다.
 */
describe('app/admin 아래 모든 page 가 자기 세션을 다시 확인한다', () => {
  const ADMIN_DIR = join(process.cwd(), 'app/admin');

  function adminPages(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return adminPages(path);

      return entry.name === 'page.tsx' ? [path] : [];
    });
  }

  const pages = adminPages(ADMIN_DIR);

  it('훑을 page 를 실제로 찾았다', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('%s 가 getAdminSession 을 부른다', (path) => {
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(code).toContain('getAdminSession(');
  });
});
