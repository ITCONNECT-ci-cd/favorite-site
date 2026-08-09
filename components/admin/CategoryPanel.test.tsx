/**
 * I1. 좌측 상위 카테고리 패널 — DESIGN_SPEC 6장 "카테고리 · 링크 (2단)" + 프로토타입 원문 실측
 * (`docs/prototype/링크 대시보드 v2.dc.html` 302–321행).
 *
 * 이 파일이 못박는 것: **패널이 어떻게 생겼는가**(수치·색·행 구성), **무엇을 서버에 보내는가**
 * (createCategory · reorderCategories 의 인자), **결과를 어떻게 쓰는가**(토스트·입력 비우기).
 * 액션이 무엇을 검사하고 어떤 문구를 돌려주는지는 `lib/mutations.test.ts` 가 고정한다 —
 * 여기서는 액션을 갈아 끼우고 계약만 본다.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CategoryPanel,
  SelectedCategoryProvider,
  useSelectedCategory,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { Toaster } from '@/components/Toast';
import { createCategory, reorderCategories } from '@/lib/mutations';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({ createCategory: vi.fn(), reorderCategories: vi.fn() }));

const ROWS: AdminCategory[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', linkCount: 118, clickTotal: 1240 },
  { id: 'cat-dev', name: '개발 도구', linkCount: 21, clickTotal: 87 },
  { id: 'cat-mkt', name: '마케팅', linkCount: 9, clickTotal: 0 },
];

function panelTree(categories: readonly AdminCategory[], totalLinkCount: number) {
  return (
    <SelectedCategoryProvider categories={categories}>
      <CategoryPanel totalLinkCount={totalLinkCount} />
      <Toaster />
    </SelectedCategoryProvider>
  );
}

function renderPanel(categories: readonly AdminCategory[] = ROWS, totalLinkCount = 290) {
  return render(panelTree(categories, totalLinkCount));
}

const panel = () => screen.getByRole('region', { name: '상위 카테고리' });
const list = () => within(panel()).getByRole('list');
const rows = () => within(list()).getAllByRole('button');
const row = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const nameField = () => screen.getByRole('textbox', { name: '새 카테고리' });
const addButton = () => screen.getByRole('button', { name: '추가' });

/** 화면에 보이는 행 순서. 정렬 단언은 전부 이것을 본다. */
function expectOrder(names: readonly string[]) {
  const buttons = rows();

  expect(buttons).toHaveLength(names.length);
  names.forEach((name, index) => {
    expect(buttons[index]).toHaveTextContent(name);
  });
}

/** 액션이 프라미스를 돌려주므로 추가·정렬 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/**
 * 행 하나를 끌어 다른 행 위에 놓는다 — 브라우저가 보내는 세 이벤트를 그대로 쏜다.
 *
 * jsdom 에는 DragEvent 가 없어 `dataTransfer` 가 실리지 않는다. 컴포넌트가 끌고 있는 행을
 * dataTransfer 가 아니라 자기 ref 로 기억하므로(프로토타입 `_drag` 와 같은 방식) 대역을
 * 흉내 내지 않아도 된다.
 */
async function dragOnto(sourceName: string, targetName: string) {
  fireEvent.dragStart(row(sourceName));
  fireEvent.dragOver(row(targetName));
  await act(async () => {
    fireEvent.drop(row(targetName));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCategory).mockResolvedValue({ ok: true });
  vi.mocked(reorderCategories).mockResolvedValue({ ok: true });
});

describe('CategoryPanel — 머리말과 추가 줄 (프로토타입 302–310행)', () => {
  it('제목과 총계를 한 줄로 낸다', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: '상위 카테고리' })).toBeInTheDocument();
    // 프로토타입 `catTotalLabel` — 상위 카테고리 수와 **전체** 링크 수다(패널 행 합계가 아니다).
    expect(screen.getByText('3개 카테고리 · 링크 290개')).toBeInTheDocument();
  });

  it('2단에서 270px 을 차지하고, 좁은 화면에서는 폭을 다 쓴다 (DESIGN_SPEC 6장 · 1장 브레이크포인트)', () => {
    renderPanel();

    expect(panel()).toHaveClass('w-full', 'min-[820px]:w-[270px]', 'min-[820px]:flex-none');
  });

  it('입력은 34px · 라운드 7px, 추가 버튼은 검은 34px 이다', () => {
    renderPanel();

    expect(nameField()).toHaveClass(
      'h-[34px]',
      'rounded-[7px]',
      'border-border-strong',
      'text-[12.5px]',
    );
    expect(nameField()).toHaveAttribute('placeholder', '새 카테고리');
    expect(addButton()).toHaveClass('h-[34px]', 'rounded-[7px]', 'bg-ink', 'text-white', 'text-[12px]');
  });
});

