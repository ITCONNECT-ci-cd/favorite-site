/**
 * D3. 공용 목록 화면(ListView) — 카테고리·즐겨찾기·매일이 함께 쓰는 목록 화면.
 * 수치와 문구의 원본은 docs/DESIGN_SPEC.md 4장이며, 이 테스트가 그 값을 고정한다.
 *
 * 카드 내부 DOM(열기 영역이 버튼인지 앵커인지 등)에는 기대지 않는다 — 카드는 C2 의 계약대로
 * 제목을 그리고, 여기서는 '어떤 카드가 몇 장 보이는가'만 본다.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ListView, type ListViewProps } from '@/components/ListView';
import { FAVS_KEY } from '@/lib/constants';
import type { BookmarkWithCount } from '@/lib/types';

function makeBookmark(
  over: Partial<BookmarkWithCount> & Pick<BookmarkWithCount, 'id'>,
): BookmarkWithCount {
  return {
    category_id: 'top',
    title: over.id,
    url: `https://example.com/${over.id}`,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    click_count: 0,
    ...over,
  };
}

/** 상위 직속 1건 + 하위 둘(2건·1건). '전체'는 4건이다. */
const BOOKMARKS: BookmarkWithCount[] = [
  makeBookmark({ id: '직속', category_id: 'top' }),
  makeBookmark({ id: '대화A', category_id: 'chat' }),
  makeBookmark({ id: '대화B', category_id: 'chat' }),
  makeBookmark({ id: '영상A', category_id: 'video' }),
];

const SUB_TABS = [
  { id: 'chat', name: '대화·검색', count: 2 },
  { id: 'video', name: '영상', count: 1 },
];

function renderList(props: Partial<ListViewProps> = {}) {
  const merged: ListViewProps = {
    title: 'AI 도구 모음',
    bookmarks: BOOKMARKS,
    emptyMessage: '이 분류에 링크가 없습니다.',
    ...props,
  };

  const view = render(<ListView {...merged} />);

  return {
    ...view,
    rerender: (next: Partial<ListViewProps> = {}) =>
      view.rerender(<ListView {...merged} {...next} />),
  };
}

/** 그리드에 깔린 카드들의 제목 — 순서 그대로. 카드 안쪽 구조는 보지 않는다. */
function shownTitles(container: HTMLElement): string[] {
  const grid = container.querySelector('.grid');
  if (grid === null) return [];

  return [...grid.children].map((card) => {
    const text = card.textContent ?? '';
    return ['직속', '대화A', '대화B', '영상A', '마케팅A'].find((t) => text.includes(t)) ?? '?';
  });
}

const chip = (name: string) => screen.getByRole('button', { name });
const chips = () => screen.getAllByRole('button', { name: /^(전체|대화·검색|영상) \d+$/ });
const chipRow = () =>
  screen.getByRole('button', { name: /^전체 \d+$/ }).parentElement as HTMLElement;

beforeEach(() => {
  localStorage.clear();
});

describe('ListView — 머리말 (DESIGN_SPEC 4장)', () => {
  it('제목 20px/700 · 개수 12px fainter · 설명 12.5px desc 를 렌더한다', () => {
    renderList({ description: '아래 탭으로 좁혀서 봅니다.' });

    const title = screen.getByRole('heading', { name: 'AI 도구 모음' });
    expect(title).toHaveClass('text-[20px]', 'font-bold', 'tracking-[-0.02em]');

    expect(screen.getByText('4개')).toHaveClass('text-[12px]', 'text-fainter');
    expect(screen.getByText('아래 탭으로 좁혀서 봅니다.')).toHaveClass(
      'text-[12.5px]',
      'text-desc',
    );
  });

  it('설명이 없으면 설명 줄을 만들지 않는다', () => {
    const { container } = renderList();

    expect(screen.getByRole('heading', { name: 'AI 도구 모음' })).toBeInTheDocument();
    expect(screen.getByText('4개')).toBeInTheDocument();
    expect(container.querySelector('p')).toBeNull();
  });

  it('개수는 지금 보이는 링크 수다 — 하위 탭을 고르면 같이 줄어든다', () => {
    renderList({ subTabs: SUB_TABS });

    expect(screen.getByText('4개')).toBeInTheDocument();

    fireEvent.click(chip('대화·검색 2'));
    expect(screen.getByText('2개')).toBeInTheDocument();
  });
});

