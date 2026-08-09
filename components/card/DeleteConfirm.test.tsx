/**
 * J3. 카드 삭제 확인 오버레이 — DESIGN_SPEC 2-1 "삭제 확인" + 프로토타입 149~157행.
 *
 * 오버레이가 **어떻게 생겼는가**(수치)와 **무엇을 언제 보내는가**(확인 전 미삭제·실패 처리)를
 * 이 파일이 못박는다. '어느 카드가 오버레이를 갖는가'·'편집과의 상호 배제'는 여러 카드를 아는
 * 화면의 몫이라 HomeView·ListView 테스트가 본다.
 *
 * 서버 액션은 갈아 끼운다 — 액션이 무엇을 검사하고 어떤 문구를 돌려주는지는
 * `lib/mutations.test.ts` 가 고정한다. 여기서는 **무엇을 넘기고 결과를 어떻게 쓰는지**만 본다.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteConfirm } from '@/components/card/DeleteConfirm';
import { Toaster } from '@/components/Toast';
import { deleteBookmark } from '@/lib/mutations';
import type { BookmarkWithCount } from '@/lib/types';
import { setFavs, storedFavs } from '@/test/favs';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({ deleteBookmark: vi.fn() }));

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

/**
 * 오버레이만 그린다. 실제로는 카드(`relative overflow-hidden`)의 마지막 자식이지만, 이 파일이
 * 보는 것은 오버레이 자신의 계약이라 카드를 끌어오지 않는다 — 카드와의 배치는 LinkCard 의 몫이다.
 */
function renderOverlay(over: Partial<BookmarkWithCount> = {}) {
  return render(
    <>
      <DeleteConfirm bookmark={{ ...BOOKMARK, ...over }} onDone={onDone} />
      <Toaster />
    </>,
  );
}

const dialog = () => screen.getByRole('alertdialog');
const deleteButton = () => screen.getByRole('button', { name: '삭제' });
const cancelButton = () => screen.getByRole('button', { name: '취소' });

/** 액션이 프라미스를 돌려주므로 확인 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function confirmDelete() {
  await act(async () => {
    fireEvent.click(deleteButton());
  });
}

/**
 * 키를 쏜다. **돌려주는 값은 `fireEvent` 의 것이다: `preventDefault` 를 불렀으면 `false`.**
 * 즉 `toBe(false)` 는 "오버레이가 이 키를 가져갔다"는 뜻이다 (CommandPalette.test 와 같은 규약).
 */
function press(key: string, init: KeyboardEventInit = {}, target: Element = dialog()): boolean {
  return fireEvent.keyDown(target, { key, ...init });
}

beforeEach(() => {
  localStorage.clear();
  onDone.mockClear();
  vi.mocked(deleteBookmark).mockReset();
  vi.mocked(deleteBookmark).mockResolvedValue({ ok: true });
});

describe('DeleteConfirm — 생김새 (DESIGN_SPEC 2-1 · 프로토타입 149~157행)', () => {
  it('스펙 문구와 삭제·취소 버튼만 둔다', () => {
    renderOverlay();

    expect(screen.getByText('이 링크를 삭제할까요')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '삭제',
      '취소',
    ]);
  });

  it('어느 카드의 확인인지 이름으로 알린다 — 카드 액션 버튼·편집 폼과 같은 방식', () => {
    renderOverlay();

    expect(screen.getByRole('alertdialog', { name: 'ChatGPT 삭제 확인' })).toBeInTheDocument();
  });

  it('문구를 오버레이의 설명으로 묶는다 — 포커스가 들어오면 함께 읽힌다', () => {
    renderOverlay();

    expect(dialog()).toHaveAccessibleDescription('이 링크를 삭제할까요');
  });

  it('카드를 통째로 덮는다 — absolute inset-0 z-[6], 배경 rgba(251,250,248,.97)', () => {
    renderOverlay();

    // `absolute inset-0 z-[6]` 은 오버레이 자신의 것이다 (LinkCard 의 deleteSlot 계약).
    expect(dialog()).toHaveClass(
      'absolute',
      'inset-0',
      'z-[6]',
      'bg-[rgba(251,250,248,.97)]',
      'flex',
      'flex-col',
      'items-center',
      'justify-center',
      'gap-[7px]',
      'p-[8px]',
    );
  });

  it('라운드는 카드가 낸다 — 오버레이는 자기 라운드를 두지 않는다', () => {
    // 프로토타입은 오버레이에도 border-radius:10px 을 적었지만, 카드 컨테이너가
    // `rounded-[10px] overflow-hidden` 이라 모서리는 이미 잘린다(LinkCard CARD).
    expect(renderOverlay().container.querySelector('[role="alertdialog"]')?.className).not.toMatch(
      /rounded/,
    );
  });

  it('문구 — 11.5px/600, 가운데 정렬, line-height 1.4 (프로토타입 151행)', () => {
    renderOverlay();

    expect(screen.getByText('이 링크를 삭제할까요')).toHaveClass(
      'text-[11.5px]',
      'font-semibold',
      'text-center',
      'leading-[1.4]',
    );
  });

  it('삭제 — 높이 26px, 좌우 11px, 라운드 6px, 배경 #a8443a + 흰 글자 11.5px/600', () => {
    renderOverlay();

    expect(deleteButton()).toHaveClass(
      'h-[26px]',
      'px-[11px]',
      'rounded-[6px]',
      'bg-danger',
      'text-white',
      'text-[11.5px]',
      'font-semibold',
    );
  });

  it('취소 — 같은 크기의 흰 버튼, 테두리 1px #ddd8d1', () => {
    renderOverlay();

    expect(cancelButton()).toHaveClass(
      'h-[26px]',
      'px-[11px]',
      'rounded-[6px]',
      'border',
      'border-border-strong',
      'bg-card',
      'text-[11.5px]',
    );
    // 프로토타입 154행에는 글자색 선언이 없다 — 본문 잉크를 그대로 물려받는다.
    expect(cancelButton().className).not.toMatch(/text-(danger|white|desc)/);
  });
});

