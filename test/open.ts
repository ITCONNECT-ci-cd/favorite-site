import { afterEach, beforeEach, vi } from 'vitest';

/**
 * 팝업이 실제로 열렸을 때 브라우저가 돌려주는 창 핸들의 대역.
 *
 * `openMany` 가 이 핸들에 하는 일은 `opener` 를 끊는 것 하나뿐이라 그 한 칸만 갖는다. 초깃값을
 * `null` 이 아닌 값으로 두는 것이 핵심이다 — 처음부터 null 이면 "끊었는지"를 단언해도 아무것도
 * 확인하지 못한다(실물 창의 `opener` 도 연 창을 가리킨 채로 온다).
 */
export function openedTab(): Window {
  return { opener: {} } as unknown as Window;
}

/**
 * '한 번에 열기'(G4)가 부르는 `window.open` 을 가로챈다.
 *
 * jsdom 은 `window.open` 을 구현하지 않는다 — 부르면 창이 열리는 대신 "Not implemented" 오류가
 * 가상 콘솔로 흘러나가고 테스트 출력만 더러워진다. 그래서 진짜 대신 스파이를 세운다.
 *
 * 기본은 **열림** 이고 호출마다 **새 핸들**을 준다. 실물에서 차단이 아닌 경우 `window.open` 이
 * 창 참조를 돌려주기 때문이고(호출부가 `noopener` 를 넘기지 않는다 — useCardHandlers.openMany 의
 * 맞바꿈 설명), 같은 객체를 돌려주면 창마다 `opener` 를 끊었는지 구분할 수 없기 때문이다.
 * 차단을 모사하는 테스트가 `mockReturnValue(null)` · `mockReturnValueOnce(...)` 로 덮는다.
 *
 * `describe` 안에서 부르고, 돌려받은 스파이로 호출 인자를 확인한다.
 */
export function setupWindowOpen(): ReturnType<typeof vi.fn<typeof window.open>> {
  const spy = vi.fn<typeof window.open>();

  beforeEach(() => {
    spy.mockReset();
    spy.mockImplementation(() => openedTab());
    vi.stubGlobal('open', spy);
  });

  afterEach(() => {
    // ⚠️ `unstubAllGlobals` 는 이 헬퍼가 세운 것만이 아니라 **그 테스트의 전역 스텁 전부**를
    // 되돌린다 — 같은 파일에서 다른 전역을 stub 하는 묶음과 함께 쓰려면 그쪽 정리와 겹치지
    // 않는지 먼저 확인해라.
    vi.unstubAllGlobals();
  });

  return spy;
}

/** `window.open` 이 받은 주소들 — 부른 순서 그대로. */
export function openedUrls(spy: ReturnType<typeof vi.fn<typeof window.open>>): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

/**
 * 실제로 열린 것으로 판정된 호출이 돌려준 창 핸들들 — 부른 순서 그대로, 차단분(null)은 뺀다.
 * `opener` 를 링크마다 끊었는지 확인하는 데 쓴다.
 */
export function openedTabs(spy: ReturnType<typeof vi.fn<typeof window.open>>): Window[] {
  return spy.mock.results.flatMap((result) =>
    result.type === 'return' && result.value !== null ? [result.value] : [],
  );
}
