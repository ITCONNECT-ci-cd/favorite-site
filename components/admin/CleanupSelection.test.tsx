/**
 * M2b. 정리 도구의 **고르고 지우는 부분** — 접힘/펼침 · 체크박스 · 일괄 삭제.
 *
 * 이 파일이 못박는 것: 도메인 그룹이 **기본으로 접혀 있는가**(사용자 요구: 열 개가 한꺼번에
 * 펼쳐져 화면을 잡아먹는다), 체크 상태가 무엇을 고르는가, 그리고 **확인 전에는 절대 지우지
 * 않는가**. 액션이 무엇을 검사하고 어떤 문구를 돌려주는지는 `lib/mutations.test.ts` 가 고정한다 —
 * 여기서는 액션을 갈아 끼우고 **무엇을 넘기고 결과를 어떻게 쓰는지**만 본다.
 *
 * 세 구역 중 ①②는 그룹 목록(`CleanupGroupList`), ③은 평면 목록(`CleanupLinkList`)이다.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CleanupGroupList,
  CleanupLinkList,
  type CleanupItem,
  type CleanupItemGroup,
} from '@/components/admin/CleanupSelection';
import { Toaster } from '@/components/Toast';
import { REQUEST_FAILED } from '@/lib/constants';
import { deleteBookmarks, type ActionResult } from '@/lib/mutations';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', () => ({ deleteBookmarks: vi.fn() }));

function item(id: string, title: string, host: string): CleanupItem {
  return { id, title, host };
}

const GROUPS: CleanupItemGroup[] = [
  {
    key: 'github.com',
    label: 'github.com',
    preview: '깃헙 A · 깃헙 B',
    items: [item('g1', '깃헙 A', 'github.com'), item('g2', '깃헙 B', 'github.com')],
  },
  {
    key: 'labs.google',
    label: 'labs.google',
    preview: '구글 A',
    items: [item('l1', '구글 A', 'labs.google')],
  },
];

const ITEMS: CleanupItem[] = [
  item('s1', '방치 하나', 'stale.test'),
  item('s2', '방치 둘', 'stale.test'),
  item('s3', '방치 셋', 'stale.test'),
];

function renderGroups(groups: CleanupItemGroup[] = GROUPS) {
  return render(
    <>
      <CleanupGroupList label="같은 도메인" groups={groups} tone="soft" />
      <Toaster />
    </>,
  );
}

function renderItems(items: CleanupItem[] = ITEMS) {
  return render(
    <>
      <CleanupLinkList label="오래 손대지 않은 링크" items={items} />
      <Toaster />
    </>,
  );
}

const groupToggle = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });
const checkbox = (name: string) => screen.getByRole('checkbox', { name });
const deleteTrigger = () => screen.getByRole('button', { name: /^선택한 \d+개 삭제$/ });
const confirmDeleteButton = () => screen.getByRole('button', { name: '삭제' });
const cancelButton = () => screen.getByRole('button', { name: '취소' });

/** 체크박스 하나를 누른다 — 제어 컴포넌트라 click 이 change 까지 함께 일으킨다. */
function check(name: string): void {
  fireEvent.click(checkbox(name));
}

/** 액션이 프라미스를 돌려주므로 확인 경로는 마이크로태스크까지 흘려보낸다. */
async function pressDelete(): Promise<void> {
  await act(async () => {
    fireEvent.click(confirmDeleteButton());
  });
}