describe('DeleteConfirm — 확인 전에는 지우지 않는다 (DESIGN_SPEC 7장)', () => {
  it('오버레이가 떴다는 것만으로는 아무것도 보내지 않는다', () => {
    renderOverlay();

    expect(deleteBookmark).not.toHaveBeenCalled();
  });

  it('취소는 아무것도 보내지 않고 닫는다', () => {
    renderOverlay();

    fireEvent.click(cancelButton());

    expect(deleteBookmark).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('Esc 도 취소다', () => {
    renderOverlay();

    expect(press('Escape')).toBe(false);
    expect(deleteBookmark).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('Esc 는 오버레이 안에서 눌렸을 때만 듣는다 — 문서 전역 리스너를 두지 않는다', () => {
    renderOverlay();

    // 같은 링크가 두 섹션에 놓이면 오버레이도 둘이다(HomeView) — 전역 리스너였다면 한 번의 Esc 가
    // 두 오버레이를 모두 건드린다. 자기 안에서만 듣도록 두어 서로를 밟지 않게 한다.
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('DeleteConfirm — 확인', () => {
  it('삭제를 누르면 그 링크 id 로 deleteBookmark 를 부르고 닫는다', async () => {
    renderOverlay();

    await confirmDelete();

    expect(deleteBookmark).toHaveBeenCalledWith('bm-1');
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('id 는 넘겨받은 링크의 것이다', async () => {
    renderOverlay({ id: 'bm-99' });

    await confirmDelete();

    expect(deleteBookmark).toHaveBeenCalledWith('bm-99');
  });
});

/**
 * 사이드바의 '내 즐겨찾기' 개수는 저장된 id 를 그대로 세고(SidebarContainer), 화면의 목록은
 * 실존 링크만 골라 센다(`pickFavorites`). 지운 링크의 id 가 localStorage 에 남으면 그 순간부터
 * 두 숫자가 갈라지므로, 원인이 생기는 이 자리에서 지운다.
 */
describe('DeleteConfirm — 즐겨찾기 정합', () => {
  // 실패 경로가 토스트를 띄우므로 타이머를 함께 흘려보낸다 (Toast.tsx 규약).
  setupToastTimers();

  it('삭제에 성공하면 이 브라우저의 즐겨찾기에서도 그 링크를 뺀다', async () => {
    setFavs(['bm-1', 'bm-2']);
    renderOverlay();

    await confirmDelete();

    expect(storedFavs()).toEqual(['bm-2']);
  });

  it('담겨 있지 않던 링크를 담지는 않는다 — toggle 은 없으면 담는 함수다', async () => {
    setFavs(['bm-2']);
    renderOverlay();

    await confirmDelete();

    expect(storedFavs()).toEqual(['bm-2']);
  });

  it('취소하면 즐겨찾기를 건드리지 않는다', () => {
    setFavs(['bm-1']);
    renderOverlay();

    fireEvent.click(cancelButton());

    expect(storedFavs()).toEqual(['bm-1']);
  });

  it('삭제에 실패하면 즐겨찾기를 건드리지 않는다 — 링크는 아직 살아 있다', async () => {
    vi.mocked(deleteBookmark).mockResolvedValue({ ok: false, error: '링크를 찾을 수 없습니다.' });
    setFavs(['bm-1']);
    renderOverlay();

    await confirmDelete();

    expect(storedFavs()).toEqual(['bm-1']);
  });
});

describe('DeleteConfirm — 삭제 실패', () => {
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(deleteBookmark).mockResolvedValue({ ok: false, error: '링크를 찾을 수 없습니다.' });
  });

  it('액션이 준 문구를 토스트로 그대로 띄운다', async () => {
    renderOverlay();

    await confirmDelete();

    expect(screen.getByText('링크를 찾을 수 없습니다.')).toBeInTheDocument();
  });

  it('오버레이를 닫지 않는다 — 다시 시도하거나 취소할 수 있어야 한다', async () => {
    renderOverlay();

    await confirmDelete();

    expect(onDone).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    expect(deleteButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
  });

  it('실패한 뒤 다시 삭제할 수 있다', async () => {
    renderOverlay();

    await confirmDelete();

    vi.mocked(deleteBookmark).mockResolvedValue({ ok: true });
    await confirmDelete();

    expect(deleteBookmark).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe('DeleteConfirm — 삭제 중 (이중 제출 방지)', () => {
  /** 응답을 붙잡아 두고 '삭제 중' 상태를 관찰한다 (InlineEdit.test 와 같은 하니스). */
  function pending() {
    let settle!: (result: { ok: true }) => void;
    vi.mocked(deleteBookmark).mockReturnValue(
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
    renderOverlay();

    const finish = pending();
    // 한 act 안에서 연달아 쏜다 = 첫 클릭의 상태 갱신이 화면에 반영되기 전이다. 이 구간에서는
    // 버튼이 아직 잠기지 않았고 클로저의 `deleting` 도 false 라, 상태만으로는 두 번째가 새어 나간다.
    await act(async () => {
      fireEvent.click(deleteButton());
      fireEvent.click(deleteButton());
    });

    expect(deleteBookmark).toHaveBeenCalledOnce();
    await finish();
  });

  it('삭제 중에는 다시 눌러도 한 번만 보낸다', async () => {
    renderOverlay();

    const finish = pending();
    await confirmDelete();
    await confirmDelete();

    expect(deleteBookmark).toHaveBeenCalledOnce();
    await finish();
  });

  it('삭제 중에는 두 버튼이 잠기고 Esc 도 듣지 않는다', async () => {
    renderOverlay();

    const finish = pending();
    await confirmDelete();

    expect(deleteButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();

    press('Escape');
    expect(onDone).not.toHaveBeenCalled();

    await finish();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('두 버튼이 잠기는 동안 포커스를 오버레이가 붙든다 — Tab 이 카드 뒤로 새지 않는다', async () => {
    renderOverlay();

    const finish = pending();
    await confirmDelete();

    expect(dialog()).toHaveFocus();
    expect(press('Tab')).toBe(false);
    expect(dialog()).toHaveFocus();

    await finish();
  });
});

/**
 * 키보드 — **오버레이 자신의 몫이다.** 카드는 형제(본문 앵커·핀·연필)에게 `inert` 를 걸지 않으므로
 * (LinkCard 의 deleteSlot JSDoc), 포커스를 데려오고 가두는 일을 여기서 하지 않으면 확인이 떠 있는데
 * Tab 이 뒤의 링크로 새어 나간다.
 */
describe('DeleteConfirm — 포커스', () => {
  it('마운트하면 포커스가 오버레이 안으로 들어온다 — 되돌릴 수 없는 쪽이 아니라 취소가 받는다', () => {
    renderOverlay();

    expect(cancelButton()).toHaveFocus();
  });

  it('마지막(취소)에서 Tab 은 첫 버튼(삭제)으로 돌아온다', () => {
    renderOverlay();

    expect(press('Tab', {}, cancelButton())).toBe(false);
    expect(deleteButton()).toHaveFocus();
  });

  it('첫 버튼(삭제)에서 ⇧Tab 은 마지막(취소)으로 간다', () => {
    renderOverlay();
    deleteButton().focus();

    expect(press('Tab', { shiftKey: true }, deleteButton())).toBe(false);
    expect(cancelButton()).toHaveFocus();
  });

  it('닫히면 오버레이를 연 곳(휴지통)으로 포커스를 돌려준다', () => {
    const trash = document.createElement('button');
    document.body.append(trash);
    trash.focus();

    const { unmount } = renderOverlay();
    expect(cancelButton()).toHaveFocus();

    unmount();

    expect(trash).toHaveFocus();
    trash.remove();
  });
});
