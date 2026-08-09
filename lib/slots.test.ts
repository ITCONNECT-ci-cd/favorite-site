/**
 * `rendersSomething` — "React 가 이 값을 그리는가"의 한곳.
 *
 * 세 소비자(LinkCard 의 `editSlot` · CategoryHeader · LinkAddRow 의 아래 줄)가 각자 무엇을
 * 하는지는 그쪽 테스트가 고정한다. 여기서는 판정 그 자체만 본다 — 소비자를 하나 더 늘려도
 * 규칙이 갈라지지 않게.
 */
import { createElement, Fragment } from 'react';
import { describe, expect, it } from 'vitest';

import { rendersSomething } from '@/lib/slots';

describe('rendersSomething — 그리지 않는 값', () => {
  it('undefined 는 없음이다', () => {
    expect(rendersSomething(undefined)).toBe(false);
  });

  it('null 도 없음이다', () => {
    expect(rendersSomething(null)).toBe(false);
  });

  it('false 는 없음이다 — `{cond && <Row/>}` 가 cond 거짓일 때 넘기는 값', () => {
    expect(rendersSomething(false)).toBe(false);
  });

  it('true 도 없음이다 — `{cond || <Row/>}` 가 cond 참일 때 넘기는 값', () => {
    expect(rendersSomething(true)).toBe(false);
  });

  it('빈 문자열도 없음이다', () => {
    expect(rendersSomething('')).toBe(false);
  });
});

describe('rendersSomething — 그리는 값', () => {
  it('요소는 있음이다', () => {
    expect(rendersSomething(createElement('p', null, '표 자리'))).toBe(true);
  });

  it('글자는 있음이다', () => {
    expect(rendersSomething('표 자리')).toBe(true);
  });

  it('0 은 있음이다 — React 가 "0" 을 그린다', () => {
    expect(rendersSomething(0)).toBe(true);
  });

  it('NaN 도 있음이다 — React 가 "NaN" 을 그린다', () => {
    expect(rendersSomething(NaN)).toBe(true);
  });
});

describe('rendersSomething — 쫓지 않는 한계', () => {
  /**
   * 빈 배열·빈 프래그먼트는 **그리는 것이 없는데도 있음**으로 답한다. prop 검사로는 자식이 있는
   * 배열·프래그먼트와 구별되지 않아 일부러 두는 한계다(J1b) — 고쳐 놓고 잊지 않도록 못박는다.
   */
  it('빈 배열은 걸러 내지 못한다', () => {
    expect(rendersSomething([])).toBe(true);
  });

  it('빈 프래그먼트도 걸러 내지 못한다', () => {
    expect(rendersSomething(createElement(Fragment))).toBe(true);
  });
});