/** 응답을 붙잡아 둔 채 '삭제 중' 구간을 관찰한다 (DeleteConfirm.test 와 같은 하니스). */
function pending() {
  let settle!: (result: ActionResult) => void;
  vi.mocked(deleteBookmarks).mockReturnValue(
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

setupToastTimers();

beforeEach(() => {
  vi.mocked(deleteBookmarks).mockReset();
  vi.mocked(deleteBookmarks).mockResolvedValue({ ok: true });
});

describe('CleanupGroupList — 기본 접힘 · 펼치기', () => {
  it('모든 그룹이 접힌 채로 시작한다 — 항목은 하나도 그리지 않는다', () => {
    renderGroups();

    for (const group of GROUPS) {
      expect(groupToggle(group.label)).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByRole('checkbox', { name: '깃헙 A 선택' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '구글 A 선택' })).not.toBeInTheDocument();
  });

  it('머리 줄을 누르면 **그 그룹만** 펼쳐진다', () => {
    renderGroups();

    fireEvent.click(groupToggle('github.com'));

    expect(groupToggle('github.com')).toHaveAttribute('aria-expanded', 'true');
    expect(checkbox('깃헙 A 선택')).toBeInTheDocument();
    expect(checkbox('깃헙 B 선택')).toBeInTheDocument();
    // 다른 그룹은 접힌 그대로다 — 열 개가 한꺼번에 펼쳐지지 않는 것이 이 화면의 요구다.
    expect(groupToggle('labs.google')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: '구글 A 선택' })).not.toBeInTheDocument();
  });

  it('다시 누르면 접힌다', () => {
    renderGroups();

    fireEvent.click(groupToggle('github.com'));
    fireEvent.click(groupToggle('github.com'));

    expect(groupToggle('github.com')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: '깃헙 A 선택' })).not.toBeInTheDocument();
  });

  it('머리 줄에 도메인 이름 · 미리보기 · 건수를 그대로 둔다 (접힌 채로도 무엇인지 보인다)', () => {
    renderGroups();

    const toggle = groupToggle('github.com');

    expect(within(toggle).getByText('github.com')).toBeInTheDocument();
    expect(within(toggle).getByText('깃헙 A · 깃헙 B')).toBeInTheDocument();
    expect(within(toggle).getByText('2개')).toBeInTheDocument();
  });
});

describe('CleanupGroupList — 체크박스', () => {
  it('선택이 0개면 삭제 버튼이 잠긴다', () => {
    renderGroups();

    expect(deleteTrigger()).toBeDisabled();
    expect(deleteTrigger()).toHaveTextContent('선택한 0개 삭제');
  });

  it('항목을 고르면 그 수가 버튼에 실린다 — 해제하면 되돌아간다', () => {
    renderGroups();
    fireEvent.click(groupToggle('github.com'));

    check('깃헙 A 선택');
    expect(checkbox('깃헙 A 선택')).toBeChecked();
    expect(deleteTrigger()).toHaveTextContent('선택한 1개 삭제');
    expect(deleteTrigger()).toBeEnabled();

    check('깃헙 A 선택');
    expect(checkbox('깃헙 A 선택')).not.toBeChecked();
    expect(deleteTrigger()).toBeDisabled();
  });

  it('그룹 전체 선택은 그 그룹만 고르고, 고른 것이 보이도록 함께 펼친다', () => {
    renderGroups();

    check('github.com 전체 선택');

    // 보이지 않는 것을 고른 채로 두지 않는다 — 지우기 전에 무엇을 고르는지 눈으로 확인시킨다.
    expect(groupToggle('github.com')).toHaveAttribute('aria-expanded', 'true');
    expect(checkbox('깃헙 A 선택')).toBeChecked();
    expect(checkbox('깃헙 B 선택')).toBeChecked();
    expect(deleteTrigger()).toHaveTextContent('선택한 2개 삭제');
    // 다른 그룹은 건드리지 않는다.
    expect(groupToggle('labs.google')).toHaveAttribute('aria-expanded', 'false');
  });

  it('그룹 전체 선택을 풀면 그 그룹의 선택만 사라진다', () => {
    renderGroups();

    check('github.com 전체 선택');
    check('labs.google 전체 선택');
    expect(deleteTrigger()).toHaveTextContent('선택한 3개 삭제');

    check('github.com 전체 선택');

    expect(deleteTrigger()).toHaveTextContent('선택한 1개 삭제');
    expect(checkbox('구글 A 선택')).toBeChecked();
  });

  it('일부만 고르면 그룹 체크박스는 중간 상태다 (전부 고른 것처럼 보이지 않는다)', () => {
    renderGroups();
    fireEvent.click(groupToggle('github.com'));

    check('깃헙 A 선택');

    const group = checkbox('github.com 전체 선택') as HTMLInputElement;
    expect(group.indeterminate).toBe(true);
    expect(group.checked).toBe(false);

    check('깃헙 B 선택');
    expect((checkbox('github.com 전체 선택') as HTMLInputElement).indeterminate).toBe(false);
    expect(checkbox('github.com 전체 선택')).toBeChecked();
  });
});

