import { act } from '@testing-library/react';

import type { ActionResult } from '@/lib/mutations';

export type PendingResult = {
  /** 액션 대역이 돌려줄 프라미스. `mockReturnValue(pending.promise)` 로 쓴다. */
  promise: Promise<ActionResult>;
  /** 매달아 둔 응답을 끝낸다 — 단언을 마친 뒤 반드시 부른다. 기본값은 성공이다. */
  finish: (result?: ActionResult) => Promise<void>;
};

/**
 * 아직 끝나지 않은 서버 응답 — **끝내는 손잡이를 함께 돌려준다.**
 *
 * "보내는 중" 을 보려고 `new Promise(() => {})` 로 영영 매달아 두면, 그 요청을 감싼 트랜지션이
 * 열린 채 남는다. React 는 열려 있는 비동기 액션이 있는 동안 낙관값(`useOptimistic`)을 걷지 않고,
 * 그 트랜지션은 **컴포넌트를 언마운트해도 닫히지 않아** 다음 테스트의 낙관값까지 걷히지 않게
 * 만든다 — I4 링크 표에서 실제로 겪은 오염이다(홀로 돌리면 통과하고 함께 돌리면 실패했다).
 *
 * 그래서 매단 응답은 반드시 `finish()` 로 끝낸다. 같은 손잡이를 네 곳이 각자 손으로 만들고
 * 있어(그중 둘은 끝내지도 않았다) 여기로 모았다.
 *
 * `finish` 가 `act` 로 감싸는 이유: 응답이 도착하며 일어나는 상태 갱신이 act 밖이면 경고가 난다.
 */
export function pendingResult(): PendingResult {
  let settle!: (result: ActionResult) => void;
  const promise = new Promise<ActionResult>((resolve) => {
    settle = resolve;
  });

  return {
    promise,
    finish: async (result: ActionResult = { ok: true }) => {
      await act(async () => {
        settle(result);
      });
    },
  };
}
