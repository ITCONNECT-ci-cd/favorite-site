/**
 * G2·G3. ⌘K 검색 팔레트 — 수치의 원본은 docs/DESIGN_SPEC.md 5장이고,
 * 마크업과 키 동작의 원본은 프로토타입(`docs/prototype/링크 대시보드 v2.dc.html`
 * 175~257행 · 640~653행 · 837~840행)이다. 이 테스트가 그 두 문서의 값을 고정한다.
 *
 * 여기서 보지 않는 것(후속 스토리 몫): 헤더 연결과 열림 상태의 소유(G5) ·
 * AI 영역의 실동작(N3). 아래 "후속 자리" describe 가 그 이음매만 확인한다.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette, type CommandPaletteProps } from '@/components/palette/CommandPalette';
import { Toaster } from '@/components/Toast';
import { recordClick } from '@/lib/clicks';
import { SEARCH_RESULT_LIMIT } from '@/lib/search';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { middleClick, rightClick } from '@/test/events';
import { BOOKMARKS, siteData } from '@/test/fixtures/seed';
import { setupToastTimers } from '@/test/toast';

/**
 * 클릭 기록은 네트워크를 타므로 여기서는 부르는지만 본다 — 요청의 모양(keepalive·visitorId·
 * 실패를 삼키는 것)은 `lib/clicks.test.ts` 가 못박는다. 문구 함수(`openToastText`)는 진짜를 쓴다.
 * (HomeView·ListView 테스트와 같은 처리다.)
 */
vi.mock('@/lib/clicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clicks')>()),
  recordClick: vi.fn(),
}));

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
/**
 * 스크롤 영역 안의 앵커 — 결과 행이거나(질의가 있을 때) 고정 링크 행이다(빈 입력일 때).
 * 둘은 동시에 보이지 않으므로 섞이지 않는다.
 *
 * `screen` 전체가 아니라 패널 안으로 스코프를 좁힌다: 이 파일은 `<Toaster />` 나 트리거 버튼을
 * 함께 마운트하는 테스트가 있고, N3 이 붙일 AI 결과 행도 앵커라 곧 이웃이 늘어난다.
 */
const rows = () => within(scrollArea()).getAllByRole('link');
/** 키워드 결과 행만 — AI 결과·고정 링크와 섞이지 않는 그 목록이다(↑↓·↵ 의 대상). */
const resultRows = () => within(screen.getByTestId('palette-results')).queryAllByRole('link');
/**
 * 패널의 세 영역은 testid 로 잡는다 — `panel().children[n]` 은 N3 이 영역을 하나
 * 끼워 넣는 순간 조용히 다른 것을 가리킨다. 반면 행 안쪽 칸 순서 단언은 그대로 둔다:
 * 그 순서 자체가 DESIGN_SPEC 5장의 나열 순서를 인코딩한 것이라 바뀌면 깨져야 맞다.
 */
const inputRow = () => screen.getByTestId('palette-input-row');
const scrollArea = () => screen.getByTestId('palette-scroll');
const footer = () => screen.getByTestId('palette-footer');
/** 입력 줄 우측 "N건" — 타자마다 바뀌므로 살아 있는 영역(role=status)이다. */
const countLabel = () => screen.getByTestId('palette-count');

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

/**
 * 키는 `window` 가 듣는다(프로토타입 653행 `window.addEventListener('keydown', …)`).
 * 실제로는 입력에 포커스가 있으므로 기본값은 입력이다 — 거기서 쏜 이벤트가 window 까지 올라온다.
 *
 * **돌려주는 값은 `fireEvent` 의 것이다: `preventDefault` 를 불렀으면 `false`, 아니면 `true`.**
 * 즉 `toBe(false)` 는 "우리가 이 키를 가져갔다", `toBe(true)` 는 "브라우저에 맡겼다"는 뜻이다.
 */
function press(
  key: string,
  init: KeyboardEventInit = {},
  target: Element | Window = input(),
): boolean {
  return fireEvent.keyDown(target, { key, ...init });
}

