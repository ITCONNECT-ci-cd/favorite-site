/**
 * D3. 공용 목록 화면(ListView) — 카테고리·즐겨찾기·매일이 함께 쓰는 목록 화면.
 * 수치와 문구의 원본은 docs/DESIGN_SPEC.md 4장이며, 이 테스트가 그 값을 고정한다.
 *
 * 카드 내부 DOM(열기 영역이 버튼인지 앵커인지 등)에는 기대지 않는다 — 카드는 C2 의 계약대로
 * 제목을 그리고, 여기서는 '어떤 카드가 몇 장 보이는가'만 본다.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListView, type ListViewProps } from '@/components/ListView';
import { Toaster } from '@/components/Toast';
import { recordClick } from '@/lib/clicks';
import type { BookmarkWithCount } from '@/lib/types';
import { middleClick } from '@/test/events';
import { setFavs, storedFavs } from '@/test/favs';
import { openedUrls, setupWindowOpen } from '@/test/open';
import { setupToastTimers } from '@/test/toast';

/**
 * 클릭 기록은 네트워크를 타므로 여기서는 부르는지만 본다 — 요청의 모양(keepalive·visitorId·
 * 실패를 삼키는 것)은 `lib/clicks.test.ts` 가 못박는다. 문구 함수(`openToastText`)는 진짜를 쓴다.
 */
vi.mock('@/lib/clicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clicks')>()),
  recordClick: vi.fn(),
}));

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

/** 이 파일이 쓰는 카드 제목 전부 — 목록에 없는 카드가 나오면 테스트가 조용히 넘어가지 않게 한다. */
const KNOWN_TITLES = ['직속', '대화A', '대화B', '영상A', '마케팅A'];

/** 그리드에 깔린 카드들의 제목 — 순서 그대로. 카드 안쪽 구조는 보지 않는다. */
function shownTitles(container: HTMLElement): string[] {
  const grid = container.querySelector('.grid');
  if (grid === null) return [];

  return [...grid.children].map((card) => {
    const text = card.textContent ?? '';
    const title = KNOWN_TITLES.find((known) => text.includes(known));
    if (title === undefined) throw new Error(`알 수 없는 카드가 그려졌다: ${text}`);

    return title;
  });
}

/**
 * 카드에서 링크를 여는 영역 — 접근성 이름은 제목이다. 카드에는 앵커가 둘이지만 파비콘 타일은
 * aria-hidden 이라 접근성 트리에 없다(C2).
 */
const openLink = (title: string) => screen.getByRole('link', { name: title });

const chip = (name: string) => screen.getByRole('button', { name });
const chips = () => screen.getAllByRole('button', { name: /^(전체|대화·검색|영상) \d+$/ });
const chipRow = () => screen.getByRole('group', { name: '하위 분류' });

/** 툴바 (DESIGN_SPEC 4장) — 라벨의 숫자는 화면 상태를 따라 바뀌므로 정규식으로 잡는다. */
const openAllButton = () => screen.getByRole('button', { name: /^전체 \d+개 열기$/ });
const openCheckedButton = () => screen.getByRole('button', { name: /^선택 \d+개 열기$/ });
const clearButton = () => screen.getByRole('button', { name: '선택 해제' });
const toolbarNote = '체크한 것만 열거나, 전체를 새 탭으로 한 번에 엽니다';