describe('CategoryPanel — 목록 (프로토타입 311–320행)', () => {
  it('받은 순서 그대로, 행마다 이름·링크 수·클릭 합계를 낸다', () => {
    renderPanel();

    expectOrder(['AI 도구 모음', '개발 도구', '마케팅']);

    const first = row('AI 도구 모음');
    expect(within(first).getByText('118개')).toBeInTheDocument();
    expect(within(first).getByText('1240회')).toBeInTheDocument();
  });

  it('행은 46px · 좌우 14px · gap 9px · 아래 구분선이다', () => {
    renderPanel();

    expect(row('개발 도구')).toHaveClass('h-[46px]', 'px-[14px]', 'gap-[9px]', 'border-b', 'border-line');
  });

  it('목록 상자는 흰 배경 · 1px 테두리 · 라운드 9px 이다', () => {
    renderPanel();

    expect(list()).toHaveClass('bg-card', 'border', 'border-border', 'rounded-[9px]', 'overflow-hidden');
  });

  it('카테고리가 하나도 없으면 빈 상자 대신 한 줄로 알린다', () => {
    renderPanel([], 0);

    expect(within(panel()).queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText('아직 카테고리가 없습니다.')).toBeInTheDocument();
  });
});

describe('CategoryPanel — 선택 (프로토타입 catSel)', () => {
  it('처음에는 첫 카테고리가 선택돼 있다', () => {
    renderPanel();

    expect(row('AI 도구 모음')).toHaveAttribute('aria-current', 'true');
    expect(row('개발 도구')).not.toHaveAttribute('aria-current');
  });

  it('선택 행만 다크 배경 + 흰 글자다', () => {
    renderPanel();

    const selected = row('AI 도구 모음');
    expect(selected).toHaveClass('bg-ink');
    expect(within(selected).getByText('AI 도구 모음')).toHaveClass('text-white');

    const plain = row('마케팅');
    expect(plain).not.toHaveClass('bg-ink');
    expect(within(plain).getByText('마케팅')).not.toHaveClass('text-white');
  });

  it('행을 누르면 선택이 그 행으로 옮겨 간다', async () => {
    renderPanel();

    await click(row('마케팅'));

    expect(row('마케팅')).toHaveAttribute('aria-current', 'true');
    expect(row('AI 도구 모음')).not.toHaveAttribute('aria-current');
  });

  it('선택한 카테고리가 사라지면 첫 카테고리로 되돌아간다', async () => {
    const { rerender } = renderPanel();

    await click(row('마케팅'));
    expect(row('마케팅')).toHaveAttribute('aria-current', 'true');

    // 삭제 뒤 서버가 새 목록을 내려보낸 상황(revalidatePath).
    rerender(panelTree(ROWS.slice(0, 2), 281));

    expect(row('AI 도구 모음')).toHaveAttribute('aria-current', 'true');
  });
});

describe('CategoryPanel — 카테고리 추가', () => {
  setupToastTimers();

  it('이름을 적고 추가를 누르면 createCategory 를 부른다', async () => {
    renderPanel();

    fireEvent.change(nameField(), { target: { value: '  리서치  ' } });
    await click(addButton());

    // 다듬기는 액션도 하지만(asText), 화면이 먼저 다듬어야 "빈 입력" 판정이 같은 기준이 된다.
    expect(createCategory).toHaveBeenCalledWith('리서치');
  });

  it('성공하면 입력을 비우고 프로토타입 문구로 알린다', async () => {
    renderPanel();

    fireEvent.change(nameField(), { target: { value: '리서치' } });
    await click(addButton());

    expect(nameField()).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('리서치 카테고리 추가됨');
  });

  it('실패하면 액션의 문구를 그대로 띄우고 적어 둔 이름을 지우지 않는다', async () => {
    vi.mocked(createCategory).mockResolvedValue({
      ok: false,
      error: '같은 이름의 카테고리가 이미 있습니다.',
    });
    renderPanel();

    fireEvent.change(nameField(), { target: { value: '마케팅' } });
    await click(addButton());

    expect(screen.getByRole('status')).toHaveTextContent('같은 이름의 카테고리가 이미 있습니다.');
    expect(nameField()).toHaveValue('마케팅');
  });

  it('빈 입력으로는 서버까지 가지 않는다 (프로토타입 `if (!n) return`)', async () => {
    renderPanel();

    fireEvent.change(nameField(), { target: { value: '   ' } });
    await click(addButton());

    expect(createCategory).not.toHaveBeenCalled();
  });

  it('요청이 끝날 때까지 추가 버튼을 잠근다 — 같은 이름이 두 번 들어가지 않게', async () => {
    let finish!: () => void;
    vi.mocked(createCategory).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ ok: true });
      }),
    );
    renderPanel();

    fireEvent.change(nameField(), { target: { value: '리서치' } });
    await click(addButton());

    expect(addButton()).toBeDisabled();

    await act(async () => {
      finish();
    });
    expect(addButton()).toBeEnabled();
  });
});

