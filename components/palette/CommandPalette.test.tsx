/**
 * G2. ⌘K 검색 팔레트 UI — 수치의 원본은 docs/DESIGN_SPEC.md 5장이고,
 * 마크업의 원본은 프로토타입(`docs/prototype/링크 대시보드 v2.dc.html` 175~257행)이다.
 * 이 테스트가 그 두 문서의 값을 고정한다.
 *
 * 여기서 보지 않는 것(후속 스토리 몫): 키보드 이동·Esc·전역 ⌘K(G3) · 헤더 연결(G5) ·
 * AI 영역의 실동작(N3). 아래 "후속 자리" describe 가 그 이음매만 확인한다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, type CommandPaletteProps } from '@/components/palette/CommandPalette';
import { SEARCH_RESULT_LIMIT } from '@/lib/search';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { BOOKMARKS, siteData } from '@/test/fixtures/seed';

/** 실시드 290건 — 프로토타입이 `docs/data/links.json` 을 그대로 훑던 것과 같다. */
const REAL: SiteData = siteData();

function makeCategory(over: Partial<Category> & Pick<Category, 'id'>): Category {
  return { name: over.id, parent_id: null, sort_order: 0, ...over };
}

/** 기본값은 검색에 걸리지 않는 중립값 — 질의를 넣은 필드 때문에 걸렸다는 것이 분명해진다. */
function makeBookmark(
  over: Partial<BookmarkWithCount> & Pick<BookmarkWithCount, 'id'>,
): BookmarkWithCount {
  return {
    category_id: null,
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

function site(bookmarks: BookmarkWithCount[], categories: Category[] = []): SiteData {
  return { categories, bookmarks };
}

function renderPalette(props: Partial<CommandPaletteProps> = {}) {
  return render(<CommandPalette open onClose={vi.fn()} data={REAL} {...props} />);
}

const panel = () => screen.getByRole('dialog');
const input = () => screen.getByRole('textbox');
/** 결과 행과 고정 링크 행은 둘 다 앵커다. 둘은 동시에 보이지 않으므로 섞이지 않는다. */
const rows = () => screen.getAllByRole('link');
/** 입력 줄 우측 "N건" — 입력 바로 다음 형제다. */
const countLabel = () => input().nextElementSibling as HTMLElement;
const inputRow = () => panel().children[0];
const scrollArea = () => panel().children[1];
const footer = () => panel().children[2];

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

describe('열기 · 닫기', () => {
  it('open=false 면 아무것도 그리지 않는다', () => {
    const { container } = render(<CommandPalette open={false} onClose={vi.fn()} data={REAL} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('open=true 면 오버레이와 패널을 그린다', () => {
    const { container } = renderPalette();

    expect(container.children).toHaveLength(2);
    expect(panel()).toHaveAttribute('aria-modal', 'true');
    expect(panel()).toHaveAccessibleName('검색');
  });

  it('열리면 입력에 포커스가 간다 (바로 타자를 칠 수 있어야 한다)', () => {
    renderPalette();

    expect(input()).toHaveFocus();
  });

  it('오버레이를 누르면 onClose 를 부른다', () => {
    const onClose = vi.fn();
    const { container } = renderPalette({ onClose });

    fireEvent.click(container.firstElementChild as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('다시 열면 지난 질의가 남아 있지 않다', () => {
    const { rerender } = renderPalette();
    type('문서');
    expect(input()).toHaveValue('문서');

    rerender(<CommandPalette open={false} onClose={vi.fn()} data={REAL} />);
    rerender(<CommandPalette open onClose={vi.fn()} data={REAL} />);

    expect(input()).toHaveValue('');
  });
});

describe('입력 즉시 필터 — 실시드', () => {
  it('"문서" 를 치면 곧바로 9건이 뜨고 순서가 스크린샷과 같다', () => {
    renderPalette();
    type('문서');

    expect(rows()).toHaveLength(9);
    expect(rows().slice(0, 5).map((row) => row.textContent)).toEqual([
      expect.stringContaining('ChatGPT'),
      expect.stringContaining('Claude'),
      expect.stringContaining('릴리스'),
      expect.stringContaining('Skywork'),
      expect.stringContaining('Descript'),
    ]);
  });

  it('결과 수를 "N건" 으로 적는다', () => {
    renderPalette();
    type('문서');

    expect(countLabel()).toHaveTextContent('9건');
  });

  it('질의를 지우면 결과 수 표시도 사라진다 (프로토타입 996행)', () => {
    renderPalette();
    type('문서');
    type('');

    expect(countLabel()).toHaveTextContent('');
  });

  it('공백만 친 것은 질의가 아니다', () => {
    renderPalette();
    type('   ');

    expect(countLabel()).toHaveTextContent('');
    expect(screen.getByText('고정해 둔 링크')).toBeInTheDocument();
  });

  it('한 글자를 더 치면 결과가 즉시 좁혀진다', () => {
    renderPalette();
    type('문서');
    const wide = rows().length;
    type('문서 편집');

    expect(rows().length).toBeLessThan(wide);
  });

  it('결과는 SEARCH_RESULT_LIMIT 건에서 끊긴다', () => {
    const many = Array.from({ length: SEARCH_RESULT_LIMIT + 10 }, (_, i) =>
      makeBookmark({ id: `b${i}`, title: `문서 ${i}` }),
    );
    renderPalette({ data: site(many) });
    type('문서');

    expect(rows()).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(countLabel()).toHaveTextContent(`${SEARCH_RESULT_LIMIT}건`);
  });
});

describe('결과 행 구성 요소', () => {
  const ONE = site(
    [
      makeBookmark({
        id: 'a',
        title: 'ChatGPT',
        url: 'https://chat.openai.com/',
        description: 'AI 대화·문서 초안',
        favicon_url: 'https://cdn.example.com/openai.png',
        category_id: 'sub',
        click_count: 3,
      }),
    ],
    [makeCategory({ id: 'top', name: 'AI 도구 모음' }), makeCategory({ id: 'sub', name: '대화·검색', parent_id: 'top' })],
  );

  it('파비콘·이름·주소·설명·분류 칩·클릭 수·매칭 배지를 한 줄에 담는다', () => {
    renderPalette({ data: ONE });
    type('문서');

    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('chat.openai.com')).toBeInTheDocument();
    expect(screen.getByText('AI 대화·문서 초안')).toBeInTheDocument();
    expect(screen.getByText('대화·검색')).toBeInTheDocument();
    expect(screen.getByText('3회')).toBeInTheDocument();
    expect(screen.getByText('설명')).toBeInTheDocument();
  });

  it('파비콘은 16px 배경 이미지로 26px 타일 가운데에 그린다', () => {
    renderPalette({ data: ONE });
    type('문서');
    const tile = rows()[0].firstElementChild as HTMLElement;

    expect(tile).toHaveStyle({ backgroundImage: 'url("https://cdn.example.com/openai.png")' });
    expect(tile).toHaveClass('size-[26px]', 'bg-[length:16px_16px]', 'bg-center', 'bg-no-repeat');
  });

  it('파비콘이 없으면 이미지 없이 회색 타일만 남는다', () => {
    renderPalette({ data: site([makeBookmark({ id: 'a', title: '문서함' })]) });
    type('문서');
    const tile = rows()[0].firstElementChild as HTMLElement;

    expect(tile.style.backgroundImage).toBe('');
    expect(tile).toHaveClass('bg-side');
  });

  it('따옴표가 든 파비콘 주소에서도 배경 선언이 살아남는다', () => {
    const data = site([makeBookmark({ id: 'a', title: '문서함', favicon_url: 'https://x/a").png' })]);
    renderPalette({ data });
    type('문서');

    expect((rows()[0].firstElementChild as HTMLElement).style.backgroundImage).not.toBe('');
  });

  it('주소는 host 만 적는다 (www. 제거, 경로 제거)', () => {
    renderPalette({ data: site([makeBookmark({ id: 'a', title: '문서함', url: 'https://www.perplexity.ai/s?q=1' })]) });
    type('문서');

    expect(screen.getByText('perplexity.ai')).toBeInTheDocument();
  });

  it('클릭 수가 0이면 가운뎃점을 찍는다 (프로토타입 914행 clickLabel)', () => {
    renderPalette({ data: site([makeBookmark({ id: 'a', title: '문서함', click_count: 0 })]) });
    type('문서');

    expect(screen.getByText('·')).toBeInTheDocument();
  });

  it('분류 칩은 하위가 있으면 하위 이름이다 (프로토타입 `b.sub || b.group`)', () => {
    renderPalette({ data: ONE });
    type('문서');

    expect(screen.getByText('대화·검색')).toBeInTheDocument();
    expect(screen.queryByText('AI 도구 모음')).not.toBeInTheDocument();
  });

  it('분류가 없는 링크에는 칩을 아예 그리지 않는다 (글자 없는 테두리가 남으면 안 된다)', () => {
    renderPalette({ data: site([makeBookmark({ id: 'a', title: '문서함', category_id: null })]) });
    type('문서');

    expect(rows()).toHaveLength(1);
    expect(screen.getByText('문서함')).toBeInTheDocument();
    // 칩이 있었다면 칸이 7개, 없으면 6개다.
    expect(rows()[0].children).toHaveLength(6);
  });

  it('행은 새 탭으로 가는 진짜 앵커다', () => {
    renderPalette({ data: ONE });
    type('문서');

    expect(rows()[0]).toHaveAttribute('href', 'https://chat.openai.com/');
    expect(rows()[0]).toHaveAttribute('target', '_blank');
    expect(rows()[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('매칭 위치 배지 5종', () => {
  const BADGES = site(
    [
      makeBookmark({ id: 'a', title: 'Zed' }),
      makeBookmark({ id: 'b', description: 'zed 로 짠다' }),
      makeBookmark({ id: 'c', url: 'https://zed.dev/' }),
      makeBookmark({ id: 'd', category_id: 'cat' }),
      makeBookmark({ id: 'e', tags: ['zed'] }),
    ],
    [makeCategory({ id: 'cat', name: 'zed 모음' })],
  );

  it('이름·설명·주소·분류·태그 다섯 라벨을 쓴다', () => {
    renderPalette({ data: BADGES });
    type('zed');

    // 배지는 행의 마지막에서 두 번째 칸이다(마지막은 ↵ 자리).
    const badges = rows().map((row) => row.children[row.children.length - 2].textContent);

    expect(badges).toEqual(['이름', '설명', '주소', '분류', '태그']);
  });
});

describe('선택 행 표시 (이동은 G3)', () => {
  it('첫 행에 선택 배경과 ↵ 를 붙인다', () => {
    renderPalette();
    type('문서');

    expect(rows()[0]).toHaveClass('bg-[#f0eee9]');
    expect(screen.getByText('↵')).toBeInTheDocument();
  });

  it('나머지 행은 선택 배경도 ↵ 도 없다', () => {
    renderPalette();
    type('문서');

    for (const row of rows().slice(1)) {
      expect(row).not.toHaveClass('bg-[#f0eee9]');
    }
    // 결과가 9건이어도 ↵ 는 하나뿐이다.
    expect(screen.getAllByText('↵')).toHaveLength(1);
  });
});

describe('빈 입력 — 고정해 둔 링크', () => {
  it('캡션과 함께 is_pinned 앞 6개를 보여준다', () => {
    renderPalette();

    expect(screen.getByText('고정해 둔 링크')).toBeInTheDocument();
    expect(rows()).toHaveLength(6);
    expect(rows().map((row) => row.children[1].textContent)).toEqual([
      'ChatGPT',
      'Claude',
      'Perplexity',
      'Gemini',
      'Google AI Studio',
      'Google NotebookLM',
    ]);
  });

  it('행 높이는 44px 이고 이름 200px · 설명 · 주소를 담는다', () => {
    renderPalette();
    const row = rows()[0];

    expect(row).toHaveClass('h-[44px]', 'gap-[12px]', 'rounded-[6px]', 'px-[8px]');
    expect(row.children[1]).toHaveClass('w-[200px]', 'text-[13.5px]', 'font-semibold', 'truncate');
    expect(row.children[2]).toHaveClass('flex-1', 'min-w-0', 'text-[12px]', 'text-desc', 'truncate');
    expect(row.children[3]).toHaveClass('flex-none', 'text-[10.5px]', 'text-fainter');
  });

  it('질의를 치면 고정 링크가 사라지고 결과로 바뀐다', () => {
    renderPalette();
    type('문서');

    expect(screen.queryByText('고정해 둔 링크')).not.toBeInTheDocument();
  });

  it('고정된 링크가 하나도 없으면 목록 없이 캡션만 남지 않는다', () => {
    renderPalette({ data: site([makeBookmark({ id: 'a' })]) });

    expect(screen.queryByText('고정해 둔 링크')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

describe('결과 0건', () => {
  it('제목과 안내문을 프로토타입 원문 그대로 적는다', () => {
    renderPalette();
    type('존재하지않는말');

    expect(screen.getByText('이름이 일치하는 링크가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('문장으로 물어봤다면 아래 AI 검색(⌘↵)을 눌러보세요')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('제목 14.5px/700 · 안내 12.5px (DESIGN_SPEC 5장)', () => {
    renderPalette();
    type('존재하지않는말');

    expect(screen.getByText('이름이 일치하는 링크가 없습니다')).toHaveClass(
      'text-[14.5px]',
      'font-bold',
      'mb-[7px]',
    );
    expect(screen.getByText('문장으로 물어봤다면 아래 AI 검색(⌘↵)을 눌러보세요')).toHaveClass(
      'text-[12.5px]',
      'text-desc',
      'leading-[1.75]',
    );
  });

  it('빈 입력에서는 0건 안내를 띄우지 않는다 (고정 링크 자리다)', () => {
    renderPalette();

    expect(screen.queryByText('이름이 일치하는 링크가 없습니다')).not.toBeInTheDocument();
  });
});

describe('수치 (DESIGN_SPEC 5장)', () => {
  it('오버레이: 전면 고정 + rgba(20,21,22,.36)', () => {
    const { container } = renderPalette();

    expect(container.firstElementChild).toHaveClass(
      'fixed',
      'inset-0',
      'z-[40]',
      'bg-[rgba(20,21,22,.36)]',
    );
  });

  it('패널: 상단 64px · 폭 800px(모바일 calc(100%-24px)) · 최대 높이 calc(100%-128px) · 라운드 12px · 그림자', () => {
    renderPalette();

    expect(panel()).toHaveClass(
      'fixed',
      'top-[64px]',
      'left-1/2',
      '-translate-x-1/2',
      'z-[41]',
      'w-[calc(100%-24px)]',
      'min-[820px]:w-[800px]',
      'max-h-[calc(100%-128px)]',
      'rounded-[12px]',
      'border',
      'border-dash',
      'bg-card',
      'shadow-[0_22px_60px_rgba(20,21,22,.28)]',
      'flex',
      'flex-col',
      'overflow-hidden',
    );
  });

  it('입력 줄 58px: 원형 아이콘 + 16.5px 입력 + 우측 11px 결과 수', () => {
    renderPalette();

    expect(inputRow()).toHaveClass(
      'h-[58px]',
      'flex-none',
      'flex',
      'items-center',
      'gap-[12px]',
      'px-[18px]',
      'border-b',
    );
    expect(inputRow().firstElementChild).toHaveClass(
      'size-[14px]',
      'rounded-full',
      'border-[1.5px]',
      'border-[#5a5651]',
    );
    expect(input()).toHaveClass('flex-1', 'min-w-0', 'text-[16.5px]', 'text-ink', 'bg-transparent');
    expect(input()).toHaveAttribute('placeholder', '무엇을 찾나요');
    expect(countLabel()).toHaveClass('flex-none', 'text-[11px]', 'text-faint');
  });

  it('결과 목록만 스크롤한다 (입력 줄·하단 바는 고정)', () => {
    renderPalette();

    expect(scrollArea()).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto');
  });

  it('결과 행 56px: 파비콘 26px / 이름 14px + 주소 10.5px(230px) / 설명 12.5px / 칩 / 클릭 수 / 배지 / ↵', () => {
    renderPalette();
    type('문서');
    const row = rows()[0];

    expect(row).toHaveClass('h-[56px]', 'gap-[12px]', 'px-[18px]', 'border-b', 'border-line');

    const [tile, name, desc, chip, clicks, badge, enter] = [...row.children];
    expect(tile).toHaveClass('size-[26px]', 'flex-none', 'rounded-[7px]');
    expect(name).toHaveClass('w-[230px]', 'flex-none', 'min-w-0');
    expect(name.children[0]).toHaveClass('text-[14px]', 'font-semibold', 'truncate', 'block');
    expect(name.children[1]).toHaveClass('text-[10.5px]', 'text-fainter', 'truncate', 'block');
    expect(desc).toHaveClass('flex-1', 'min-w-0', 'truncate', 'text-[12.5px]', 'text-sub');
    expect(chip).toHaveClass(
      'flex-none',
      'rounded-[4px]',
      'border',
      'bg-side',
      'px-[8px]',
      'py-[2px]',
      'text-[10.5px]',
      'text-[#5a5651]',
    );
    expect(clicks).toHaveClass('w-[44px]', 'flex-none', 'text-right', 'text-[11px]', 'font-semibold', 'text-faint');
    expect(badge).toHaveClass('w-[44px]', 'flex-none', 'text-right', 'text-[10px]', 'text-fainter');
    expect(enter).toHaveClass('w-[44px]', 'flex-none', 'text-right', 'text-[10px]', 'font-semibold', 'text-ink');
  });

  it('고정 링크 파비콘은 22px 타일에 14px 이미지다', () => {
    renderPalette();

    expect(rows()[0].firstElementChild).toHaveClass(
      'size-[22px]',
      'rounded-[6px]',
      'bg-[length:14px_14px]',
    );
  });

  it('하단 바 48px: 안내 3개 + 우측 검은 AI 버튼', () => {
    renderPalette();

    expect(footer()).toHaveClass(
      'h-[48px]',
      'flex-none',
      'flex',
      'items-center',
      'gap-[18px]',
      'px-[18px]',
      'bg-page',
      'border-t',
    );
    for (const hint of ['↑↓ 이동', '↵ 열기', 'esc 닫기']) {
      expect(screen.getByText(hint)).toHaveClass('text-[10.5px]', 'text-desc');
    }

    const button = screen.getByRole('button', { name: 'AI 검색' });
    expect(button).toHaveClass('ml-auto', 'h-[30px]', 'gap-[8px]', 'rounded-[6px]', 'bg-ink', 'px-[13px]');
    expect(button).toHaveTextContent('⌘↵');
  });
});

describe('후속 자리 — G3 · G5 · N3', () => {
  it('N3 가 끼울 AI 슬롯은 결과 아래·하단 바 위에 놓인다', () => {
    renderPalette({ aiSlot: <div data-testid="ai-slot" /> });
    type('문서');
    const slot = screen.getByTestId('ai-slot');

    expect(scrollArea()).toContainElement(slot);
    expect(rows()[8].compareDocumentPosition(slot)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('AI 슬롯을 주지 않아도 팔레트는 그대로 뜬다', () => {
    renderPalette();

    expect(panel()).toBeInTheDocument();
  });

  it('AI 검색 버튼은 지금 렌더만 하고 콜백이 있으면 부른다 (실동작은 N3)', () => {
    const onAiSearch = vi.fn();
    renderPalette({ onAiSearch });

    fireEvent.click(screen.getByRole('button', { name: 'AI 검색' }));

    expect(onAiSearch).toHaveBeenCalledTimes(1);
  });

  it('행을 누르면 onOpenLink 로 알린다 (클릭 기록 배선은 G3)', () => {
    const onOpenLink = vi.fn();
    renderPalette({ onOpenLink });
    type('문서');

    fireEvent.click(rows()[0]);

    expect(onOpenLink).toHaveBeenCalledWith(BOOKMARKS[0].id);
  });

  it('고정 링크 행도 같은 콜백을 쓴다', () => {
    const onOpenLink = vi.fn();
    renderPalette({ onOpenLink });

    fireEvent.click(rows()[0]);

    expect(onOpenLink).toHaveBeenCalledWith(BOOKMARKS[0].id);
  });

  it('기본 이동을 막지 않는다 (브라우저가 새 탭을 연다)', () => {
    renderPalette();
    type('문서');

    expect(fireEvent.click(rows()[0])).toBe(true);
  });
});
