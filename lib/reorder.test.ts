/**
 * `moveOnto` — 관리 화면 둘과 공개 화면의 카드 드래그가 **같은 규칙**을 쓰도록 올린 계산.
 *
 * 세 화면이 각자 복제를 들고 있던 시절에는 이 계약이 어디에도 적혀 있지 않았다. 여기서 고정하는
 * 것은 하나다: **"이 항목 위에 놓았다" = 그 자리를 차지한다.**
 */
import { describe, expect, it } from 'vitest';

import { moveOnto } from '@/lib/reorder';

const LIST = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('moveOnto', () => {
  it('뒤에서 앞으로 끌면 대상 **앞**에 놓인다', () => {
    expect(ids(moveOnto(LIST, 'd', 'b'))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('앞에서 뒤로 끌면 대상 **뒤**에 놓인다', () => {
    // 인덱스를 빼내기 전에 잡기 때문에 생기는 비대칭이다 — 눈으로 보는 결과가 이쪽이다.
    expect(ids(moveOnto(LIST, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('자기 자신 위에 놓으면 그대로다', () => {
    expect(ids(moveOnto(LIST, 'b', 'b'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('둘 중 하나라도 목록에 없으면 아무것도 옮기지 않는다', () => {
    // 다른 목록에서 시작한 드래그 · 그사이 지워진 항목 — 조용히 무시하는 쪽이 안전하다.
    expect(ids(moveOnto(LIST, 'zz', 'b'))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(moveOnto(LIST, 'a', 'zz'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('원본을 건드리지 않는다 — 낙관적 순서의 밑값이 흔들리면 안 된다', () => {
    const original = [...LIST];

    moveOnto(LIST, 'd', 'a');

    expect(LIST).toEqual(original);
  });

  it('빈 목록·한 개짜리 목록에서도 던지지 않는다', () => {
    expect(moveOnto([], 'a', 'b')).toEqual([]);
    expect(ids(moveOnto([{ id: 'a' }], 'a', 'a'))).toEqual(['a']);
  });
});
