/**
 * J2. 카드 인라인 편집 폼 — DESIGN_SPEC 2-1 "인라인 편집" + 프로토타입 실측.
 *
 * 폼이 **어떻게 생겼는가**(필드 구성·수치)와 **무엇을 보내는가**(patch 구성·실패 처리)를 이 파일이
 * 못박는다. '동시에 한 장만' 은 여러 카드를 아는 화면의 몫이라 HomeView·ListView 테스트가 본다.
 *
 * 서버 액션은 갈아 끼운다 — 액션이 실제로 무엇을 검사하고 어떤 문구를 돌려주는지는
 * `lib/mutations.test.ts` 가 고정한다. 여기서는 **무엇을 넘기고 결과를 어떻게 쓰는지**만 본다.
 */
import { startTransition } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InlineEdit } from '@/components/card/InlineEdit';
import { Toaster } from '@/components/Toast';
import { updateBookmark } from '@/lib/mutations';
import type { BookmarkWithCount } from '@/lib/types';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({ updateBookmark: vi.fn() }));

/**
 * `startTransition` **한 함수만** 진짜 구현을 감싼 스파이로 바꾼다(나머지 react 는 그대로).
 *
 * 저장 성공 시의 닫힘이 트랜지션 안에서 일어나는지는 결과만 봐서는 알 수 없다 — 콜백은 어차피
 * 그 자리에서 실행되고, `act()` 는 트랜지션이든 아니든 다 흘려보낸다. 트랜지션에 묶였는지 여부가
 * 드러나는 곳(옛 값이 한 프레임 스치는가)은 revalidate 된 새 prop 이 실제로 내려오는 브라우저이고,
 * 여기서 붙잡을 수 있는 것은 **배선**뿐이라 호출 자체를 본다.
 */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();

  return { ...actual, startTransition: vi.fn(actual.startTransition) };
});

const BOOKMARK: BookmarkWithCount = {
  id: 'bm-1',
  category_id: 'cat-1',
  title: 'ChatGPT',
  url: 'https://chat.openai.com',
  description: 'AI 대화·문서 초안',
  tags: [],
  favicon_url: null,
  is_pinned: false,
  source: 'manual',
  sort_order: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  click_count: 3,
};

const onDone = vi.fn();

function renderForm(over: Partial<BookmarkWithCount> = {}) {
  render(
    <>
      <InlineEdit bookmark={{ ...BOOKMARK, ...over }} onDone={onDone} />
      <Toaster />
    </>,
  );
}

/**
 * 실제 배치와 같은 그림 — 폼은 **카드의 본문 자리**에 들어앉고(LinkCard 의 `editSlot`), 그 폼을
 * 연 연필은 같은 카드의 상단 줄에 있다. 포커스가 "누가 눌렀는가"를 가릴 때 보는 것이 이
 * 부모-자식 관계라, 포커스를 다루는 묶음은 폼만 띄우지 않고 이 카드로 감싼다.
 *
 * jsdom 의 클릭은 포커스를 옮기지 않으므로 '누른 자리'는 테스트가 손으로 짚는다.
 */
function Card({ open, label }: { open: boolean; label: string }) {
  return (
    <div>
      <button type="button">{label}</button>
      {open && <InlineEdit bookmark={BOOKMARK} onDone={onDone} />}
    </div>
  );
}

const titleField = () => screen.getByRole('textbox', { name: '이름' });
const descField = () => screen.getByRole('textbox', { name: '한 줄 설명' });
const saveButton = () => screen.getByRole('button', { name: '저장' });
const cancelButton = () => screen.getByRole('button', { name: '취소' });

/** 액션이 프라미스를 돌려주므로 저장 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function save() {
  await act(async () => {
    fireEvent.click(saveButton());
  });
}

/**
 * 입력에서 Enter 를 누른 상황. 제출 버튼이 있는 폼의 입력에서 Enter 는 브라우저가 **submit 이벤트**로
 * 바꿔 준다(HTML 암묵적 제출) — 우리 코드가 받는 것이 바로 그 이벤트라 여기서는 그것을 쏜다.
 * jsdom 은 암묵적 제출을 구현하지 않아 keyDown 만으로는 아무 일도 일어나지 않는다.
 *
 * 이 배선을 고른 이유는 조합 입력(IME)이다 — 한글을 확정하는 Enter 로 폼이 저장되면 안 되는데,
 * 그 판정은 브라우저가 이미 하고 있다(조합 중 Enter 는 제출을 일으키지 않는다). 손으로 keydown 을
 * 듣고 저장하면 그 규칙을 우리가 다시 구현해야 한다.
 */
