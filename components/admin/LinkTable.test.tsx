/**
 * I4. 링크 표 + 인라인 편집 + 고정 — DESIGN_SPEC 6장 "표 헤더 38px" · "행(min-height 52px …)"
 * + 프로토타입 원문 실측(`docs/prototype/링크 대시보드 v2.dc.html` 382–406행).
 *
 * 이 파일이 못박는 것: **표가 어떻게 생겼는가**(수치·색·행 구성과 order), **무엇을 서버에
 * 보내는가**(`updateBookmark`·`togglePin`·`reorderBookmarks` 의 인자), **결과를 어떻게 쓰는가**
 * (토스트·초안 유지). 액션이 무엇을 검사하고 어떤 문구를 돌려주는지는 `lib/mutations.test.ts` 가
 * 고정한다 — 여기서는 액션을 갈아 끼우고 계약만 본다.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SelectedCategoryProvider,
  useSelectedCategory,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { LinkFilterProvider, useLinkFilter } from '@/components/admin/FilterRow';
import { LinkTable, type AdminLink, type LinkRowMap } from '@/components/admin/LinkTable';
import type { SubCategoryMap } from '@/components/admin/SubCategoryRow';
import { Toaster } from '@/components/Toast';
import { reorderBookmarks, togglePin, updateBookmark } from '@/lib/mutations';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({
  createCategory: vi.fn(),
  reorderCategories: vi.fn(),
  reorderBookmarks: vi.fn(),
  togglePin: vi.fn(),
  updateBookmark: vi.fn(),
}));

const CATEGORIES: AdminCategory[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', linkCount: 3, clickTotal: 49 },
  { id: 'cat-mkt', name: '마케팅', linkCount: 1, clickTotal: 0 },
];

const SUBS: SubCategoryMap = {
  'cat-ai': [
    { id: 'sub-chat', name: '대화형', linkCount: 1 },
    { id: 'sub-img', name: '이미지 생성', linkCount: 0 },
  ],
};

const ICON_URL = 'https://cdn.example.com/perplexity.png';

function link(overrides: Partial<AdminLink> & Pick<AdminLink, 'id' | 'title'>): AdminLink {
  return {
    url: `https://example.test/${overrides.id}`,
    description: null,
    categoryId: 'cat-ai',
    faviconUrl: null,
    clickCount: 0,
    isPinned: false,
    source: 'manual',
    ...overrides,
  };
}

/** 상위 직속 2개 + 하위 소속 1개 — 표는 셋을 **한 목록**으로 그린다(정렬 대상도 이 셋 전부다). */
const LINKS: LinkRowMap = {
  'cat-ai': [
    link({
      id: 'bm-1',
      title: 'Perplexity',
      url: 'https://www.perplexity.ai/',
      description: '검색형 AI',
      faviconUrl: ICON_URL,
      clickCount: 42,
      isPinned: true,
      source: 'discord',
    }),
    // 주소가 **주소로 해석되지 않는** 한 줄이다(스킴이 없다 — `hostOf` JSDoc 의 그 예). 표가 그
    // 경우에도 주소 줄을 비우지 않는지 아래에서 본다.
    link({ id: 'bm-2', title: 'ChatGPT', url: 'chat.openai.com/c/1', categoryId: 'sub-chat', clickCount: 7 }),
    link({
      id: 'bm-3',
      title: 'Claude',
      url: 'https://claude.ai',
      description: '글쓰기',
      source: 'discord',
    }),
  ],
  'cat-mkt': [link({ id: 'bm-9', title: 'GA4', categoryId: 'cat-mkt' })],
};

/** 좌측 패널 없이 선택을 바꾸는 자리 — 표가 선택을 **prop 이 아니라 문맥에서** 읽는지 본다. */
function SelectOther() {
  const { select } = useSelectedCategory();

  return (
    <button type="button" onClick={() => select('cat-mkt')}>
      마케팅 고르기
    </button>
  );
}

/**
 * 필터 줄 대신 서는 자리 — 표가 필터를 **prop 이 아니라 문맥에서** 읽는지 본다.
 *
 * 진짜 줄(`components/admin/FilterRow.tsx`)을 세우지 않는 것은, 그쪽 칩·검색 칸이 무엇을 세고
 * 무엇에 맞는지는 그 파일의 테스트가 이미 잠갔기 때문이다. 여기서 볼 것은 **그 결과가 표에 어떻게
 * 닿는가**뿐이다.
 */
function SetFilter() {
  const { setQuery, setSubFilter, setSourceFilter, setSort } = useLinkFilter();

  return (
    <>
      <button type="button" onClick={() => setQuery('.ai')}>
        주소로 좁히기
      </button>
      <button type="button" onClick={() => setQuery('없는링크')}>
        아무것도 못 찾기
      </button>
      <button type="button" onClick={() => setSubFilter('sub-chat')}>
        대화형만 보기
      </button>
      <button type="button" onClick={() => setSort('clicks')}>
        클릭순으로 보기
      </button>
      <button type="button" onClick={() => setSort('order')}>
        지정한 순서로 보기
      </button>
      <button type="button" onClick={() => setSourceFilter('discord')}>
        자동만 보기
      </button>
    </>
  );
}

