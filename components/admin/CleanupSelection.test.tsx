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
  CONFIRM_ARM_MS,
  LINKS_PER_PAGE,
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

/**
 * 방치 링크 N건 — 쪽 넘김을 보는 묶음이 쓴다. 번호를 제목과 id 에 함께 달아 **몇 번째 줄이
 * 지금 화면에 있는지**를 이름만으로 확인할 수 있게 한다(쪽이 바뀌면 이름이 통째로 갈린다).
 */
function manyItems(count: number): CleanupItem[] {
  return Array.from({ length: count }, (_, index) =>
    item(`p${index + 1}`, `방치 ${index + 1}`, 'stale.test'),
  );
}

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
/* 세 구역이 한 화면에 서므로 버튼 이름은 구역으로 갈라져 있다(`${구역} 삭제 확인` — SubCategoryRow
   규칙). 여기서는 한 구역만 그리므로 꼬리로 찾는다. */
const deleteTrigger = () => screen.getByRole('button', { name: /선택한 \d+개 삭제$/ });
const confirmDeleteButton = () => screen.getByRole('button', { name: /삭제 확인$/ });
const cancelButton = () => screen.getByRole('button', { name: /삭제 취소$/ });

/* 쪽 넘김도 같은 규칙으로 구역 이름을 앞에 단다(위 삭제 버튼과 짝) — 꼬리로 찾는다. */
const prevPage = () => screen.getByRole('button', { name: /이전 쪽$/ });
const nextPage = () => screen.getByRole('button', { name: /다음 쪽$/ });
const pagePosition = () => screen.getByText(/^\d+ \/ \d+ 쪽$/);
/** 지금 그려진 줄의 번호들 — 쪽이 바뀌면 통째로 갈린다(구역 전체 선택은 세지 않는다). */
const shownNumbers = () =>
  screen
    .getAllByRole('checkbox', { name: /^방치 \d+ 선택$/ })
    .map((box) => Number(box.getAttribute('aria-label')?.split(' ')[1]));

/** 체크박스 하나를 누른다 — 제어 컴포넌트라 click 이 change 까지 함께 일으킨다. */
function check(name: string): void {
  fireEvent.click(checkbox(name));
}

/**
 * 확인을 열고 `삭제` 의 빗장이 풀릴 때까지 흘려보낸다.
 *
 * 확인 줄은 트리거가 있던 자리를 그대로 차지하므로 `삭제` 는 잠긴 채로 서고 `CONFIRM_ARM_MS`
 * 뒤에 풀린다(트리거 더블클릭의 두 번째 클릭을 받지 않기 위해서다). 그 잠금 자체는 아래
 * "확인을 연 클릭의 잔상" 테스트가 보고, 나머지 테스트는 열린 뒤의 일을 보므로 여기로 묶는다.
 */
function openConfirm(): void {
  fireEvent.click(deleteTrigger());
  act(() => {
    vi.advanceTimersByTime(CONFIRM_ARM_MS);
  });
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

  /**
   * `lib/cleanup.ts` 판정상 빈 그룹은 나오지 않지만, 개수만 견주면 `0 === 0` 이 "전부 골랐다"가
   * 된다. 구역 전체 선택(`BulkBar`)은 같은 자리에서 길이를 함께 보므로, 한 파일 안에서 같은
   * 판정이 두 규칙으로 갈라지지 않게 못박는다.
   */
  it('빈 그룹의 전체 선택은 "전부 골랐다"로 서지 않는다', () => {
    renderGroups([{ key: 'empty.test', label: 'empty.test', preview: '', items: [] }]);

    expect(checkbox('empty.test 전체 선택')).not.toBeChecked();
    expect(deleteTrigger()).toBeDisabled();
  });
});

