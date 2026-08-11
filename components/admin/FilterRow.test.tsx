/**
 * I5. 필터 줄(목록 내 검색 · 하위 칩 · 정렬 4종) — DESIGN_SPEC 6장 "필터 줄"
 * + 프로토타입 원문 실측(`docs/prototype/링크 대시보드 v2.dc.html` 367–381행 · 1095–1112행).
 *
 * 이 파일이 못박는 것: **줄이 어떻게 생겼는가**(수치·색), **칩이 무엇을 세는가**(전체 / 각 하위 /
 * 하위 미지정), 그리고 **거르기·정렬의 결과**다. 결과는 `visibleLinks` 를 통해 본다 — 실제
 * 소비자(`components/admin/LinkTable.tsx`)가 부르는 바로 그 함수이고, 그 표에 값이 닿는지는
 * `LinkTable.test.tsx` 가 따로 본다.
 *
 * 검색·칩·정렬 자체는 이미 내려온 목록만 다시 늘어놓는다. 같은 줄의 자동 favicon 유지보수 버튼은
 * 별도 server action이라 대역으로 한 번 호출·중복 제출 배선을 확인한다.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SelectedCategoryProvider,
  useSelectedCategory,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { FilterRow, LinkFilterProvider, useLinkFilter, visibleLinks } from '@/components/admin/FilterRow';
import type { AdminLink, LinkRowMap } from '@/components/admin/LinkTable';
import type { SubCategoryMap } from '@/components/admin/SubCategoryRow';
import { DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED } from '@/lib/constants';
import { fillDiscordFavicons } from '@/lib/discord-favicon-fill';
import { reconcileDiscordFaviconOrphans } from '@/lib/discord-favicon-reconcile';

vi.mock('@/lib/discord-favicon-fill', () => ({ fillDiscordFavicons: vi.fn() }));
vi.mock('@/lib/discord-favicon-reconcile', () => ({ reconcileDiscordFaviconOrphans: vi.fn() }));

const CATEGORIES: AdminCategory[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', linkCount: 5, clickTotal: 71 },
  { id: 'cat-mkt', name: '마케팅', linkCount: 1, clickTotal: 0 },
];

const SUBS: SubCategoryMap = {
  'cat-ai': [
    { id: 'sub-chat', name: '대화형', linkCount: 2 },
    { id: 'sub-img', name: '이미지 생성', linkCount: 1 },
  ],
};

/**
 * '이미지 생성' 을 지운 **직후 한 프레임** — 서버는 그 안의 링크를 상위로 올리지만
 * (`deleteSubCategory`), 새 하위 목록이 새 링크 행보다 먼저 도착할 수 있다. 그래서 이 목록에는
 * 없는 `sub-img` 를 여전히 가리키는 링크(bm-4)가 남아 있다.
 */
const SUBS_MINUS_IMG: SubCategoryMap = {
  'cat-ai': [{ id: 'sub-chat', name: '대화형', linkCount: 2 }],
};

function link(overrides: Partial<AdminLink> & Pick<AdminLink, 'id' | 'title'>): AdminLink {
  return {
    url: `https://example.test/${overrides.id}`,
    description: null,
    categoryId: 'cat-ai',
    faviconUrl: null,
    clickCount: 0,
    source: 'manual',
    ...overrides,
  };
}

/**
 * 상위 직속 2개 + 하위 소속 3개. 배열의 자리가 곧 "직접 지정한 순서"다
 * (`AdminLink` JSDoc — `sort_order` 는 따로 내려오지 않는다).
 */
