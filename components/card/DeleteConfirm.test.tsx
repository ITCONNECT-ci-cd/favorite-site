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
import { startTransition } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteConfirm } from '@/components/card/DeleteConfirm';
import { Toaster } from '@/components/Toast';
import type { ActionResult } from '@/lib/mutations';
import { deleteBookmark } from '@/lib/mutations';
import type { BookmarkWithCount } from '@/lib/types';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({ deleteBookmark: vi.fn() }));

/**
 * `startTransition` **한 함수만** 진짜 구현을 감싼 스파이로 바꾼다(나머지 react 는 그대로).
 *
 * 삭제 성공 시의 닫힘이 트랜지션 안에서 일어나는지는 결과만 봐서는 알 수 없다 — 콜백은 어차피
 * 그 자리에서 실행되고, `act()` 는 트랜지션이든 아니든 다 흘려보낸다. 트랜지션에 묶였는지가
 * 드러나는 곳(지운 카드가 한 프레임 되살아나는가)은 revalidate 가 실제로 도는 브라우저이고,
 * 여기서 붙잡을 수 있는 것은 **배선**뿐이라 호출 자체를 본다 (InlineEdit.test 와 같은 하니스).
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
  is_favorite: false,
  fav_order: 0,
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

/**
 * 실제 배치와 같은 그림 — 오버레이는 **카드의 마지막 자식**이고, 그 확인창을 연 휴지통은 같은
 * 카드 안에 있다(LinkCard 의 `deleteSlot` 계약). 포커스가 "누가 눌렀는가"를 가릴 때 보는 것이
 * 이 부모-자식 관계라, 포커스를 다루는 묶음은 오버레이만 띄우지 않고 이 카드로 감싼다.
 *
 * jsdom 의 클릭은 포커스를 옮기지 않으므로 '누른 자리'는 테스트가 손으로 짚는다.
 */
