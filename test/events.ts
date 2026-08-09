import { fireEvent } from '@testing-library/react';

/**
 * fireEvent 에는 auxClick 헬퍼가 없어 이벤트를 직접 만들어 쏜다.
 *
 * 카드의 열기 영역은 진짜 앵커라 가운데 클릭(새 탭)·우클릭(메뉴)이 브라우저 기본 동작으로
 * 살아 있고, 우리는 그중 '여는 것'만 센다(C2). 그 경계를 테스트가 확인하려면 button 번호를
 * 실어 보내야 한다.
 *
 * D5 에서 세 벌로 복제돼 있던 같은 헬퍼를 여기로 모았다.
 */
export function auxClick(element: Element, button: number): boolean {
  return fireEvent(
    element,
    new MouseEvent('auxclick', { bubbles: true, cancelable: true, button }),
  );
}

/** 가운데 클릭 = 새 탭 (button 1). 왼쪽 클릭은 click 이라 auxclick 으로 오지 않는다. */
export function middleClick(element: Element): boolean {
  return auxClick(element, 1);
}

/** 우클릭 (button 2) — 메뉴만 연다. 여는 것이 아니므로 세지 않는다. */
export function rightClick(element: Element): boolean {
  return auxClick(element, 2);
}
