import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteConfirm } from '@/components/card/DeleteConfirm';
import { SidebarContainer, type SidebarContainerProps } from '@/components/SidebarContainer';
import { useFavorites } from '@/lib/favorites';
import { deleteBookmark } from '@/lib/mutations';
import type { BookmarkWithCount, Category } from '@/lib/types';
import { setFavs } from '@/test/favs';

/** Sidebar 가 usePathname 을 쓰므로 라우터 컨텍스트 없이 렌더하려면 모킹해야 한다. */
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

/** 아래 '즐겨찾기 정합' 묶음이 진짜 삭제 확인 오버레이를 쓰므로 액션만 갈아 끼운다. */
vi.mock('@/lib/mutations', () => ({ deleteBookmark: vi.fn() }));

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

/**
 * 사이드바 행의 우측 개수.
 *
 * 행은 `<li>` 하나이고 그 안의 개수에는 `data-testid="count"` 가 붙어 있다(C3 Sidebar).
 * 링크의 부모를 타고 올라가지 않는 이유는 Row 의 DOM 중첩이 바뀌면 조용히 깨지기 때문이다 —
 * `<li>` 로 행을 잡고 testid 로 값을 집으면 그 안쪽 구조가 바뀌어도 버틴다.
 */
function countOf(name: string): string | null {
  const row = screen.getByRole('link', { name }).closest('li');
  expect(row, `'${name}' 행을 찾지 못했다`).not.toBeNull();

  return within(row!).getByTestId('count').textContent;
}

/** 카드의 핀 토글처럼 같은 탭의 다른 인스턴스가 즐겨찾기를 바꾸는 상황. */
function FavToggler({ id }: { id: string }) {
  const { toggle } = useFavorites();

  return (
    <button type="button" onClick={() => toggle(id)}>
      토글
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('SidebarContainer', () => {
  it('저장된 즐겨찾기 수를 favCount 로 넘긴다', () => {
    setFavs(['a', 'b', 'c']);

    render(<SidebarContainer {...PROPS} />);

    expect(countOf('내 즐겨찾기')).toBe('3');
  });

  it('담긴 즐겨찾기가 없으면 0 이다', () => {
    render(<SidebarContainer {...PROPS} />);

    expect(countOf('내 즐겨찾기')).toBe('0');
  });

  it('서버에서 받은 나머지 개수는 손대지 않고 통과시킨다', () => {
    setFavs(['a']);

    render(<SidebarContainer {...PROPS} />);

    expect(countOf('홈')).toBe('290');
    expect(countOf('매일 사용하는 사이트')).toBe('12');
    expect(countOf('현재 운영 중인 사이트')).toBe('16');
    expect(countOf('AI 도구 모음')).toBe('118');
  });

  it('다른 인스턴스가 즐겨찾기를 바꾸면 개수가 곧바로 따라간다', () => {
    render(
      <>
        <SidebarContainer {...PROPS} />
        <FavToggler id="a" />
      </>,
    );
    expect(countOf('내 즐겨찾기')).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: '토글' }));
    expect(countOf('내 즐겨찾기')).toBe('1');

    // 다시 빼면 되돌아온다 — 구독이 한 방향으로만 도는지까지 본다.
    fireEvent.click(screen.getByRole('button', { name: '토글' }));
    expect(countOf('내 즐겨찾기')).toBe('0');
  });

  /**
   * J3 — 지운 링크의 id 가 localStorage 에 남으면 이 숫자만 실제 목록보다 커진다
   * (화면의 목록은 `pickFavorites` 로 죽은 id 를 걸러 낸다). 그 어긋남을 여기서 가리지 않고
   * 원인이 생기는 자리(삭제 확인)에서 지우므로, 진짜 오버레이를 함께 세워 확인한다.
   */
  it('링크를 지우면 그 id 가 즐겨찾기에서 빠져 개수가 곧바로 줄어든다 (J3)', async () => {
    vi.mocked(deleteBookmark).mockResolvedValue({ ok: true });
    setFavs(['bm-1', 'bm-2', 'bm-3']);

    const bookmark: BookmarkWithCount = {
      id: 'bm-2',
      category_id: 'ai',
      title: 'ChatGPT',
      url: 'https://chat.openai.com',
      description: null,
      tags: [],
      favicon_url: null,
      is_pinned: false,
      sort_order: 0,
      created_at: '2024-01-01T00:00:00.000Z',
      click_count: 0,
    };

    render(
      <>
        <SidebarContainer {...PROPS} />
        <DeleteConfirm bookmark={bookmark} onDone={() => {}} />
      </>,
    );
    expect(countOf('내 즐겨찾기')).toBe('3');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    });

    expect(countOf('내 즐겨찾기')).toBe('2');
  });

  it('서버 렌더에서는 저장된 값이 있어도 0 이다 (하이드레이션 불일치 방지)', () => {
    setFavs(['a', 'b', 'c']);

    // useFavorites 의 서버 스냅샷은 항상 빈 Set 이다. 서버가 3을 그리고 클라이언트가
    // 0으로 시작하면 React 가 하이드레이션 불일치를 낸다.
    const html = renderToString(<SidebarContainer {...PROPS} />);

    expect(html).toContain('>0<');
    expect(html).not.toContain('>3<');
  });
});