const LINKS: LinkRowMap = {
  'cat-ai': [
    link({
      id: 'bm-1',
      title: 'Perplexity',
      url: 'https://www.perplexity.ai/',
      description: '검색형 AI',
      clickCount: 42,
    }),
    link({
      id: 'bm-2',
      title: 'ChatGPT',
      url: 'https://chat.openai.com/c/1',
      categoryId: 'sub-chat',
      clickCount: 7,
      source: 'discord',
    }),
    link({ id: 'bm-3', title: 'Claude', url: 'https://claude.ai', description: '글쓰기', clickCount: 3 }),
    link({ id: 'bm-4', title: '미드저니', url: 'https://midjourney.com', categoryId: 'sub-img', clickCount: 19 }),
    link({
      id: 'bm-5',
      title: 'Gemini',
      url: 'https://gemini.google.com',
      categoryId: 'sub-chat',
      source: 'discord',
    }),
  ],
  'cat-mkt': [link({ id: 'bm-9', title: 'GA4', categoryId: 'cat-mkt' })],
};

const ORDER = ['Perplexity', 'ChatGPT', 'Claude', '미드저니', 'Gemini'];

/**
 * 필터가 실제로 무엇을 남기는지 보는 자리 — 표(`LinkTable`)가 부르는 것과 **같은 함수**를 같은
 * 인자로 부른다. 표 자체를 세우면 액션 대역·토스트가 딸려 와 이 파일이 보려는 것(거르기·정렬의
 * 결과)이 그 밑에 묻힌다.
 */
function Shown({ links, subs }: { links: LinkRowMap; subs: SubCategoryMap }) {
  const { selected } = useSelectedCategory();
  const filter = useLinkFilter();
  if (selected === null) return null;

  return (
    <ul aria-label="보이는 링크">
      {/* 이름이 같은 링크끼리의 차례(동점 정렬)는 글자만으로는 볼 수 없어 id 도 함께 단다. */}
      {visibleLinks(links[selected.id] ?? [], subs[selected.id] ?? [], filter).map((item) => (
        <li key={item.id} data-id={item.id}>
          {item.title}
        </li>
      ))}
    </ul>
  );
}

/** 좌측 패널 없이 선택을 바꾸는 자리 — 줄이 선택을 **prop 이 아니라 문맥에서** 읽는지 본다. */
function SelectOther() {
  const { select } = useSelectedCategory();

  return (
    <button type="button" onClick={() => select('cat-mkt')}>
      마케팅 고르기
    </button>
  );
}

/** 같은 나무를 다시 그릴 수 있게 따로 뺀다 — 위에서 내려온 목록만 바뀌는 상황을 `rerender` 로 만든다. */
function tree(
  links: LinkRowMap,
  subs: SubCategoryMap,
  faviconProviderApproved: boolean = true,
) {
  return (
    <SelectedCategoryProvider categories={CATEGORIES}>
      <LinkFilterProvider>
        <SelectOther />
        <FilterRow
          linksByCategory={links}
          subsByCategory={subs}
          faviconProviderApproved={faviconProviderApproved}
        />
        <Shown links={links} subs={subs} />
      </LinkFilterProvider>
    </SelectedCategoryProvider>
  );
}

function renderRow(
  links: LinkRowMap = LINKS,
  subs: SubCategoryMap = SUBS,
  faviconProviderApproved: boolean = true,
) {
  return render(tree(links, subs, faviconProviderApproved));
}

const filterRow = () => screen.getByTestId('filter-row');
const search = () => screen.getByRole('textbox', { name: '이 목록에서 검색' });
const chipGroup = () => screen.getByRole('group', { name: '하위 카테고리 필터' });
const chips = () => within(chipGroup()).getAllByRole('button');
const chip = (name: string) => screen.getByRole('button', { name });
const sortSelect = () => screen.getByRole('combobox', { name: '정렬' });
const sourceGroup = () => screen.getByRole('group', { name: '등록 출처 필터' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fillDiscordFavicons).mockResolvedValue({
    ok: true,
    filled: 2,
    failed: 1,
    remaining: 3,
  });
  vi.mocked(reconcileDiscordFaviconOrphans).mockResolvedValue({
    ok: true,
    scanned: 4,
    kept: 2,
    invalid: 1,
    deleted: 1,
  });
});

