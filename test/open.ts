import { afterEach, beforeEach, vi } from 'vitest';

/**
 * '한 번에 열기'(G4)가 부르는 `window.open` 을 가로챈다.
 *
 * jsdom 은 `window.open` 을 구현하지 않는다 — 부르면 창이 열리는 대신 "Not implemented" 오류가
 * 가상 콘솔로 흘러나가고 테스트 출력만 더러워진다. 그래서 진짜 대신 스파이를 세운다.
 *
 * 돌려주는 값은 **언제나 null** 이다. 실물도 그렇다: `noopener` 로 연 창은 규격상 참조를
 * 돌려주지 않으므로, 차단됐는지 열렸는지 호출부가 알 수 없다(그래서 토스트가 팝업 차단을
 * 무조건 안내한다 — 계획서 V4).
 *
 * `describe` 안에서 부르고, 돌려받은 스파이로 호출 인자를 확인한다.
 */
export function setupWindowOpen(): ReturnType<typeof vi.fn<typeof window.open>> {
  const spy = vi.fn<typeof window.open>();

  beforeEach(() => {
    spy.mockReset();
    spy.mockReturnValue(null);
    vi.stubGlobal('open', spy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return spy;
}

/** `window.open` 이 받은 주소들 — 부른 순서 그대로. */
export function openedUrls(spy: ReturnType<typeof vi.fn<typeof window.open>>): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}
