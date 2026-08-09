import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarContainer, type SidebarContainerProps } from '@/components/SidebarContainer';
import { FAVS_KEY } from '@/lib/constants';
import type { Category } from '@/lib/types';

/** Sidebar 가 usePathname 을 쓰므로 라우터 컨텍스트 없이 렌더하려면 모킹해야 한다. */
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const CATEGORIES: Category[] = [
  { id: 'ai', name: 'AI 도구 모음', parent_id: null, sort_order: 0 },
  { id: 'op', name: '현재 운영 중인 사이트', parent_id: null, sort_order: 1 },
];

const PROPS: SidebarContainerProps = {
  categories: CATEGORIES,
  counts: { ai: 118, op: 16 },
  totalCount: 290,
  dailyCount: 12,
  operatingCategoryId: 'op',
};

/** 사이드바 행 우측의 개수 — 행 컨테이너(링크의 부모) 안에 있다. */
function countOf(name: string): string | null {
  const link = screen.getByRole('link', { name });

  return within(link.parentElement!).getByTestId('count').textContent;
}

beforeEach(() => {
  localStorage.clear();
});

describe('SidebarContainer', () => {
  it('저장된 즐겨찾기 수를 favCount 로 넘긴다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a', 'b', 'c']));

    render(<SidebarContainer {...PROPS} />);

    expect(countOf('내 즐겨찾기')).toBe('3');
  });

  it('담긴 즐겨찾기가 없으면 0 이다', () => {
    render(<SidebarContainer {...PROPS} />);

    expect(countOf('내 즐겨찾기')).toBe('0');
  });

  it('서버에서 받은 나머지 개수는 손대지 않고 통과시킨다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a']));

    render(<SidebarContainer {...PROPS} />);

    expect(countOf('홈')).toBe('290');
    expect(countOf('매일 사용하는 사이트')).toBe('12');
    expect(countOf('현재 운영 중인 사이트')).toBe('16');
    expect(countOf('AI 도구 모음')).toBe('118');
  });
});