describe('CleanupGroupList — 확인 없이는 지우지 않는다', () => {
  it('삭제 버튼을 눌러도 확인 전에는 액션에 닿지 않는다', () => {
    renderGroups();
    check('github.com 전체 선택');

    fireEvent.click(deleteTrigger());

    expect(deleteBookmarks).not.toHaveBeenCalled();
    expect(screen.getByText('선택한 2개를 삭제할까요')).toBeInTheDocument();
    expect(confirmDeleteButton()).toBeInTheDocument();
    expect(cancelButton()).toBeInTheDocument();
  });

  it('확인이 뜨면 포커스가 취소로 간다 — 되돌릴 수 없는 쪽에 손이 놓이지 않는다', () => {
    renderGroups();
    check('github.com 전체 선택');

    fireEvent.click(deleteTrigger());

    expect(cancelButton()).toHaveFocus();
  });

  it('확인하는 동안에는 선택을 바꿀 수 없다 — 묻는 개수와 지우는 개수가 갈리면 안 된다', () => {
    renderGroups();
    check('github.com 전체 선택');

    fireEvent.click(deleteTrigger());

    expect(checkbox('깃헙 A 선택')).toBeDisabled();
    expect(checkbox('github.com 전체 선택')).toBeDisabled();
  });

  it('취소하면 아무것도 지우지 않고 선택도 그대로 두며, 포커스를 누른 자리로 돌려준다', () => {
    renderGroups();
    check('github.com 전체 선택');

    fireEvent.click(deleteTrigger());
    fireEvent.click(cancelButton());

    expect(deleteBookmarks).not.toHaveBeenCalled();
    expect(deleteTrigger()).toHaveTextContent('선택한 2개 삭제');
    expect(deleteTrigger()).toHaveFocus();
  });

  it('확인하면 고른 id 만 한 번에 넘긴다', async () => {
    renderGroups();
    fireEvent.click(groupToggle('github.com'));
    check('깃헙 B 선택');
    check('labs.google 전체 선택');

    fireEvent.click(deleteTrigger());
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['g2', 'l1']);
  });

  it('같은 틱에 두 번 눌러도 한 번만 보낸다 — 화면이 다시 그려지기 전의 두 번째 클릭', async () => {
    renderGroups();
    check('github.com 전체 선택');
    fireEvent.click(deleteTrigger());

    const finish = pending();
    await act(async () => {
      fireEvent.click(confirmDeleteButton());
      fireEvent.click(confirmDeleteButton());
    });

    expect(deleteBookmarks).toHaveBeenCalledOnce();
    await finish();
  });

  it('보내는 동안 두 버튼을 잠그고 왕복 중임을 알린다', async () => {
    renderGroups();
    check('github.com 전체 선택');
    fireEvent.click(deleteTrigger());

    const finish = pending();
    await act(async () => {
      fireEvent.click(confirmDeleteButton());
    });

    expect(confirmDeleteButton()).toBeDisabled();
    expect(confirmDeleteButton()).toHaveAttribute('aria-busy', 'true');
    expect(cancelButton()).toBeDisabled();

    await finish();
  });
});

