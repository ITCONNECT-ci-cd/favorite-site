/**
 * 끌어 온 항목을 대상 항목 **자리에** 끼워 넣은 새 목록 (프로토타입 `dropOn`).
 *
 * 인덱스는 **빼내기 전에** 잡는다 — 그래서 뒤에서 앞으로 끌면 대상 앞에, 앞에서 뒤로 끌면 대상
 * 뒤에 놓인다. 이 비대칭이 곧 사람이 기대하는 결과다("이 카드 위에 놓았다" = 그 자리를 차지한다).
 *
 * 원본을 건드리지 않는 순수 함수다. 둘 중 하나라도 목록에 없으면 **복사본을 그대로** 돌려준다 —
 * 다른 목록에서 시작한 드래그(또는 그사이 지워진 항목)를 조용히 무시하는 쪽이 안전하다.
 *
 * 관리 화면 둘(`components/admin/CategoryPanel.tsx`·`LinkTable.tsx`)이 각자 같은 계산을 들고
 * 있었다. 공개 화면의 드래그(`components/useCardReorder.ts`)가 셋째 사용처가 되면서 여기로
 * 올렸다 — 세 벌이 갈라지면 "앞에서 뒤로 끌 때 어디에 놓이는가"가 화면마다 달라진다.
 */
export function moveOnto<T extends { id: string }>(
  items: readonly T[],
  sourceId: string,
  targetId: string,
): T[] {
  const next = [...items];
  const from = next.findIndex((item) => item.id === sourceId);
  const to = next.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0) return next;

  const moved = next.splice(from, 1);
  next.splice(to, 0, ...moved);

  return next;
}
