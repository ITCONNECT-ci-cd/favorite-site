/**
 * I2. 하위 카테고리 줄 — DESIGN_SPEC 6장 "하위 줄(배경 `#faf9f7`): '하위' 라벨 + 하위 칩
 * (이름·개수·수정·×) + 추가 입력 + 추가 버튼" + 프로토타입 원문 실측(338–356행).
 *
 * 여기서 못박는 것은 **줄의 모습**, **칩의 세 갈래**(보기 · 이름 수정 · 삭제 확인), 그리고
 * 서버 액션에 무엇을 넘기고 결과를 어떻게 쓰는지다. 액션이 무엇을 검사하고 어떤 문구를
 * 돌려주는지(깊이 차단 · 링크 상위 재배속)는 `lib/mutations.test.ts` 가 고정한다 — 이 파일은
 * **UI 쪽 절반**만 본다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CategoryPanel,
  SelectedCategoryProvider,
  type AdminCategory,
} from '@/components/admin/CategoryPanel';
import { SubCategoryRow, type SubCategoryMap } from '@/components/admin/SubCategoryRow';
import { Toaster } from '@/components/Toast';
import {
  createSubCategory,
  deleteSubCategory,
  renameSubCategory,
  type ActionResult,
} from '@/lib/mutations';
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
/** 펼친 칩의 버튼들 — 글자는 '저장'·'삭제'·'취소'뿐이라 접근성 이름에 하위 이름이 앞선다. */
const saveButton = (subName: string) => button(`${subName} 이름 저장`);
const confirmButton = (subName: string) => button(`${subName} 삭제 확인`);
const renameForm = () => nameField().closest('form') as HTMLFormElement;

/**
 * 응답이 **언제** 오는지 테스트가 정하는 액션. 요청은 나갔고 응답은 아직인 '왕복 중' 창을 본다 —
 * `mockResolvedValue` 로는 그 창이 열리자마자 닫혀 잠금을 확인할 수 없다.
 */
function deferred() {
  let settle!: (result: ActionResult) => void;
  const promise = new Promise<ActionResult>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

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

    expect(screen.getByRole('status')).toHaveTextContent('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    expect(button('하위 카테고리 추가')).not.toBeDisabled();
    vi.mocked(console.error).mockRestore();
  });

  it('요청이 나가 있는 동안 버튼이 잠기고 aria-busy 로도 알린다', async () => {
    const pending = deferred();
    vi.mocked(createSubCategory).mockReturnValue(pending.promise);
    renderRow();

    fireEvent.change(addField(), { target: { value: '코딩 보조' } });
    await click(button('하위 카테고리 추가'));

    // 흐려지는 모습만으로는 화면을 볼 수 없는 사용자에게 아무 일도 일어나지 않은 것과 같다
    // (I3 LinkAddRow·J2 InlineEdit 의 제출 버튼과 같은 짝).
    expect(button('하위 카테고리 추가')).toBeDisabled();
    expect(button('하위 카테고리 추가')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      pending.settle({ ok: true });
    });

    expect(button('하위 카테고리 추가')).toHaveAttribute('aria-busy', 'false');
  });
});

