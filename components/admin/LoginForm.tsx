'use client';

import { useActionState, useId, useState } from 'react';

/**
 * 로그인 실패 문구 — **하나뿐이다.**
 *
 * "없는 계정입니다" / "비밀번호가 틀렸습니다" 로 나누면 아무나 POST 를 던져 어떤 이메일이
 * 계정으로 존재하는지 확인할 수 있다(계정 열거). 사내 서비스라도 관리자 계정 하나가 표적이
 * 되는 건 마찬가지다. 그래서 DESIGN_SPEC 6장이 "사유를 이메일/비밀번호로 나누지 않는다"를
 * 못박았고, 아래 `LoginFormState` 가 그 규칙을 타입으로 강제한다.
 */
export const LOGIN_FAILED_MESSAGE = '이메일 또는 비밀번호를 확인해 주세요';

/**
 * 서버 액션이 화면에 돌려줄 수 있는 전부.
 *
 * **`string` 이 아니라 `boolean` 인 것이 핵심이다.** 문구를 서버가 실어 보내는 구조였다면
 * 누군가 친절을 베풀어 "비밀번호가 다릅니다" 를 넣는 순간 사유가 새어 나가고, 그건 코드 리뷰가
 * 놓치기 쉬운 종류의 변경이다. 실을 수 있는 값이 참/거짓뿐이면 새어 나갈 통로 자체가 없다.
 * **이 타입에 사유·코드·필드 이름을 추가하지 마라.**
 */
export type LoginFormState = { failed: boolean };

const INITIAL_STATE: LoginFormState = { failed: false };

type LoginFormProps = {
  /**
   * 로그인 서버 액션(`app/admin/actions.ts`). 성공하면 액션이 redirect 로 이 화면을 떠나므로
   * `{ failed: false }` 가 화면에 반영되는 일은 실제로는 없다.
   *
   * 컴포넌트가 액션을 직접 import 하지 않고 prop 으로 받는 이유는, 이 파일이 클라이언트
   * 컴포넌트라 서버 모듈을 끌어오면 경계가 흐려지고 테스트에서 갈아 끼울 수도 없어서다.
   */
  action: (state: LoginFormState, formData: FormData) => Promise<LoginFormState>;
  /** 제목 위 11px 주소 표기. 어느 주소로 들어와 있는지 알려 주는 줄이다. */
  address: string;
};

/**
 * 이메일·비밀번호 입력이 공유하는 치수 (DESIGN_SPEC 6장: 높이 40px, 라운드 7px).
 *
 * 아래 여백(`mb-*`)은 일부러 빼 뒀다 — 두 입력의 값이 다른데(16px / 20px) 여기에 기본값을
 * 두고 한쪽만 덮어쓰면 **클래스를 적은 순서로는 승부가 나지 않는다.** 같은 유틸의 두 값은
 * 특정도가 같아서 생성된 CSS 의 순서가 이기고, 그건 우리가 정하는 값이 아니다.
 */
const FIELD_CLASS =
  'block h-[40px] w-full rounded-[7px] border border-border-strong bg-card px-[12px] text-[13px] text-ink';

/** 입력 라벨 — 프로토타입의 12px/600. */
const LABEL_CLASS = 'mb-[7px] block text-[12px] font-semibold text-ink';

/**
 * 관리자 로그인 화면 — `/admin` (DESIGN_SPEC 6장).
 *
 * 미인증 상태에서 `app/admin/layout.tsx` 가 **children 대신** 이것만 렌더한다. 화면 전체를
 * 사이드바 배경(`bg-side`)으로 덮고 396px 컬럼을 가운데 세운다 — 공개 셸(사이드바·헤더)은
 * 여기에 없다. 관리 라우트가 `(public)` 라우트 그룹 밖에 있어서 상속되지 않기 때문이다.
 *
 * 프로토타입 하단의 점선 '프로토타입 계정' 안내 박스는 만들지 않는다 — 자격을 화면에 적어
 * 두는 자리였다(스펙도 "제품에서는 제거").
 *
 * 입력의 `required`·`type="email"` 이 띄우는 브라우저 말풍선("이 입력란을 작성하세요")은
 * **자격을 검증하기 전 단계**라 사유 비구분과 무관하다 — 어떤 계정이 존재하는지 알려 주지
 * 않는다. 서버도 빈 입력을 같은 `{ failed: true }` 로 접으므로(actions.ts), 말풍선을 지운다고
 * 더 안전해지지도 않는다. 지우면 키보드만 쓰는 사람이 빈 폼을 왕복하게 될 뿐이다.
 */
