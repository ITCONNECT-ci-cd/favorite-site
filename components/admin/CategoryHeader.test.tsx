/**
 * I1. 우측 헤더 패널 — DESIGN_SPEC 6장 "헤더 패널: 카테고리 이름 16px/700 + 링크 수 +
 * '이름 수정' / '카테고리 삭제'" + 프로토타입 원문 실측(324–337행).
 *
 * 여기서 못박는 것은 **줄의 모습**과 **세 갈래 상태**(보기 · 이름 수정 · 삭제 확인), 그리고
 * 서버 액션에 무엇을 넘기고 결과를 어떻게 쓰는지다. 액션이 무엇을 검사하고 어떤 문구를
 * 돌려주는지는 `lib/mutations.test.ts` 가 고정한다.
 */
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoryHeader } from '@/components/admin/CategoryHeader';
import {
  CategoryPanel,
  SelectedCategoryProvider,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { Toaster } from '@/components/Toast';
import { deleteCategory, renameCategory } from '@/lib/mutations';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({
  createCategory: vi.fn(),
  reorderCategories: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

const ROWS: AdminCategory[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', linkCount: 118, clickTotal: 1240 },
  { id: 'cat-dev', name: '개발 도구', linkCount: 21, clickTotal: 87 },
];

function headerTree(categories: readonly AdminCategory[], children?: ReactNode) {
  return (
    <SelectedCategoryProvider categories={categories}>
      <CategoryHeader>{children}</CategoryHeader>
      <Toaster />
    </SelectedCategoryProvider>
  );
}

function renderHeader(categories: readonly AdminCategory[] = ROWS, children?: ReactNode) {
  return render(headerTree(categories, children));
}

const panel = () => screen.getByRole('region', { name: '선택한 카테고리' });
const nameField = () => screen.getByRole('textbox', { name: '카테고리 이름' });
const button = (name: string) => screen.getByRole('button', { name });
const renameForm = () => nameField().closest('form') as HTMLFormElement;

/** 액션이 **거부로 끝나는** 상황 — 네트워크 단절·배포로 액션 id 가 바뀐 경우. */
const REJECTION = new Error('Failed to fetch');
/** 거부 경로가 남기는 진단 로그(사용자 문구가 아니다) — 테스트 출력만 조용히 시킨다. */
function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

/** 액션이 프라미스를 돌려주므로 저장·삭제 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** 이름 수정을 열고 새 이름을 적어 둔 상태로 만든다. */
async function startRename(value: string) {
  await click(button('이름 수정'));
  fireEvent.change(nameField(), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renameCategory).mockResolvedValue({ ok: true });
  vi.mocked(deleteCategory).mockResolvedValue({ ok: true });
});

describe('CategoryHeader — 보기 줄 (프로토타입 331–336행)', () => {
  it('선택한 카테고리 이름과 링크 수를 낸다', () => {
    renderHeader();

    expect(screen.getByText('AI 도구 모음')).toHaveClass('text-[16px]', 'font-bold');
    expect(screen.getByText('118개 링크')).toBeInTheDocument();
  });

  it('패널 상자는 흰 배경 · 1px 테두리 · 라운드 9px 이고 아래 14px 을 띄운다', () => {
    renderHeader();

    expect(panel()).toHaveClass(
      'bg-card',
      'border',
      'border-border',
      'rounded-[9px]',
      'overflow-hidden',
      'mb-[14px]',
    );
  });

  it('카테고리가 하나도 없으면 이름 자리에 안내를 낸다', () => {
    renderHeader([]);

    expect(screen.getByText('카테고리가 없습니다. ‘상위 카테고리’에서 먼저 추가하세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이름 수정' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '카테고리 삭제' })).not.toBeInTheDocument();
  });
});

describe('CategoryHeader — 이름 인라인 수정', () => {
  setupToastTimers();

  it('이름 수정을 누르면 그 자리에 입력·저장·취소가 들어선다', async () => {
    renderHeader();

    await click(button('이름 수정'));

    expect(nameField()).toHaveValue('AI 도구 모음');
    expect(nameField()).toHaveClass('w-[240px]', 'h-[34px]', 'border-[1.5px]', 'border-ink');
    expect(button('저장')).toBeInTheDocument();
    expect(button('저장')).toHaveClass('cursor-pointer', 'disabled:cursor-default');
    expect(button('취소')).toBeInTheDocument();
    // 편집 중에는 삭제 자리가 사라진다 — 고치던 이름과 지우려는 대상이 섞이지 않게.
    expect(screen.queryByRole('button', { name: '카테고리 삭제' })).not.toBeInTheDocument();
  });

  it('저장하면 선택한 카테고리 id 와 새 이름을 넘긴다', async () => {
    renderHeader();

    await startRename('  AI 도구  ');
    await click(button('저장'));

    expect(renameCategory).toHaveBeenCalledWith('cat-ai', 'AI 도구');
  });

  it('성공하면 보기 줄로 돌아가며 프로토타입 문구로 알린다', async () => {
    renderHeader();

    await startRename('AI 도구');
    await click(button('저장'));

    expect(screen.queryByRole('textbox', { name: '카테고리 이름' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('AI 도구 모음 → AI 도구으로 바꿈');
  });

  it('이름이 그대로면 서버까지 가지 않고 닫힌다', async () => {
    renderHeader();

    await startRename('  AI 도구 모음  ');
    await click(button('저장'));

    expect(renameCategory).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '카테고리 이름' })).not.toBeInTheDocument();
  });

  it('실패하면 문구를 그대로 띄우고 고치던 이름을 그대로 둔다', async () => {
    vi.mocked(renameCategory).mockResolvedValue({
      ok: false,
      error: '같은 이름의 카테고리가 이미 있습니다.',
    });
    renderHeader();

    await startRename('개발 도구');
    await click(button('저장'));

    expect(screen.getByRole('status')).toHaveTextContent('같은 이름의 카테고리가 이미 있습니다.');
    expect(nameField()).toHaveValue('개발 도구');
  });

  it('취소하면 아무것도 보내지 않고 보기 줄로 돌아간다', async () => {
    renderHeader();

    await startRename('버릴 이름');
    await click(button('취소'));

    expect(renameCategory).not.toHaveBeenCalled();
    expect(screen.getByText('AI 도구 모음')).toBeInTheDocument();
  });

  it('Esc 로도 취소된다', async () => {
    renderHeader();

    await startRename('버릴 이름');
    await act(async () => {
      fireEvent.keyDown(nameField(), { key: 'Escape' });
    });

    expect(renameCategory).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '카테고리 이름' })).not.toBeInTheDocument();
  });

  it('같은 틱에 제출이 두 번 들어와도 요청은 한 번만 나간다', async () => {
    // `disabled` 는 다시 그려진 뒤에야 걸리므로 같은 틱의 두 번째 제출을 막지 못한다
    // (Enter 를 튕기는 키보드). 빗장이 ref 여야 여기서 걸린다.
    vi.mocked(renameCategory).mockReturnValue(new Promise(() => {}));
    renderHeader();

    await startRename('AI 도구');
    await act(async () => {
      fireEvent.submit(renameForm());
      fireEvent.submit(renameForm());
    });

    expect(renameCategory).toHaveBeenCalledTimes(1);
  });

  it('요청 자체가 거부되면 잠금을 풀고 재시도 문구를 띄운다', async () => {
    const spy = silenceConsoleError();
    vi.mocked(renameCategory).mockRejectedValue(REJECTION);
    renderHeader();

    await startRename('AI 도구');
    await click(button('저장'));

    expect(screen.getByRole('status')).toHaveTextContent(
      '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
    // 잠긴 채 남으면 저장·취소·Esc 가 전부 막혀 새로고침 말고는 나갈 길이 없다.
    expect(button('저장')).toBeEnabled();
    expect(nameField()).toHaveValue('AI 도구');

    // 빗장(ref)도 함께 풀렸는지 — 같은 자리에서 곧바로 다시 낼 수 있어야 한다.
    vi.mocked(renameCategory).mockResolvedValue({ ok: true });
    await click(button('저장'));
    expect(renameCategory).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('CategoryHeader — 카테고리 삭제', () => {
  setupToastTimers();

  it('삭제를 눌러도 곧바로 지우지 않고 확인을 먼저 받는다', async () => {
    renderHeader();

    await click(button('카테고리 삭제'));

    expect(deleteCategory).not.toHaveBeenCalled();
    // "지우려면 비워라" 규칙(lib/mutations.ts deleteCategory)을 확인 문구가 미리 알려 준다.
    expect(screen.getByText('비어 있는 카테고리만 삭제됩니다. 삭제할까요?')).toBeInTheDocument();
    expect(button('삭제')).toBeInTheDocument();
  });

  it('확인하면 선택한 카테고리 id 로 지운다', async () => {
    renderHeader();

    await click(button('카테고리 삭제'));
    await click(button('삭제'));

    expect(deleteCategory).toHaveBeenCalledWith('cat-ai');
    expect(screen.getByRole('status')).toHaveTextContent('AI 도구 모음 카테고리 삭제됨');
  });

  it('하위가 남아 거절당하면 그 문구를 그대로 알린다', async () => {
    vi.mocked(deleteCategory).mockResolvedValue({
      ok: false,
      error: '하위 카테고리를 먼저 삭제하세요.',
    });
    renderHeader();

    await click(button('카테고리 삭제'));
    await click(button('삭제'));

    expect(screen.getByRole('status')).toHaveTextContent('하위 카테고리를 먼저 삭제하세요.');
    // 확인 줄은 걷는다 — 같은 상태로 다시 누르게 두면 같은 거절만 반복된다.
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
  });

  it('링크가 남아 거절당하면 그 문구를 그대로 알린다', async () => {
    vi.mocked(deleteCategory).mockResolvedValue({
      ok: false,
      error: '이 카테고리에 링크가 남아 있습니다. 링크를 옮기거나 삭제한 뒤 다시 시도하세요.',
    });
    renderHeader();

    await click(button('카테고리 삭제'));
    await click(button('삭제'));

    expect(screen.getByRole('status')).toHaveTextContent('이 카테고리에 링크가 남아 있습니다.');
  });

  it('확인 줄에서 취소하면 아무 일도 일어나지 않는다', async () => {
    renderHeader();

    await click(button('카테고리 삭제'));
    await click(button('취소'));

    expect(deleteCategory).not.toHaveBeenCalled();
    expect(button('카테고리 삭제')).toBeInTheDocument();
  });

  it('같은 틱에 두 번 눌러도 삭제 요청은 한 번만 나간다', async () => {
    // 두 번째 요청은 "카테고리를 찾을 수 없습니다."로 돌아와, 지워 놓고 실패를 말하는 화면이 된다.
    vi.mocked(deleteCategory).mockReturnValue(new Promise(() => {}));
    renderHeader();

    await click(button('카테고리 삭제'));
    const confirmButton = button('삭제');
    await act(async () => {
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
    });

    expect(deleteCategory).toHaveBeenCalledTimes(1);
  });

  it('요청 자체가 거부되면 확인 줄을 열어 둔 채 재시도 문구를 띄운다', async () => {
    const spy = silenceConsoleError();
    vi.mocked(deleteCategory).mockRejectedValue(REJECTION);
    renderHeader();

    await click(button('카테고리 삭제'));
    await click(button('삭제'));

    expect(screen.getByRole('status')).toHaveTextContent(
      '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
    // 서버가 판단한 결과가 아니라 닿지도 않은 요청이라, 같은 자리에서 그대로 다시 누를 수 있어야 한다.
    expect(button('삭제')).toBeEnabled();

    vi.mocked(deleteCategory).mockResolvedValue({ ok: true });
    await click(button('삭제'));
    expect(deleteCategory).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('CategoryHeader — 포커스가 가는 자리', () => {
  setupToastTimers();

  it('이름 수정을 열면 입력이 포커스를 받는다', async () => {
    renderHeader();

    await click(button('이름 수정'));

    // 방금 사라진 '이름 수정' 버튼에 포커스가 남으면 키보드 사용자는 갈 곳을 잃는다.
    expect(nameField()).toHaveFocus();
  });

  it('취소하면 포커스가 이름 수정 버튼으로 돌아온다', async () => {
    renderHeader();

    await click(button('이름 수정'));
    await click(button('취소'));

    expect(button('이름 수정')).toHaveFocus();
  });

  it('Esc 로 닫아도 포커스가 이름 수정 버튼으로 돌아온다', async () => {
    renderHeader();

    await click(button('이름 수정'));
    await act(async () => {
      fireEvent.keyDown(nameField(), { key: 'Escape' });
    });

    expect(button('이름 수정')).toHaveFocus();
  });

  it('저장에 성공해 닫혀도 포커스가 이름 수정 버튼으로 돌아온다', async () => {
    renderHeader();

    await startRename('AI 도구');
    await click(button('저장'));

    expect(button('이름 수정')).toHaveFocus();
  });

  it('삭제 확인을 열면 포커스는 삭제가 아니라 취소로 간다', async () => {
    renderHeader();

    await click(button('카테고리 삭제'));

    // 되돌릴 수 없는 동작을 묻는 자리라 기본 포커스는 덜 위험한 쪽이다(WAI-ARIA APG
    // alertdialog · J3 DeleteConfirm 과 같은 판단) — 여기서 Enter 가 곧 삭제면 확인을 둔 뜻이 없다.
    expect(button('취소')).toHaveFocus();
  });

  it('확인 줄에서 취소하면 포커스가 카테고리 삭제 버튼으로 돌아온다', async () => {
    renderHeader();

    await click(button('카테고리 삭제'));
    await click(button('취소'));

    expect(button('카테고리 삭제')).toHaveFocus();
  });

  it('삭제가 거절돼 확인 줄이 걷혀도 포커스가 카테고리 삭제 버튼으로 돌아온다', async () => {
    vi.mocked(deleteCategory).mockResolvedValue({
      ok: false,
      error: '하위 카테고리를 먼저 삭제하세요.',
    });
    renderHeader();

    await click(button('카테고리 삭제'));
    await click(button('삭제'));

    expect(button('카테고리 삭제')).toHaveFocus();
  });

  it('삭제한 카테고리가 목록에서 빠져도 포커스 되돌리기가 터지지 않는다', async () => {
    // 성공 경로에서는 이 줄이 통째로 사라진다(revalidatePath 로 새 목록이 온다). 사라진 노드에
    // focus() 를 부르지 않도록 `isConnected` 를 본다 — 안 보면 떨어져 나간 버튼을 부른다.
    const { rerender } = renderHeader([ROWS[0]]);

    await click(button('카테고리 삭제'));
    await click(button('삭제'));
    await act(async () => {
      rerender(headerTree([]));
    });

    expect(
      screen.getByText('카테고리가 없습니다. ‘상위 카테고리’에서 먼저 추가하세요.'),
    ).toBeInTheDocument();
  });

  it('선택이 바뀌어 줄이 다시 마운트돼도 포커스를 가져오지 않는다', async () => {
    render(
      <SelectedCategoryProvider categories={ROWS}>
        <CategoryPanel totalLinkCount={139} />
        <CategoryHeader />
      </SelectedCategoryProvider>,
    );

    const target = screen.getByRole('button', { name: /개발 도구/ });
    target.focus();
    await click(target);

    // 마운트마다 포커스를 잡으면 좌측에서 카테고리를 고를 때마다 포커스가 헤더로 끌려간다.
    expect(target).toHaveFocus();
  });
});

describe('CategoryHeader — 아래에 붙는 줄들 (I2·I3·I4 자리)', () => {
  it('children 은 헤더 줄 아래 같은 상자 안에 들어간다', () => {
    renderHeader(ROWS, <p>하위 줄</p>);

    const rows = panel().children;
    expect(rows).toHaveLength(2);
    expect(within(panel()).getByText('하위 줄')).toBe(rows[1]);
  });

  it('아래에 붙는 줄이 있을 때만 헤더 줄에 구분선이 생긴다', () => {
    const { unmount } = renderHeader(ROWS, <p>하위 줄</p>);
    expect(panel().firstElementChild).toHaveClass('border-b', 'border-line');

    unmount();
    renderHeader();
    expect(panel().firstElementChild).not.toHaveClass('border-b');
  });

  /**
   * "아래 줄이 있다"의 기준은 **React 가 실제로 무언가를 그리는가**다(J1b LinkCard `hasEditSlot`).
   * `undefined` 만 걸러 내면 아래 세 값이 전부 검사를 통과해, 상자 테두리 바로 안쪽에 아무것도
   * 나누지 않는 선이 하나 더 그어진다.
   */
  function expectNoDivider(children: ReactNode) {
    const { unmount } = renderHeader(ROWS, children);

    expect(panel().firstElementChild).not.toHaveClass('border-b');
    expect(panel().children).toHaveLength(1);

    unmount();
  }

  it('조건이 거짓일 때 넘어오는 false 는 아래 줄로 치지 않는다 (`{cond && <Row/>}`)', () => {
    expectNoDivider(false);
  });

  it('null 도 아래 줄로 치지 않는다', () => {
    expectNoDivider(null);
  });

  it('빈 문자열도 아래 줄로 치지 않는다', () => {
    expectNoDivider('');
  });

  it('카테고리가 없으면 안내 문구만 남기고 아래 줄은 그리지 않는다', () => {
    // 아래 줄들이 다루는 대상이 없고(하위 줄은 그 상황에서 스스로 null 을 돌려준다 — I2),
    // 안내 문구 줄은 구분선을 갖지 않으므로 무언가 붙으면 선 없이 맞붙은 두 줄이 된다.
    renderHeader([], <p>하위 줄</p>);

    expect(screen.queryByText('하위 줄')).not.toBeInTheDocument();
    expect(panel().children).toHaveLength(1);
  });

  it('글자 버튼들도 손가락 커서를 쓰고 잠긴 동안에는 되돌린다 (프로토타입 334–335행)', () => {
    // Tailwind v4 preflight 에는 버튼 커서 규칙이 없어 적지 않으면 화살표로 남는다.
    renderHeader();

    expect(button('이름 수정')).toHaveClass('cursor-pointer', 'disabled:cursor-default');
    expect(button('카테고리 삭제')).toHaveClass('cursor-pointer', 'disabled:cursor-default');
  });
});

describe('CategoryHeader — 좌측 패널과 함께 (선택 연동)', () => {
  it('선택이 바뀌면 그 카테고리를 보여 준다', async () => {
    render(
      <SelectedCategoryProvider categories={ROWS}>
        <CategoryPanel totalLinkCount={139} />
        <CategoryHeader />
      </SelectedCategoryProvider>,
    );

    expect(within(panel()).getByText('118개 링크')).toBeInTheDocument();

    await click(screen.getByRole('button', { name: /개발 도구/ }));

    expect(within(panel()).getByText('21개 링크')).toBeInTheDocument();
  });

  it('고치던 이름은 다른 카테고리로 옮겨 가지 않는다', async () => {
    render(
      <SelectedCategoryProvider categories={ROWS}>
        <CategoryPanel totalLinkCount={139} />
        <CategoryHeader />
      </SelectedCategoryProvider>,
    );

    await startRename('버릴 이름');
    await click(screen.getByRole('button', { name: /개발 도구/ }));

    // 편집 상태가 새 선택으로 새어 나가면 '개발 도구' 자리에 '버릴 이름'이 들어앉는다.
    expect(screen.queryByRole('textbox', { name: '카테고리 이름' })).not.toBeInTheDocument();
    expect(within(panel()).getByText('개발 도구')).toBeInTheDocument();
  });
});