describe('SubCategoryRow — 이름 수정', () => {
  setupToastTimers();

  it('수정을 누르면 그 칩 자리에 입력과 저장이 들어선다 (프로토타입 343–344행)', async () => {
    renderRow();

    await click(button('대화형 이름 수정'));

    expect(nameField()).toHaveValue('대화형');
    expect(nameField()).toHaveClass('w-[110px]', 'h-[20px]', 'rounded-[4px]', 'border-ink');
    expect(saveButton('대화형')).toBeInTheDocument();
    // 고치는 중인 칩에서는 삭제 자리가 사라진다 — 고치던 이름과 지우려는 대상이 섞이지 않게.
    expect(within(row()).queryByRole('button', { name: '대화형 삭제' })).not.toBeInTheDocument();
  });

  it('저장하면 그 하위의 id 와 새 이름을 넘긴다', async () => {
    renderRow();

    await startRename('대화형', '  챗봇  ');
    await click(saveButton('대화형'));

    expect(renameSubCategory).toHaveBeenCalledWith('sub-chat', '챗봇');
  });

  it('성공하면 칩으로 돌아가며 프로토타입 문구로 알린다 (773행)', async () => {
    renderRow();

    await startRename('대화형', '챗봇');
    await click(saveButton('대화형'));

    expect(within(row()).queryByRole('textbox', { name: '하위 카테고리 이름' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('대화형 → 챗봇');
  });

  it('이름이 그대로면 서버까지 가지 않고 닫힌다', async () => {
    renderRow();

    await startRename('대화형', '  대화형  ');
    await click(saveButton('대화형'));

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
    await click(saveButton('대화형'));

    expect(screen.getByRole('status')).toHaveTextContent('하위 카테고리를 찾을 수 없습니다.');
    expect(nameField()).toHaveValue('챗봇');
    // 실패는 다시 낼 값이므로 잠금이 풀려 있어야 한다 — 성공 경로와 갈리는 곳이다.
    expect(saveButton('대화형')).not.toBeDisabled();
  });

  it('요청 자체가 거부되면 잠긴 채로 남지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(renameSubCategory).mockRejectedValue(new Error('Failed to fetch'));
    renderRow();

    await startRename('대화형', '챗봇');
    await click(saveButton('대화형'));

    // 거부는 서버가 판단한 결과가 아니므로 폼도 고치던 이름도 남는다(실패와 같은 갈래).
    expect(screen.getByRole('status')).toHaveTextContent('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    expect(saveButton('대화형')).not.toBeDisabled();
    expect(nameField()).toHaveValue('챗봇');
    vi.mocked(console.error).mockRestore();
  });

  it('취소 버튼으로도 닫힌다 — 나가는 길이 Esc 하나가 아니다', async () => {
    renderRow();

    await startRename('대화형', '버릴 이름');
    await click(button('대화형 이름 수정 취소'));

    expect(renameSubCategory).not.toHaveBeenCalled();
    expect(within(row()).getByText('대화형')).toBeInTheDocument();
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

/**
 * 같은 요청이 두 번 나가는 창을 막는 두 겹 — 각각 막는 창이 다르다.
 *
 * 성공 경로가 잠금을 **트랜지션 안에서** 푸는 것(응답이 온 뒤 닫힘이 커밋될 때까지 열린 폼이
 * 잠긴 채로 있는 것)은 여기서 볼 수 없다. jsdom 에는 트랜지션이 기다릴 새 데이터가 없어
 * 그 두 커밋이 한 번에 끝나기 때문이다 — 그 창은 라우터가 revalidate 를 물고 오는 실제 화면에만
 * 있고, 지켜 주는 것은 `setBusy(false)` 가 `startTransition` 안에 함께 들어 있다는 구조다.
 */
describe('SubCategoryRow — 이중 제출', () => {
  setupToastTimers();

  it('같은 틱에 두 번 제출해도 추가 요청은 한 번만 나간다', async () => {
    renderRow();

    fireEvent.change(addField(), { target: { value: '코딩 보조' } });
    const form = addField().closest('form') as HTMLFormElement;
    // 상태(`adding`)만으로는 이 창을 못 막는다 — 두 제출 사이에 렌더가 끼지 않아 값도 `disabled`
    // 도 아직 그대로다. 두 번째가 나가면 서버가 같은 이름을 거절하고, 그 거절 토스트가 방금의
    // 성공 토스트를 덮어 **만들어 놓고 실패를 말하는** 화면이 된다.
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(createSubCategory).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('AI 도구 모음 → 코딩 보조 하위 카테고리 추가');
  });

  it('같은 틱에 두 번 제출해도 이름 수정 요청은 한 번만 나간다', async () => {
    renderRow();

    await startRename('대화형', '챗봇');
    // 한 act 안의 두 제출은 사이에 렌더가 끼지 않는다 — `busy` 도 `disabled` 도 아직 그대로라
    // 막는 것은 그 자리에서 바뀌는 빗장(ref)뿐이다.
    await act(async () => {
      fireEvent.submit(renameForm());
      fireEvent.submit(renameForm());
    });

    expect(renameSubCategory).toHaveBeenCalledTimes(1);
  });

  it('같은 틱에 두 번 눌러도 삭제 요청은 한 번만 나간다', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    const confirm = confirmButton('대화형');
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(deleteSubCategory).toHaveBeenCalledTimes(1);
  });

  it('왕복이 끝나기 전에는 두 번째 제출을 받지 않는다', async () => {
    const pending = deferred();
    vi.mocked(renameSubCategory).mockReturnValue(pending.promise);
    renderRow();

    await startRename('대화형', '챗봇');
    await click(saveButton('대화형'));
    await act(async () => {
      fireEvent.submit(renameForm());
    });

    expect(renameSubCategory).toHaveBeenCalledTimes(1);
    // 폼은 응답이 올 때까지 열려 있고, 잠긴 것이 눈에도 보인다.
    expect(saveButton('대화형')).toBeDisabled();

    await act(async () => {
      pending.settle({ ok: true });
    });
  });

  it('한 칩이 왕복하는 동안 다른 칩의 수정·× 도 잠긴다', async () => {
    const pending = deferred();
    vi.mocked(renameSubCategory).mockReturnValue(pending.promise);
    renderRow();

    await startRename('대화형', '챗봇');
    await click(saveButton('대화형'));

    // 여기서 열 수 있으면, 왕복이 끝나며 `active` 가 비워질 때 치던 글자째 사라진다.
    expect(button('이미지 생성 이름 수정')).toBeDisabled();
    expect(button('이미지 생성 삭제')).toBeDisabled();

    await act(async () => {
      pending.settle({ ok: true });
    });

    // 성공 경로는 잠금을 트랜지션 안에서 푼다 — 풀기는 **푼다**. 여기서 잠긴 채로 남으면
    // 줄에 남은 칩들이 새로고침 전까지 영영 못 쓰게 된다.
    expect(button('이미지 생성 이름 수정')).not.toBeDisabled();
    expect(button('이미지 생성 삭제')).not.toBeDisabled();
  });

  it('왕복 중임을 aria-busy 로도 알린다 (InlineEdit·DeleteConfirm 과 같은 짝)', async () => {
    const pending = deferred();
    vi.mocked(renameSubCategory).mockReturnValue(pending.promise);
    renderRow();

    await startRename('대화형', '챗봇');
    await click(saveButton('대화형'));

    expect(saveButton('대화형')).toHaveAttribute('aria-busy', 'true');
    // 이 줄의 `busy` 는 칩 하나가 아니라 **줄 전체**의 왕복이다 — 잠그는 자리면 함께 알린다.
    expect(button('이미지 생성 이름 수정')).toHaveAttribute('aria-busy', 'true');
    expect(button('대화형 이름 수정 취소')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      pending.settle({ ok: true });
    });

    expect(button('이미지 생성 이름 수정')).toHaveAttribute('aria-busy', 'false');
  });

  it('성공한 뒤에도 줄은 이어서 쓸 수 있다', async () => {
    renderRow();

    await startRename('대화형', '챗봇');
    await click(saveButton('대화형'));

    await startRename('이미지 생성', '그림');
    await click(saveButton('이미지 생성'));

    expect(renameSubCategory).toHaveBeenNthCalledWith(2, 'sub-img', '그림');
  });
});

/**
 * 위 묶음의 JSDoc 이 말한 **구조**를 소스에서 직접 센다.
 *
 * jsdom 에는 트랜지션이 기다릴 새 데이터가 없어 두 커밋이 한 번에 끝난다 — `setBusy(false)` 를
 * `startTransition` **밖**으로 빼내도 이 파일의 나머지가 전부 통과한다(실측). 화면으로 관측할 수
 * 없는 계약은 소스로 못박는다(`lib/mutations.test.ts`·`lib/favicon-collect.test.ts` 와 같은 방식).
 */
describe('SubCategoryRow — 잠금 해제는 닫힘과 같은 커밋이다 (소스)', () => {
  /**
   * cwd 기준으로 읽는다 — jsdom 환경에서는 `import.meta.url` 이 file: 스킴이 아니라
   * `new URL(...)` 로는 열 수 없다(app/not-found.test.tsx 와 같은 방식).
   */
  const source = readFileSync(join(process.cwd(), 'components/admin/SubCategoryRow.tsx'), 'utf8');
  /** 주석은 걷어낸다 — 규칙을 설명하는 주석 자체가 통과 근거가 되면 안 된다. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('성공 경로의 setBusy(false) 와 setActive(null) 은 한 트랜지션 안에 함께 있다', () => {
    const paired = code.match(
      /startTransition\(\(\) => \{\s*setBusy\(false\);\s*setActive\(null\);\s*\}\)/g,
    );

    // 이름 수정 · 삭제 두 곳. 먼저 풀면 닫힘이 커밋되기 전 한 프레임 동안 '잠기지 않은 채 열린
    // 폼'이 생기고, 그 창으로 같은 요청이 한 번 더 나간다.
    expect(paired).toHaveLength(2);
    // 트랜지션은 그 둘뿐이다 — 다른 모양이 하나라도 늘면 위 셈이 새는지부터 다시 본다.
    expect(code.match(/startTransition\(/g)).toHaveLength(2);
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
    expect(confirmButton('대화형')).toBeInTheDocument();
    expect(button('대화형 삭제 취소')).toBeInTheDocument();
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
    await click(confirmButton('대화형'));

    expect(deleteSubCategory).toHaveBeenCalledWith('sub-chat');
  });

  it('성공하면 옮겨진 링크 수까지 알린다 (프로토타입 784행)', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    await click(confirmButton('대화형'));

    expect(screen.getByRole('status')).toHaveTextContent('대화형 하위 카테고리 삭제 · 링크 3개는 상위로 올라감');
  });

  it('링크가 없었으면 개수 없이 알린다', async () => {
    renderRow();

    await click(button('이미지 생성 삭제'));
    await click(confirmButton('이미지 생성'));

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
    await click(confirmButton('대화형'));

    expect(screen.getByRole('status')).toHaveTextContent('하위 카테고리를 찾을 수 없습니다.');
    expect(within(row()).queryByRole('button', { name: '대화형 삭제 확인' })).not.toBeInTheDocument();
    // 실패는 트랜지션 없이 그 자리에서 걷는다 — 기다릴 새 데이터가 없고 칩도 그대로 남는다.
    expect(button('대화형 삭제')).not.toBeDisabled();
  });

  it('요청 자체가 거부되면 확인 줄을 그대로 두고 잠금만 푼다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deleteSubCategory).mockRejectedValue(new Error('Failed to fetch'));
    renderRow();

    await click(button('대화형 삭제'));
    await click(confirmButton('대화형'));

    expect(screen.getByRole('status')).toHaveTextContent('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    // 위 실패와 갈리는 곳이다 — 요청이 **닿지도 않았다.** 서버가 판단한 결과가 아니므로 확인
    // 줄을 걷지 않고 같은 자리에서 그대로 다시 누르게 둔다(I1 CategoryHeader 와 같은 갈래).
    expect(confirmButton('대화형')).not.toBeDisabled();

    await click(confirmButton('대화형'));

    // 잠금이 실제로 풀렸다는 증거 — 두 번째 시도가 서버까지 나간다.
    expect(deleteSubCategory).toHaveBeenCalledTimes(2);
    vi.mocked(console.error).mockRestore();
  });

  it('확인 줄에서 취소하면 아무 일도 일어나지 않는다', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    await click(button('대화형 삭제 취소'));

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

/**
 * 갈래를 열면 그것을 연 버튼이 그 자리에서 **사라진다**. 포커스를 옮겨 두지 않으면 `<body>` 로
 * 떨어져, 키보드 사용자는 화면 맨 앞에서 이 줄까지 다시 걸어와야 한다.
 */
describe('SubCategoryRow — 포커스', () => {
  setupToastTimers();

  it('저장하고 나면 그 칩의 수정 버튼으로 돌아온다', async () => {
    renderRow();

    await startRename('대화형', '챗봇');
    await click(saveButton('대화형'));

    expect(button('대화형 이름 수정')).toHaveFocus();
  });

  it('Esc 로 닫아도 수정 버튼으로 돌아온다', async () => {
    renderRow();

    await startRename('대화형', '버릴 이름');
    await act(async () => {
      fireEvent.keyDown(nameField(), { key: 'Escape' });
    });

    expect(button('대화형 이름 수정')).toHaveFocus();
  });

  it('수정을 취소해도 수정 버튼으로 돌아온다', async () => {
    renderRow();

    await startRename('대화형', '버릴 이름');
    await click(button('대화형 이름 수정 취소'));

    expect(button('대화형 이름 수정')).toHaveFocus();
  });

  it('확인 줄이 열리면 덜 위험한 취소가 포커스를 받는다', async () => {
    renderRow();

    await click(button('대화형 삭제'));

    // × 를 누른 직후의 Enter 한 번이 그대로 삭제가 되면 확인을 거치게 한 의미가 없다(APG).
    expect(button('대화형 삭제 취소')).toHaveFocus();
  });

  it('삭제를 취소하면 × 로 돌아온다', async () => {
    renderRow();

    await click(button('대화형 삭제'));
    await click(button('대화형 삭제 취소'));

    expect(button('대화형 삭제')).toHaveFocus();
  });

  it('삭제가 실패해 확인 줄이 걷혀도 × 로 돌아온다', async () => {
    vi.mocked(deleteSubCategory).mockResolvedValue({
      ok: false,
      error: '하위 카테고리를 찾을 수 없습니다.',
    });
    renderRow();

    await click(button('대화형 삭제'));
    // 실브라우저의 클릭은 누른 버튼으로 포커스를 옮긴다 — `fireEvent.click` 은 옮기지 않아
    // 포커스가 `취소`(확인 줄이 열릴 때 받은 자리)에 남는다. 그대로 두면 이 테스트가 보려는
    // '눌러서 사라진 버튼에서 떨어진 포커스'가 만들어지지 않아 저절로 통과한다.
    const confirm = confirmButton('대화형');
    confirm.focus();
    await click(confirm);

    expect(button('대화형 삭제')).toHaveFocus();
  });

  it('확인 갈래와 보기 갈래는 DOM 노드를 나눠 쓰지 않는다 (프래그먼트 키)', async () => {
    renderRow();

    const removeButton = button('대화형 삭제');
    const renameButton = button('대화형 이름 수정');

    await click(removeButton);

    // 키가 없으면 React 는 같은 자리의 자식들을 순서로 맞춰 host 노드를 재사용한다 — `취소` 가
    // 곧 옛 `×` 노드, `삭제 확인` 이 곧 옛 `수정` 노드가 된다. 그러면 갈래가 바뀌어도 포커스가
    // 그 노드에 얹힌 채라 위 두 테스트가 저절로 통과하고, 실브라우저에서는 삭제가 실패했을 때
    // 포커스가 **이름 수정** 버튼에 남는다.
    expect(button('대화형 삭제 취소')).not.toBe(removeButton);
    expect(button('대화형 삭제 확인')).not.toBe(renameButton);
  });

  it('다른 칩을 열어 닫힌 경우에는 포커스를 뺏지 않는다', async () => {
    renderRow();

    await startRename('대화형', '버릴 이름');
    await click(button('이미지 생성 이름 수정'));

    // 닫히는 칩이 조건 없이 자기 '수정'을 잡으면, 방금 연 입력에서 포커스를 도로 뺏어 온다.
    expect(nameField()).toHaveFocus();
  });
});

describe('SubCategoryRow — 버튼의 결', () => {
  it('누를 수 있는 것에는 손가락 커서가, 잠긴 동안에는 기본 커서가 붙는다', () => {
    renderRow();

    expect(button('대화형 이름 수정')).toHaveClass('cursor-pointer', 'disabled:cursor-default');
    expect(button('대화형 삭제')).toHaveClass('cursor-pointer', 'disabled:cursor-default');
    expect(button('하위 카테고리 추가')).toHaveClass('cursor-pointer', 'disabled:cursor-default');
  });

  it('추가 입력과 버튼은 함께 줄바꿈하고 좁아져도 찌그러지지 않는다', () => {
    renderRow();

    expect(addField().closest('form')).toHaveClass('flex', 'flex-none', 'items-center');
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
