import { act } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { TOAST_DURATION_MS } from '@/components/Toast';

/**
 * 토스트를 띄우는 테스트 묶음이 부르는 한 줄. `describe` 안에서 부른다.
 *
 * 토스트 스토어는 모듈 레벨이라 상태가 테스트 사이에 남는다(Toast.tsx 규약). 그래서 매 테스트
 * 뒤에 **자동 소멸 경로로** 비운다 — 스토어를 손으로 리셋하는 대신 2초를 흘려보내는 것은
 * 제품이 실제로 지나는 길이 그 길뿐이기 때문이다.
 *
 * `act()` 로 감싸는 이유: 타이머가 깨우는 것은 React 상태 갱신(useSyncExternalStore 구독)이라
 * act 밖에서 일어나면 경고가 난다.
 *
 * D5 에서 여섯 벌로 복제돼 있던 같은 훅 쌍을 여기로 모았다.
 */
export function useToastTimers(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    vi.useRealTimers();
  });
}