export function LoginForm({ action, address }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const titleId = useId();
  const emailId = useId();
  const passwordId = useId();

  /**
   * 이메일만 제어 입력으로 든다 — **실패해도 지워지지 않게** 하려고.
   *
   * React 19 는 `action` 을 가진 폼을 제출이 끝날 때 `requestFormReset` 으로 되돌린다.
   * 성공하면 화면을 떠나므로 보이지 않지만, 실패해서 같은 화면에 남는 경우에는 비제어
   * 입력이 전부 비워진다 — 자격이 틀렸다는 안내 옆에서 이메일까지 사라지면 매번 다시 친다.
   *
   * 비밀번호는 **일부러 리셋되는 대로 둔다.** 틀린 비밀번호는 다시 치는 것이 맞고, 화면에
   * 남겨 둘 값도 아니다.
   *
   * 실패 여부를 여기서 쓰지 않는다는 점이 중요하다: `LoginFormState` 는 `{ failed: boolean }`
   * 하나로 잠겨 있고(그 타입 주석), 이 보존은 상태를 늘리지 않고 입력 자신의 값으로 해결한다.
   */
  const [email, setEmail] = useState('');

  return (
    <div className="flex h-full items-center justify-center bg-side px-[12px] py-[24px]">
      <div className="w-[396px] max-w-full">
        <p className="mb-[10px] text-[11px] text-fainter">{address}</p>

        <h1 id={titleId} className="mb-[4px] text-[19px] font-bold tracking-[-0.02em] text-ink">
          관리자 로그인
        </h1>

        <p className="mb-[22px] text-[12.5px] text-desc">고정 관리와 정리 도구</p>

        {/* 카드 = form. 알림 박스가 '카드 상단'이라는 스펙 문구가 곧 '폼의 첫 자식'이 된다. */}
        <form
          action={formAction}
          aria-labelledby={titleId}
          className="rounded-[9px] border border-border-strong bg-card p-[22px]"
        >
          {state.failed ? (
            /* role="alert" — 제출 뒤에 나타나는 내용이라 스크린 리더가 그 자리에서 읽어야 한다.
               왼쪽 3px 검은 막대는 장식이므로 aria-hidden 이다. */
            <p
              role="alert"
              className="mb-[18px] flex gap-[10px] rounded-[6px] border border-dash bg-side px-[12px] py-[11px] text-[12.5px] font-semibold text-ink"
            >
              <span aria-hidden="true" className="w-[3px] flex-none rounded-[2px] bg-ink" />
              {LOGIN_FAILED_MESSAGE}
            </p>
          ) : null}

          <label htmlFor={emailId} className={LABEL_CLASS}>
            이메일
          </label>
          {/* value/onChange 는 장식이 아니다 — 이게 없으면 실패 제출마다 이메일이 지워진다. */}
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={`${FIELD_CLASS} mb-[16px]`}
          />

          <label htmlFor={passwordId} className={LABEL_CLASS}>
            비밀번호
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            /* 비밀번호 아래만 20px — 버튼과의 간격이 입력 사이 간격보다 넓다(프로토타입). */
            className={`${FIELD_CLASS} mb-[20px]`}
          />

          {/* 제출 중 잠금: 두 번 눌러 로그인 요청이 두 번 나가는 것을 막는다.
              문구는 바꾸지 않는다 — 스펙이 정한 버튼 이름은 '로그인' 하나다. */}
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="flex h-[42px] w-full items-center justify-center rounded-[7px] bg-ink text-[13.5px] font-semibold text-white hover:bg-ink-hover disabled:opacity-60"
          >
            로그인
          </button>
        </form>
      </div>
    </div>
  );
}
