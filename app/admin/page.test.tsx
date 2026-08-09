import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminPage from '@/app/admin/page';
import CleanupPage from '@/app/admin/cleanup/page';
import StatsPage from '@/app/admin/stats/page';
import { getAdminSession } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

/** 셸이 지는 상단 바·탭은 여기 없다 — 화면은 콘텐츠만 만든다(components/admin/AdminShell.tsx). */
const PAGES: Array<[string, () => Promise<ReactElement | null>]> = [
  ['/admin', AdminPage],
  ['/admin/stats', StatsPage],
  ['/admin/cleanup', CleanupPage],
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'admin@example.com' });
});

describe('AdminPage — 카테고리 · 링크 진입점', () => {
  it('본문 랜드마크만 세워 둔다 — 안은 I1 이 채운다', async () => {
    const { container } = render((await AdminPage()) as ReactElement);

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.textContent).toBe('');
  });

  it('세션 정보를 화면에 적지 않는다', async () => {
    const { container } = render((await AdminPage()) as ReactElement);

    expect(container.textContent).not.toMatch(/@|user-|token/i);
  });
});

/** K2·M2 가 통째로 교체할 자리다. 탭이 404 가 되지 않도록 자리만 잡아 둔다. */
describe('자리 표시 화면 (통계 · 정리 도구)', () => {
  it.each([
    ['통계', StatsPage],
    ['정리 도구', CleanupPage],
  ] as const)('%s 화면은 준비 중임을 한 줄로 알린다', async (name, Page) => {
    const { container } = render((await Page()) as ReactElement);

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByText(`${name} 화면은 다음 단계에서 들어옵니다.`)).toBeInTheDocument();
  });
});

/**
 * **미인증 요청에는 아무것도 그리지 않는다.**
 *
 * 레이아웃이 children 을 렌더하지 않아도 Next 는 page 를 렌더해 응답의 RSC 페이로드에
 * 실어 보낸다 — 화면에 안 보일 뿐 HTML 안에는 들어간다(H2 통합 검증에서 dev·프로덕션
 * 양쪽 실측). 그래서 화면 스스로 한 번 더 막는다. 아래 소스 스캔이 "부르긴 하는가"까지만
 * 본다면, 이 단언은 "부른 결과로 실제 아무것도 내보내지 않는가"를 본다.
 */
describe('관리 화면 — 미인증 요청', () => {
  beforeEach(() => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
  });

  it.each(PAGES)('%s 는 본문을 만들지 않는다', async (_path, Page) => {
    expect(await Page()).toBeNull();
  });

  it.each(PAGES)('%s 는 페이로드에 아무 내용도 싣지 않는다', async (_path, Page) => {
    const { container } = render(<>{await Page()}</>);

    expect(container.textContent).toBe('');
  });
});

/**
 * I·K·M 시리즈가 붙일 **모든** 관리 화면에 같은 규칙을 건다.
 *
 * 위 단언들은 지금 존재하는 화면만 지킨다. 새 관리 화면이 이 줄을 빼먹으면 그 화면의 내용이
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
    // 탭 3개가 가리키는 화면이 전부 있어야 한다 — 하나라도 없으면 그 탭은 404 다.
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it.each(pages)('%s 가 getAdminSession 을 부른다', (path) => {
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(code).toContain('getAdminSession(');
  });
});
