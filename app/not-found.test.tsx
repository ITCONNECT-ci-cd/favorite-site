import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NotFound from '@/app/not-found';

/**
 * 루트 404 — 어느 라우트에도 걸리지 않은 URL 이 온다(오타·죽은 북마크·크롤러).
 *
 * 짝인 `app/(public)/not-found.tsx` 와 역할이 다르다: 그쪽은 그룹 안 `notFound()` 만 받고
 * 셸에 감싸이며, 여기는 미매칭 URL 만 받고 셸이 없다.
 */
describe('루트 404 화면', () => {
  it('한국어로 알린다 — Next 기본 영문 화면을 그대로 두지 않는다', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeInTheDocument();
    expect(screen.getByText('주소가 잘못되었거나 지워진 페이지입니다.')).toBeInTheDocument();
  });

  it('막다른 길로 두지 않는다 — 홈으로 가는 링크가 있다', () => {
    render(<NotFound />);

    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '/');
  });

  /**
   * **없는 주소 하나가 DB 왕복을 만들지 않는다.** 이 화면에 셸을 세우려면 카테고리·링크를
   * 통째로 조회해야 하는데, 주소를 잘못 친 사람과 크롤러에게 그 비용을 물릴 이유가 없다.
   * 조회를 들이는 변경은 눈에 안 띄게 들어오므로 소스에서 잠근다.
   */
  it('데이터를 조회하지 않는다 — 셸도 세우지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'app/not-found.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).not.toContain('@/lib/queries');
    expect(source).not.toContain('@/lib/supabase');
    expect(source).not.toContain('SidebarContainer');
    expect(source).not.toContain('PaletteHost');
  });
});