async function pressEnter(field: HTMLElement) {
  await act(async () => {
    fireEvent.submit(field.closest('form')!);
  });
}

/**
 * 토스트 타이머는 **파일 전체**에 깐다 (Toast.tsx 규약: 스토어가 모듈 레벨이라 상태가 테스트
 * 사이에 남는다). 실패 묶음만 감싸 두었더니 `저장` 묶음의 "이름을 비워도 그대로 보낸다"(액션이
 * 실패를 돌려주므로 토스트가 뜬다)가 **실타이머로** 2초짜리 setTimeout 을 남기고 끝났다.
 *
 * 여기 한 번만 부른다 — 안쪽 `describe` 에서 또 부르면 afterEach 가 안에서 밖으로 도는 사이
 * 이미 실타이머로 돌아온 뒤에 `advanceTimersByTime` 이 불려 터진다.
 */
setupToastTimers();

beforeEach(() => {
  onDone.mockClear();
  vi.mocked(startTransition).mockClear();
  vi.mocked(updateBookmark).mockReset();
  vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
});

describe('InlineEdit — 폼 구성 (DESIGN_SPEC 2-1 · 프로토타입 실측)', () => {
  it('이름·설명 입력과 저장·취소 버튼만 둔다', () => {
    renderForm();

    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '저장',
      '취소',
    ]);
  });

  it('스펙·프로토타입에 없는 필드(주소·분류)는 두지 않는다', () => {
    renderForm();

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /주소/ })).not.toBeInTheDocument();
  });

  it('현재 이름·설명을 채우고 프로토타입 placeholder 를 쓴다', () => {
    renderForm();

    expect(titleField()).toHaveValue('ChatGPT');
    expect(titleField()).toHaveAttribute('placeholder', '이름');
    expect(descField()).toHaveValue('AI 대화·문서 초안');
    expect(descField()).toHaveAttribute('placeholder', '한 줄 설명');
  });

  it('설명이 없는 링크는 빈 값으로 시작한다', () => {
    renderForm({ description: null });

    expect(descField()).toHaveValue('');
  });

  it('어느 카드의 폼인지 이름으로 알린다 — 카드 액션 버튼과 같은 방식', () => {
    renderForm();

    expect(screen.getByRole('form', { name: 'ChatGPT 수정' })).toBeInTheDocument();
  });

  it('본문 자리를 그대로 차지한다 — margin-top:auto, 세로 5px 간격 (프로토타입)', () => {
    renderForm();

    // LinkCard 의 `editSlot` JSDoc(J1b)이 정한 계약은 "폼이 `mt-auto` 나 `flex-1` 중 하나를
    // 갖는다"이고, 이 단언은 그중 지금 구현이 고른 쪽을 못박는다 — `flex-1` 로 가는 대안 구현이
    // 오면 계약은 그대로이므로 이 한 줄만 갱신하면 된다.
    expect(screen.getByRole('form', { name: 'ChatGPT 수정' })).toHaveClass(
      'mt-auto',
      'flex',
      'flex-col',
      'gap-[5px]',
    );
  });

  it('이름 입력 — 높이 30px, 테두리 1.5px #141516, 12.5px/600', () => {
    renderForm();

    expect(titleField()).toHaveClass(
      'h-[30px]',
      'w-full',
      'rounded-[6px]',
      'bg-card',
      'px-[8px]',
      'border-[1.5px]',
      'border-ink',
      'text-[12.5px]',
      'font-semibold',
    );
  });

  it('설명 입력 — 높이 30px, 테두리 1px #ddd8d1, 12px', () => {
    renderForm();

    expect(descField()).toHaveClass(
      'h-[30px]',
      'w-full',
      'rounded-[6px]',
      'bg-card',
      'px-[8px]',
      'border',
      'border-border-strong',
      'text-[12px]',
    );
  });

  it('저장은 검은 버튼(flex:1, 28px), 취소는 흰 버튼', () => {
    renderForm();

    expect(saveButton()).toHaveClass(
      'flex-1',
      'h-[28px]',
      'justify-center',
      'rounded-[6px]',
      'bg-ink',
      'text-white',
      'text-[11.5px]',
      'font-semibold',
    );
    expect(cancelButton()).toHaveClass(
      'shrink-0',
      'h-[28px]',
      'px-[10px]',
      'rounded-[6px]',
      'border',
      'border-border-strong',
      'bg-card',
      'text-[11.5px]',
      'text-desc',
    );
  });
});

