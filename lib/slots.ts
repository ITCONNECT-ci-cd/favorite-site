import type { ReactNode } from 'react';

/**
 * **React 가 이 값을 그리는가.** 슬롯·children 이 "있다"의 판정은 전부 이 한 줄을 쓴다.
 *
 * `undefined`·`null` 뿐 아니라 boolean(`false`·`true` 둘 다)·빈 문자열도 React 는 아무것도 그리지
 * 않으므로 전부 '없음'이다. `undefined` 만 걸러 내면 호출부의 관용구 `{cond && <Row/>}` 가 cond
 * 거짓일 때 넘기는 **false** 가 검사를 통과해, 아무것도 나누지 않는 구분선이나 본문만 사라진 빈
 * 카드가 만들어진다. `false` 한 값이 아니라 `typeof` 로 boolean 전체를 거르는 이유는
 * `cond || <Row/>` 가 cond 참일 때 만드는 **true** 도 똑같이 아무것도 그리지 않기 때문이다.
 * 0·NaN 은 뺀다 — React 는 그 둘을 `"0"`·`"NaN"` 으로 **그리므로** '있음'이 맞다.
 *
 * `[]`·`<></>`·"렌더 결과가 null 인 컴포넌트"도 그리는 것이 없지만, prop 검사로는 자식이 있는
 * 배열·프래그먼트·컴포넌트와 구별되지 않아 **쫓지 않는다**(J1b 가 적어 둔 한계 그대로다).
 *
 * 판정이 세 곳(LinkCard 의 `editSlot` · CategoryHeader · LinkAddRow 의 아래 줄)에 같은 모양으로
 * 복제돼 있던 것을 여기로 모았다 — 규칙이 갈라지면 어느 화면에서만 빈 선이 그어진다.
 */
export function rendersSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== 'boolean' && node !== '';
}