/** 선택 행 번호. 배경(`#f0eee9`)과 `↵` 가 같은 행을 가리키는지까지 함께 본다 — 갈라지면 둘 다 못 믿는다. */
function selectedIndex(): number {
  const list = resultRows();
  const byBackground = list.findIndex((row) => row.classList.contains('bg-[#f0eee9]'));
  const byEnter = list.findIndex((row) => row.textContent?.endsWith('↵') === true);

  expect(byEnter).toBe(byBackground);

  return byBackground;
}

/** 열기 경로(기록·토스트)를 보는 테스트 — 토스트를 그리는 `<Toaster />` 를 함께 마운트한다. */
const paletteWithToaster = (props: Partial<CommandPaletteProps>) => (
  <>
    <CommandPalette open onClose={vi.fn()} data={REAL} {...props} />
    <Toaster />
  </>
);

function renderWithToaster(props: Partial<CommandPaletteProps> = {}) {
  return render(paletteWithToaster(props));
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

  it('배지 칸은 접근성 트리에서 감춘다 — 행 이름이 "… 3회 설명" 으로 늘어지지 않게', () => {
    renderPalette({ data: BADGES });
    type('zed');

    for (const row of rows()) {
      // 눈으로는 그대로 보이고(글자가 남아 있다) 이름 계산에서만 빠진다.
      const badge = row.children[row.children.length - 2];
      expect(badge).not.toBeEmptyDOMElement();
      expect(badge).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('선택 행 표시', () => {
  it('첫 행에 선택 배경과 ↵ 를 붙인다', () => {
    renderPalette();
    type('문서');

    expect(rows()[0]).toHaveClass('bg-[#f0eee9]');
    expect(screen.getByText('↵')).toBeInTheDocument();
  });

  it('선택 행은 aria-current 로도 알린다 (배경색만으로는 읽히지 않는다)', () => {
    renderPalette();
    type('문서');

    expect(rows()[0]).toHaveAttribute('aria-current', 'true');
    expect(rows()[1]).not.toHaveAttribute('aria-current');
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

  it('aiBusy 면 감춘다 — AI 가 도는 중이거나 이미 찾아 놓았다 (프로토타입 1002행)', () => {
    renderPalette({ aiBusy: true });
    type('존재하지않는말');

    expect(screen.queryByText('이름이 일치하는 링크가 없습니다')).not.toBeInTheDocument();
  });

  it('aiBusy 가 꺼지면 다시 뜬다 (N3 이 이 한 값만 켜고 끄면 된다)', () => {
    const { rerender } = render(
      <CommandPalette open onClose={vi.fn()} data={REAL} aiBusy />,
    );
    type('존재하지않는말');
    rerender(<CommandPalette open onClose={vi.fn()} data={REAL} aiBusy={false} />);

    expect(screen.getByText('이름이 일치하는 링크가 없습니다')).toBeInTheDocument();
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
    // 세 칸의 순서는 스펙 문장("원형 아이콘 + 입력 + 우측 결과 수") 그대로다.
    expect([...inputRow().children]).toEqual([inputRow().firstElementChild, input(), countLabel()]);
  });

  it('결과 수는 살아 있는 영역이라 스크린리더가 타자 사이에 읽어 준다', () => {
    renderPalette();
    type('문서');

    expect(countLabel()).toHaveAttribute('aria-live', 'polite');
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

describe('후속 자리 — G5 · N3', () => {
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

  // 행 클릭이 onOpenLink 로 알리는 것·기본 이동을 막지 않는 것은 아래 '행 클릭 = ↵' 이 본다.
});

/* ──────────────────────────────── G3 ──────────────────────────────── */

/**
 * 열기 경로 확인용 소형 데이터. 실시드로는 "몇 번째 행이 어느 id 인가"를 눈으로 짚기 어렵다.
 * 셋 다 `문서` 로 걸린다(이름).
 */
const THREE = site([
  makeBookmark({ id: 'a', title: '문서 하나' }),
  makeBookmark({ id: 'b', title: '문서 둘' }),
  makeBookmark({ id: 'c', title: '문서 셋' }),
]);

/** 같은 질의(`문서`)에 결과만 하나로 줄어든 한 벌 — 선택이 목록 밖으로 밀리는 상황을 만든다. */
const THREE_TO_ONE = site([makeBookmark({ id: 'a', title: '문서 하나' })]);

describe('전역 ⌘K · Ctrl+K', () => {
  function renderGate(props: Partial<CommandPaletteProps> = {}) {
    return render(<CommandPalette open={false} onClose={vi.fn()} data={REAL} {...props} />);
  }

  it('닫혀 있어도 ⌘K 를 들어 열기를 요청한다 (리스너는 게이트가 들고 있다)', () => {
    const onOpenRequest = vi.fn();
    renderGate({ onOpenRequest });

    press('k', { metaKey: true }, window);

    expect(onOpenRequest).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+K 도 같은 자리를 연다 (Windows 사용자 — C4 인계)', () => {
    const onOpenRequest = vi.fn();
    renderGate({ onOpenRequest });

    press('k', { ctrlKey: true }, window);

    expect(onOpenRequest).toHaveBeenCalledTimes(1);
  });

  it('⇧ 가 섞여 대문자 K 로 와도 연다 (프로토타입 `k.toLowerCase()`)', () => {
    const onOpenRequest = vi.fn();
    renderGate({ onOpenRequest });

    press('K', { metaKey: true, shiftKey: true }, window);

    expect(onOpenRequest).toHaveBeenCalledTimes(1);
  });

  it('수식키 없는 k 는 아무것도 하지 않는다 (타자를 가로채면 안 된다)', () => {
    const onOpenRequest = vi.fn();
    renderGate({ onOpenRequest });

    expect(press('k', {}, window)).toBe(true);
    expect(onOpenRequest).not.toHaveBeenCalled();
  });

  it('브라우저 기본 단축키를 막는다 (Ctrl+K = 주소창 검색)', () => {
    renderGate({ onOpenRequest: vi.fn() });

    expect(press('k', { metaKey: true }, window)).toBe(false);
  });

  it('이미 열려 있어도 요청은 그대로 나간다 (프로토타입 openPalette 무조건 호출)', () => {
    const onOpenRequest = vi.fn();
    render(<CommandPalette open onClose={vi.fn()} data={REAL} onOpenRequest={onOpenRequest} />);

    press('k', { metaKey: true }, window);

    expect(onOpenRequest).toHaveBeenCalledTimes(1);
  });

  it('콜백이 없어도 터지지 않는다 (G5 배선 전 상태)', () => {
    renderGate();

    expect(() => press('k', { metaKey: true }, window)).not.toThrow();
  });

  it('언마운트하면 리스너를 뗀다', () => {
    const onOpenRequest = vi.fn();
    const { unmount } = renderGate({ onOpenRequest });
    unmount();

    press('k', { metaKey: true }, window);

    expect(onOpenRequest).not.toHaveBeenCalled();
  });
});

describe('↑↓ 이동 (순환)', () => {
  it('↓ 는 다음 행을 선택한다', () => {
    renderPalette();
    type('문서');

    press('ArrowDown');

    expect(selectedIndex()).toBe(1);
  });

  it('마지막 행에서 ↓ 는 첫 행으로 돌아온다', () => {
    renderPalette({ data: THREE });
    type('문서');
    press('ArrowDown');
    press('ArrowDown');
    expect(selectedIndex()).toBe(2);

    press('ArrowDown');

    expect(selectedIndex()).toBe(0);
  });

  it('첫 행에서 ↑ 는 마지막 행으로 간다', () => {
    renderPalette({ data: THREE });
    type('문서');

    press('ArrowUp');

    expect(selectedIndex()).toBe(2);
  });

  it('입력 캐럿이 함께 움직이지 않게 기본 동작을 막는다', () => {
    renderPalette();
    type('문서');

    expect(press('ArrowDown')).toBe(false);
    expect(press('ArrowUp')).toBe(false);
  });

  it('결과가 없으면 이동도 없다 (0으로 나누지 않는다)', () => {
    renderPalette();
    type('존재하지않는말');

    expect(() => press('ArrowDown')).not.toThrow();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('질의를 바꾸면 선택이 첫 행으로 돌아온다 (프로토타입 onQ `sel: 0`)', () => {
    renderPalette();
    type('문서');
    press('ArrowDown');
    press('ArrowDown');
    expect(selectedIndex()).toBe(2);

    type('문서 편집');

    expect(selectedIndex()).toBe(0);
  });

  it('한글 조합 중에는 키를 먹지 않는다 (IME 가 쓰는 ↑↓ 다)', () => {
    renderPalette();
    type('문서');

    press('ArrowDown', { isComposing: true });

    expect(selectedIndex()).toBe(0);
  });

  it('결과가 줄어 선택이 목록 밖을 가리켜도 마지막 행으로 접힌다', () => {
    const { rerender } = render(<CommandPalette open onClose={vi.fn()} data={THREE} />);
    type('문서');
    press('ArrowDown');
    press('ArrowDown');
    expect(selectedIndex()).toBe(2);

    // 질의는 그대로 두고 data 만 줄인다 — 입력 onChange 의 선택 리셋을 지나지 않는 유일한 경로다.
    rerender(<CommandPalette open onClose={vi.fn()} data={THREE_TO_ONE} />);

    expect(resultRows()).toHaveLength(1);
    expect(selectedIndex()).toBe(0);
  });

  it('닫힌 뒤에는 화살표를 듣지 않는다', () => {
    const { rerender } = renderPalette();
    rerender(<CommandPalette open={false} onClose={vi.fn()} data={REAL} />);

    expect(fireEvent.keyDown(window, { key: 'ArrowDown' })).toBe(true);
  });
});

describe('선택 이동을 소리로 알리기', () => {
  it('결과 수 옆에 선택 행 제목을 얹어 읽어 준다 (배경색은 소리가 나지 않는다)', () => {
    renderPalette({ data: THREE });
    type('문서');
    expect(countLabel()).toHaveTextContent('3건 · 문서 하나');

    press('ArrowDown');

    expect(countLabel()).toHaveTextContent('3건 · 문서 둘');
  });

  it('보이는 글자는 "N건" 그대로다 — 제목은 sr-only 로만 붙는다 (스펙 5장 "우측 결과 수")', () => {
    renderPalette({ data: THREE });
    type('문서');

    expect(countLabel().firstChild?.textContent).toBe('3건');
    const forScreenReader = countLabel().querySelector('span');
    expect(forScreenReader).toHaveClass('sr-only');
    expect(forScreenReader).toHaveTextContent('· 문서 하나');
  });

  it('읽어 주는 자리는 그대로 살아 있는 영역이다', () => {
    renderPalette({ data: THREE });
    type('문서');

    expect(countLabel()).toHaveAttribute('role', 'status');
    expect(countLabel()).toHaveAttribute('aria-live', 'polite');
  });

  it('결과가 0건이면 제목 없이 건수만 읽는다', () => {
    renderPalette();
    type('존재하지않는말');

    expect(countLabel()).toHaveTextContent('0건');
    expect(countLabel().querySelector('span')).toBeNull();
  });
});

describe('행 호버 = 선택 이동', () => {
  it('행에 마우스를 올리면 선택이 그 행으로 옮겨간다 (프로토타입 `hover`)', () => {
    renderPalette();
    type('문서');

    fireEvent.mouseEnter(rows()[3]);

    expect(selectedIndex()).toBe(3);
  });

  it('호버로 옮긴 자리에서 ↓ 가 이어진다', () => {
    renderPalette();
    type('문서');
    fireEvent.mouseEnter(rows()[3]);

    press('ArrowDown');

    expect(selectedIndex()).toBe(4);
  });
});

describe('선택 행 스크롤 인투 뷰', () => {
  /** jsdom 에는 scrollIntoView 가 없다 — 옮겨갈 행에만 스파이를 심는다. */
  it('선택이 옮겨가면 그 행을 목록 안으로 끌어온다', () => {
    renderPalette();
    type('문서');
    const next = rows()[1];
    next.scrollIntoView = vi.fn();

    press('ArrowDown');

    expect(next.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('메서드가 없는 환경에서도 이동은 그대로 된다 (옵셔널 호출)', () => {
    renderPalette();
    type('문서');

    expect(() => press('ArrowDown')).not.toThrow();
    expect(selectedIndex()).toBe(1);
  });
});

describe('↵ 열기 · 행 클릭 = ↵', () => {
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  it('↵ 는 선택 행의 앵커를 눌러 새 탭을 연다 (이동은 브라우저 몫이라 막지 않는다)', () => {
    renderWithToaster({ data: THREE });
    type('문서');
    const row = rows()[0];
    const clicks: Event[] = [];
    row.addEventListener('click', (event) => clicks.push(event));

    press('Enter');

    expect(clicks).toHaveLength(1);
    expect(clicks[0].defaultPrevented).toBe(false);
  });

  it('↵ 는 클릭을 기록하고 프로토타입 문구로 알린 뒤 팔레트를 닫는다', () => {
    const onClose = vi.fn();
    const onOpenLink = vi.fn();
    renderWithToaster({ data: THREE, onClose, onOpenLink });
    type('문서');

    press('Enter');

    // isBulk 는 넘기지 않는다 — 사람이 행 하나를 연 클릭이다(기본 false).
    expect(recordClick).toHaveBeenCalledWith('a');
    expect(recordClick).toHaveBeenCalledOnce();
    expect(screen.getByText('문서 하나 · 새 탭으로 이동')).toBeInTheDocument();
    expect(onOpenLink).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('결과가 줄어 선택이 목록 밖을 가리켜도 ↵ 는 남은 행을 연다 (AI 로 새지 않는다)', () => {
    const onAiSearch = vi.fn();
    const { rerender } = render(paletteWithToaster({ data: THREE, onAiSearch }));
    type('문서');
    press('ArrowDown');
    press('ArrowDown');

    rerender(paletteWithToaster({ data: THREE_TO_ONE, onAiSearch }));
    press('Enter');

    expect(recordClick).toHaveBeenCalledWith('a');
    expect(screen.getByText('문서 하나 · 새 탭으로 이동')).toBeInTheDocument();
    expect(onAiSearch).not.toHaveBeenCalled();
  });

  it('↑↓ 로 옮긴 뒤의 ↵ 는 그 행을 연다', () => {
    renderWithToaster({ data: THREE });
    type('문서');
    press('ArrowDown');

    press('Enter');

    expect(recordClick).toHaveBeenCalledWith('b');
    expect(screen.getByText('문서 둘 · 새 탭으로 이동')).toBeInTheDocument();
  });

  it('↵ 는 기본 동작을 막는다 (입력의 form 제출·줄바꿈이 끼어들지 않게)', () => {
    renderWithToaster({ data: THREE });
    type('문서');

    expect(press('Enter')).toBe(false);
  });

  it('한글 조합을 끝내는 ↵ 로는 열지 않는다', () => {
    const onClose = vi.fn();
    renderWithToaster({ data: THREE, onClose });
    type('문서');

    press('Enter', { isComposing: true });

    expect(recordClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('버튼에 포커스가 있을 때의 ↵ 는 가로채지 않는다 (그 버튼이 눌려야 한다)', () => {
    const onClose = vi.fn();
    renderWithToaster({ data: THREE, onClose, onAiSearch: vi.fn() });
    type('문서');
    const button = screen.getByRole('button', { name: 'AI 검색' });
    button.focus();

    expect(press('Enter', {}, button)).toBe(true);
    expect(recordClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('행에 포커스가 있을 때의 ↵ 도 가로채지 않는다 (짚어 둔 행과 선택 행, 탭이 둘 열린다)', () => {
    const onClose = vi.fn();
    renderWithToaster({ data: THREE, onClose });
    type('문서');
    // 탭으로 세 번째 행까지 짚어 둔 상태 — 선택(첫 행)과 일부러 어긋나게 둔다.
    const row = rows()[2];
    row.focus();

    // 브라우저가 그 행을 활성화한다. 우리가 preventDefault 로 가로채면 그 이동이 사라지고
    // 대신 선택 행(첫 행)이 열려, 사람이 짚은 것과 다른 링크가 뜬다.
    expect(press('Enter', {}, row)).toBe(true);
    expect(recordClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('행 클릭도 ↵ 와 같다 — 기록·토스트·알림·닫기', () => {
    const onClose = vi.fn();
    const onOpenLink = vi.fn();
    renderWithToaster({ data: THREE, onClose, onOpenLink });
    type('문서');

    expect(fireEvent.click(rows()[1])).toBe(true);

    expect(recordClick).toHaveBeenCalledWith('b');
    expect(screen.getByText('문서 둘 · 새 탭으로 이동')).toBeInTheDocument();
    expect(onOpenLink).toHaveBeenCalledWith('b');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('고정 링크 행도 같은 계약이다 (프로토타입은 recent 도 같은 open 을 쓴다)', () => {
    const onClose = vi.fn();
    const onOpenLink = vi.fn();
    renderWithToaster({ onClose, onOpenLink });

    fireEvent.click(rows()[0]);

    expect(recordClick).toHaveBeenCalledWith(BOOKMARKS[0].id);
    expect(screen.getByText(`${BOOKMARKS[0].title} · 새 탭으로 이동`)).toBeInTheDocument();
    expect(onOpenLink).toHaveBeenCalledWith(BOOKMARKS[0].id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('가운데 클릭도 집계한다 — 다만 팔레트는 그대로 둔다 (뒤 탭으로 열고 계속 찾는다)', () => {
    const onClose = vi.fn();
    renderWithToaster({ data: THREE, onClose });
    type('문서');

    expect(middleClick(rows()[0])).toBe(true);

    expect(recordClick).toHaveBeenCalledWith('a');
    expect(screen.getByText('문서 하나 · 새 탭으로 이동')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('우클릭은 여는 것이 아니라 세지 않는다', () => {
    renderWithToaster({ data: THREE });
    type('문서');

    rightClick(rows()[0]);

    expect(recordClick).not.toHaveBeenCalled();
  });
});

describe('결과 0건에서의 ↵ · ⌘↵ (AI 검색 자리 — 실동작은 N3)', () => {
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  it('결과가 없으면 ↵ 가 AI 검색을 부른다 — 질의를 인자로 준다 (프로토타입 `if (r) open else runAi`)', () => {
    const onAiSearch = vi.fn();
    const onClose = vi.fn();
    renderWithToaster({ onAiSearch, onClose });
    type('존재하지않는말');

    press('Enter');

    // 입력을 팔레트가 들고 있어 소비자(N3)가 알 길이 없다 — 공백을 턴 값으로 넘긴다.
    expect(onAiSearch).toHaveBeenCalledWith('존재하지않는말');
    expect(onAiSearch).toHaveBeenCalledTimes(1);
    expect(recordClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('빈 입력에서의 ↵ 도 AI 검색이다 — 고정 링크는 선택 대상이 아니다', () => {
    const onAiSearch = vi.fn();
    const onClose = vi.fn();
    renderWithToaster({ onAiSearch, onClose });
    expect(screen.getByText('고정해 둔 링크')).toBeInTheDocument();

    press('Enter');

    // 빈 질의를 막는 것은 프로토타입처럼 `runAi` 안(N3)이다 — 팔레트는 그대로 넘긴다.
    expect(onAiSearch).toHaveBeenCalledWith('');
    expect(recordClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('공백만 친 질의도 턴 값으로 넘어간다', () => {
    const onAiSearch = vi.fn();
    renderWithToaster({ onAiSearch });
    type('   ');

    press('Enter');

    expect(onAiSearch).toHaveBeenCalledWith('');
  });

  it('결과가 있어도 ⌘↵ 는 AI 검색이다 (하단 버튼의 aria-keyshortcuts 와 같은 약속)', () => {
    const onAiSearch = vi.fn();
    renderWithToaster({ data: THREE, onAiSearch });
    type('문서');

    press('Enter', { metaKey: true });

    expect(onAiSearch).toHaveBeenCalledWith('문서');
    expect(onAiSearch).toHaveBeenCalledTimes(1);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it('하단 AI 검색 버튼도 같은 질의를 넘긴다 (세 자리가 한 계약이다)', () => {
    const onAiSearch = vi.fn();
    renderWithToaster({ data: THREE, onAiSearch });
    type('문서');

    fireEvent.click(screen.getByRole('button', { name: 'AI 검색' }));

    expect(onAiSearch).toHaveBeenCalledWith('문서');
  });

  it('Ctrl+↵ 도 같다', () => {
    const onAiSearch = vi.fn();
    renderWithToaster({ data: THREE, onAiSearch });
    type('문서');

    press('Enter', { ctrlKey: true });

    expect(onAiSearch).toHaveBeenCalledTimes(1);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it('결과 행에 포커스가 있어도 ⌘↵ 는 AI 검색이다 (수식키 없는 ↵ 의 예외가 여기까지 오면 안 된다)', () => {
    const onAiSearch = vi.fn();
    const onClose = vi.fn();
    renderWithToaster({ data: THREE, onAiSearch, onClose });
    type('문서');
    const row = rows()[0];
    row.focus();

    // 막지 않으면 ⌘+클릭(= 새 탭)으로 그 링크가 열려 AI 검색이 통째로 사라진다.
    expect(press('Enter', { metaKey: true }, row)).toBe(false);
    expect(onAiSearch).toHaveBeenCalledTimes(1);
    expect(recordClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('AI 검색 버튼에 포커스가 있어도 ⌘↵ 는 그대로 AI 검색이다', () => {
    const onAiSearch = vi.fn();
    renderWithToaster({ data: THREE, onAiSearch });
    type('문서');
    const button = screen.getByRole('button', { name: 'AI 검색' });
    button.focus();

    expect(press('Enter', { metaKey: true }, button)).toBe(false);
    expect(onAiSearch).toHaveBeenCalledTimes(1);
  });

  it('AI 콜백이 없어도 터지지 않는다', () => {
    renderPalette();
    type('존재하지않는말');

    expect(() => press('Enter')).not.toThrow();
  });
});

/**
 * 키 하나짜리 단위 테스트만으로는 "⌘K 를 눌러 링크 하나를 여는 데까지" 가 이어지는지 알 수 없다.
 * PaletteHost(G5) 스위트는 ⌘K 열기와 마우스 클릭 열기를 각각 보지만 키보드로만 끝까지 가는 길은
 * 없어, 열림 상태를 쥔 작은 래퍼로 여기서 한 번 통과시킨다(PRD 성공 기준 5 의 자동화된 몫).
 */
function StatefulPalette({ data }: { data: SiteData }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <CommandPalette
        open={open}
        onOpenRequest={() => setOpen(true)}
        onClose={() => setOpen(false)}
        data={data}
      />
      <Toaster />
    </>
  );
}

describe('이어지는 시나리오 — ⌘K → 타자 → ↓ → ↵', () => {
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  it('키보드만으로 팔레트를 열어 두 번째 결과를 열고 팔레트가 닫힌다', () => {
    render(<StatefulPalette data={THREE} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    press('k', { metaKey: true }, window);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(input()).toHaveFocus();

    type('문서');
    expect(resultRows()).toHaveLength(3);

    press('ArrowDown');
    expect(selectedIndex()).toBe(1);

    press('Enter');

    expect(recordClick).toHaveBeenCalledWith('b');
    expect(screen.getByText('문서 둘 · 새 탭으로 이동')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // 문서 스크롤도 함께 풀린다 — 닫힌 화면에 잠금이 남으면 페이지가 굳는다.
    expect(document.body.style.overflow).toBe('');
  });

  it('esc 로 닫았다가 ⌘K 로 다시 열면 지난 질의가 남아 있지 않다', () => {
    // 고정 링크 줄까지 확인하려고 실시드를 쓴다 (THREE 에는 고정된 링크가 없다).
    render(<StatefulPalette data={REAL} />);
    press('k', { metaKey: true }, window);
    type('문서');

    press('Escape');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    press('k', { metaKey: true }, window);

    expect(input()).toHaveValue('');
    expect(screen.getByText('고정해 둔 링크')).toBeInTheDocument();
  });
});

describe('esc 닫기', () => {
  it('esc 를 누르면 onClose 를 부른다', () => {
    const onClose = vi.fn();
    renderPalette({ onClose });

    press('Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('기본 동작을 막는다', () => {
    renderPalette();

    expect(press('Escape')).toBe(false);
  });

  it('닫힌 뒤에는 듣지 않는다 (팔레트가 없을 때의 esc 는 남의 것이다)', () => {
    const onClose = vi.fn();
    const { rerender } = renderPalette({ onClose });
    rerender(<CommandPalette open={false} onClose={onClose} data={REAL} />);
    onClose.mockClear();

    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('문서 스크롤 잠금', () => {
  it('열려 있는 동안 문서가 스크롤되지 않는다 (뒤 화면이 따라 움직이면 안 된다)', () => {
    renderPalette();

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('닫으면 잠금을 푼다', () => {
    const { rerender } = renderPalette();
    rerender(<CommandPalette open={false} onClose={vi.fn()} data={REAL} />);

    expect(document.body.style.overflow).toBe('');
  });

  it('원래 값이 있었다면 그 값으로 되돌린다 (남의 설정을 지우지 않는다)', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = renderPalette();
    unmount();

    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});

describe('포커스 위생 — Tab 격리 · 반환', () => {
  const aiButton = () => screen.getByRole('button', { name: 'AI 검색' });

  it('마지막 요소에서 Tab 은 패널 첫 요소(입력)로 돌아온다', () => {
    renderPalette();
    aiButton().focus();

    expect(press('Tab', {}, aiButton())).toBe(false);
    expect(input()).toHaveFocus();
  });

  it('첫 요소에서 ⇧Tab 은 마지막 요소로 간다', () => {
    renderPalette();

    expect(press('Tab', { shiftKey: true })).toBe(false);
    expect(aiButton()).toHaveFocus();
  });

  it('가운데에서는 브라우저에 맡긴다 (가둠은 경계에서만 작동한다)', () => {
    renderPalette();
    const row = rows()[0];
    row.focus();

    expect(press('Tab', {}, row)).toBe(true);
    expect(row).toHaveFocus();
  });

  it('포커스가 패널 밖에 있으면 데려온다 (aria-modal 과 정합)', () => {
    renderPalette();
    (document.activeElement as HTMLElement).blur();

    expect(press('Tab', {}, document.body)).toBe(false);
    expect(input()).toHaveFocus();
  });

  it('닫히면 열기 전에 포커스가 있던 곳으로 돌려준다 (헤더 트리거)', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { rerender } = render(<CommandPalette open onClose={vi.fn()} data={REAL} />);
    expect(input()).toHaveFocus();
    rerender(<CommandPalette open={false} onClose={vi.fn()} data={REAL} />);

    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
