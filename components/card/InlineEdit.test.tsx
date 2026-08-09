/**
 * J2. 카드 인라인 편집 폼 — DESIGN_SPEC 2-1 "인라인 편집" + 프로토타입 실측.
 *
 * 폼이 **어떻게 생겼는가**(필드 구성·수치)와 **무엇을 보내는가**(patch 구성·실패 처리)를 이 파일이
 * 못박는다. '동시에 한 장만' 은 여러 카드를 아는 화면의 몫이라 HomeView·ListView 테스트가 본다.
 *
 * 서버 액션은 갈아 끼운다 — 액션이 실제로 무엇을 검사하고 어떤 문구를 돌려주는지는
 * `lib/mutations.test.ts` 가 고정한다. 여기서는 **무엇을 넘기고 결과를 어떻게 쓰는지**만 본다.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InlineEdit } from '@/components/card/InlineEdit';
import { Toaster } from '@/components/Toast';
import { updateBookmark } from '@/lib/mutations';
import type { BookmarkWithCount } from '@/lib/types';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({ updateBookmark: vi.fn() }));

const BOOKMARK: BookmarkWithCount = {
  id: 'bm-1',
  category_id: 'cat-1',
  title: 'ChatGPT',
  url: 'https://chat.openai.com',
  description: 'AI 대화·문서 초안',
  tags: [],
  favicon_url: null,
  is_pinned: false,
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

beforeEach(() => {
  onDone.mockClear();
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

    expect(screen.getByRole('form', { name: 'ChatGPT 편집' })).toBeInTheDocument();
  });

  it('본문 자리를 그대로 차지한다 — margin-top:auto, 세로 5px 간격 (프로토타입)', () => {
    renderForm();

    expect(screen.getByRole('form', { name: 'ChatGPT 편집' })).toHaveClass(
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

  it('바꾼 필드만 보낸다 — 건드리지 않은 키는 patch 에 넣지 않는다', async () => {
    renderForm();

    fireEvent.change(descField(), { target: { value: '설명만 고침' } });
    await save();

    expect(updateBookmark).toHaveBeenCalledWith('bm-1', { description: '설명만 고침' });
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

    const form = screen.getByRole('form', { name: 'ChatGPT 편집' });

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
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(updateBookmark).mockResolvedValue({
      ok: false,
      error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  });

  it('액션이 준 문구를 토스트로 그대로 띄운다', async () => {
    renderForm();

    fireEvent.change(titleField(), { target: { value: '실패할 이름' } });
    await save();

    expect(
      screen.getByText('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
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