function renderTable(links: LinkRowMap = LINKS, subs: SubCategoryMap = SUBS) {
  return render(
    <SelectedCategoryProvider categories={CATEGORIES}>
      <LinkFilterProvider>
        <SelectOther />
        <SetFilter />
        <LinkTable linksByCategory={links} subsByCategory={subs} />
        <Toaster />
      </LinkFilterProvider>
    </SelectedCategoryProvider>,
  );
}

/** 필터 줄을 대신하는 버튼 하나 누르기. */
function setFilter(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

const head = () => screen.getByText('링크').parentElement as HTMLElement;
const list = () => screen.getByRole('list', { name: '링크 목록' });
const rows = () => within(list()).getAllByRole('listitem');
const titleField = (title: string) => screen.getByRole('textbox', { name: `${title} 제목` });
const row = (title: string) => titleField(title).closest('li') as HTMLElement;
const descField = (title: string) => screen.getByRole('textbox', { name: `${title} 한 줄 설명` });
const subSelect = (title: string) => screen.getByRole('combobox', { name: `${title} 하위 카테고리` });
const pinToggle = (title: string) => screen.getByRole('button', { name: `${title} 매일 고정` });

/** 액션이 프라미스를 돌려주므로 쓰기 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function flush(run: () => void) {
  await act(async () => {
    run();
  });
}

/**
 * 아직 끝나지 않은 응답 — **끝내는 손잡이를 함께 돌려준다.**
 *
 * `new Promise(() => {})` 로 영영 매달아 두면 그 요청을 감싼 트랜지션이 열린 채 남고, React 는
 * 열려 있는 비동기 액션이 있는 동안 낙관값을 걷지 않는다. 그 트랜지션은 컴포넌트를 언마운트해도
 * 닫히지 않아 **다음 테스트의 낙관값까지 걷히지 않게** 만든다(이 파일에서 실제로 겪은 오염이다 —
 * 홀로 돌리면 통과하고 함께 돌리면 실패했다). 그래서 매단 응답은 반드시 이 손잡이로 끝낸다.
 */
function pendingResult() {
  let settle!: (result: { ok: true } | { ok: false; error: string }) => void;
  const promise = new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
    settle = resolve;
  });

  return {
    promise,
    /** 매달아 둔 응답을 끝낸다 — 단언을 마친 뒤 부른다. */
    finish: async (result: { ok: true } | { ok: false; error: string } = { ok: true }) => {
      await act(async () => {
        settle(result);
      });
    },
  };
}

/** 끌어서 놓기 한 번 — jsdom 에는 DragEvent 가 없어 dataTransfer 없이 흘려보낸다. */
async function drag(sourceTitle: string, targetTitle: string) {
  fireEvent.dragStart(row(sourceTitle));
  fireEvent.dragOver(row(targetTitle));
  await flush(() => {
    fireEvent.drop(row(targetTitle));
  });
}

/** 화면에 보이는 행 순서. 정렬 단언은 전부 이것을 본다. */
function expectOrder(titles: readonly string[]) {
  const items = rows();

  expect(items).toHaveLength(titles.length);
  titles.forEach((title, index) => {
    expect(within(items[index]).getByRole('textbox', { name: `${title} 제목` })).toHaveValue(title);
  });
}

const REJECTION = new Error('요청이 닿지 않았다');
/** 요청 자체가 거부됐을 때의 문구 — `lib/constants.ts` 의 `REQUEST_FAILED` 와 같은 문장이다. */
const REQUEST_FAILED = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

