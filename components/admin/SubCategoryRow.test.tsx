/**
 * I2. 하위 카테고리 줄 — DESIGN_SPEC 6장 "하위 줄(배경 `#faf9f7`): '하위' 라벨 + 하위 칩
 * (이름·개수·수정·×) + 추가 입력 + 추가 버튼" + 프로토타입 원문 실측(338–356행).
 *
 * 여기서 못박는 것은 **줄의 모습**, **칩의 세 갈래**(보기 · 이름 수정 · 삭제 확인), 그리고
 * 서버 액션에 무엇을 넘기고 결과를 어떻게 쓰는지다. 액션이 무엇을 검사하고 어떤 문구를
 * 돌려주는지(깊이 차단 · 링크 상위 재배속)는 `lib/mutations.test.ts` 가 고정한다 — 이 파일은
 * **UI 쪽 절반**만 본다.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CategoryPanel,
  SelectedCategoryProvider,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { SubCategoryRow, type SubCategoryMap } from '@/components/admin/SubCategoryRow';
import { Toaster } from '@/components/Toast';
import { createSubCategory, deleteSubCategory, renameSubCategory } from '@/lib/mutations';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mutations')>()),
  createSubCategory: vi.fn(),
  renameSubCategory: vi.fn(),
  deleteSubCategory: vi.fn(),
}));

const ROWS: AdminCategory[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', linkCount: 118, clickTotal: 1240 },
  { id: 'cat-dev', name: '개발 도구', linkCount: 21, clickTotal: 87 },
];

const SUBS: SubCategoryMap = {
  'cat-ai': [
    { id: 'sub-chat', name: '대화형', linkCount: 3 },
    { id: 'sub-img', name: '이미지 생성', linkCount: 0 },
  ],
  'cat-dev': [{ id: 'sub-ide', name: '에디터', linkCount: 5 }],
};

function renderRow(categories: readonly AdminCategory[] = ROWS, subs: SubCategoryMap = SUBS) {
  return render(
    <SelectedCategoryProvider categories={categories}>
      <SubCategoryRow subsByCategory={subs} />
      <Toaster />
    </SelectedCategoryProvider>,
  );
}

/** 좌측 패널과 함께 — 선택이 오가는 것을 보는 묶음에서만 쓴다. */
function renderWithPanel(subs: SubCategoryMap = SUBS) {
  return render(
    <SelectedCategoryProvider categories={ROWS}>
      <CategoryPanel totalLinkCount={139} />
      <SubCategoryRow subsByCategory={subs} />
      <Toaster />
    </SelectedCategoryProvider>,
  );
}

const row = () => screen.getByRole('group', { name: '하위 카테고리' });
/** 칩 = 이름을 담은 span 의 부모. 보기 갈래에서만 쓴다(수정 갈래에서는 form 이 들어선다). */
const chip = (name: string) => within(row()).getByText(name).parentElement as HTMLElement;
const button = (name: string) => within(row()).getByRole('button', { name });
const addField = () => within(row()).getByRole('textbox', { name: '새 하위 카테고리' });
const nameField = () => within(row()).getByRole('textbox', { name: '하위 카테고리 이름' });

/** 액션이 프라미스를 돌려주므로 서버를 지나는 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** 추가 입력에 이름을 적고 추가를 누른다. */
async function add(value: string) {
  fireEvent.change(addField(), { target: { value } });
  await click(button('하위 카테고리 추가'));
}

/** 어느 칩의 이름 수정을 열고 새 이름을 적어 둔다. */
async function startRename(subName: string, value: string) {
  await click(button(`${subName} 이름 수정`));
  fireEvent.change(nameField(), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSubCategory).mockResolvedValue({ ok: true });
  vi.mocked(renameSubCategory).mockResolvedValue({ ok: true });
  vi.mocked(deleteSubCategory).mockResolvedValue({ ok: true });
});