function Card({ open, label }: { open: boolean; label: string }) {
  return (
    <div>
      <button type="button">{label}</button>
      {open && <DeleteConfirm bookmark={BOOKMARK} onDone={onDone} />}
    </div>
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
 * 응답을 붙잡아 두고 '삭제 중' 상태를 관찰한다 (InlineEdit.test 와 같은 하니스).
 * 돌려주는 함수에 결과를 넘기면 그 결과로 끝난다 — 기본은 성공이다.
 */
function pending() {
  let settle!: (result: ActionResult) => void;
  vi.mocked(deleteBookmark).mockReturnValue(
    new Promise<ActionResult>((resolve) => {
      settle = resolve;
    }),
  );

  return async (result: ActionResult = { ok: true }) => {
    await act(async () => {
      settle(result);
    });
  };
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
  vi.mocked(startTransition).mockClear();
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

  it('성공하면 닫힘을 트랜지션에 묶는다 — 카드가 사라지는 것과 같은 커밋에서', async () => {
    renderOverlay();

    await confirmDelete();

    // 닫힘은 `await` 뒤에 일어나는 상태 갱신이라 저절로 트랜지션이 되지 않는다(React 의 알려진
    // 한계 — Next `interactive-apps.md` Step 6). 감싸지 않으면 오버레이가 revalidate 보다 먼저
    // 걷혀, 지운 카드가 되살아난 것처럼 남는 창에서 휴지통을 다시 누를 수 있다.
    expect(startTransition).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();

    // 트랜지션이 받은 콜백이 곧 '닫기'여야 한다 — 엉뚱한 것을 감싸 놓고 닫기는 밖에서 부르는
    // 배선이어도 위 두 단언만으로는 걸리지 않는다.
    const [close] = vi.mocked(startTransition).mock.calls[0];

    onDone.mockClear();
    close();

    expect(onDone).toHaveBeenCalledOnce();
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

  it('잠금이 풀리면 포커스를 취소로 되돌린다 — 컨테이너에 남겨 두지 않는다', async () => {
    renderOverlay();

    const finish = pending();
    await confirmDelete();
    // 삭제 중에는 두 버튼이 잠겨 오버레이가 포커스를 받아 둔다(그 자리에 남겨 두면 다시
    // 시도하려는 사용자가 Tab 부터 눌러야 한다).
    expect(dialog()).toHaveFocus();

    await finish({ ok: false, error: '링크를 찾을 수 없습니다.' });

    expect(cancelButton()).toHaveFocus();
  });
});

/**
 * 액션이 **거부로 끝나는** 길 — `{ ok:false }` 를 돌려주는 것과 다르다. 네트워크가 끊기면 fetch
 * 자체가 실패하고, 배포로 액션 id 가 바뀌면 요청이 아예 닿지 않는다. 잡지 않으면 `deleting` 이
 * 참인 채로 남아 두 버튼도 Esc 도 잠긴, 새로고침 말고는 나갈 길이 없는 확인창이 된다.
 */
describe('DeleteConfirm — 요청이 거부됐을 때', () => {
  setupToastTimers();

  beforeEach(() => {
    // 원인 진단은 서버 로그의 몫이라 테스트 출력에는 싣지 않는다.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deleteBookmark).mockRejectedValue(new Error('Failed to fetch'));
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
  });

  it('사용자에게는 액션의 실패 문구와 같은 한 문장을 띄운다', async () => {
    renderOverlay();

    await confirmDelete();

    expect(
      screen.getByText('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument();
    // 진짜 원인(스택·요청)은 로그로만 간다.
    expect(console.error).toHaveBeenCalled();
  });

  it('빗장을 풀어 다시 시도할 길을 남긴다 — 두 버튼과 Esc 가 살아난다', async () => {
    renderOverlay();

    await confirmDelete();

    expect(deleteButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    expect(dialog()).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    expect(press('Escape')).toBe(false);

    expect(onDone).toHaveBeenCalledOnce();
  });

  it('다시 누르면 그때는 보낸다', async () => {
    renderOverlay();

    await confirmDelete();

    vi.mocked(deleteBookmark).mockResolvedValue({ ok: true });
    await confirmDelete();

    expect(deleteBookmark).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe('DeleteConfirm — 삭제 중 (이중 제출 방지)', () => {
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

  it('삭제 버튼은 처리 중임을 aria-busy 로도 알린다 (InlineEdit·LoginForm 과 같은 짝)', async () => {
    renderOverlay();

    const finish = pending();
    await confirmDelete();

    // 흐려지는 모습만으로는 화면을 볼 수 없는 사용자에게 아무 일도 없는 것과 같다.
    expect(deleteButton()).toHaveAttribute('aria-busy', 'true');

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

  it('오버레이 자신이 포커스를 든 채여도 Tab 은 안에서 돈다 — 컨테이너도 경계다', () => {
    renderOverlay();
    // 삭제 중에 오버레이가 받아 둔 포커스가 실패로 잠금이 풀린 뒤까지 남은 상황. `contains` 는
    // 자기 자신을 포함하므로 이 자리를 '가운데'로 보면 ⇧Tab 이 카드 뒤 본문 링크로 새어 나간다.
    dialog().focus();

    expect(press('Tab', { shiftKey: true })).toBe(false);
    expect(cancelButton()).toHaveFocus();

    dialog().focus();

    expect(press('Tab')).toBe(false);
    expect(deleteButton()).toHaveFocus();
  });

  it('닫히면 오버레이를 연 곳(휴지통)으로 포커스를 돌려준다', () => {
    const { rerender } = render(<Card open={false} label="휴지통" />);
    const trash = screen.getByRole('button', { name: '휴지통' });
    trash.focus();

    rerender(<Card open label="휴지통" />);
    expect(cancelButton()).toHaveFocus();

    rerender(<Card open={false} label="휴지통" />);

    expect(trash).toHaveFocus();
  });
});

/**
 * **어느 휴지통이 이 확인창을 열었는가** — 트리거를 `useEffect` 가 아니라 **렌더 시점**에 붙드는
 * 이유가 여기 둘 다 있다.
 */
describe('DeleteConfirm — 확인창을 연 자리', () => {
  /** 카드 둘이 나란히 있고, 확인창은 화면이 든 id 하나를 따라 그중 한 자리에만 뜬다. */
  function Cards({ open }: { open: 'a' | 'b' | null }) {
    return (
      <>
        <Card open={open === 'a'} label="A 삭제" />
        <Card open={open === 'b'} label="B 삭제" />
      </>
    );
  }

  /** 같은 링크가 홈의 두 섹션에 놓인 경우 — 확인창이 **두 자리에 함께** 뜬다. */
  function Both({ open }: { open: boolean }) {
    return (
      <>
        <Card open={open} label="위 삭제" />
        <Card open={open} label="아래 삭제" />
      </>
    );
  }

  it('앞 확인창이 닫히며 되돌린 포커스를 새 확인창이 트리거로 붙들지 않는다', () => {
    const { rerender } = render(<Cards open={null} />);
    const trashA = screen.getByRole('button', { name: 'A 삭제' });
    const trashB = screen.getByRole('button', { name: 'B 삭제' });

    trashA.focus();
    rerender(<Cards open="a" />);

    trashB.focus();
    // 화면의 `deletingId` 가 한 번에 바뀌어 **한 커밋에서** A 가 사라지고 B 가 뜬다. React 는
    // 사라지는 쪽의 cleanup 을 먼저 돌리므로 그 순간 activeElement 는 A 가 되돌려 놓은 A 의
    // 휴지통이다 — effect 에서 읽는 구현은 B 가 남의 트리거를 붙든다.
    rerender(<Cards open="b" />);

    rerender(<Cards open={null} />);

    expect(trashB).toHaveFocus();
  });

  it('두 자리에 함께 떠도 눌린 카드의 확인창만 포커스를 데려간다', () => {
    const { rerender } = render(<Both open={false} />);
    screen.getByRole('button', { name: '위 삭제' }).focus();

    rerender(<Both open />);

    // 둘 다 데려오면 나중에 마운트된 아래쪽이 이겨, 누르지도 않은 카드로 포커스가 간다.
    const [top, bottom] = screen.getAllByRole('button', { name: '취소' });
    expect(top).toHaveFocus();
    expect(bottom).not.toHaveFocus();
  });

  it('클릭이 포커스를 옮기지 않는 환경에서는 가리지 않고 데려온다 — 종전 그대로', () => {
    // 붙들 것이 `<body>` 뿐이면(macOS Safari 기본값 · jsdom) 누가 눌렀는지 알 길이 없다.
    // 확인창이 떠 있는데 포커스가 카드 밖에 남는 쪽이 더 나쁘므로 그때는 데려온다.
    const { rerender } = render(<Both open={false} />);
    expect(document.activeElement).toBe(document.body);

    rerender(<Both open />);

    const cancels = screen.getAllByRole('button', { name: '취소' });
    expect(cancels[cancels.length - 1]).toHaveFocus();
  });
});