describe('CleanupGroupList — 결과 처리', () => {
  it('성공하면 선택을 비우고 알린다', async () => {
    renderGroups();
    check('github.com 전체 선택');
    fireEvent.click(deleteTrigger());

    await pressDelete();

    expect(screen.queryByText('선택한 2개를 삭제할까요')).not.toBeInTheDocument();
    expect(deleteTrigger()).toHaveTextContent('선택한 0개 삭제');
    expect(deleteTrigger()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('2개를 삭제했습니다');
  });

  it('성공 뒤 포커스를 잃지 않는다 — 잠긴 버튼 대신 선택 안내가 받는다', async () => {
    renderGroups();
    check('github.com 전체 선택');
    fireEvent.click(deleteTrigger());

    await pressDelete();

    expect(document.body).not.toHaveFocus();
    expect(screen.getByText('선택한 링크가 없습니다')).toHaveFocus();
  });

  it('실패하면 서버가 준 문구를 그대로 알리고 선택은 남긴다 — 다시 시도할 수 있다', async () => {
    vi.mocked(deleteBookmarks).mockResolvedValue({ ok: false, error: '링크를 찾을 수 없습니다.' });
    renderGroups();
    check('github.com 전체 선택');
    fireEvent.click(deleteTrigger());

    await pressDelete();

    expect(screen.getByRole('status')).toHaveTextContent('링크를 찾을 수 없습니다.');
    // 확인은 남는다(다시 누르거나 취소로 나간다) — 선택도 그대로다.
    expect(confirmDeleteButton()).toBeEnabled();
    await pressDelete();
    expect(deleteBookmarks).toHaveBeenCalledTimes(2);
  });

  it('요청이 거부되면 빗장을 풀고 응답 없음 문구를 낸다 (500 을 내지 않는다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deleteBookmarks).mockRejectedValue(new TypeError('fetch failed'));
    renderGroups();
    check('github.com 전체 선택');
    fireEvent.click(deleteTrigger());

    await pressDelete();

    expect(screen.getByRole('status')).toHaveTextContent(REQUEST_FAILED);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[CleanupSelection]'), expect.any(TypeError));
    // 빗장이 풀렸다 — 다시 누르면 또 나간다.
    await pressDelete();
    expect(deleteBookmarks).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe('CleanupLinkList — 평면 목록(방치)', () => {
  it('항목마다 제목 · 주소 · 체크박스를 한 줄로 그린다', () => {
    renderItems();

    const rows = screen.getAllByRole('listitem');

    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('방치 하나')).toBeInTheDocument();
    expect(within(rows[0]).getByText('stale.test')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('checkbox', { name: '방치 하나 선택' })).toBeInTheDocument();
  });

  it('전체 선택으로 한 번에 고르고 한 번에 푼다', () => {
    renderItems();

    check('오래 손대지 않은 링크 전체 선택');
    expect(deleteTrigger()).toHaveTextContent('선택한 3개 삭제');
    for (const title of ['방치 하나', '방치 둘', '방치 셋']) {
      expect(checkbox(`${title} 선택`)).toBeChecked();
    }

    check('오래 손대지 않은 링크 전체 선택');
    expect(deleteTrigger()).toHaveTextContent('선택한 0개 삭제');
  });

  it('고른 것만 넘긴다', async () => {
    renderItems();

    check('방치 둘 선택');
    fireEvent.click(deleteTrigger());
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['s2']);
  });

  it('고른 차례가 아니라 **보이는 차례**로 보낸다', async () => {
    renderItems();

    check('방치 셋 선택');
    check('방치 하나 선택');
    fireEvent.click(deleteTrigger());
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['s1', 's3']);
  });

  /**
   * 체크 집합은 id 만 들고 있어, 다른 창이 링크를 지우고 revalidate 가 도착하면 이미 없는 id 가
   * 남는다. 개수와 요청은 **지금 화면에 있는 것**으로 걸러야 한다 — 안 그러면 사라진 줄이 개수에
   * 끼고, 없는 id 가 삭제 요청에 실려 "일부만 지워졌다"를 스스로 만들어 낸다.
   */
  it('사라진 줄은 개수에도 삭제 요청에도 끼지 않는다', async () => {
    const { rerender } = renderItems();

    check('방치 둘 선택');
    check('방치 셋 선택');
    expect(deleteTrigger()).toHaveTextContent('선택한 2개 삭제');

    rerender(
      <>
        <CleanupLinkList label="오래 손대지 않은 링크" items={[ITEMS[0], ITEMS[2]]} />
        <Toaster />
      </>,
    );

    expect(deleteTrigger()).toHaveTextContent('선택한 1개 삭제');
    fireEvent.click(deleteTrigger());
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['s3']);
  });

  it('항목이 없으면 아무것도 그리지 않는다 — 0건 안내는 바깥 화면의 몫이다', () => {
    const { container } = render(<CleanupLinkList label="오래 손대지 않은 링크" items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