setupToastTimers();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
  vi.mocked(togglePin).mockResolvedValue({ ok: true });
  vi.mocked(reorderBookmarks).mockResolvedValue({ ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('LinkTable — 표 헤더 (프로토타입 382–387행)', () => {
  it('헤더 줄은 38px · #f7f5f2 · 아래 1px #e3dfd9 다', () => {
    renderTable();

    expect(head()).toHaveClass(
      'flex',
      'items-center',
      'gap-[12px]',
      'h-[38px]',
      'px-[16px]',
      'bg-page',
      'border-b',
      'border-border',
      'text-[11px]',
      'text-desc',
    );
  });

  it('다섯 칸의 폭은 표 행과 같은 값이다', () => {
    renderTable();

    const cell = (text: string) => within(head()).getByText(text);

    expect(cell('링크')).toHaveClass('w-[250px]', 'flex-none');
    expect(cell('한 줄 설명 — 눌러서 바로 고칩니다')).toHaveClass('flex-1', 'min-w-0');
    expect(cell('하위 카테고리')).toHaveClass('w-[130px]', 'flex-none');
    expect(cell('클릭')).toHaveClass('w-[46px]', 'flex-none', 'text-right');
    // `고정`은 켜진 토글의 글자이기도 하다 — 헤더 안으로 좁혀야 헛짚지 않는다.
    expect(cell('고정')).toHaveClass('w-[56px]', 'flex-none', 'text-right');
  });

  it('선택한 카테고리의 링크만 목록에 오른다 — 하위 소속도 함께다', () => {
    renderTable();

    expectOrder(['Perplexity', 'ChatGPT', 'Claude']);
    expect(screen.queryByText('GA4')).not.toBeInTheDocument();
  });

  it('다른 카테고리를 고르면 그 목록으로 바뀐다 (prop 이 아니라 선택 문맥)', async () => {
    renderTable();

    await flush(() => {
      fireEvent.click(screen.getByRole('button', { name: '마케팅 고르기' }));
    });

    expectOrder(['GA4']);
  });

  it('카테고리는 있고 링크가 하나도 없으면 한 줄로 알린다', () => {
    renderTable({});

    expect(screen.getByText('아직 링크가 없습니다. 위 줄에서 첫 링크를 추가하세요.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '링크 목록' })).not.toBeInTheDocument();
  });
});

describe('LinkTable — 행의 모습 (프로토타입 390–406행)', () => {
  it('행은 52px 를 밑으로 하고 좁아지면 감싼다', () => {
    renderTable();

    expect(row('Perplexity')).toHaveClass(
      'flex',
      'flex-wrap',
      'items-center',
      'gap-x-[12px]',
      'gap-y-[10px]',
      'min-h-[52px]',
      'px-[16px]',
      'py-[8px]',
      'border-b',
      'border-line',
      // 호버 `#faf9f7` — 프로토타입 390행의 `style-hover` 그대로다.
      'hover:bg-toolbar',
    );
    expect(row('Perplexity')).toHaveAttribute('draggable', 'true');
  });

  it('감쌀 때의 자리는 order 로 잠근다 — 손잡이 0 · 이름 1 · 설명 2 · 하위 3 · 클릭 4 · 고정 5', () => {
    renderTable();

    const cells = within(row('Perplexity'));

    expect(cells.getByTestId('handle')).toHaveClass('order-0');
    expect(cells.getByTestId('name-cell')).toHaveClass('order-1');
    expect(descField('Perplexity').closest('form')).toHaveClass('order-2');
    expect(subSelect('Perplexity')).toHaveClass('order-3');
    expect(cells.getByTestId('clicks')).toHaveClass('order-4');
    expect(pinToggle('Perplexity')).toHaveClass('order-5');
  });

  it('손잡이는 9×12px 두 줄이다', () => {
    renderTable();

    expect(within(row('Perplexity')).getByTestId('handle')).toHaveClass(
      'w-[9px]',
      'h-[12px]',
      'flex-none',
      'border-t-2',
      'border-b-2',
      'border-dash',
      'cursor-grab',
    );
  });

  it('이름 칸은 250px — 24px 파비콘 타일 + 이름 13px/600 + 주소 10.5px', () => {
    renderTable();

    const cell = within(row('Perplexity')).getByTestId('name-cell');

    expect(cell).toHaveClass('w-[250px]', 'flex-none', 'min-w-0');
    expect(within(cell).getByTestId('favicon')).toHaveClass('w-[24px]', 'h-[24px]', 'rounded-[6px]');
    expect(within(cell).getByTestId('favicon')).toHaveStyle({ backgroundImage: `url("${ICON_URL}")` });
    expect(titleField('Perplexity')).toHaveClass('text-[13px]', 'font-semibold');
    // 주소는 `hostOf` 규칙 그대로다 — 카드 하단 줄과 같은 표기(`www.` 만 뗀다).
    expect(within(cell).getByText('perplexity.ai')).toHaveClass('text-[10.5px]', 'text-muted', 'truncate');
  });

  it('행마다 source badge를 정확히 하나 표시한다', () => {
    renderTable();

    expect(within(row('Perplexity')).getAllByTestId('source-badge')).toHaveLength(1);
    expect(within(row('Perplexity')).getByTestId('source-badge')).toHaveTextContent('자동');
    expect(within(row('ChatGPT')).getAllByTestId('source-badge')).toHaveLength(1);
    expect(within(row('ChatGPT')).getByTestId('source-badge')).toHaveTextContent('직접');
  });

  it('파비콘이 없으면 배경 이미지를 걸지 않는다 (url("null") 금지)', () => {
    renderTable();

    expect(within(row('Claude')).getByTestId('favicon').style.backgroundImage).toBe('');
  });

  /**
   * `hostOf` 의 catch 갈래다 — 주소로 해석되지 않으면(스킴이 없어 `new URL` 이 던진다) 입력을 그대로
   * 적는다. 지금 그런 값이 DB 에 들어갈 길은 없지만(`createBookmark` 가 http/https 만 받는다),
   * 그런 행이 하나 섞여도 표의 주소 줄이 **비지는 않는다**는 것이 이 단언이 지키는 것이다.
   */
  it('host 를 뽑을 수 없는 주소는 입력 그대로 적는다', () => {
    renderTable();

    expect(within(row('ChatGPT')).getByText('chat.openai.com/c/1')).toBeInTheDocument();
  });

  it('설명 칸은 240px 를 기준으로 늘어나고 그 아래로는 줄지 않는다', () => {
    renderTable();

    expect(descField('Perplexity').closest('form')).toHaveClass('flex-[1_1_240px]', 'min-w-[240px]');
    expect(descField('Perplexity')).toHaveClass('h-[32px]', 'w-full', 'text-[12.5px]', 'border-select-hover');
    expect(descField('Perplexity')).toHaveAttribute('placeholder', '설명을 직접 적으세요');
    expect(descField('Perplexity')).toHaveValue('검색형 AI');
    expect(descField('Claude')).toHaveValue('글쓰기');
    expect(descField('ChatGPT')).toHaveValue('');
  });

  it('클릭 칸은 46px 우측 정렬이고 눈 아이콘을 단다', () => {
    renderTable();

    const cell = within(row('Perplexity')).getByTestId('clicks');

    expect(cell).toHaveClass('w-[46px]', 'flex-none', 'justify-end', 'text-[11.5px]', 'font-semibold');
    expect(cell).toHaveTextContent('42');
    expect(cell.querySelector('svg')).not.toBeNull();
  });

  it('고정 토글은 56×26px 알약이다 — 켜짐은 검은 배경 `고정`, 꺼짐은 흰 배경 `☆`', () => {
    renderTable();

    // 손가락 커서는 프로토타입 406행 원문이다. 이 버튼은 잠기지 않으므로 `disabled:` 짝은 없다.
    expect(pinToggle('Perplexity')).toHaveClass('cursor-pointer');
    expect(pinToggle('Perplexity')).toHaveClass('w-[56px]', 'h-[26px]', 'rounded-[13px]', 'bg-ink', 'text-white', 'border-ink');
    expect(pinToggle('Perplexity')).toHaveTextContent('고정');
    expect(pinToggle('Perplexity')).toHaveAttribute('aria-pressed', 'true');

    expect(pinToggle('Claude')).toHaveClass('bg-card', 'text-ghost', 'border-border-strong');
    expect(pinToggle('Claude')).toHaveTextContent('☆');
    expect(pinToggle('Claude')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('LinkTable — 제목 인라인 편집', () => {
  it('120자 제한 입력을 떠날 때 바뀐 제목만 보낸다', async () => {
    renderTable();

    expect(titleField('Claude')).toHaveAttribute('maxlength', '120');
    fireEvent.change(titleField('Claude'), { target: { value: 'Claude 문서' } });
    await flush(() => {
      fireEvent.blur(titleField('Claude'));
    });

    expect(updateBookmark).toHaveBeenCalledWith('bm-3', { title: 'Claude 문서' });
  });

  it('저장 실패 뒤에도 관리자가 적은 draft를 유지한다', async () => {
    vi.mocked(updateBookmark).mockResolvedValue({ ok: false, error: '이름을 입력하세요.' });
    renderTable();

    fireEvent.change(titleField('Claude'), { target: { value: '고치던 제목' } });
    await flush(() => {
      fireEvent.blur(titleField('Claude'));
    });

    expect(titleField('Claude')).toHaveValue('고치던 제목');
    expect(screen.getByRole('status')).toHaveTextContent('이름을 입력하세요.');
  });
});

describe('LinkTable — 설명 인라인 편집', () => {
  it('칸을 떠날 때 바뀐 설명만 보낸다', async () => {
    renderTable();

    fireEvent.change(descField('Claude'), { target: { value: '긴 글을 쓰는 AI' } });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });

    expect(updateBookmark).toHaveBeenCalledWith('bm-3', { description: '긴 글을 쓰는 AI' });
    expect(screen.getByRole('status')).toHaveTextContent('Claude 설명 저장됨');
  });

  it('Enter 로도 저장된다 (폼의 암묵적 제출 — IME 판정은 브라우저에 맡긴다)', async () => {
    renderTable();

    fireEvent.change(descField('Claude'), { target: { value: '새 설명' } });
    await flush(() => {
      fireEvent.submit(descField('Claude').closest('form') as HTMLFormElement);
    });

    expect(updateBookmark).toHaveBeenCalledWith('bm-3', { description: '새 설명' });
  });

  it('고치지 않고 떠나면 서버까지 가지 않는다', async () => {
    renderTable();

    await flush(() => {
      fireEvent.blur(descField('Perplexity'));
    });

    expect(updateBookmark).not.toHaveBeenCalled();
  });

  it('비우면 빈 값을 보낸다 — 설명을 지우는 길이다', async () => {
    renderTable();

    fireEvent.change(descField('Perplexity'), { target: { value: '   ' } });
    await flush(() => {
      fireEvent.blur(descField('Perplexity'));
    });

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { description: '' });
  });

  it('저장한 값으로 다시 떠나도 두 번 보내지 않는다', async () => {
    renderTable();

    fireEvent.change(descField('Claude'), { target: { value: '새 설명' } });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });

    expect(updateBookmark).toHaveBeenCalledTimes(1);
  });

  it('같은 틱에 제출이 둘이면 한 번만 나간다 (ref 빗장)', async () => {
    const save = pendingResult();
    vi.mocked(updateBookmark).mockReturnValue(save.promise);
    renderTable();

    const form = descField('Claude').closest('form') as HTMLFormElement;
    fireEvent.change(descField('Claude'), { target: { value: '새 설명' } });
    await flush(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(updateBookmark).toHaveBeenCalledTimes(1);
    await save.finish();
  });

  it('거절당하면 서버 문구를 그대로 알리고 적은 것은 지우지 않는다', async () => {
    vi.mocked(updateBookmark).mockResolvedValue({ ok: false, error: '링크를 찾을 수 없습니다.' });
    renderTable();

    fireEvent.change(descField('Claude'), { target: { value: '새 설명' } });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });

    expect(screen.getByRole('status')).toHaveTextContent('링크를 찾을 수 없습니다.');
    expect(descField('Claude')).toHaveValue('새 설명');
  });

  it('요청 자체가 거부되면 다시 시도할 수 있게 두고 한 줄로 알린다', async () => {
    vi.mocked(updateBookmark).mockRejectedValue(REJECTION);
    renderTable();

    fireEvent.change(descField('Claude'), { target: { value: '새 설명' } });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });

    expect(console.error).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(REQUEST_FAILED);

    // 빗장이 풀려 있어야 한다 — 다시 떠나면 한 번 더 나간다.
    vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });

    expect(updateBookmark).toHaveBeenCalledTimes(2);
  });

  /**
   * 왕복 중에 더 적고 떠나면 그 blur 가 부른 저장을 `savingDescRef` 가 버린다 — 방금 적은 글자는
   * 초안에만 남고(초안은 새 prop 이 와도 덮이지 않는다) 다시 나갈 길이 없다. 그래서 나가 있는
   * 동안에는 값을 잠근다.
   *
   * `disabled` 가 아니라 `readOnly` 인 것은 포커스 때문이다 — disabled 가 된 요소에서 브라우저는
   * 포커스를 body 로 떨어뜨려 적던 사람이 자리를 잃는다(J2 `InlineEdit` 과 같은 짝).
   */
  it('저장이 나가 있는 동안 값은 잠기되 `readOnly` 다 — disabled 였다면 포커스가 body 로 떨어진다', async () => {
    const save = pendingResult();
    vi.mocked(updateBookmark).mockReturnValue(save.promise);
    renderTable();

    fireEvent.change(descField('Claude'), { target: { value: '새 설명' } });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });

    expect(descField('Claude')).toHaveAttribute('readonly');
    expect(descField('Claude')).not.toBeDisabled();

    await save.finish();
    expect(descField('Claude')).not.toHaveAttribute('readonly');
  });

  it('나가 있는 동안임을 aria-busy 로도 알린다', async () => {
    const save = pendingResult();
    vi.mocked(updateBookmark).mockReturnValue(save.promise);
    renderTable();

    expect(descField('Claude')).toHaveAttribute('aria-busy', 'false');

    fireEvent.change(descField('Claude'), { target: { value: '새 설명' } });
    await flush(() => {
      fireEvent.blur(descField('Claude'));
    });

    expect(descField('Claude')).toHaveAttribute('aria-busy', 'true');

    await save.finish();
    expect(descField('Claude')).toHaveAttribute('aria-busy', 'false');
  });
});

