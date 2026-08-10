/**
 * K1. 분류 선택 목록 만들기 — 서버가 든 `Category[]` 에서 **선택 상자에 필요한 것만** 남긴다.
 *
 * 이 파일이 못박는 것은 둘이다: **무엇을 내려보내는가**(id·name·하위 여부뿐 — 290행짜리
 * 북마크 배열을 클라이언트로 더 내리지 않기 위한 계약)와 **어떤 차례로 세우는가**(상위 바로
 * 뒤에 그 하위들). 화면에 어떻게 보이는지는 `QuickAddCard.test.tsx` 가 본다.
 */
import { describe, expect, it } from 'vitest';

import { toQuickAddOptions } from '@/components/card/quick-add-options';
import type { Category } from '@/lib/types';

function category(over: Partial<Category> & Pick<Category, 'id'>): Category {
  return { name: over.id, parent_id: null, sort_order: 0, ...over };
}

describe('toQuickAddOptions', () => {
  it('선택 상자가 쓰는 세 값만 남긴다 — id · 이름 · 하위 여부', () => {
    const options = toQuickAddOptions([
      category({ id: 'top', name: 'AI 도구 모음', sort_order: 3 }),
      category({ id: 'sub', name: '대화·검색', parent_id: 'top', sort_order: 1 }),
    ]);

    // sort_order 같은 나머지 필드는 화면이 쓰지 않으므로 넘기지 않는다.
    expect(options).toEqual([
      { id: 'top', name: 'AI 도구 모음', isSub: false },
      { id: 'sub', name: '대화·검색', isSub: true },
    ]);
  });

  it('하위는 흩어져 있어도 자기 상위 바로 뒤에 모인다', () => {
    const options = toQuickAddOptions([
      category({ id: 'a', name: '상위 A' }),
      category({ id: 'b', name: '상위 B' }),
      category({ id: 'a1', name: 'A 의 하위', parent_id: 'a' }),
      category({ id: 'b1', name: 'B 의 하위', parent_id: 'b' }),
      category({ id: 'a2', name: 'A 의 하위 둘', parent_id: 'a' }),
    ]);

    expect(options.map((option) => option.id)).toEqual(['a', 'a1', 'a2', 'b', 'b1']);
  });

  it('상위끼리의 차례는 받은 그대로다 — 정렬은 서버(sort_order)가 이미 했다', () => {
    const options = toQuickAddOptions([
      category({ id: 'c', name: '셋째' }),
      category({ id: 'a', name: '첫째' }),
    ]);

    expect(options.map((option) => option.id)).toEqual(['c', 'a']);
  });

  it('부모가 사라진 하위(데이터 손상)는 상위처럼 자기 자리에 선다', () => {
    // 카테고리 화면이 같은 상황을 404 로 막지 않고 자기 자신을 상위처럼 그리는 것과 같은 판단이다
    // (app/(public)/category/[id]/page.tsx 의 rootOf) — 링크가 있는데 넣을 곳이 목록에서
    // 사라지는 편이 더 나쁘다.
    const options = toQuickAddOptions([category({ id: '고아', name: '고아 분류', parent_id: '없는부모' })]);

    expect(options).toEqual([{ id: '고아', name: '고아 분류', isSub: false }]);
  });

  it('분류가 없으면 빈 목록이다', () => {
    expect(toQuickAddOptions([])).toEqual([]);
  });
});