describe('CleanupGroupList — 확인 없이는 지우지 않는다', () => {
  it('삭제 버튼을 눌러도 확인 전에는 액션에 닿지 않는다', () => {
    renderGroups();
    check('github.com 전체 선택');

    openConfirm();

    expect(deleteBookmarks).not.toHaveBeenCalled();
    expect(screen.getByText('선택한 2개를 삭제할까요')).toBeInTheDocument();
    expect(confirmDeleteButton()).toBeInTheDocument();
    expect(cancelButton()).toBeInTheDocument();
  });

  it('확인이 뜨면 포커스가 취소로 간다 — 되돌릴 수 없는 쪽에 손이 놓이지 않는다', () => {
    renderGroups();
    check('github.com 전체 선택');

    openConfirm();

    expect(cancelButton()).toHaveFocus();
  });

  /**
   * 포커스가 `취소` 로 가므로, 묻는 문장이 그 자리에서 낭독되지 않으면 화면을 볼 수 없는
   * 사용자에게 들리는 것은 "취소, 버튼"뿐이다 — 무엇을 몇 개 지우는지 끝내 알 수 없다.
   * 이 저장소가 카테고리 삭제·하위 삭제·로그인 실패에 세워 둔 `role="alert"` 와 같은 짝이고,
   * `aria-describedby` 는 포커스가 어느 버튼에 있어도 문장이 함께 읽히게 한다.
   */
  it('묻는 문장이 role="alert" 로 서고, 두 버튼이 그 문장을 물고 있다', () => {
    renderGroups();
    check('github.com 전체 선택');

    openConfirm();

    expect(screen.getByRole('alert')).toHaveTextContent('선택한 2개를 삭제할까요');
    expect(confirmDeleteButton()).toHaveAccessibleDescription('선택한 2개를 삭제할까요');
    expect(cancelButton()).toHaveAccessibleDescription('선택한 2개를 삭제할까요');
  });

  /**
   * 확인 줄은 트리거가 있던 자리를 그대로 차지한다(제자리 교체). 트리거는 `취소` 보다 넓으므로
   * 그 발자국 왼쪽 절반이 새로 선 `삭제` 위에 오고, 더블클릭의 두 번째 클릭이 거기 떨어진다 —
   * 되돌릴 수 없는 일괄 삭제가 확인 없이 나가는 길이다. 열린 직후에는 잠가서 그 잔상을 받지 않는다.
   */
  it('확인을 연 클릭의 잔상이 삭제를 누르지 않는다 — 열린 직후의 삭제는 잠겨 있다', async () => {
    renderGroups();
    check('github.com 전체 선택');

    fireEvent.click(deleteTrigger());

    expect(confirmDeleteButton()).toBeDisabled();
    await pressDelete();
    expect(deleteBookmarks).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(CONFIRM_ARM_MS);
    });

    expect(confirmDeleteButton()).toBeEnabled();
    await pressDelete();
    expect(deleteBookmarks).toHaveBeenCalledOnce();
  });

  it('취소하고 다시 열어도 삭제는 또 잠긴 채로 선다 — 빗장은 열 때마다 새로 걸린다', () => {
    renderGroups();
    check('github.com 전체 선택');

    openConfirm();
    fireEvent.click(cancelButton());
    fireEvent.click(deleteTrigger());

    expect(confirmDeleteButton()).toBeDisabled();
  });

  /**
   * 세 구역의 바가 한 화면에 서므로 글자만 보면 `삭제`·`취소` 가 셋씩이고, `선택한 N개 삭제` 는
   * 개수가 겹치는 순간 완전히 같아진다(SubCategoryRow 가 문서화한 규칙 — 이름을 구역으로 가른다).
   */
  it('버튼 이름 앞에 구역이 선다 — 이름만 듣는 사람에게 같은 버튼이 여럿이 되지 않는다', () => {
    renderGroups();
    check('github.com 전체 선택');

    expect(deleteTrigger()).toHaveAccessibleName('같은 도메인에서 선택한 2개 삭제');

    openConfirm();

    expect(confirmDeleteButton()).toHaveAccessibleName('같은 도메인 삭제 확인');
    expect(cancelButton()).toHaveAccessibleName('같은 도메인 삭제 취소');
  });

  it('확인하는 동안에는 선택을 바꿀 수 없다 — 묻는 개수와 지우는 개수가 갈리면 안 된다', () => {
    renderGroups();
    check('github.com 전체 선택');

    openConfirm();

    expect(checkbox('깃헙 A 선택')).toBeDisabled();
    expect(checkbox('github.com 전체 선택')).toBeDisabled();
  });

  it('취소하면 아무것도 지우지 않고 선택도 그대로 두며, 포커스를 누른 자리로 돌려준다', () => {
    renderGroups();
    check('github.com 전체 선택');

    openConfirm();
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

    openConfirm();
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['g2', 'l1']);
  });

  it('같은 틱에 두 번 눌러도 한 번만 보낸다 — 화면이 다시 그려지기 전의 두 번째 클릭', async () => {
    renderGroups();
    check('github.com 전체 선택');
    openConfirm();

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
    openConfirm();

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
    openConfirm();

    await pressDelete();

    expect(screen.queryByText('선택한 2개를 삭제할까요')).not.toBeInTheDocument();
    expect(deleteTrigger()).toHaveTextContent('선택한 0개 삭제');
    expect(deleteTrigger()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('2개를 삭제했습니다');
  });

  it('성공 뒤 포커스를 잃지 않는다 — 잠긴 버튼 대신 선택 안내가 받는다', async () => {
    renderGroups();
    check('github.com 전체 선택');
    openConfirm();

    await pressDelete();

    expect(screen.getByText('선택한 링크가 없습니다')).toHaveFocus();
  });

  it('실패하면 서버가 준 문구를 그대로 알리고 선택은 남긴다 — 다시 시도할 수 있다', async () => {
    vi.mocked(deleteBookmarks).mockResolvedValue({ ok: false, error: '링크를 찾을 수 없습니다.' });
    renderGroups();
    check('github.com 전체 선택');
    openConfirm();

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
    openConfirm();

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
    openConfirm();
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['s2']);
  });

  it('고른 차례가 아니라 **보이는 차례**로 보낸다', async () => {
    renderItems();

    check('방치 셋 선택');
    check('방치 하나 선택');
    openConfirm();
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
    openConfirm();
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['s3']);
  });

  /**
   * 확인이 열려 있는 동안 revalidate 로 고른 줄이 사라질 수 있다(선택은 잠겨 있어도 목록은
   * 바깥에서 바뀐다). 그때 `삭제` 가 활성인 채로 남으면 눌러도 조용히 아무 일도 일어나지 않아
   * 고장처럼 보인다 — 잠가서 지울 것이 없다는 사실을 드러낸다.
   */
  it('확인 중에 고른 줄이 사라지면 삭제를 잠근다 — 눌러도 아무 일 없는 버튼을 남기지 않는다', () => {
    const { rerender } = renderItems();

    check('방치 둘 선택');
    openConfirm();
    expect(confirmDeleteButton()).toBeEnabled();

    rerender(
      <>
        <CleanupLinkList label="오래 손대지 않은 링크" items={[ITEMS[0], ITEMS[2]]} />
        <Toaster />
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('선택한 0개를 삭제할까요');
    expect(confirmDeleteButton()).toBeDisabled();
  });

  it('항목이 없으면 아무것도 그리지 않는다 — 0건 안내는 바깥 화면의 몫이다', () => {
    const { container } = render(<CleanupLinkList label="오래 손대지 않은 링크" items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * ③ 방치 목록의 **쪽 넘김**. 기본 기준(180일)에서 211건이 한꺼번에 서던 화면을 자른 장치다
 * (사용자 요구: "20개까지 보이게 하고 페이지네이션 처리… 너무 길어").
 *
 * 이 묶음이 못박는 것은 두 가지다. 하나는 **자르는 규칙**(20개씩, 한 쪽뿐이면 컨트롤을 그리지
 * 않는다), 다른 하나는 **선택의 의미가 쪽 단위로 유지되는가**다: `useCleanupSelection` 의
 * "고른 것은 지금 화면에 있는 것뿐" 이 이제 목록 전체가 아니라 이 쪽을 뜻하므로, 전체 선택도
 * 개수도 삭제 요청도 현재 쪽에서만 나오고 쪽을 넘기면 체크가 비워져야 한다.
 *
 * 서버 왕복(`?page=`)이 아니라 클라이언트에서 자르는 이유는 기준 탭과 다르다 — 기준 탭은
 * `cleanup_abandoned` rpc 를 다시 쳐야 해서 URL 이지만(CleanupView JSDoc), 쪽 넘김은 이미 받아
 * 둔 배열을 자를 뿐이라 서버에 물을 것이 없다(통계 기간 탭과 같은 선례).
 */
describe('CleanupLinkList — 쪽 넘김 (한 쪽에 20개)', () => {
  it('한 쪽에 딱 차는 만큼이면 쪽 넘김 줄을 아예 그리지 않는다 — 쪽이 하나뿐인데 컨트롤은 군더더기다', () => {
    renderItems(manyItems(LINKS_PER_PAGE));

    expect(shownNumbers()).toHaveLength(LINKS_PER_PAGE);
    expect(screen.queryByRole('button', { name: /이전 쪽$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /다음 쪽$/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/쪽$/)).not.toBeInTheDocument();
  });

  it('한 줄만 넘쳐도 두 쪽으로 갈린다 — 첫 쪽은 앞의 20개뿐이다', () => {
    renderItems(manyItems(LINKS_PER_PAGE + 1));

    expect(shownNumbers()).toEqual(Array.from({ length: LINKS_PER_PAGE }, (_, i) => i + 1));
    expect(screen.queryByRole('checkbox', { name: '방치 21 선택' })).not.toBeInTheDocument();
    expect(pagePosition()).toHaveTextContent('1 / 2 쪽');
  });

  it('다음·이전이 목록 내용을 바꾼다 — 마지막 쪽은 남은 만큼만 그린다', () => {
    renderItems(manyItems(LINKS_PER_PAGE + 1));

    fireEvent.click(nextPage());

    expect(shownNumbers()).toEqual([21]);
    expect(screen.queryByRole('checkbox', { name: '방치 1 선택' })).not.toBeInTheDocument();
    expect(pagePosition()).toHaveTextContent('2 / 2 쪽');

    fireEvent.click(prevPage());

    expect(shownNumbers()).toEqual(Array.from({ length: LINKS_PER_PAGE }, (_, i) => i + 1));
    expect(pagePosition()).toHaveTextContent('1 / 2 쪽');
  });

  it('끝에 닿은 쪽 넘김 버튼은 잠긴다 — 첫 쪽의 `이전`, 마지막 쪽의 `다음`', () => {
    renderItems(manyItems(LINKS_PER_PAGE * 2 + 1));

    expect(prevPage()).toBeDisabled();
    expect(nextPage()).toBeEnabled();

    fireEvent.click(nextPage());
    expect(prevPage()).toBeEnabled();
    expect(nextPage()).toBeEnabled();

    fireEvent.click(nextPage());
    expect(pagePosition()).toHaveTextContent('3 / 3 쪽');
    expect(nextPage()).toBeDisabled();
  });

  /**
   * 체크를 비우지 않으면 `checked` 에 남은 이전 쪽 선택이 그 쪽으로 돌아왔을 때 되살아나, 사용자가
   * 고른 적 없다고 생각하는 것이 체크된 채로 선다. 되돌릴 수 없는 삭제 화면에서 그것은 확인 단계를
   * 무력화한다(같은 이유로 이 화면은 `CONFIRM_ARM_MS` 무장 지연을 둔다).
   */
  it('쪽을 넘기면 체크를 비운다 — 되돌아와도 이전 쪽 선택이 되살아나지 않는다', () => {
    renderItems(manyItems(LINKS_PER_PAGE + 1));

    check('방치 1 선택');
    check('방치 2 선택');
    expect(deleteTrigger()).toHaveTextContent('선택한 2개 삭제');

    fireEvent.click(nextPage());
    expect(deleteTrigger()).toHaveTextContent('선택한 0개 삭제');

    fireEvent.click(prevPage());
    expect(checkbox('방치 1 선택')).not.toBeChecked();
    expect(checkbox('방치 2 선택')).not.toBeChecked();
    expect(deleteTrigger()).toHaveTextContent('선택한 0개 삭제');
  });

  it("'전체 선택'은 현재 쪽 20개만 고른다 — 개수는 언제나 눈에 보이는 것만 센다", () => {
    renderItems(manyItems(LINKS_PER_PAGE * 2 + 1));

    check('오래 손대지 않은 링크 전체 선택');

    expect(deleteTrigger()).toHaveTextContent(`선택한 ${LINKS_PER_PAGE}개 삭제`);
    expect(checkbox('오래 손대지 않은 링크 전체 선택')).toBeChecked();

    // 마지막 쪽은 한 줄뿐이므로 같은 상자가 1개만 고른다 — '전부'의 뜻이 쪽마다 달라진다.
    fireEvent.click(nextPage());
    fireEvent.click(nextPage());
    check('오래 손대지 않은 링크 전체 선택');
    expect(deleteTrigger()).toHaveTextContent('선택한 1개 삭제');
  });

  it('삭제 요청에도 현재 쪽의 id 만 실린다', async () => {
    renderItems(manyItems(LINKS_PER_PAGE + 3));

    fireEvent.click(nextPage());
    check('오래 손대지 않은 링크 전체 선택');
    openConfirm();
    await pressDelete();

    expect(deleteBookmarks).toHaveBeenCalledExactlyOnceWith(['p21', 'p22', 'p23']);
  });

  /**
   * 확인이 열려 있는 동안 쪽이 넘어가면 화면이 물은 개수("선택한 3개를 삭제할까요")와 실제로
   * 지우는 개수가 갈린다 — `confirming` 이 선택 훅에 사는 이유가 그것이고, 쪽 넘김도 같은 빗장을
   * 나눠 진다.
   */
  it('확인이 열려 있는 동안에는 쪽을 넘길 수 없다', () => {
    renderItems(manyItems(LINKS_PER_PAGE * 2 + 1));

    fireEvent.click(nextPage());
    check('방치 21 선택');
    openConfirm();

    expect(prevPage()).toBeDisabled();
    expect(nextPage()).toBeDisabled();

    fireEvent.click(nextPage());
    expect(pagePosition()).toHaveTextContent('2 / 3 쪽');
    expect(screen.getByRole('alert')).toHaveTextContent('선택한 1개를 삭제할까요');
  });

  it('서버 왕복 중에도 쪽 넘김은 잠겨 있다', async () => {
    renderItems(manyItems(LINKS_PER_PAGE * 2 + 1));

    fireEvent.click(nextPage());
    check('방치 21 선택');
    openConfirm();

    const finish = pending();
    await act(async () => {
      fireEvent.click(confirmDeleteButton());
    });

    expect(prevPage()).toBeDisabled();
    expect(nextPage()).toBeDisabled();

    await finish();
  });

  /**
   * 삭제가 성공하면 서버가 목록을 다시 그려 `items` 가 짧아진다. 마지막 쪽에 있던 것을 전부
   * 지우면 그 쪽 번호가 사라지는데, 그대로 두면 빈 목록이 뜬다 — 마지막 쪽으로 물린다.
   */
  it('items 가 짧아져 지금 쪽이 사라지면 마지막 쪽으로 물린다 — 빈 화면을 남기지 않는다', () => {
    const { rerender } = renderItems(manyItems(LINKS_PER_PAGE * 2 + 1));

    fireEvent.click(nextPage());
    fireEvent.click(nextPage());
    expect(pagePosition()).toHaveTextContent('3 / 3 쪽');

    rerender(
      <>
        <CleanupLinkList label="오래 손대지 않은 링크" items={manyItems(LINKS_PER_PAGE * 2)} />
        <Toaster />
      </>,
    );

    expect(pagePosition()).toHaveTextContent('2 / 2 쪽');
    expect(shownNumbers()).toEqual(
      Array.from({ length: LINKS_PER_PAGE }, (_, i) => i + 1 + LINKS_PER_PAGE),
    );
  });

  it('한 쪽에 담길 만큼 짧아지면 쪽 넘김 줄이 통째로 사라진다', () => {
    const { rerender } = renderItems(manyItems(LINKS_PER_PAGE + 1));

    fireEvent.click(nextPage());
    expect(shownNumbers()).toEqual([21]);

    rerender(
      <>
        <CleanupLinkList label="오래 손대지 않은 링크" items={manyItems(LINKS_PER_PAGE)} />
        <Toaster />
      </>,
    );

    expect(screen.queryByRole('button', { name: /다음 쪽$/ })).not.toBeInTheDocument();
    expect(shownNumbers()).toEqual(Array.from({ length: LINKS_PER_PAGE }, (_, i) => i + 1));
  });

  /**
   * 눌러서 잠긴 버튼은 포커스를 잃는다(브라우저가 떼어 문서 뿌리로 보낸다) — 이 저장소는 그런
   * 전환에서 포커스를 건져 내는 것을 표준으로 지켜 왔다(`BulkBar` 의 `restoreTrigger`·DeleteConfirm).
   * 여기서는 반대쪽 버튼이 받는다: 끝 쪽에서 갈 수 있는 방향은 그쪽뿐이다.
   */
  it('마지막 쪽에 닿아 `다음` 이 잠기면 포커스가 `이전` 으로 간다', () => {
    renderItems(manyItems(LINKS_PER_PAGE + 1));

    fireEvent.click(nextPage());

    expect(nextPage()).toBeDisabled();
    expect(prevPage()).toHaveFocus();
  });

  it('첫 쪽으로 돌아와 `이전` 이 잠기면 포커스가 `다음` 으로 간다', () => {
    renderItems(manyItems(LINKS_PER_PAGE + 1));

    fireEvent.click(nextPage());
    fireEvent.click(prevPage());

    expect(prevPage()).toBeDisabled();
    expect(nextPage()).toHaveFocus();
  });

  it('가운데 쪽으로 옮길 때는 포커스를 건드리지 않는다 — 누른 버튼이 그대로 살아 있다', () => {
    renderItems(manyItems(LINKS_PER_PAGE * 2 + 1));

    fireEvent.click(nextPage());

    expect(pagePosition()).toHaveTextContent('2 / 3 쪽');
    expect(nextPage()).toBeEnabled();
    expect(prevPage()).not.toHaveFocus();
    expect(nextPage()).not.toHaveFocus();
  });

  /**
   * 쪽이 바뀐 것은 눈에만 보인다 — 위치 표시가 live 영역이라야 화면을 보지 않는 사용자도 옮겨 간
   * 것을 안다. 목록 `aria-label` 갱신과 **둘 다** 하면 같은 것이 두 번 읽히므로 한 곳에서만 한다.
   */
  it('위치 표시가 live 영역이고, 낭독은 그 한 곳에서만 한다', () => {
    renderItems(manyItems(LINKS_PER_PAGE + 1));

    expect(pagePosition()).toHaveAttribute('aria-live', 'polite');

    const list = screen.getByRole('list');
    expect(list).not.toHaveAttribute('aria-live');
    expect(list).not.toHaveAttribute('aria-label');
  });

  /* 세 구역의 바가 한 화면에 서므로 버튼 이름은 구역으로 갈라 둔다(삭제 버튼과 같은 규칙). */
  it('쪽 넘김 버튼 이름에도 구역이 선다', () => {
    renderItems(manyItems(LINKS_PER_PAGE + 1));

    expect(prevPage()).toHaveAccessibleName('오래 손대지 않은 링크 이전 쪽');
    expect(nextPage()).toHaveAccessibleName('오래 손대지 않은 링크 다음 쪽');
    expect(prevPage()).toHaveTextContent('이전');
    expect(nextPage()).toHaveTextContent('다음');
  });
});