/** 지금 보이는 목록 — 거르기·정렬 단언은 전부 이것을 본다. 하나도 안 남는 경우도 봐야 해서 query 다. */
function shownTitles(): Array<string | null> {
  return within(screen.getByRole('list', { name: '보이는 링크' }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent);
}

/** 이름이 겹치는 목록에서 쓰는 같은 것 — 동점끼리의 차례는 글자로는 구별되지 않는다. */
function shownIds(): Array<string | null> {
  return within(screen.getByRole('list', { name: '보이는 링크' }))
    .queryAllByRole('listitem')
    .map((item) => item.getAttribute('data-id'));
}

function type(value: string): void {
  fireEvent.change(search(), { target: { value } });
}

function sortBy(value: string): void {
  fireEvent.change(sortSelect(), { target: { value } });
}

describe('FilterRow — 줄의 모습 (프로토타입 367–381행)', () => {
  /**
   * 프로토타입은 `height:44px` 고정이지만 여기서는 **밑값**으로 적고 감싸게 둔다. 좁은 화면
   * (<820px 에서 관리자 2단이 1단으로 접힌다 — DESIGN_SPEC 1장)에서 하위 칩이 여러 줄이 되면
   * 44px 상자를 넘는데, 이 줄을 담은 상자가 `overflow-hidden` 이라(LinkAddRow) 넘친 칩이 그냥
   * 사라진다. 위아래 7px 를 주어 한 줄일 때는 정확히 44px(30 + 7 + 7)이 되게 맞췄다.
   */
  it('줄은 44px 를 밑으로 하고 좌우 16px · gap 10px · 아래 1px #e3dfd9 다', () => {
    renderRow();

    expect(filterRow()).toHaveClass(
      'flex',
      'flex-wrap',
      'items-center',
      'gap-x-[10px]',
      'gap-y-[10px]',
      'min-h-[44px]',
      'px-[16px]',
      'py-[7px]',
      'bg-card',
      'border-b',
      'border-border',
    );
  });

  it('검색 칸은 190×30px 이고 배경이 #f3f1ed 다', () => {
    renderRow();

    expect(search()).toHaveClass(
      'w-[190px]',
      'h-[30px]',
      'rounded-[6px]',
      'border',
      'border-border-strong',
      'bg-side',
      'px-[10px]',
      'text-[12px]',
    );
    expect(search()).toHaveAttribute('placeholder', '이 목록에서 검색');
  });

  it('칩 줄은 남는 자리를 다 쓰고 gap 5px 로 감싼다', () => {
    renderRow();

    expect(chipGroup()).toHaveClass('flex', 'flex-wrap', 'gap-[5px]', 'flex-1', 'min-w-0');
  });

  it('칩은 26px · 라운드 6px · 11.5px/600 이고 고른 칩만 검은 배경이다', () => {
    renderRow();

    expect(chip('전체 5')).toHaveClass(
      'h-[26px]',
      'rounded-[6px]',
      'px-[10px]',
      'text-[11.5px]',
      'font-semibold',
      'whitespace-nowrap',
      'border',
      'border-border-strong',
      'cursor-pointer',
      'bg-ink',
      'text-white',
    );
    expect(chip('대화형 2')).toHaveClass('bg-card', 'text-[#3a3833]');
  });

  it('정렬 라벨은 11px #9a9791, select 는 120×30px 다', () => {
    renderRow();

    expect(within(filterRow()).getByText('정렬')).toHaveClass('text-[11px]', 'text-fainter', 'flex-none');
    expect(sortSelect()).toHaveClass(
      'w-[120px]',
      'flex-none',
      'h-[30px]',
      'rounded-[6px]',
      'border',
      'border-border-strong',
      'bg-card',
      'px-[6px]',
      'text-[11.5px]',
    );
  });

  it('정렬은 네 가지이고 기본은 직접 지정한 순서다 (프로토타입 376–379행)', () => {
    renderRow();

    expect(within(sortSelect()).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '직접 지정한 순서',
      '하위 카테고리순',
      '클릭 많은순',
      '이름순',
    ]);
    expect(sortSelect()).toHaveValue('order');
  });

  it('출처 필터는 전체가 기본이고 자동만으로 좁힐 수 있다', () => {
    renderRow();

    const sourceButtons = within(sourceGroup()).getAllByRole('button');
    expect(sourceButtons.map((button) => button.textContent)).toEqual(['전체', '자동만']);
    expect(sourceButtons[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(sourceGroup()).getByRole('button', { name: '자동만' }));

    expect(shownTitles()).toEqual(['ChatGPT', 'Gemini']);
  });

  it('자동 파비콘 버튼은 server action을 한 번 호출한다', async () => {
    renderRow();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '자동 파비콘 채우기' }));
    });

    expect(fillDiscordFavicons).toHaveBeenCalledOnce();
  });

  it('privacy 승인 전에는 provider 버튼과 호출을 막되 reconciliation은 계속 사용할 수 있다', async () => {
    renderRow(LINKS, SUBS, false);

    const fillButton = screen.getByRole('button', { name: '자동 파비콘 채우기' });
    expect(fillButton).toBeDisabled();
    expect(fillButton).toHaveAttribute('title', DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED);
    expect(screen.getByRole('note')).toHaveTextContent(
      DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED,
    );
    expect(screen.getByRole('button', { name: '고아 객체 정리' })).toBeEnabled();

    fireEvent.click(fillButton);
    expect(fillDiscordFavicons).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '고아 객체 정리' }));
    });
    expect(reconcileDiscordFaviconOrphans).toHaveBeenCalledOnce();
  });

  it('고아 객체 정리 버튼은 24시간 reconciliation server action을 한 번 호출한다', async () => {
    renderRow();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '고아 객체 정리' }));
    });

    expect(reconcileDiscordFaviconOrphans).toHaveBeenCalledOnce();
  });

  it('고아 객체 정리 중 연속 클릭은 한 작업으로 접는다', async () => {
    let finish!: (value: {
      ok: true;
      scanned: number;
      kept: number;
      invalid: number;
      deleted: number;
    }) => void;
    vi.mocked(reconcileDiscordFaviconOrphans).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    renderRow();

    act(() => {
      const button = screen.getByRole('button', { name: '고아 객체 정리' });
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(reconcileDiscordFaviconOrphans).toHaveBeenCalledOnce();

    await act(async () => {
      finish({ ok: true, scanned: 0, kept: 0, invalid: 0, deleted: 0 });
    });
  });

  it('상위 카테고리가 하나도 없으면 줄 자체가 없다', () => {
    render(
      <SelectedCategoryProvider categories={[]}>
        <LinkFilterProvider>
          <FilterRow linksByCategory={{}} subsByCategory={{}} />
        </LinkFilterProvider>
      </SelectedCategoryProvider>,
    );

    expect(screen.queryByTestId('filter-row')).not.toBeInTheDocument();
  });
});