describe('CategoryPanel — 드래그 정렬 (DESIGN_SPEC 6장 "draggable 로 순서 변경")', () => {
  setupToastTimers();

  it('행은 draggable 이다', () => {
    renderPanel();

    expect(row('마케팅')).toHaveAttribute('draggable', 'true');
  });

  it('끌어 놓은 순서를 상위 id 목록으로 통째로 보낸다', async () => {
    renderPanel();

    await dragOnto('마케팅', 'AI 도구 모음');

    // 뒤 행을 앞 행 위에 놓으면 그 자리를 차지한다(프로토타입 dropOn).
    // 상위 id 만 실린다 — 하위가 섞이면 서버가 거부한다(lib/mutations.ts reorderCategories).
    expect(reorderCategories).toHaveBeenCalledWith(['cat-mkt', 'cat-ai', 'cat-dev']);
  });

  it('앞 행을 뒤로 끌면 그 행 뒤에 붙는다', async () => {
    renderPanel();

    await dragOnto('AI 도구 모음', '개발 도구');

    expect(reorderCategories).toHaveBeenCalledWith(['cat-dev', 'cat-ai', 'cat-mkt']);
  });

  it('제자리에 놓으면 아무것도 보내지 않는다', async () => {
    renderPanel();

    await dragOnto('개발 도구', '개발 도구');

    expect(reorderCategories).not.toHaveBeenCalled();
  });

  it('저장이 끝나기 전에도 새 순서를 보여 준다 (낙관적 표시)', async () => {
    let finish!: () => void;
    vi.mocked(reorderCategories).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ ok: true });
      }),
    );
    renderPanel();

    await dragOnto('마케팅', 'AI 도구 모음');
    expectOrder(['마케팅', 'AI 도구 모음', '개발 도구']);

    // 요청이 끝나면 낙관적 순서는 걷힌다 — 제품에서는 이때 서버가 새 순서를 함께 실어 보낸다
    // (revalidatePath). 여기서는 props 가 그대로라 원래 순서로 돌아오는 것이 정상이다.
    await act(async () => {
      finish();
    });
    expectOrder(['AI 도구 모음', '개발 도구', '마케팅']);
  });

  it('저장에 실패하면 액션의 문구를 그대로 띄운다', async () => {
    vi.mocked(reorderCategories).mockResolvedValue({
      ok: false,
      error: '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    });
    renderPanel();

    await dragOnto('마케팅', 'AI 도구 모음');

    expect(screen.getByRole('status')).toHaveTextContent('순서를 저장하지 못했습니다.');
  });
});

describe('useSelectedCategory — I2·I3·I4 가 쓰는 통로', () => {
  function Probe() {
    const { selected, categories } = useSelectedCategory();

    return <p>{`${selected?.name ?? '없음'} / ${categories.length}`}</p>;
  }

  it('선택된 카테고리와 전체 목록을 함께 준다', () => {
    render(
      <SelectedCategoryProvider categories={ROWS}>
        <Probe />
      </SelectedCategoryProvider>,
    );

    expect(screen.getByText('AI 도구 모음 / 3')).toBeInTheDocument();
  });

  it('provider 밖에서 부르면 조용히 넘어가지 않고 터진다', () => {
    // React 가 렌더 오류를 콘솔로도 알린다 — 테스트 출력만 조용히 시킨다.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/SelectedCategoryProvider/);

    spy.mockRestore();
  });

  it('provider 는 children 을 감싸는 DOM 을 만들지 않는다 — 2단 배치는 화면 몫이다', () => {
    const { container } = render(
      <SelectedCategoryProvider categories={ROWS}>
        <p>왼쪽</p>
        <p>오른쪽</p>
      </SelectedCategoryProvider>,
    );

    expect(container.children).toHaveLength(2);
  });
});
