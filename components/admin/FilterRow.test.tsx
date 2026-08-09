/**
 * I5. 필터 줄(목록 내 검색 · 하위 칩 · 정렬 4종) — DESIGN_SPEC 6장 "필터 줄"
 * + 프로토타입 원문 실측(`docs/prototype/링크 대시보드 v2.dc.html` 367–381행 · 1095–1112행).
 *
 * 이 파일이 못박는 것: **줄이 어떻게 생겼는가**(수치·색), **칩이 무엇을 세는가**(전체 / 각 하위 /
 * 하위 미지정), 그리고 **거르기·정렬의 결과**다. 결과는 `visibleLinks` 를 통해 본다 — 실제
 * 소비자(`components/admin/LinkTable.tsx`)가 부르는 바로 그 함수이고, 그 표에 값이 닿는지는
 * `LinkTable.test.tsx` 가 따로 본다.
 *
 * 서버 왕복이 없다 — 검색·칩·정렬은 이미 내려온 목록을 다시 늘어놓을 뿐이라 액션을 부르지
 * 않는다. 그래서 이 파일에는 `lib/mutations` 대역도, 토스트도, 빗장도 없다.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SelectedCategoryProvider,
  useSelectedCategory,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { FilterRow, LinkFilterProvider, useLinkFilter, visibleLinks } from '@/components/admin/FilterRow';
import type { AdminLink, LinkRowMap } from '@/components/admin/LinkTable';
import type { SubCategoryMap } from '@/components/admin/SubCategoryRow';

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

function link(overrides: Partial<AdminLink> & Pick<AdminLink, 'id' | 'title'>): AdminLink {
  return {
    url: `https://example.test/${overrides.id}`,
    description: null,
    categoryId: 'cat-ai',
    faviconUrl: null,
    clickCount: 0,
    isPinned: false,
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
    link({ id: 'bm-2', title: 'ChatGPT', url: 'https://chat.openai.com/c/1', categoryId: 'sub-chat', clickCount: 7 }),
    link({ id: 'bm-3', title: 'Claude', url: 'https://claude.ai', description: '글쓰기', clickCount: 3 }),
    link({ id: 'bm-4', title: '미드저니', url: 'https://midjourney.com', categoryId: 'sub-img', clickCount: 19 }),
    link({ id: 'bm-5', title: 'Gemini', url: 'https://gemini.google.com', categoryId: 'sub-chat' }),
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
      {visibleLinks(links[selected.id] ?? [], subs[selected.id] ?? [], filter).map((item) => (
        <li key={item.id}>{item.title}</li>
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

function renderRow(links: LinkRowMap = LINKS, subs: SubCategoryMap = SUBS) {
  return render(
    <SelectedCategoryProvider categories={CATEGORIES}>
      <LinkFilterProvider>
        <SelectOther />
        <FilterRow linksByCategory={links} subsByCategory={subs} />
        <Shown links={links} subs={subs} />
      </LinkFilterProvider>
    </SelectedCategoryProvider>,
  );
}

const filterRow = () => screen.getByTestId('filter-row');
const search = () => screen.getByRole('textbox', { name: '이 목록에서 검색' });
const chipGroup = () => screen.getByRole('group', { name: '하위 카테고리 필터' });
const chips = () => within(chipGroup()).getAllByRole('button');
const chip = (name: string) => screen.getByRole('button', { name });
const sortSelect = () => screen.getByRole('combobox', { name: '정렬' });

/** 지금 보이는 목록 — 거르기·정렬 단언은 전부 이것을 본다. 하나도 안 남는 경우도 봐야 해서 query 다. */
function shownTitles(): Array<string | null> {
  return within(screen.getByRole('list', { name: '보이는 링크' }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent);
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
    renderRow(LINKS, { 'cat-ai': [{ id: 'sub-chat', name: '대화형', linkCount: 2 }] });

    // '이미지 생성' 이 사라졌으므로 거기 있던 미드저니가 미지정 쪽(2 → 3)으로 온다.
    expect(chips().map((item) => item.textContent)).toEqual(['전체 5', '대화형 2', '하위 미지정 3']);
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
    renderRow(LINKS, { 'cat-ai': [{ id: 'sub-chat', name: '대화형', linkCount: 2 }] });

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

  it('정렬과 거르기는 함께 걸린다', () => {
    renderRow();

    fireEvent.click(chip('하위 미지정 2'));
    sortBy('clicks');

    expect(shownTitles()).toEqual(['Perplexity', 'Claude']);

    sortBy('name');
    expect(shownTitles()).toEqual(['Claude', 'Perplexity']);
  });
});

describe('FilterRow — 문맥', () => {
  it('다른 카테고리를 고르면 검색·칩·정렬이 처음으로 돌아간다', () => {
    renderRow();

    type('글쓰기');
    fireEvent.click(chip('대화형 2'));
    sortBy('clicks');

    fireEvent.click(screen.getByRole('button', { name: '마케팅 고르기' }));

    expect(search()).toHaveValue('');
    expect(sortSelect()).toHaveValue('order');
    expect(chip('전체 1')).toHaveAttribute('aria-pressed', 'true');
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