describe('ListView — 하위 탭 칩 줄', () => {
  it('하위가 없으면 칩 줄 자체를 렌더하지 않는다', () => {
    renderList();

    expect(screen.queryByRole('button', { name: /^전체 \d+$/ })).toBeNull();
  });

  it('빈 배열도 하위가 없는 것으로 본다', () => {
    renderList({ subTabs: [] });

    expect(screen.queryByRole('button', { name: /^전체 \d+$/ })).toBeNull();
  });

  it('전체(개수) + 하위별(개수) 순으로 칩을 만든다', () => {
    renderList({ subTabs: SUB_TABS });

    expect(chips().map((c) => c.textContent)).toEqual(['전체 4', '대화·검색 2', '영상 1']);
  });

  it('선택 칩은 bg-ink/흰 글자, 나머지는 흰 배경 + border-border-strong 이다', () => {
    renderList({ subTabs: SUB_TABS });

    expect(chip('전체 4')).toHaveClass('bg-ink', 'text-white', 'border-ink');
    expect(chip('전체 4')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('영상 1')).toHaveClass('bg-card', 'border-border-strong');
    expect(chip('영상 1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('칩은 링크가 아니라 버튼이다 — 클릭해도 URL 이 바뀌지 않는다', () => {
    renderList({ subTabs: SUB_TABS });

    for (const c of chips()) expect(c).toHaveAttribute('type', 'button');
    expect(within(chipRow()).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('ListView — 탭 필터링', () => {
  it('기본은 전체 — 상위 직속과 모든 하위 링크가 함께 보인다', () => {
    const { container } = renderList({ subTabs: SUB_TABS });

    expect(shownTitles(container)).toEqual(['직속', '대화A', '대화B', '영상A']);
  });

  it('하위 칩을 누르면 그 하위 링크만 남는다', () => {
    const { container } = renderList({ subTabs: SUB_TABS });

    fireEvent.click(chip('대화·검색 2'));

    expect(shownTitles(container)).toEqual(['대화A', '대화B']);
    expect(chip('대화·검색 2')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 4')).toHaveAttribute('aria-pressed', 'false');
  });

  it('전체 칩으로 되돌아온다', () => {
    const { container } = renderList({ subTabs: SUB_TABS });

    fireEvent.click(chip('영상 1'));
    expect(shownTitles(container)).toEqual(['영상A']);

    fireEvent.click(chip('전체 4'));
    expect(shownTitles(container)).toEqual(['직속', '대화A', '대화B', '영상A']);
  });

  it('initialSubId 로 들어오면 그 탭이 선택된 채로 시작한다 (사이드바의 하위 링크)', () => {
    const { container } = renderList({ subTabs: SUB_TABS, initialSubId: 'chat' });

    expect(chip('대화·검색 2')).toHaveAttribute('aria-pressed', 'true');
    expect(shownTitles(container)).toEqual(['대화A', '대화B']);
  });

  it('initialSubId 가 바뀌면(같은 상위 안에서 이동) 선택 탭이 따라간다', () => {
    const { container, rerender } = renderList({ subTabs: SUB_TABS, initialSubId: 'chat' });

    rerender({ initialSubId: 'video' });
    expect(shownTitles(container)).toEqual(['영상A']);

    // 상위 자신으로 돌아오면 다시 전체다.
    rerender({ initialSubId: null });
    expect(shownTitles(container)).toEqual(['직속', '대화A', '대화B', '영상A']);
  });

  it('다른 분류로 이동해 고른 하위가 사라지면 전체로 되돌린다', () => {
    const { container, rerender } = renderList({ subTabs: SUB_TABS });
    fireEvent.click(chip('영상 1'));

    rerender({
      title: '마케팅',
      bookmarks: [makeBookmark({ id: '마케팅A', category_id: 'mkt' })],
      subTabs: [],
    });

    expect(shownTitles(container)).toEqual(['마케팅A']);
  });
});

describe('ListView — 본문 (홈과 같은 카드 그리드)', () => {
  it('행 목록이 아니라 CardGrid 로 깐다', () => {
    const { container } = renderList();

    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fill,minmax(158px,1fr))]', 'gap-[10px]');
    expect(grid?.children).toHaveLength(4);
  });

  it('목록 화면이라 카드마다 핀이 보인다', () => {
    renderList();

    expect(screen.getAllByLabelText(/ 즐겨찾기$/)).toHaveLength(4);
  });

  it('즐겨찾기에 담긴 카드에 isFaved 를 내려준다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['대화B']));
    renderList();

    expect(screen.getByLabelText('대화B 즐겨찾기')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('대화A 즐겨찾기')).toHaveAttribute('aria-pressed', 'false');
  });

  it('체크와 툴바는 2단계 G4 몫이라 아직 렌더하지 않는다', () => {
    renderList({ subTabs: SUB_TABS });

    expect(screen.queryAllByLabelText(/ 선택$/)).toHaveLength(0);
    expect(screen.queryByText(/^전체 \d+개 열기$/)).toBeNull();
    expect(screen.queryByText(/^선택 \d+개 열기$/)).toBeNull();
    expect(screen.queryByText('선택 해제')).toBeNull();
  });
});

describe('ListView — 빈 상태', () => {
  it('링크가 없으면 점선 안내 박스를 대신 놓는다', () => {
    const { container } = renderList({ bookmarks: [] });

    const box = screen.getByText('이 분류에 링크가 없습니다.');
    expect(box).toHaveClass('border-dashed', 'border-dash', 'bg-side');
    expect(container.querySelector('.grid')).toBeNull();
  });

  it('고른 하위가 비어 있어도 같은 안내 박스를 보인다 — 칩 줄은 그대로 남는다', () => {
    renderList({
      bookmarks: [makeBookmark({ id: '대화A', category_id: 'chat' })],
      subTabs: [
        { id: 'chat', name: '대화·검색', count: 1 },
        { id: 'video', name: '영상', count: 0 },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: '영상 0' }));

    expect(screen.getByText('이 분류에 링크가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전체 1' })).toBeInTheDocument();
    expect(screen.getByText('0개')).toBeInTheDocument();
  });

  it('안내 문구는 화면이 정한다 — 즐겨찾기(D4)는 다른 문구를 넘긴다', () => {
    renderList({
      bookmarks: [],
      title: '내 즐겨찾기',
      emptyMessage: '아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.',
    });

    expect(
      screen.getByText('아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.'),
    ).toBeInTheDocument();
  });
});