describe('SubCategoryRow — 줄의 모습 (프로토타입 338–339행)', () => {
  it('회색 줄에 라벨과 칩들이 줄바꿈하며 놓인다', () => {
    renderRow();

    expect(row()).toHaveClass(
      'flex',
      'flex-wrap',
      'items-center',
      'gap-[8px]',
      'bg-toolbar',
      'px-[16px]',
      'py-[12px]',
    );
    expect(within(row()).getByText('하위')).toHaveClass('w-[34px]', 'flex-none', 'text-[11px]');
  });

  it('칩은 이름·개수·수정·× 넷을 담는다 (프로토타입 341–350행)', () => {
    renderRow();

    expect(chip('대화형')).toHaveClass(
      'h-[28px]',
      'gap-[7px]',
      'rounded-[7px]',
      'border',
      'border-border',
      'bg-card',
      'px-[9px]',
    );
    expect(within(chip('대화형')).getByText('대화형')).toHaveClass('text-[12px]', 'font-semibold');
    expect(within(chip('대화형')).getByText('3개')).toHaveClass('text-[11px]', 'text-fainter');
    expect(within(chip('대화형')).getByRole('button', { name: '대화형 이름 수정' })).toHaveTextContent('수정');
    expect(within(chip('대화형')).getByRole('button', { name: '대화형 삭제' })).toHaveTextContent('×');
  });

  it('선택한 상위의 하위만 낸다', () => {
    renderRow();

    expect(within(row()).getByText('대화형')).toBeInTheDocument();
    expect(within(row()).getByText('이미지 생성')).toBeInTheDocument();
    // 다른 상위의 하위가 섞이면 엉뚱한 카테고리의 칩에 링크를 옮기게 된다.
    expect(within(row()).queryByText('에디터')).not.toBeInTheDocument();
  });

  it('하위가 하나도 없어도 라벨과 추가 자리는 남는다', () => {
    renderRow(ROWS, {});

    expect(within(row()).getByText('하위')).toBeInTheDocument();
    expect(addField()).toBeInTheDocument();
    expect(button('하위 카테고리 추가')).toBeInTheDocument();
  });

  it('카테고리가 하나도 없으면 줄 자체를 그리지 않는다', () => {
    renderRow([]);

    // 상위가 없으면 새 하위를 매달 자리도 없다 — 부모 없는 추가 입력을 남기지 않는다.
    expect(screen.queryByRole('group', { name: '하위 카테고리' })).not.toBeInTheDocument();
  });

  it('추가 입력·버튼은 프로토타입 수치를 따른다 (354–355행)', () => {
    renderRow();

    expect(addField()).toHaveClass('h-[28px]', 'w-[130px]', 'rounded-[7px]', 'text-[11.5px]');
    expect(addField()).toHaveAttribute('placeholder', '하위 추가');
    expect(button('하위 카테고리 추가')).toHaveClass('h-[28px]', 'rounded-[7px]', 'bg-select', 'text-[11.5px]');
  });
});