/** 카드의 체크 버튼 — 접근성 이름은 `<제목> 선택` 이다 (C2 LinkCard). */
const check = (title: string) => screen.getByLabelText(`${title} 선택`);

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

    expect(screen.queryByRole('group', { name: '하위 분류' })).toBeNull();
  });

  it('빈 배열도 하위가 없는 것으로 본다', () => {
    renderList({ subTabs: [] });

    expect(screen.queryByRole('group', { name: '하위 분류' })).toBeNull();
  });

  it('전체(개수) + 하위별(개수) 순으로 칩을 만든다', () => {
    renderList({ subTabs: SUB_TABS });

    expect(chips().map((c) => c.textContent)).toEqual(['전체 4', '대화·검색 2', '영상 1']);
  });

  it('선택 칩은 bg-ink/흰 글자, 나머지는 흰 배경 + border-border-strong 이다', () => {
    renderList({ subTabs: SUB_TABS });

    expect(chip('전체 4')).toHaveClass('bg-ink', 'text-white', 'border-ink');
    expect(chip('전체 4')).toHaveAttribute('aria-pressed', 'true');
    // 비선택 글자색은 스펙 표에 없는 프로토타입 고유값이라 임의 값으로 옮겼다.
    expect(chip('영상 1')).toHaveClass('bg-card', 'border-border-strong', 'text-[#3a3833]');
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
  // 그리드의 수치(열 규칙·gap)는 CardGrid 의 계약이라 그쪽 테스트가 지킨다.
  // 여기서는 '행 목록이 아니라 그리드에 카드가 한 장씩 깔렸는가'만 본다.
  it('행 목록이 아니라 CardGrid 로 깐다', () => {
    const { container } = renderList();

    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
    expect(grid?.children).toHaveLength(4);
  });

  it('목록 화면이라 카드마다 핀이 보인다', () => {
    renderList();

    expect(screen.getAllByLabelText(/ 즐겨찾기$/)).toHaveLength(4);
  });

  it('즐겨찾기에 담긴 카드에 isFaved 를 내려준다', () => {
    setFavs(['대화B']);
    renderList();

    expect(screen.getByLabelText('대화B 즐겨찾기')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('대화A 즐겨찾기')).toHaveAttribute('aria-pressed', 'false');
  });

  it('목록 화면이라 카드마다 체크도 보인다 (계획서 V3 — 카테고리·매일·즐겨찾기)', () => {
    renderList();

    expect(screen.getAllByLabelText(/ 선택$/)).toHaveLength(4);
  });
});