describe('LinkTable — 하위 카테고리 지정', () => {
  it('옵션은 `—` + 선택한 상위의 하위들이다', () => {
    renderTable();

    const options = within(subSelect('Perplexity')).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual(['—', '대화형', '이미지 생성']);
    expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual(['', 'sub-chat', 'sub-img']);
  });

  it('하위에 속한 링크는 그 하위가, 상위 직속은 `—` 가 골라져 있다', () => {
    renderTable();

    expect(subSelect('ChatGPT')).toHaveValue('sub-chat');
    expect(subSelect('Perplexity')).toHaveValue('');
  });

  it('하위를 고르면 그 하위로 옮긴다', async () => {
    renderTable();

    await flush(() => {
      fireEvent.change(subSelect('Perplexity'), { target: { value: 'sub-img' } });
    });

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { categoryId: 'sub-img' });
    expect(screen.getByRole('status')).toHaveTextContent('Perplexity → 이미지 생성');
  });

  it('`—` 를 고르면 상위 직속으로 되돌린다 (categoryId 는 비울 수 없다)', async () => {
    renderTable();

    await flush(() => {
      fireEvent.change(subSelect('ChatGPT'), { target: { value: '' } });
    });

    expect(updateBookmark).toHaveBeenCalledWith('bm-2', { categoryId: 'cat-ai' });
    expect(screen.getByRole('status')).toHaveTextContent('ChatGPT → AI 도구 모음');
  });

  /**
   * 값이 어느 option 과도 맞지 않으면 브라우저는 **아무것도 고르지 않은** 빈 칸을 보여 준다
   * (`selectedIndex === -1`). 그 상태의 `value` 도 빈 문자열이라 값만 보는 단언은 접었는지
   * 아닌지를 구분하지 못한다 — 그래서 몇 번째가 골라졌는지를 본다.
   */
  it('지워진 하위를 가리키던 값은 `—` 로 접힌다 (하위 삭제 후 revalidate)', () => {
    renderTable(LINKS, { 'cat-ai': [{ id: 'sub-img', name: '이미지 생성', linkCount: 0 }] });

    expect((subSelect('ChatGPT') as HTMLSelectElement).selectedIndex).toBe(0);
    expect(subSelect('ChatGPT')).toHaveValue('');
  });

  /**
   * 값이 prop 에서만 온다면 React 는 다시 그릴 때 고른 값을 **되돌려 놓는다** — 사람은 옮겼는데
   * 칸은 옛 하위를 가리키는 구간이 서버 왕복 내내 이어진다. 저장이 끝나기 전에도 고른 것을
   * 그대로 보여야 한다(좌측 패널의 낙관 순서와 같은 계약).
   */
  it('저장이 끝나기 전에도 고른 하위를 그대로 보여 준다', async () => {
    const move = pendingResult();
    vi.mocked(updateBookmark).mockReturnValue(move.promise);
    renderTable();

    await flush(() => {
      fireEvent.change(subSelect('Perplexity'), { target: { value: 'sub-img' } });
    });

    expect(subSelect('Perplexity')).toHaveValue('sub-img');

    // 요청이 끝나면 낙관값은 걷힌다 — 제품에서는 이때 서버가 옮겨진 행을 함께 실어 보낸다(정렬 쪽
    // '저장이 끝나기 전에도 새 순서를 보여 준다' 와 같은 계약이다).
    await move.finish();
    expect(subSelect('Perplexity')).toHaveValue('');
  });

  /** select 는 **잠그지 않는다**(잠기면 키보드로 고른 사람이 튕겨 나간다) — 대신 상태만 알린다. */
  it('옮기는 중임을 aria-busy 로 알리되 잠그지는 않는다', async () => {
    const move = pendingResult();
    vi.mocked(updateBookmark).mockReturnValue(move.promise);
    renderTable();

    expect(subSelect('Perplexity')).toHaveAttribute('aria-busy', 'false');

    await flush(() => {
      fireEvent.change(subSelect('Perplexity'), { target: { value: 'sub-img' } });
    });

    expect(subSelect('Perplexity')).toHaveAttribute('aria-busy', 'true');
    expect(subSelect('Perplexity')).not.toBeDisabled();

    await move.finish();
    expect(subSelect('Perplexity')).toHaveAttribute('aria-busy', 'false');
  });

  it('거절당하면 고른 값을 걷고 원래 하위로 돌아간다', async () => {
    vi.mocked(updateBookmark).mockResolvedValue({ ok: false, error: '카테고리를 찾을 수 없습니다.' });
    renderTable();

    await flush(() => {
      fireEvent.change(subSelect('ChatGPT'), { target: { value: 'sub-img' } });
    });
    // 트랜지션이 닫히며 낙관값이 걷힌다 — 서버가 거절했으니 옛 하위가 다시 이긴다.
    expect(subSelect('ChatGPT')).toHaveValue('sub-chat');
  });

  it('같은 틱에 두 번 골라도 한 번만 나간다 (ref 빗장)', async () => {
    const move = pendingResult();
    vi.mocked(updateBookmark).mockReturnValue(move.promise);
    renderTable();

    await flush(() => {
      fireEvent.change(subSelect('Perplexity'), { target: { value: 'sub-img' } });
      fireEvent.change(subSelect('Perplexity'), { target: { value: 'sub-chat' } });
    });

    expect(updateBookmark).toHaveBeenCalledTimes(1);
    await move.finish();
  });

  it('거절당하면 서버 문구를 그대로 알린다', async () => {
    vi.mocked(updateBookmark).mockResolvedValue({ ok: false, error: '카테고리를 찾을 수 없습니다.' });
    renderTable();

    await flush(() => {
      fireEvent.change(subSelect('Perplexity'), { target: { value: 'sub-img' } });
    });

    expect(screen.getByRole('status')).toHaveTextContent('카테고리를 찾을 수 없습니다.');
  });

  it('요청 자체가 거부되면 한 줄로 알린다', async () => {
    vi.mocked(updateBookmark).mockRejectedValue(REJECTION);
    renderTable();

    await flush(() => {
      fireEvent.change(subSelect('Perplexity'), { target: { value: 'sub-img' } });
    });

    expect(console.error).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(REQUEST_FAILED);
  });
});