describe('SubCategoryRow — 하위 추가', () => {
  setupToastTimers();

  it('선택한 상위 카테고리 아래에 만든다', async () => {
    renderRow();

    await add('  코딩 보조  ');

    expect(createSubCategory).toHaveBeenCalledWith('cat-ai', '코딩 보조');
  });

  it('성공하면 입력을 비우고 프로토타입 문구로 알린다 (761행)', async () => {
    renderRow();

    await add('코딩 보조');

    expect(addField()).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('AI 도구 모음 → 코딩 보조 하위 카테고리 추가');
  });

  it('입력에서 Enter 로도 추가된다', async () => {
    renderRow();

    fireEvent.change(addField(), { target: { value: '코딩 보조' } });
    await act(async () => {
      fireEvent.submit(addField().closest('form') as HTMLFormElement);
    });

    expect(createSubCategory).toHaveBeenCalledWith('cat-ai', '코딩 보조');
  });

  it('빈 이름은 서버까지 가지 않고 조용히 넘어간다', async () => {
    renderRow();

    await add('   ');

    expect(createSubCategory).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('실패하면 문구를 그대로 띄우고 적던 이름을 그대로 둔다', async () => {
    vi.mocked(createSubCategory).mockResolvedValue({
      ok: false,
      error: '같은 이름의 하위 카테고리가 이미 있습니다.',
    });
    renderRow();

    await add('대화형');

    expect(screen.getByRole('status')).toHaveTextContent('같은 이름의 하위 카테고리가 이미 있습니다.');
    expect(addField()).toHaveValue('대화형');
  });

  it('요청 자체가 거부되면 잠긴 채로 남지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createSubCategory).mockRejectedValue(new Error('Failed to fetch'));
    renderRow();

    await add('코딩 보조');

    expect(screen.getByRole('status')).toHaveTextContent('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    expect(button('하위 카테고리 추가')).not.toBeDisabled();
    vi.mocked(console.error).mockRestore();
  });
});

describe('SubCategoryRow — 이름 수정', () => {
  setupToastTimers();

  it('수정을 누르면 그 칩 자리에 입력과 저장이 들어선다 (프로토타입 343–344행)', async () => {
    renderRow();

    await click(button('대화형 이름 수정'));

    expect(nameField()).toHaveValue('대화형');
    expect(nameField()).toHaveClass('w-[110px]', 'h-[20px]', 'rounded-[4px]', 'border-ink');
    expect(button('저장')).toBeInTheDocument();
    // 고치는 중인 칩에서는 삭제 자리가 사라진다 — 고치던 이름과 지우려는 대상이 섞이지 않게.
    expect(within(row()).queryByRole('button', { name: '대화형 삭제' })).not.toBeInTheDocument();
  });

  it('저장하면 그 하위의 id 와 새 이름을 넘긴다', async () => {
    renderRow();

    await startRename('대화형', '  챗봇  ');
    await click(button('저장'));

    expect(renameSubCategory).toHaveBeenCalledWith('sub-chat', '챗봇');
  });

  it('성공하면 칩으로 돌아가며 프로토타입 문구로 알린다 (773행)', async () => {
    renderRow();

    await startRename('대화형', '챗봇');
    await click(button('저장'));

    expect(within(row()).queryByRole('textbox', { name: '하위 카테고리 이름' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('대화형 → 챗봇');
  });

  it('이름이 그대로면 서버까지 가지 않고 닫힌다', async () => {
    renderRow();

    await startRename('대화형', '  대화형  ');
    await click(button('저장'));

    expect(renameSubCategory).not.toHaveBeenCalled();
    expect(within(row()).queryByRole('textbox', { name: '하위 카테고리 이름' })).not.toBeInTheDocument();
  });

  it('실패하면 문구를 그대로 띄우고 고치던 이름을 그대로 둔다', async () => {
    vi.mocked(renameSubCategory).mockResolvedValue({
      ok: false,
      error: '하위 카테고리를 찾을 수 없습니다.',
    });
    renderRow();

    await startRename('대화형', '챗봇');
    await click(button('저장'));

    expect(screen.getByRole('status')).toHaveTextContent('하위 카테고리를 찾을 수 없습니다.');
    expect(nameField()).toHaveValue('챗봇');
  });

  it('Esc 로 취소된다 (프로토타입 onEditKey)', async () => {
    renderRow();

    await startRename('대화형', '버릴 이름');
    await act(async () => {
      fireEvent.keyDown(nameField(), { key: 'Escape' });
    });

    expect(renameSubCategory).not.toHaveBeenCalled();
    expect(within(row()).getByText('대화형')).toBeInTheDocument();
  });

  it('한 번에 한 칩만 열린다 (프로토타입 editCat 은 하나)', async () => {
    renderRow();

    await startRename('대화형', '버릴 이름');
    await click(button('이미지 생성 이름 수정'));

    expect(within(row()).getAllByRole('textbox', { name: '하위 카테고리 이름' })).toHaveLength(1);
    expect(nameField()).toHaveValue('이미지 생성');
  });

  it('선택이 바뀌면 고치던 이름은 따라가지 않는다', async () => {
    renderWithPanel();

    await startRename('대화형', '버릴 이름');
    await click(screen.getByRole('button', { name: /개발 도구/ }));

    expect(within(row()).queryByRole('textbox', { name: '하위 카테고리 이름' })).not.toBeInTheDocument();
    expect(within(row()).getByText('에디터')).toBeInTheDocument();
  });
});

describe('SubCategoryRow — 하위 삭제', () => {
  setupToastTimers();

  it('×를 눌러도 곧바로 지우지 않고 확인을 먼저 받는다', async () => {
    renderRow();

    await click(button('대화형 삭제'));

    expect(deleteSubCategory).not.toHaveBeenCalled();
    // 링크가 사라지지 않고 상위로 올라간다는 것을 누르기 전에 알린다(deleteSubCategory 가 하는 일).
    expect(within(row()).getByRole('alert')).toHaveTextContent('링크 3개는 상위로 올라갑니다. 삭제할까요?');
    expect(button('삭제')).toBeInTheDocument();
    expect(button('취소')).toBeInTheDocument();
  });

  it('링크가 없는 하위에는 옮길 링크 이야기를 하지 않는다', async () => {
    renderRow();

    await click(button('이미지 생성 삭제'));

    expect(within(row()).getByRole('alert')).toHaveTextContent('삭제할까요?');
    expect(within(row()).getByRole('alert')).not.toHaveTextContent('상위로');
  });

  it('확인하면 그 하위의 id 로 지운다', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    await click(button('삭제'));

    expect(deleteSubCategory).toHaveBeenCalledWith('sub-chat');
  });

  it('성공하면 옮겨진 링크 수까지 알린다 (프로토타입 784행)', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    await click(button('삭제'));

    expect(screen.getByRole('status')).toHaveTextContent('대화형 하위 카테고리 삭제 · 링크 3개는 상위로 올라감');
  });

  it('링크가 없었으면 개수 없이 알린다', async () => {
    renderRow();

    await click(button('이미지 생성 삭제'));
    await click(button('삭제'));

    expect(screen.getByRole('status')).toHaveTextContent('이미지 생성 하위 카테고리 삭제');
    expect(screen.getByRole('status')).not.toHaveTextContent('올라감');
  });

  it('실패하면 문구를 그대로 알리고 확인 줄은 걷는다', async () => {
    vi.mocked(deleteSubCategory).mockResolvedValue({
      ok: false,
      error: '하위 카테고리를 찾을 수 없습니다.',
    });
    renderRow();

    await click(button('대화형 삭제'));
    await click(button('삭제'));

    expect(screen.getByRole('status')).toHaveTextContent('하위 카테고리를 찾을 수 없습니다.');
    expect(within(row()).queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
  });

  it('확인 줄에서 취소하면 아무 일도 일어나지 않는다', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    await click(button('취소'));

    expect(deleteSubCategory).not.toHaveBeenCalled();
    expect(button('대화형 삭제')).toBeInTheDocument();
  });

  it('이름 수정과 삭제 확인은 서로를 밀어낸다', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    await click(button('이미지 생성 이름 수정'));

    expect(within(row()).queryByRole('alert')).not.toBeInTheDocument();

    await click(button('대화형 삭제'));

    expect(within(row()).queryByRole('textbox', { name: '하위 카테고리 이름' })).not.toBeInTheDocument();
  });
});

describe('SubCategoryRow — 2단계 제약 (하위의 하위 차단)', () => {
  setupToastTimers();

  it('칩 안에는 하위를 더 만들 자리가 없다', () => {
    renderRow();

    // 줄 전체에 추가 진입점은 **하나뿐**이고 그것은 칩 밖에 있다.
    expect(within(row()).getAllByRole('textbox')).toHaveLength(1);
    expect(within(row()).getAllByRole('button', { name: /추가/ })).toHaveLength(1);
    expect(within(chip('대화형')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(chip('대화형')).queryByRole('button', { name: /추가/ })).not.toBeInTheDocument();
  });

  it('데이터에 하위의 하위가 있어도 그리지 않는다', () => {
    // 서버가 막는 모양(createSubCategory 의 DEPTH_LIMIT)이라 실제로는 만들어질 수 없지만,
    // 화면이 그 전제를 스스로 지키는지 본다 — 목록은 **선택한 상위** 것만 읽는다.
    renderRow(ROWS, { ...SUBS, 'sub-chat': [{ id: 'sub-deep', name: '더 깊은', linkCount: 1 }] });

    expect(within(row()).queryByText('더 깊은')).not.toBeInTheDocument();
  });

  it('추가는 언제나 상위 카테고리 id 로 나간다', async () => {
    renderWithPanel();

    await click(screen.getByRole('button', { name: /개발 도구/ }));
    await add('디버거');

    // 하위 id('sub-ide')가 아니라 선택된 상위 id 다 — 하위 id 로 나가면 서버가 DEPTH_LIMIT 로 막는다.
    expect(createSubCategory).toHaveBeenCalledWith('cat-dev', '디버거');
  });
});