describe('InlineEdit — 저장', () => {
  it('바꾼 값을 updateBookmark 로 보내고 성공하면 폼을 닫는다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '챗지피티' } });
    fireEvent.change(descField(), { target: { value: '새 설명' } });
    await save();

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', {
      title: '챗지피티',
      description: '새 설명',
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('성공하면 닫힘을 트랜지션에 묶는다 — 새 데이터와 같은 커밋에서 사라지게', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '챗지피티' } });
    await save();

    // 닫힘은 `await` 뒤에 일어나는 상태 갱신이라 저절로 트랜지션이 되지 않는다(React 의 알려진
    // 한계 — Next `interactive-apps.md` Step 6). 감싸지 않으면 폼이 revalidate 보다 먼저 닫혀
    // 카드에 옛 이름이 한 프레임 스친다.
    expect(startTransition).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();

    // 트랜지션이 받은 콜백이 곧 '닫기'여야 한다 — 엉뚱한 것을 감싸 놓고 닫기는 밖에서 부르는
    // 배선이어도 위 두 단언만으로는 걸리지 않는다.
    const [close] = vi.mocked(startTransition).mock.calls[0];

    onDone.mockClear();
    close();

    expect(onDone).toHaveBeenCalledOnce();
  });

  it('바꾼 필드만 보낸다 — 건드리지 않은 키는 patch 에 넣지 않는다', async () => {
    renderForm();

    fireEvent.change(descField(), { target: { value: '설명만 고침' } });
    await save();

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { description: '설명만 고침' });
  });

  it('비교 기준선은 폼을 연 순간이다 — 그 사이 내려온 남의 수정을 되돌리지 않는다', async () => {
    const { rerender } = render(<InlineEdit bookmark={BOOKMARK} onDone={onDone} />);

    fireEvent.change(titleField(), { target: { value: '챗지피티' } });

    // 다른 창이 설명만 고쳤고, 그 액션의 revalidate 로 새 prop 이 열려 있는 폼에 내려왔다.
    rerender(
      <InlineEdit
        bookmark={{ ...BOOKMARK, description: '남이 방금 고친 설명' }}
        onDone={onDone}
      />,
    );
    await save();

    // 사용자가 손댄 것은 이름뿐이다. 비교를 지금 prop 과 했다면 건드리지도 않은 설명이 patch 에
    // 실려(입력에는 열 때의 옛 값이 그대로 있다) 남의 수정을 옛 값으로 되돌린다.
    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { title: '챗지피티' });
  });

  it('앞뒤 공백을 다듬어 보낸다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '  챗지피티  ' } });
    await save();

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { title: '챗지피티' });
  });

  it('공백만 달라진 값은 바뀐 것으로 보지 않는다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '  ChatGPT ' } });
    await save();

    expect(updateBookmark).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('아무것도 바꾸지 않으면 서버까지 가지 않고 닫는다', async () => {
    renderForm();

    await save();

    expect(updateBookmark).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('설명을 지우면 빈 문자열을 보낸다 — 비우는 판정은 액션이 한다', async () => {
    renderForm();

    fireEvent.change(descField(), { target: { value: '' } });
    await save();

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { description: '' });
  });

  it('이름 입력에서 Enter — 폼 제출이 곧 저장이다 (DESIGN_SPEC 2-1)', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '엔터 저장' } });
    await pressEnter(titleField());

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { title: '엔터 저장' });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('설명 입력에서 Enter 를 눌러도 저장한다', async () => {
    renderForm();

    fireEvent.change(descField(), { target: { value: '엔터 저장' } });
    await pressEnter(descField());

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { description: '엔터 저장' });
  });

  it('Enter 가 저장이 되는 조건을 갖춘다 — 두 입력이 폼 안에 있고 저장이 submit 버튼이다', () => {
    renderForm();

    const form = screen.getByRole('form', { name: 'ChatGPT 수정' });

    expect(form).toContainElement(titleField());
    expect(form).toContainElement(descField());
    expect(saveButton()).toHaveAttribute('type', 'submit');
    expect(form).toContainElement(saveButton());
  });

  it('이름을 비워도 그대로 보낸다 — 빈 이름의 처분은 액션이 정한다', async () => {
    vi.mocked(updateBookmark).mockResolvedValue({ ok: false, error: '이름을 입력하세요.' });
    renderForm();

    fireEvent.change(titleField(), { target: { value: '   ' } });
    await save();

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { title: '' });
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('InlineEdit — 저장 실패', () => {
  // 토스트 타이머는 파일 상단에서 한 번에 깔았다 (setupToastTimers 주석).
  beforeEach(() => {
    vi.mocked(updateBookmark).mockResolvedValue({
      ok: false,
      error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  });

  it('액션이 준 문구를 토스트로 그대로 띄운다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '실패할 이름' } });
    await save();

    expect(
      screen.getByText('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument();
  });

  it('폼을 닫지 않고 고치던 값을 그대로 남긴다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '실패할 이름' } });
    await save();

    expect(onDone).not.toHaveBeenCalled();
    expect(titleField()).toHaveValue('실패할 이름');
  });

  it('실패한 뒤 다시 저장할 수 있다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '실패할 이름' } });
    await save();

    vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
    await save();

    expect(updateBookmark).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledOnce();
  });
});

/**
 * 액션이 **거부로 끝나는** 길 — `{ ok:false }` 를 돌려주는 것과 다르다. 네트워크가 끊기면 fetch
 * 자체가 실패하고, 배포로 액션 id 가 바뀌면 요청이 아예 닿지 않는다. 잡지 않으면 `saving` 이 참인
 * 채로 남아 버튼도 Esc 도 잠긴, 새로고침 말고는 나갈 길이 없는 폼이 된다.
 */
describe('InlineEdit — 요청이 거부됐을 때', () => {
  beforeEach(() => {
    // 원인 진단은 서버 로그의 몫이라 테스트 출력에는 싣지 않는다.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updateBookmark).mockRejectedValue(new Error('Failed to fetch'));
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
  });

  it('사용자에게는 액션의 실패 문구와 같은 한 문장을 띄운다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '끊긴 저장' } });
    await save();

    expect(
      screen.getByText('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument();
    // 진짜 원인(스택·요청)은 로그로만 간다.
    expect(console.error).toHaveBeenCalled();
  });

  it('빗장을 풀어 다시 시도할 길을 남긴다 — 버튼·입력·Esc 가 살아난다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '끊긴 저장' } });
    await save();

    expect(saveButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    expect(titleField()).not.toHaveAttribute('readonly');
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.keyDown(titleField(), { key: 'Escape' });

    expect(onDone).toHaveBeenCalledOnce();
  });

  it('고치던 값을 그대로 두고, 다시 누르면 그때는 보낸다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '끊긴 저장' } });
    await save();

    expect(titleField()).toHaveValue('끊긴 저장');

    vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
    await save();

    expect(updateBookmark).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe('InlineEdit — 저장 중 (이중 제출 방지)', () => {
  /** 응답을 붙잡아 두고 '저장 중' 상태를 관찰한다. */
  function pending() {
    let settle!: (result: { ok: true }) => void;
    vi.mocked(updateBookmark).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    return async () => {
      await act(async () => {
        settle({ ok: true });
      });
    };
  }

  it('같은 틱에 두 번 눌러도 한 번만 보낸다 — 화면이 다시 그려지기 전의 두 번째 클릭', async () => {
    renderForm();
    fireEvent.change(titleField(), { target: { value: '한 번만' } });

    const finish = pending();
    // 한 act 안에서 연달아 쏜다 = 첫 클릭의 상태 갱신이 화면에 반영되기 전이다. 그 구간에서는
    // 버튼이 아직 잠기지 않았고 클로저의 `saving` 도 false 라, 상태만으로는 두 번째가 새어 나간다
    // (J3 DeleteConfirm 이 같은 자리에서 실측으로 확인한 구멍이다 — 빗장은 ref 여야 한다).
    await act(async () => {
      fireEvent.click(saveButton());
      fireEvent.click(saveButton());
    });

    expect(updateBookmark).toHaveBeenCalledOnce();
    await finish();
  });

  it('저장 중에는 다시 눌러도 한 번만 보낸다', async () => {
    renderForm();
    fireEvent.change(titleField(), { target: { value: '한 번만' } });

    const finish = pending();
    await save();
    await save();

    expect(updateBookmark).toHaveBeenCalledOnce();
    await finish();
  });

  it('저장 중에는 Enter 로도 다시 보내지 않는다', async () => {
    renderForm();
    fireEvent.change(titleField(), { target: { value: '한 번만' } });

    const finish = pending();
    await save();
    await pressEnter(titleField());

    expect(updateBookmark).toHaveBeenCalledOnce();
    await finish();
  });

  it('입력은 잠기되 `readOnly` 다 — disabled 였다면 그 순간 포커스가 body 로 떨어진다', async () => {
    renderForm();
    fireEvent.change(titleField(), { target: { value: '한 번만' } });

    const finish = pending();
    await pressEnter(titleField()); // Enter 저장 — 이 순간 포커스는 이름 입력에 있다.

    expect(titleField()).toHaveAttribute('readonly');
    expect(descField()).toHaveAttribute('readonly');
    expect(titleField()).not.toBeDisabled();
    // 포커스가 남아 있어야 실패했을 때 이어서 고칠 수 있고, 그때까지 Esc 도 폼이 받는다.
    expect(titleField()).toHaveFocus();

    await finish();
  });

  it('저장 버튼은 처리 중임을 aria-busy 로도 알린다 (LoginForm 과 같은 짝)', async () => {
    renderForm();
    fireEvent.change(titleField(), { target: { value: '한 번만' } });

    const finish = pending();
    await save();

    // 흐려지는 모습만으로는 화면을 볼 수 없는 사용자에게 아무 일도 없는 것과 같다.
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');

    await finish();
  });

  it('저장 중에는 두 버튼이 잠기고 Esc 도 듣지 않는다', async () => {
    renderForm();
    fireEvent.change(titleField(), { target: { value: '한 번만' } });

    const finish = pending();
    await save();

    expect(saveButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();

    fireEvent.keyDown(titleField(), { key: 'Escape' });
    expect(onDone).not.toHaveBeenCalled();

    await finish();
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe('InlineEdit — 취소', () => {
  it('취소 버튼은 아무것도 보내지 않고 닫는다', () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '버릴 값' } });
    fireEvent.click(cancelButton());

    expect(updateBookmark).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('Esc 도 취소다 (DESIGN_SPEC 2-1)', () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '버릴 값' } });
    fireEvent.keyDown(titleField(), { key: 'Escape' });

    expect(updateBookmark).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('취소 버튼은 폼을 제출하지 않는다', () => {
    renderForm();

    // type="submit" 이면 클릭이 저장까지 흘러간다 — 취소는 제출 경로 밖에 있어야 한다.
    expect(cancelButton()).toHaveAttribute('type', 'button');
  });
});

describe('InlineEdit — 포커스', () => {
  it('뜨는 순간 이름 입력이 받는다 — 연필에 남아 있으면 Esc 가 듣지 않는다', () => {
    renderForm();

    // Esc·Enter 는 폼 안에서 올라오는 이벤트다. 포커스가 폼 밖(연필)에 있으면 키보드로는
    // 고칠 수도, 나갈 수도 없는 폼이 된다.
    expect(titleField()).toHaveFocus();
  });

  /**
   * 저장 중에는 두 버튼이 잠기고, 브라우저는 **잠긴 요소에서 포커스를 떼어** 문서 뿌리로 보낸다.
   * 실패하면 폼은 남는데 포커스는 카드 밖이라, 다시 시도하려면 화면 맨 앞에서 걸어와야 한다
   * (J3 DeleteConfirm 이 실패 경로에서 `취소` 로 되돌리는 것과 같은 처방 · G 스윕).
   */
  it('저장이 실패해 잠금이 풀리면 포커스가 저장 버튼으로 돌아온다', async () => {
    vi.mocked(updateBookmark).mockResolvedValue({ ok: false, error: '이름을 입력하세요.' });
    renderForm();

    fireEvent.change(titleField(), { target: { value: '실패할 이름' } });
    // 실제 브라우저에서는 누른 저장이 그 자리에서 잠기며 포커스가 떨어진다. jsdom 의 클릭은
    // 포커스를 옮기지 않으므로 그 결과 상태를 손으로 만든다.
    titleField().blur();
    await save();

    expect(saveButton()).toHaveFocus();
  });

  it('요청이 거부돼 잠금이 풀려도 마찬가지다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updateBookmark).mockRejectedValue(new Error('Failed to fetch'));
    renderForm();

    fireEvent.change(titleField(), { target: { value: '실패할 이름' } });
    titleField().blur();
    await save();

    expect(saveButton()).toHaveFocus();

    spy.mockRestore();
  });

  it('실패해도 이미 다른 곳에 있는 포커스는 뺏지 않는다', async () => {
    // 이름 칸에서 Enter 로 저장한 경우다 — 입력이 `readOnly` 라 포커스가 그 자리에 남아 있고,
    // 뺏으면 거절 사유를 보고 이어 고칠 자리를 잃는다.
    vi.mocked(updateBookmark).mockResolvedValue({ ok: false, error: '이름을 입력하세요.' });
    renderForm();

    fireEvent.change(titleField(), { target: { value: '실패할 이름' } });
    titleField().focus();
    await pressEnter(titleField());

    expect(titleField()).toHaveFocus();
  });

  it('닫힐 때 폼을 열어 준 자리로 돌려준다', () => {
    // 폼은 연필의 ref 를 모르므로(그 버튼은 LinkCard 의 것이다) 렌더 시점의 activeElement 를
    // 붙드는 것이 최선이다. jsdom 의 클릭은 포커스를 옮기지 않아 여기서는 손으로 맞춰 둔다.
    const { rerender } = render(<Card open={false} label="연필" />);
    const pencil = screen.getByRole('button', { name: '연필' });
    pencil.focus();

    rerender(<Card open label="연필" />);
    expect(titleField()).toHaveFocus();

    rerender(<Card open={false} label="연필" />);

    expect(pencil).toHaveFocus();
  });
});

/**
 * **어느 연필이 이 폼을 열었는가** — 트리거를 `useEffect` 가 아니라 **렌더 시점**에 붙드는 이유가
 * 여기 둘 다 있다 (J3 DeleteConfirm 의 같은 묶음과 짝이다).
 */
describe('InlineEdit — 폼을 연 자리', () => {
  /** 카드 둘이 나란히 있고, 폼은 화면이 든 `editingId` 하나를 따라 그중 한 자리에만 열린다. */
  function Cards({ open }: { open: 'a' | 'b' | null }) {
    return (
      <>
        <Card open={open === 'a'} label="A 수정" />
        <Card open={open === 'b'} label="B 수정" />
      </>
    );
  }

  /** 같은 링크가 홈의 두 섹션에 놓인 경우 — 폼이 **두 벌 함께** 열린다. */
  function Both({ open }: { open: boolean }) {
    return (
      <>
        <Card open={open} label="위 수정" />
        <Card open={open} label="아래 수정" />
      </>
    );
  }

  it('앞 폼이 닫히며 되돌린 포커스를 새 폼이 트리거로 붙들지 않는다', () => {
    const { rerender } = render(<Cards open={null} />);
    const pencilA = screen.getByRole('button', { name: 'A 수정' });
    const pencilB = screen.getByRole('button', { name: 'B 수정' });

    pencilA.focus();
    rerender(<Cards open="a" />);

    pencilB.focus();
    // 화면의 `editingId` 가 한 번에 바뀌어 **한 커밋에서** A 가 사라지고 B 가 열린다. React 는
    // 사라지는 쪽의 cleanup 을 먼저 돌리므로 그 순간 activeElement 는 A 가 되돌려 놓은 A 의
    // 연필이다 — effect 에서 읽는 구현은 B 가 남의 트리거를 붙든다.
    rerender(<Cards open="b" />);

    rerender(<Cards open={null} />);

    expect(pencilB).toHaveFocus();
  });

  it('두 벌이 함께 열려도 눌린 카드의 폼만 포커스를 데려간다', () => {
    const { rerender } = render(<Both open={false} />);
    screen.getByRole('button', { name: '위 수정' }).focus();

    rerender(<Both open />);

    // 둘 다 데려오면 나중에 마운트된 아래쪽이 이겨, 누르지도 않은 카드로 포커스가 간다.
    const [top, bottom] = screen.getAllByRole('textbox', { name: '이름' });
    expect(top).toHaveFocus();
    expect(bottom).not.toHaveFocus();
  });

  it('클릭이 포커스를 옮기지 않는 환경에서는 가리지 않고 데려온다 — 종전 그대로', () => {
    // 붙들 것이 `<body>` 뿐이면(macOS Safari 기본값 · jsdom) 누가 눌렀는지 알 길이 없다.
    // 폼이 열렸는데 포커스가 카드 밖에 남는 쪽이 더 나쁘므로 그때는 데려온다.
    const { rerender } = render(<Both open={false} />);
    expect(document.activeElement).toBe(document.body);

    rerender(<Both open />);

    const fields = screen.getAllByRole('textbox', { name: '이름' });
    expect(fields[fields.length - 1]).toHaveFocus();
  });
});