describe('ListView — 핀 토글 (D6)', () => {
  setupToastTimers();

  const pin = (title: string) => screen.getByLabelText(`${title} 즐겨찾기`);

  it('핀을 누르면 담기고 프로토타입 문구로 알린다', () => {
    renderList();
    render(<Toaster />);

    fireEvent.click(pin('대화A'));

    expect(pin('대화A')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('대화A · 홈 즐겨찾기에 담김')).toBeInTheDocument();
    expect(storedFavs()).toEqual(['대화A']);
  });

  it('담긴 카드의 핀을 다시 누르면 빠지고 해제 문구로 알린다', () => {
    setFavs(['대화A']);
    renderList();
    render(<Toaster />);

    expect(pin('대화A')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(pin('대화A'));

    expect(pin('대화A')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('대화A 즐겨찾기 해제')).toBeInTheDocument();
    expect(storedFavs()).toEqual([]);
  });

  it('토글한 카드만 바뀐다 — 옆 카드는 그대로다', () => {
    renderList();

    fireEvent.click(pin('대화A'));

    expect(pin('대화A')).toHaveAttribute('aria-pressed', 'true');
    for (const title of ['직속', '대화B', '영상A']) {
      expect(pin(title)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('하위 탭으로 좁혀 놓은 화면에서도 토글된다', () => {
    renderList({ subTabs: SUB_TABS });
    render(<Toaster />);

    fireEvent.click(chip('영상 1'));
    fireEvent.click(pin('영상A'));

    expect(pin('영상A')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('영상A · 홈 즐겨찾기에 담김')).toBeInTheDocument();
    // 토글이 탭 선택을 되돌리지 않는다.
    expect(chip('영상 1')).toHaveAttribute('aria-pressed', 'true');
    expect(shownTitles(screen.getByRole('main'))).toEqual(['영상A']);
  });
});

describe('ListView — 카드 클릭 기록 (F3)', () => {
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  it('카드를 열면 그 링크의 클릭을 기록하고 프로토타입 문구로 알린다', () => {
    renderList();
    render(<Toaster />);

    fireEvent.click(openLink('대화A'));

    // 인자가 id 하나뿐이다 — isBulk 는 넘기지 않는다(사람이 카드를 누른 클릭 = 기본 false).
    expect(recordClick).toHaveBeenCalledWith('대화A');
    expect(recordClick).toHaveBeenCalledOnce();
    expect(screen.getByText('대화A · 새 탭으로 이동')).toBeInTheDocument();
  });

  it('가운데 클릭(새 탭)도 기록한다', () => {
    renderList();
    render(<Toaster />);

    middleClick(openLink('영상A'));

    expect(recordClick).toHaveBeenCalledWith('영상A');
    expect(screen.getByText('영상A · 새 탭으로 이동')).toBeInTheDocument();
  });

  it('하위 탭으로 좁혀 놓은 화면에서도 기록한다', () => {
    renderList({ subTabs: SUB_TABS });

    fireEvent.click(chip('영상 1'));
    fireEvent.click(openLink('영상A'));

    expect(recordClick).toHaveBeenCalledWith('영상A');
    // 여는 동작이 탭 선택을 되돌리지 않는다.
    expect(chip('영상 1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('기본 동작을 막지 않는다 — 이동은 브라우저에 맡긴다', () => {
    renderList();

    // preventDefault 를 부르면 dispatchEvent 가 false 를 돌려준다.
    expect(fireEvent.click(openLink('대화A'))).toBe(true);
    expect(middleClick(openLink('대화B'))).toBe(true);
  });

  it('핀을 눌러도 클릭을 기록하지 않는다 (여는 동작이 아니다)', () => {
    renderList();

    fireEvent.click(screen.getByLabelText('대화A 즐겨찾기'));

    expect(recordClick).not.toHaveBeenCalled();
  });
});

describe('ListView — 툴바 (DESIGN_SPEC 4장 · G4)', () => {
  it('칩 줄 아래, 카드 그리드 위에 놓는다', () => {
    const { container } = renderList({ subTabs: SUB_TABS });

    const toolbar = openAllButton().parentElement!;

    expect(
      chipRow().compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toolbar.compareDocumentPosition(container.querySelector('.grid')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('전체 열기는 검은 버튼이다 (높이 32px · 패딩 13px · 라운드 7px · 12px/600)', () => {
    renderList();

    expect(openAllButton()).toHaveClass(
      'h-[32px]',
      'px-[13px]',
      'rounded-[7px]',
      'bg-ink',
      'text-white',
      'text-[12px]',
      'font-semibold',
    );
    expect(openAllButton()).toHaveAttribute('type', 'button');
  });

  it('선택 열기는 흰 버튼이다 (테두리 border-strong · 배경 card)', () => {
    renderList();

    expect(openCheckedButton()).toHaveClass(
      'h-[32px]',
      'px-[13px]',
      'rounded-[7px]',
      'border-border-strong',
      'bg-card',
      'text-[12px]',
      'font-semibold',
    );
    expect(openCheckedButton()).not.toHaveClass('bg-ink');
  });

  it('선택 해제는 버튼 모양 없는 흐린 글자다 (11.5px faint)', () => {
    renderList();

    expect(clearButton()).toHaveClass('text-[11.5px]', 'text-faint');
    expect(clearButton()).toHaveAttribute('type', 'button');
  });

  it('우측 안내문은 프로토타입 원문이고 <820px 에서는 숨는다', () => {
    renderList();

    // 프로토타입의 `descColDisplay`(narrow ? none : block)를 그대로 옮긴 것이다.
    expect(screen.getByText(toolbarNote)).toHaveClass(
      'ml-auto',
      'hidden',
      'min-[820px]:block',
      'text-[11.5px]',
      'text-fainter',
    );
  });

  it('전체 열기의 개수는 지금 보이는 링크 수다 — 하위 탭을 고르면 함께 줄어든다', () => {
    renderList({ subTabs: SUB_TABS });

    expect(openAllButton()).toHaveTextContent('전체 4개 열기');

    fireEvent.click(chip('대화·검색 2'));

    expect(openAllButton()).toHaveTextContent('전체 2개 열기');
  });

  it('목록이 비어도 툴바는 남는다 (프로토타입도 목록 화면이면 언제나 그린다)', () => {
    renderList({ bookmarks: [] });

    expect(openAllButton()).toHaveTextContent('전체 0개 열기');
    expect(openCheckedButton()).toHaveTextContent('선택 0개 열기');
    expect(clearButton()).toBeInTheDocument();
  });
});

describe('ListView — 체크 선택 (G4)', () => {
  it('체크를 누르면 켜지고 다시 누르면 꺼진다', () => {
    renderList();

    expect(check('대화A')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(check('대화A'));
    expect(check('대화A')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(check('대화A'));
    expect(check('대화A')).toHaveAttribute('aria-pressed', 'false');
  });

  it('선택한 카드만 바뀐다 — 옆 카드는 그대로다', () => {
    renderList();

    fireEvent.click(check('대화A'));

    for (const title of ['직속', '대화B', '영상A']) {
      expect(check(title)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('선택한 카드 수가 "선택 N개 열기" 에 그대로 붙는다', () => {
    renderList();

    expect(openCheckedButton()).toHaveTextContent('선택 0개 열기');

    fireEvent.click(check('대화A'));
    fireEvent.click(check('영상A'));

    expect(openCheckedButton()).toHaveTextContent('선택 2개 열기');
  });

  it('"선택 해제"가 전부 끈다', () => {
    renderList();

    fireEvent.click(check('대화A'));
    fireEvent.click(check('영상A'));

    fireEvent.click(clearButton());

    expect(openCheckedButton()).toHaveTextContent('선택 0개 열기');
    for (const title of ['직속', '대화A', '대화B', '영상A']) {
      expect(check(title)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('하위 탭을 옮기면 선택이 비워진다 (프로토타입 aiTabs.go 가 checked 를 비운다)', () => {
    renderList({ subTabs: SUB_TABS });

    fireEvent.click(check('대화A'));
    expect(openCheckedButton()).toHaveTextContent('선택 1개 열기');

    fireEvent.click(chip('영상 1'));
    expect(openCheckedButton()).toHaveTextContent('선택 0개 열기');

    // 되돌아와도 꺼진 채다 — 숨어 있던 사이에 되살아나지 않는다.
    fireEvent.click(chip('전체 4'));
    expect(check('대화A')).toHaveAttribute('aria-pressed', 'false');
  });

  it('같은 분류 안에서 상위↔하위를 오가도(initialSubId 변화) 선택이 비워진다', () => {
    const { rerender } = renderList({ subTabs: SUB_TABS, initialSubId: 'chat' });

    fireEvent.click(check('대화A'));
    expect(openCheckedButton()).toHaveTextContent('선택 1개 열기');

    rerender({ initialSubId: null });

    expect(openCheckedButton()).toHaveTextContent('선택 0개 열기');
    expect(check('대화A')).toHaveAttribute('aria-pressed', 'false');
  });

  it('체크는 여는 동작이 아니다 — 클릭을 기록하지 않는다', () => {
    vi.mocked(recordClick).mockClear();
    renderList();

    fireEvent.click(check('대화A'));

    expect(recordClick).not.toHaveBeenCalled();
  });
});

describe('ListView — 한 번에 열기 (G4)', () => {
  setupToastTimers();
  const windowOpen = setupWindowOpen();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  it('전체 열기는 보이는 카드를 순서대로 새 탭에 연다', () => {
    renderList();

    fireEvent.click(openAllButton());

    expect(windowOpen.mock.calls).toEqual([
      ['https://example.com/직속', '_blank', 'noopener,noreferrer'],
      ['https://example.com/대화A', '_blank', 'noopener,noreferrer'],
      ['https://example.com/대화B', '_blank', 'noopener,noreferrer'],
      ['https://example.com/영상A', '_blank', 'noopener,noreferrer'],
    ]);
  });

  it('연 링크마다 isBulk=true 로 기록한다 (F3 — handleOpen 재사용이 아니다)', () => {
    renderList();

    fireEvent.click(openAllButton());

    expect(vi.mocked(recordClick).mock.calls).toEqual([
      ['직속', true],
      ['대화A', true],
      ['대화B', true],
      ['영상A', true],
    ]);
  });

  it('탭 그룹 명칭과 팝업 차단을 함께 알린다', () => {
    renderList();
    render(<Toaster />);

    fireEvent.click(openAllButton());

    expect(
      screen.getByText(
        '4개를 새 탭으로 엽니다 · 크롬에서 "AI 도구 모음" 탭 그룹으로 묶어 두면 좋습니다 · 열리지 않으면 팝업 차단을 확인하세요',
      ),
    ).toBeInTheDocument();
  });

  it('하위 탭으로 좁혀 놓으면 보이는 것만 열고 명칭도 "상위 · 하위" 가 된다', () => {
    renderList({ subTabs: SUB_TABS });
    render(<Toaster />);

    fireEvent.click(chip('대화·검색 2'));
    fireEvent.click(openAllButton());

    expect(openedUrls(windowOpen)).toEqual([
      'https://example.com/대화A',
      'https://example.com/대화B',
    ]);
    expect(
      screen.getByText(
        '2개를 새 탭으로 엽니다 · 크롬에서 "AI 도구 모음 · 대화·검색" 탭 그룹으로 묶어 두면 좋습니다 · 열리지 않으면 팝업 차단을 확인하세요',
      ),
    ).toBeInTheDocument();
  });

  it('선택 열기는 체크한 것만 목록 순서대로 연다', () => {
    renderList();
    render(<Toaster />);

    fireEvent.click(check('영상A'));
    fireEvent.click(check('직속'));

    fireEvent.click(openCheckedButton());

    expect(openedUrls(windowOpen)).toEqual([
      'https://example.com/직속',
      'https://example.com/영상A',
    ]);
    expect(vi.mocked(recordClick).mock.calls).toEqual([
      ['직속', true],
      ['영상A', true],
    ]);
    expect(
      screen.getByText(
        '2개를 새 탭으로 엽니다 · 크롬에서 "AI 도구 모음" 탭 그룹으로 묶어 두면 좋습니다 · 열리지 않으면 팝업 차단을 확인하세요',
      ),
    ).toBeInTheDocument();
  });

  it('체크해 둔 카드가 탭 전환으로 숨으면 열지 않는다 (D3 인계)', () => {
    renderList({ subTabs: SUB_TABS });

    fireEvent.click(check('직속'));
    fireEvent.click(chip('영상 1'));
    fireEvent.click(openCheckedButton());

    expect(windowOpen).not.toHaveBeenCalled();
    expect(recordClick).not.toHaveBeenCalled();
  });

  it('체크한 카드가 다른 하위로 옮겨져 화면에서 빠지면 열지 않는다 (shown 과 교차)', () => {
    // 탭도 `initialSubId` 도 그대로라 선택 비우기가 돌지 않는 경로다 — `shown` 과의 교차만이
    // 이 경우를 잡는다. 서버가 데이터를 다시 내려 링크의 분류가 바뀐 상황을 모사한다.
    const { rerender } = renderList({ subTabs: SUB_TABS, initialSubId: 'chat' });

    fireEvent.click(check('대화A'));
    expect(openCheckedButton()).toHaveTextContent('선택 1개 열기');

    rerender({
      bookmarks: BOOKMARKS.map((bookmark) =>
        bookmark.id === '대화A' ? { ...bookmark, category_id: 'video' } : bookmark,
      ),
    });

    expect(openCheckedButton()).toHaveTextContent('선택 0개 열기');

    fireEvent.click(openCheckedButton());

    expect(windowOpen).not.toHaveBeenCalled();
    expect(recordClick).not.toHaveBeenCalled();
  });

  it('아무것도 고르지 않고 선택 열기를 누르면 아무 탭도 열지 않고 안내만 한다', () => {
    renderList();
    render(<Toaster />);

    fireEvent.click(openCheckedButton());

    expect(windowOpen).not.toHaveBeenCalled();
    expect(recordClick).not.toHaveBeenCalled();
    expect(screen.getByText('열 링크를 먼저 선택하세요')).toBeInTheDocument();
  });

  it('빈 목록에서 전체 열기를 눌러도 같은 안내만 한다', () => {
    renderList({ bookmarks: [] });
    render(<Toaster />);

    fireEvent.click(openAllButton());

    expect(windowOpen).not.toHaveBeenCalled();
    expect(screen.getByText('열 링크를 먼저 선택하세요')).toBeInTheDocument();
  });
});

describe('ListView — 빈 상태', () => {
  // 점선 박스의 생김새는 EmptyBox 의 계약이다 — 여기서는 그리드 대신 안내문이 놓였는지만 본다.
  it('링크가 없으면 안내 박스를 대신 놓는다', () => {
    const { container } = renderList({ bookmarks: [] });

    expect(screen.getByText('이 분류에 링크가 없습니다.')).toBeInTheDocument();
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