describe('LinkTable — 매일 고정', () => {
  it('토글은 링크 id 하나만 보낸다 (켜고 끄는 판정은 서버가 한다)', async () => {
    renderTable();

    await flush(() => {
      fireEvent.click(pinToggle('Claude'));
    });

    expect(togglePin).toHaveBeenCalledWith('bm-3');
    expect(screen.getByRole('status')).toHaveTextContent('Claude 매일 보는 곳에 고정');
  });

  it('이미 고정된 링크를 누르면 해제라고 알린다', async () => {
    renderTable();

    await flush(() => {
      fireEvent.click(pinToggle('Perplexity'));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Perplexity 고정 해제');
  });

  /**
   * **13번째는 화면이 미리 세지 않는다.** 상한 판정은 DB 트리거 하나가 갖고(lib/mutations.ts
   * `togglePin`), 화면이 한 벌 더 세면 두 창에서 동시에 누를 때 조용히 갈라진다.
   */
  it('12개가 이미 고정돼 있어도 요청은 그대로 나가고, 막는 것은 서버 문구다', async () => {
    const full: LinkRowMap = {
      'cat-ai': [
        ...Array.from({ length: 12 }, (_unused, index) =>
          link({ id: `pin-${index}`, title: `고정 ${index}`, isPinned: true }),
        ),
        link({ id: 'bm-13', title: '열세 번째' }),
      ],
    };
    vi.mocked(togglePin).mockResolvedValue({ ok: false, error: '매일 고정은 최대 12개입니다.' });
    renderTable(full);

    await flush(() => {
      fireEvent.click(pinToggle('열세 번째'));
    });

    expect(togglePin).toHaveBeenCalledWith('bm-13');
    expect(screen.getByRole('status')).toHaveTextContent('매일 고정은 최대 12개입니다.');
  });

  it('같은 틱에 두 번 눌러도 한 번만 나간다 (ref 빗장)', async () => {
    const pin = pendingResult();
    vi.mocked(togglePin).mockReturnValue(pin.promise);
    renderTable();

    await flush(() => {
      fireEvent.click(pinToggle('Claude'));
      fireEvent.click(pinToggle('Claude'));
    });

    expect(togglePin).toHaveBeenCalledTimes(1);
    await pin.finish();
  });

  /** 버튼도 잠그지 않는다(누른 버튼이 잠기면 포커스가 문서로 튕긴다) — 상태만 알린다. */
  it('누른 뒤 나가 있는 동안임을 aria-busy 로 알리되 잠그지는 않는다', async () => {
    const pin = pendingResult();
    vi.mocked(togglePin).mockReturnValue(pin.promise);
    renderTable();

    expect(pinToggle('Claude')).toHaveAttribute('aria-busy', 'false');

    await flush(() => {
      fireEvent.click(pinToggle('Claude'));
    });

    expect(pinToggle('Claude')).toHaveAttribute('aria-busy', 'true');
    expect(pinToggle('Claude')).not.toBeDisabled();

    await pin.finish();
    expect(pinToggle('Claude')).toHaveAttribute('aria-busy', 'false');
  });

  it('요청 자체가 거부되면 한 줄로 알리고 빗장을 푼다', async () => {
    vi.mocked(togglePin).mockRejectedValue(REJECTION);
    renderTable();

    await flush(() => {
      fireEvent.click(pinToggle('Claude'));
    });

    expect(console.error).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(REQUEST_FAILED);

    vi.mocked(togglePin).mockResolvedValue({ ok: true });
    await flush(() => {
      fireEvent.click(pinToggle('Claude'));
    });

    expect(togglePin).toHaveBeenCalledTimes(2);
  });
});

describe('LinkTable — 드래그 정렬', () => {
  /**
   * `reorderBookmarks` 는 받은 id 배열의 자리를 그대로 `sort_order` 로 쓴다(전역 재부여).
   * **그 카테고리 목록 전체**를 보내지 않으면 안 보낸 링크들이 뒤로 밀려 뒤섞인다.
   */
  it('그 카테고리의 목록 전체를 새 순서로 보낸다 — 하위 소속 링크도 함께다', async () => {
    renderTable();

    await drag('Claude', 'Perplexity');

    expect(reorderBookmarks).toHaveBeenCalledWith(['bm-3', 'bm-1', 'bm-2']);
  });

  it('앞 행을 뒤로 끌면 그 자리를 차지한다', async () => {
    renderTable();

    await drag('Perplexity', 'Claude');

    expect(reorderBookmarks).toHaveBeenCalledWith(['bm-2', 'bm-3', 'bm-1']);
  });

  it('저장이 끝나기 전에도 새 순서를 보여 준다', async () => {
    const order = pendingResult();
    vi.mocked(reorderBookmarks).mockReturnValue(order.promise);
    renderTable();

    await drag('Claude', 'Perplexity');

    expectOrder(['Claude', 'Perplexity', 'ChatGPT']);

    // 요청이 끝나면 낙관 순서는 걷힌다 — 제품에서는 이때 서버가 새 순서를 함께 실어 보낸다.
    await order.finish();
    expectOrder(['Perplexity', 'ChatGPT', 'Claude']);
  });

  it('제자리에 놓으면 아무 일도 하지 않는다', async () => {
    renderTable();

    await drag('Claude', 'Claude');

    expect(reorderBookmarks).not.toHaveBeenCalled();
  });

  it('끌기 시작이 없던 drop 은 무시한다 (바깥에서 끌어 온 것)', async () => {
    renderTable();

    await flush(() => {
      fireEvent.drop(row('Claude'));
    });

    expect(reorderBookmarks).not.toHaveBeenCalled();
  });

  it('dragEnd 로 끝난 드래그는 빗장을 비워 뒤이은 drop 이 먹지 않는다', async () => {
    renderTable();

    fireEvent.dragStart(row('Claude'));
    fireEvent.dragEnd(row('Claude'));
    await flush(() => {
      fireEvent.drop(row('Perplexity'));
    });

    expect(reorderBookmarks).not.toHaveBeenCalled();
  });

  it('앞선 정렬이 아직 가 있으면 두 번째 드롭은 버린다', async () => {
    const order = pendingResult();
    vi.mocked(reorderBookmarks).mockReturnValue(order.promise);
    renderTable();

    await drag('Claude', 'Perplexity');
    await drag('ChatGPT', 'Perplexity');

    expect(reorderBookmarks).toHaveBeenCalledTimes(1);
    await order.finish();
  });

  /**
   * **그리는 목록과 보내는 목록은 다르다.** 화면에는 걸러진 일부만 보이지만, `reorderBookmarks` 는
   * 받은 id 배열의 자리를 그대로 `sort_order` 로 쓴다(전역 재부여) — 일부만 보내면 보낸 것들이
   * 0..k 로 앞당겨져 안 보낸 링크들과 뒤섞인다.
   */
  it('걸러 놓고 끌어도 보내는 것은 걸러지지 않은 목록 전체다', async () => {
    renderTable();

    setFilter('주소로 좁히기');
    expectOrder(['Perplexity', 'Claude']);

    await drag('Claude', 'Perplexity');

    // 화면에서 사라져 있던 ChatGPT(bm-2)도 payload에는 함께 실리되 자기 slot(가운데)을 지킨다.
    expect(reorderBookmarks).toHaveBeenCalledWith(['bm-3', 'bm-2', 'bm-1']);
  });

  it('자동만 필터에서 끌어도 숨은 manual 행의 slot을 보존한다', async () => {
    renderTable();

    setFilter('자동만 보기');
    expectOrder(['Perplexity', 'Claude']);
    await drag('Claude', 'Perplexity');

    expect(reorderBookmarks).toHaveBeenCalledWith(['bm-3', 'bm-2', 'bm-1']);
  });

  it('걸러진 화면에도 새 순서가 곧바로 보인다', async () => {
    const order = pendingResult();
    vi.mocked(reorderBookmarks).mockReturnValue(order.promise);
    renderTable();

    setFilter('주소로 좁히기');
    await drag('Claude', 'Perplexity');

    expectOrder(['Claude', 'Perplexity']);
    await order.finish();
  });

  it('거절당하면 서버 문구를 그대로 알린다', async () => {
    vi.mocked(reorderBookmarks).mockResolvedValue({
      ok: false,
      error: '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    });
    renderTable();

    await drag('Claude', 'Perplexity');

    expect(screen.getByRole('status')).toHaveTextContent('순서를 저장하지 못했습니다.');
  });

  it('요청 자체가 거부돼도 관리 화면이 오류 화면으로 바뀌지 않는다', async () => {
    vi.mocked(reorderBookmarks).mockRejectedValue(REJECTION);
    renderTable();

    await drag('Claude', 'Perplexity');

    expect(console.error).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(REQUEST_FAILED);
    expect(list()).toBeInTheDocument();
  });
});

/**
 * I5 — 필터 줄이 정한 것을 표가 어떻게 쓰는가. 무엇이 걸러지고 어떻게 늘어서는지(검색 규칙·정렬
 * 4종)는 `components/admin/FilterRow.test.tsx` 가 잠근다.
 */
describe('LinkTable — 필터·정렬을 따르는 목록', () => {
  it('고른 하위만 남기고, 그 사이 행의 내용은 그대로다', () => {
    renderTable();

    setFilter('대화형만 보기');

    expectOrder(['ChatGPT']);
    expect(subSelect('ChatGPT')).toHaveValue('sub-chat');
  });

  it('정렬을 바꾸면 그 차례로 그린다', () => {
    renderTable();

    setFilter('클릭순으로 보기');

    expectOrder(['Perplexity', 'ChatGPT', 'Claude']);
  });

  /**
   * 링크는 있는데 걸러 낸 결과가 비었다 — 표 헤더만 남으면 고장으로 보인다. "아직 링크가 없습니다"
   * 는 이 자리에서 **거짓말**이라(링크는 있다) 다른 문장으로 나간다.
   */
  it('맞는 링크가 하나도 없으면 추가하라고 하지 않고 조건을 지우라고 한다', () => {
    renderTable();

    setFilter('아무것도 못 찾기');

    expect(screen.queryByRole('list', { name: '링크 목록' })).not.toBeInTheDocument();
    expect(
      screen.getByText('조건에 맞는 링크가 없습니다. 검색어·하위·출처 필터를 조정해 보세요.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/아직 링크가 없습니다/)).not.toBeInTheDocument();
  });

  /**
   * **직접 지정한 순서가 아닌 동안에는 끌 수 없다.**
   *
   * 화면에 보이는 차례(클릭순·이름순·하위순)와 저장되는 차례(`sort_order`)가 서로 다른데, 그
   * 상태에서 끌어다 놓으면 사람은 보이는 차례를 바꿨다고 믿고 저장되는 것은 전혀 다른 결과가 된다
   * (놓은 자리가 보이는 목록에서는 2번이어도 실제 목록에서는 5번일 수 있다). 되돌릴 방법도 화면에
   * 없다 — 오케스트레이터 결정으로 이 상태의 드래그는 아예 받지 않는다.
   */
  it('직접 지정한 순서가 아니면 행을 끌 수 없다', () => {
    renderTable();

    setFilter('클릭순으로 보기');

    expect(row('Perplexity')).toHaveAttribute('draggable', 'false');
  });

  it('직접 지정한 순서가 아니면 손잡이도 집을 수 있는 모습이 아니다', () => {
    renderTable();

    expect(within(row('Perplexity')).getByTestId('handle')).toHaveClass('cursor-grab');

    setFilter('클릭순으로 보기');

    const handle = within(row('Perplexity')).getByTestId('handle');
    expect(handle).toHaveClass('cursor-default', 'opacity-40');
    expect(handle).not.toHaveClass('cursor-grab');
  });

  /** `draggable=false` 로도 브라우저는 드래그를 시작하지 않지만, 바깥에서 끌어 온 drop 은 남는다. */
  it('직접 지정한 순서가 아니면 드롭이 들어와도 아무것도 보내지 않는다', async () => {
    renderTable();

    setFilter('클릭순으로 보기');
    await drag('Claude', 'Perplexity');

    expect(reorderBookmarks).not.toHaveBeenCalled();
  });

  it('직접 지정한 순서로 되돌리면 다시 끌 수 있다', async () => {
    renderTable();

    setFilter('클릭순으로 보기');
    setFilter('지정한 순서로 보기');

    expect(row('Perplexity')).toHaveAttribute('draggable', 'true');

    await drag('Claude', 'Perplexity');

    expect(reorderBookmarks).toHaveBeenCalledWith(['bm-3', 'bm-1', 'bm-2']);
  });
});