describe('FilterRow — 하위 칩 (프로토타입 1095–1099행)', () => {
  it('전체 → 하위들 → 하위 미지정 차례로 서고, 각자 자기 개수를 단다', () => {
    renderRow();

    // 전체 5 = 직속 2 + 하위 3. 하위 미지정 2 = 상위 직속(bm-1 · bm-3).
    expect(chips().map((item) => item.textContent)).toEqual([
      '전체 5',
      '대화형 2',
      '이미지 생성 1',
      '하위 미지정 2',
    ]);
  });

  it('처음에는 전체가 눌려 있다', () => {
    renderRow();

    expect(chip('전체 5')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('대화형 2')).toHaveAttribute('aria-pressed', 'false');
  });

  it('누른 칩 하나만 눌린 상태가 된다', () => {
    renderRow();

    fireEvent.click(chip('대화형 2'));

    expect(chip('대화형 2')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 5')).toHaveAttribute('aria-pressed', 'false');
  });

  /** 칩의 숫자는 **거르기 전** 목록을 센다 — 검색으로 줄어든 수를 얹으면 되돌아갈 곳이 사라진다. */
  it('검색어를 적어도 칩의 개수는 그대로다', () => {
    renderRow();

    type('글쓰기');

    expect(chips().map((item) => item.textContent)).toEqual([
      '전체 5',
      '대화형 2',
      '이미지 생성 1',
      '하위 미지정 2',
    ]);
  });

  /**
   * 하위가 하나도 없으면 두 칩이 같은 수를 세지만 둘 다 그린다(프로토타입 1095–1097행). 여기 쓰인
   * 목록에는 하위 소속 링크가 셋 있는데 하위 목록이 비었다 — 아래 '없어진 하위' 와 같은 상태다.
   */
  it('하위가 없는 상위에서는 전체와 하위 미지정이 같은 수를 센다', () => {
    renderRow(LINKS, {});

    expect(chips().map((item) => item.textContent)).toEqual(['전체 5', '하위 미지정 5']);
  });

  /**
   * 하위를 지우면 서버가 그 안의 링크를 상위로 올리지만(`deleteSubCategory`), 새 하위 목록이 새
   * 링크 행보다 먼저 도착할 수 있다. 그 한 프레임에서 표의 select 는 이미 `—` 를 그리므로
   * (LinkTable `subValue`) 칩도 같은 곳에 세어야 한다.
   */
  it('없어진 하위를 가리키는 링크는 하위 미지정으로 센다', () => {
    renderRow(LINKS, SUBS_MINUS_IMG);

    // '이미지 생성' 이 사라졌으므로 거기 있던 미드저니가 미지정 쪽(2 → 3)으로 온다.
    expect(chips().map((item) => item.textContent)).toEqual(['전체 5', '대화형 2', '하위 미지정 3']);
  });

  /**
   * 같은 프레임에서 **눌린 표시도** 함께 접혀야 한다. 고른 하위가 사라지면 거르기는 이미 그 링크들을
   * '하위 미지정' 으로 넘기는데(`inSubFilter`), 눌린 표시만 옛 id 를 그대로 비교하면 **아무 칩도 안
   * 눌린 채 걸러진 표만** 남는다 — 표는 줄어 있는데 무엇이 줄였는지가 화면 어디에도 없는 상태다.
   *
   * 칩을 다시 누르는 것이 아니라 **위에서 내려온 목록만** 바뀌는 상황이라 `rerender` 로 만든다.
   */
  it('고른 하위가 사라지면 눌린 표시도 하위 미지정으로 접힌다', () => {
    const { rerender } = renderRow();

    fireEvent.click(chip('이미지 생성 1'));
    expect(chip('이미지 생성 1')).toHaveAttribute('aria-pressed', 'true');

    rerender(tree(LINKS, SUBS_MINUS_IMG));

    expect(chip('하위 미지정 3')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 5')).toHaveAttribute('aria-pressed', 'false');
    // 거르기와 같은 규칙이라는 뜻 — 눌린 칩과 남은 목록이 서로를 설명한다.
    expect(shownTitles()).toEqual(['Perplexity', 'Claude', '미드저니']);
  });
});

describe('FilterRow — 거르기', () => {
  it('처음에는 목록을 그대로 보여 준다 (직접 지정한 순서)', () => {
    renderRow();

    expect(shownTitles()).toEqual(ORDER);
  });

  it('하위 칩을 누르면 그 하위 소속만 남는다', () => {
    renderRow();

    fireEvent.click(chip('대화형 2'));

    expect(shownTitles()).toEqual(['ChatGPT', 'Gemini']);
  });

  it('하위 미지정은 상위 직속만 남긴다', () => {
    renderRow();

    fireEvent.click(chip('하위 미지정 2'));

    expect(shownTitles()).toEqual(['Perplexity', 'Claude']);
  });

  it('전체로 되돌리면 다시 다 보인다', () => {
    renderRow();

    fireEvent.click(chip('이미지 생성 1'));
    expect(shownTitles()).toEqual(['미드저니']);

    fireEvent.click(chip('전체 5'));
    expect(shownTitles()).toEqual(ORDER);
  });

  it('검색은 이름 · 설명 · 주소(host)를 본다 (프로토타입 1108행)', () => {
    renderRow();

    // 이름: '미드저니'만.
    type('미드');
    expect(shownTitles()).toEqual(['미드저니']);

    // 설명: bm-3 의 '글쓰기'.
    type('글쓰기');
    expect(shownTitles()).toEqual(['Claude']);

    // 주소: 표에 적히는 host 표기(`hostOf`)를 본다 — `www.` 는 이미 떨어져 있다.
    type('perplexity.ai');
    expect(shownTitles()).toEqual(['Perplexity']);
  });

  it('대소문자를 가리지 않는다', () => {
    renderRow();

    type('MIDJOURNEY');

    expect(shownTitles()).toEqual(['미드저니']);
  });

  it('앞뒤 공백만 적은 것은 검색어가 아니다', () => {
    renderRow();

    type('   ');

    expect(shownTitles()).toEqual(ORDER);
  });

  /**
   * 프로토타입은 세 값을 **이어 붙인 한 문자열**에서 찾는다(`(b.title + b.desc + b.host)`) — 그러면
   * 이름 끝과 설명 앞에 걸친 글자가 우연히 맞는다. 여기서는 칸마다 따로 본다: 사람이 찾는 것은
   * 언제나 한 칸 안의 글자이고, 걸쳐서 맞은 행은 왜 나왔는지 화면에서 설명되지 않는다.
   */
  it('이름과 설명에 걸친 문자열은 맞지 않는다', () => {
    renderRow();

    type('perplexity검색형');

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('없어진 하위를 가리키는 링크는 하위 미지정에 함께 남는다', () => {
    renderRow(LINKS, SUBS_MINUS_IMG);

    fireEvent.click(chip('하위 미지정 3'));

    expect(shownTitles()).toEqual(['Perplexity', 'Claude', '미드저니']);
  });

  it('검색과 칩은 함께 걸린다', () => {
    renderRow();

    // 'ai' 는 host 로 셋(perplexity.ai · chat.openai.com · claude.ai)과 설명 하나에 맞는다.
    type('ai');
    expect(shownTitles()).toEqual(['Perplexity', 'ChatGPT', 'Claude']);

    fireEvent.click(chip('하위 미지정 2'));
    expect(shownTitles()).toEqual(['Perplexity', 'Claude']);
  });

  it('아무것도 맞지 않으면 빈 목록이다', () => {
    renderRow();

    type('없는링크');

    expect(shownTitles()).toEqual([]);
  });
});

/**
 * '하위 없음 맨 뒤' 만 보는 목록 — 하위 이름을 일부러 **`헬` 보다 뒤에 서는 'ㅎ' 계열**로 골랐다
 * (ㅎ+ㅔ < ㅎ+ㅕ). 프로토타입은 하위 없음을 `'헬'` 이라는 글자로 바꿔 넣어 뒤로 미뤘는데(1111행),
 * 그 수법으로 되돌리면 '협업 도구' 소속이 하위 없음보다 **뒤로** 밀린다. 위 `SUBS` 의 두 이름
 * ('대화형'·'이미지 생성')으로는 그 차이가 드러나지 않는다 — 둘 다 `헬` 보다 앞이라 센티널이 있으나
 * 없으나 결과가 같다.
 */
const H_SUBS: SubCategoryMap = {
  'cat-ai': [{ id: 'sub-collab', name: '협업 도구', linkCount: 1 }],
};
/** 하위 없음이 **먼저** 적혀 있다 — 안정 정렬만으로는 기대한 차례가 나오지 않게 두었다. */
const H_LINKS: LinkRowMap = {
  'cat-ai': [
    link({ id: 'h-1', title: '직속 링크' }),
    link({ id: 'h-2', title: '협업 링크', categoryId: 'sub-collab' }),
  ],
};

describe('FilterRow — 정렬 (프로토타입 1109–1112행)', () => {
  it('직접 지정한 순서는 서버가 준 차례 그대로다', () => {
    renderRow();

    sortBy('order');

    expect(shownTitles()).toEqual(ORDER);
  });

  it('클릭 많은순은 내림차순이다', () => {
    renderRow();

    sortBy('clicks');

    expect(shownTitles()).toEqual(['Perplexity', '미드저니', 'ChatGPT', 'Claude', 'Gemini']);
  });

  /**
   * `localeCompare(_, 'ko')` 하나로 정한다 — 한글이 라틴 문자보다 앞에 서는 것은 우리 규칙이
   * 아니라 ko 정렬(ICU)의 결과다. 손으로 다시 적으면 브라우저와 갈라진다.
   */
  it('이름순은 ko 정렬이다', () => {
    renderRow();

    sortBy('name');

    expect(shownTitles()).toEqual(['미드저니', 'ChatGPT', 'Claude', 'Gemini', 'Perplexity']);
  });

  /** 하위명 오름차순, 같은 하위 안에서는 직접 지정한 순서, **하위 없음은 맨 뒤**다. */
  it('하위 카테고리순은 하위명 오름차순이고 하위 없음이 뒤로 간다', () => {
    renderRow();

    sortBy('sub');

    expect(shownTitles()).toEqual(['ChatGPT', 'Gemini', '미드저니', 'Perplexity', 'Claude']);
  });

  /**
   * 하위 없음은 **이름 겨루기에 끼지 않는다**. 프로토타입처럼 `'헬'` 을 대신 넣어 뒤로 미루면 그
   * 글자보다 뒤에 서는 하위(여기서는 '협업 도구')가 나타나는 순간 순서가 뒤집힌다 — 있고 없음을
   * 먼저 가르는 지금 구현만 이 목록을 옳게 늘어놓는다.
   */
  it('하위 없음은 ㅎ 계열 하위보다도 뒤다 (`헬` 센티널이 아니다)', () => {
    renderRow(H_LINKS, H_SUBS);

    sortBy('sub');

    expect(shownTitles()).toEqual(['협업 링크', '직속 링크']);
  });

  it('정렬과 거르기는 함께 걸린다', () => {
    renderRow();

    fireEvent.click(chip('하위 미지정 2'));
    sortBy('clicks');

    expect(shownTitles()).toEqual(['Perplexity', 'Claude']);

    sortBy('name');
    expect(shownTitles()).toEqual(['Claude', 'Perplexity']);
  });
});

/**
 * 동점만 보는 목록 — 위 `LINKS` 로는 볼 수 없다(거기 값을 동점으로 만들면 다른 단언이 함께 흔들린다).
 *
 * | 자리 | id        | 이름      | 클릭 |
 * | ---- | --------- | --------- | ---- |
 * | 0    | tie-b     | Bravo     | 7    |
 * | 1    | tie-a     | Alfa      | 7    |
 * | 2    | tie-c     | Charlie   | 7    |
 * | 3    | same-mid  | 같은 이름 | 5    |
 * | 4    | same-low  | 같은 이름 | 1    |
 * | 5    | same-high | 같은 이름 | 9    |
 *
 * 클릭이 같은 셋의 이름도, 이름이 같은 셋의 클릭도 **적힌 차례가 오름차순도 내림차순도 아니다** —
 * 2차 키(`|| a.title.localeCompare(b.title)` 같은 것)를 어느 방향으로 덧붙여도 차례가 달라진다.
 * 하위는 아무도 없어(전부 상위 직속) 하위순에서는 여섯이 다 동점이다.
 */
const TIES: LinkRowMap = {
  'cat-ai': [
    link({ id: 'tie-b', title: 'Bravo', clickCount: 7 }),
    link({ id: 'tie-a', title: 'Alfa', clickCount: 7 }),
    link({ id: 'tie-c', title: 'Charlie', clickCount: 7 }),
    link({ id: 'same-mid', title: '같은 이름', clickCount: 5 }),
    link({ id: 'same-low', title: '같은 이름', clickCount: 1 }),
    link({ id: 'same-high', title: '같은 이름', clickCount: 9 }),
  ],
};

/**
 * 순서를 바꾸는 셋은 **동점일 때 직접 지정한 순서를 지킨다** — `Array.prototype.sort` 가 안정
 * 정렬이라(ES2019) 따로 손댈 것이 없다는 것이 `visibleLinks` 의 근거다. 그 근거가 정말 지켜지는지는
 * 동점이 있어야만 보인다: 동점이 없는 목록에서는 2차 키를 아무렇게나 덧붙여도 아무 단언도 깨지지
 * 않는다.
 *
 * 이름이 겹치므로 글자가 아니라 id 로 본다(`shownIds`).
 */
describe('FilterRow — 동점은 직접 지정한 순서를 지킨다', () => {
  it('클릭이 같으면 적힌 차례 그대로다', () => {
    renderRow(TIES, {});

    sortBy('clicks');

    // 9 → [7 · 7 · 7 은 적힌 차례] → 5 → 1.
    expect(shownIds()).toEqual(['same-high', 'tie-b', 'tie-a', 'tie-c', 'same-mid', 'same-low']);
  });

  it('이름이 같으면 적힌 차례 그대로다', () => {
    renderRow(TIES, {});

    sortBy('name');

    // ko 정렬은 한글을 앞에 세운다 — 같은 이름 셋이 적힌 차례로 먼저, 그 뒤에 Alfa·Bravo·Charlie.
    expect(shownIds()).toEqual(['same-mid', 'same-low', 'same-high', 'tie-a', 'tie-b', 'tie-c']);
  });

  it('하위가 다 같으면(여기서는 다 없음) 목록이 그대로 남는다', () => {
    renderRow(TIES, {});

    sortBy('sub');

    expect(shownIds()).toEqual(['tie-b', 'tie-a', 'tie-c', 'same-mid', 'same-low', 'same-high']);
  });
});

describe('FilterRow — 문맥', () => {
  /**
   * 되돌리는 것은 **목록을 줄이던 두 값**뿐이다. 남은 검색어·칩은 새 카테고리에서 아무것도 맞히지
   * 못해 이유가 화면 밖에 있는 빈 표를 만들지만, 정렬은 무엇도 감추지 않는 보기 취향이라 카테고리를
   * 넘어 그대로 간다(프로토타입 1101행도 하위 칩만 되돌린다).
   */
  it('다른 카테고리를 고르면 검색·칩·출처는 처음으로 돌아가고 정렬은 따라간다', () => {
    renderRow();

    type('글쓰기');
    fireEvent.click(chip('대화형 2'));
    fireEvent.click(within(sourceGroup()).getByRole('button', { name: '자동만' }));
    sortBy('clicks');

    fireEvent.click(screen.getByRole('button', { name: '마케팅 고르기' }));

    expect(search()).toHaveValue('');
    expect(chip('전체 1')).toHaveAttribute('aria-pressed', 'true');
    expect(within(sourceGroup()).getByRole('button', { name: '전체' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(sortSelect()).toHaveValue('clicks');
    expect(shownTitles()).toEqual(['GA4']);
  });

  it('provider 밖에서 쓰면 조용히 비어 있지 않고 던진다', () => {
    function Orphan() {
      useLinkFilter();

      return null;
    }

    // React 가 렌더 오류를 콘솔로도 알린다 — 테스트 출력만 조용히 시킨다(CategoryPanel 과 같은 처리).
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Orphan />)).toThrow(/LinkFilterProvider/);

    spy.mockRestore();
  });
});
