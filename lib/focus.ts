/**
 * 포커스가 **아무 데도 없는 것과 같은 자리**인가 — `null`·`<body>`·`<html>`.
 *
 * 브라우저는 포커스를 가진 요소가 잠기거나(disabled) 문서에서 빠지면 포커스를 떼어 문서의
 * 뿌리로 보낸다. 그 자리는 "사용자가 두고 온 자리"가 아니라 "잃어버린 자리"라, 화면이 포커스를
 * 되돌려도 아무에게서도 뺏지 않는다. 되돌리기 전에 이것을 먼저 묻는 것이 **포커스 강탈 가드**다.
 *
 * ## `<html>` 까지 세는 이유
 *
 * 떨어진 포커스가 `<body>` 로만 간다고 보면 틈이 생긴다 — `<body>` 가 아직 없거나(문서 조립 중),
 * 문서 뿌리에 tabindex 가 걸려 있거나, 엔진이 `<html>` 을 활성 요소로 두는 경우가 있다.
 * `activeElement` 가 `null` 인 순간도 마찬가지다. 셋 다 "포커스를 잃었다"는 같은 상태이고,
 * 하나라도 빠뜨리면 가드가 그 경로에서만 조용히 통과해 포커스를 되돌리지 않는다.
 *
 * ⚠️ `document` 를 읽으므로 **브라우저에서만** 부른다(effect 안, 또는 서버에서 렌더되지 않는
 * 컴포넌트의 렌더 중).
 */
export function isFocusNowhere(node: Element | null): boolean {
  return node === null || node === document.body || node === document.documentElement;
}
