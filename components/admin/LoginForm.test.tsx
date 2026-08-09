import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LOGIN_FAILED_MESSAGE, LoginForm, type LoginFormState } from '@/components/admin/LoginForm';

const ADDRESS = 'link.itconnect.dev/admin';

type LoginAction = (state: LoginFormState, formData: FormData) => Promise<LoginFormState>;

/** 성공한 액션 — 실제로는 redirect 로 화면을 떠나므로 여기서는 실패만 아니면 된다. */
const succeed = async (): Promise<LoginFormState> => ({ failed: false });
const fail = async (): Promise<LoginFormState> => ({ failed: true });

/** 인자를 실제로 들여다볼 때는 이 헬퍼로 감싼다 — 인자 없는 스텁을 그냥 vi.fn 에 넘기면 mock.calls 가 빈 튜플로 좁혀진다. */
const spyOn = (impl: () => Promise<LoginFormState>) => vi.fn<LoginAction>(impl);

function renderForm(action: LoginAction = succeed) {
  return render(<LoginForm action={action} address={ADDRESS} />);
}

/** 카드 = form 요소. 알림 박스가 '카드 상단'에 붙는지 보려면 이 기준이 필요하다. */
function card(): HTMLFormElement {
  return screen.getByRole('form', { name: '관리자 로그인' }) as HTMLFormElement;
}

function submit() {
  fireEvent.submit(card());
}

describe('LoginForm — 화면 구성 (DESIGN_SPEC 6장 로그인)', () => {
  it('중앙 396px 컬럼을 사이드바 배경 위에 세운다', () => {
    const { container } = renderForm();
    const screenRoot = container.firstElementChild!;

    expect(screenRoot).toHaveClass('bg-side', 'flex', 'items-center', 'justify-center');
    expect(screenRoot.firstElementChild).toHaveClass('w-[396px]');
  });

  it('주소 표기 → 제목 → 부제 순으로 카드 위에 쌓인다', () => {
    renderForm();

    const address = screen.getByText(ADDRESS);
    const title = screen.getByRole('heading', { name: '관리자 로그인' });

    expect(address).toHaveClass('text-[11px]', 'text-fainter');
    expect(title).toHaveClass('text-[19px]', 'font-bold');
    // 제목 letter-spacing 은 스펙 1장 '화면 제목' 행과 같은 -0.02em.
    expect(title).toHaveClass('tracking-[-0.02em]');
    expect(screen.getByText('고정 관리와 정리 도구')).toHaveClass('text-[12.5px]', 'text-desc');

    // 순서 — 주소가 제목보다, 제목이 카드보다 앞이다.
    expect(address.compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(title.compareDocumentPosition(card())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('흰 카드가 라운드 9px · 패딩 22px 다', () => {
    renderForm();

    expect(card()).toHaveClass('bg-card', 'rounded-[9px]', 'p-[22px]');
  });

  it('이메일·비밀번호 입력이 높이 40px · 라운드 7px 다', () => {
    renderForm();

    for (const label of ['이메일', '비밀번호']) {
      expect(screen.getByLabelText(label)).toHaveClass('h-[40px]', 'rounded-[7px]');
    }
  });

  it('비밀번호 입력은 가려서 받는다', () => {
    renderForm();

    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('type', 'password');
  });

  it('검은 로그인 버튼이 42px 다', () => {
    renderForm();

    const button = screen.getByRole('button', { name: '로그인' });

    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveClass('h-[42px]', 'bg-ink', 'text-white');
  });

  it('프로토타입 계정 안내 박스를 만들지 않는다', () => {
    const { container } = renderForm();

    // 점선 박스 자체가 없어야 한다 — 자격을 화면에 적어 두는 자리였다.
    expect(container.querySelector('.border-dashed')).toBeNull();
    expect(screen.queryByText(/프로토타입 계정/)).not.toBeInTheDocument();
  });
});

describe('LoginForm — 실패 알림', () => {
  it('처음에는 알림 박스가 없다', () => {
    renderForm();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('실패하면 카드 상단에 회색 알림 박스가 붙는다', async () => {
    renderForm(fail);
    submit();

    const alert = await screen.findByRole('alert');

    // '카드 상단' — 카드의 첫 자식이다.
    expect(card().firstElementChild).toBe(alert);
    expect(alert).toHaveClass('bg-side', 'border-dash', 'rounded-[6px]');
  });

  it('실패 사유를 이메일/비밀번호로 나누지 않는다', async () => {
    renderForm(fail);
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(LOGIN_FAILED_MESSAGE);
    expect(LOGIN_FAILED_MESSAGE).toBe('이메일 또는 비밀번호를 확인해 주세요');
  });

  /**
   * 문구가 아니라 **계약**을 잠근다. 액션이 돌려줄 수 있는 것이 boolean 하나면
   * "그 이메일은 없는 계정입니다" 같은 사유가 흘러나올 통로 자체가 없다.
   * 이 테스트가 깨진다면 state 에 사유를 실을 자리가 생겼다는 뜻이다.
   */
  it('액션이 돌려주는 값에는 사유를 실을 자리가 없다', async () => {
    const action = spyOn(fail);
    renderForm(action);
    submit();

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(Object.keys(await action.mock.results[0]!.value)).toEqual(['failed']);
  });

  it('다시 제출해 성공하면 알림 박스가 사라진다', async () => {
    const action = vi.fn<LoginAction>().mockImplementationOnce(fail).mockImplementationOnce(succeed);

    renderForm(action);
    submit();
    await screen.findByRole('alert');

    submit();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('LoginForm — 제출', () => {
  it('입력한 이메일·비밀번호를 액션에 넘긴다', async () => {
    const action = spyOn(succeed);
    renderForm(action);

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw-1234' } });
    submit();

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    const formData = action.mock.calls[0]![1];
    expect(formData.get('email')).toBe('admin@example.com');
    expect(formData.get('password')).toBe('pw-1234');
  });

  it('제출 중에는 버튼을 잠근다 — 두 번 눌러 두 번 로그인하지 않는다', async () => {
    let release!: (state: LoginFormState) => void;
    const action = vi.fn(
      () =>
        new Promise<LoginFormState>((resolve) => {
          release = resolve;
        }),
    );

    renderForm(action);
    submit();

    const button = screen.getByRole('button', { name: '로그인' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');

    release({ failed: false });
    await waitFor(() => expect(button).toBeEnabled());
  });
});
