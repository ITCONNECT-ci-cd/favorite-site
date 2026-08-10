import type { Category } from '@/lib/types';

/**
 * '+ 링크 추가' 타일의 **분류 선택 상자 한 줄**. 서버가 든 `Category` 에서 화면이 쓰는 것만 남긴다.
 *
 * 필드가 셋뿐인 것은 계약이다 — 공개 화면의 서버 컴포넌트는 이미 290행짜리 북마크 배열을
 * 클라이언트로 내려보내고 있어(app/(public)/layout.tsx), 거기에 카테고리 원본까지 통째로 얹지
 * 않는다. `sort_order`·`parent_id` 는 아래 `toQuickAddOptions` 가 **차례를 세우는 데에만** 쓰고
 * 화면으로 넘기지 않는다.
 */
export type QuickAddCategory = {
  id: string;
  name: string;
  /** 하위 분류인가. 선택 목록에서 한 단 들여 보이는 데에만 쓴다(둘 다 링크를 담을 수 있다). */
  isSub: boolean;
};

/**
 * 선택 상자에 세울 차례로 분류를 편다 — **상위 바로 뒤에 그 하위들**.
 *
 * 받은 배열은 `sort_order` 순이지만 상위·하위가 한 배열에 섞여 있어(lib/queries 의 getAllData)
 * 그대로 늘어놓으면 하위가 남의 상위 밑에 붙어 보인다. 상위끼리의 차례와 한 상위 안 하위끼리의
 * 차례는 받은 그대로 둔다 — 정렬은 서버가 이미 했다.
 *
 * `<optgroup>` 을 쓰지 않는 이유: 하위를 가진 상위도 **자기 링크를 담는다**(카테고리 화면의
 * '전체'가 상위 직속 + 하위를 합치는 것이 그 증거다). optgroup 의 라벨은 고를 수 없으므로
 * 그 상위에 직접 넣을 길이 사라진다. 그래서 평평한 목록을 쓰고 들여쓰기는 화면이 이름 앞에 붙인다.
 *
 * 부모가 목록에 없는 하위(데이터 손상)는 **상위처럼 자기 자리에** 선다 — 카테고리 화면이 같은
 * 상황에서 404 대신 자기 자신을 상위처럼 그리는 것과 같은 판단이다
 * (app/(public)/category/[id]/page.tsx 의 `rootOf`). 넣을 곳이 목록에서 조용히 사라지는 편이 더 나쁘다.
 */
export function toQuickAddOptions(categories: readonly Category[]): QuickAddCategory[] {
  const known = new Set(categories.map((category) => category.id));
  const options: QuickAddCategory[] = [];

  for (const category of categories) {
    // 부모가 목록에 있는 하위는 여기서 내지 않는다 — 아래에서 그 부모 뒤에 붙는다.
    if (category.parent_id !== null && known.has(category.parent_id)) continue;

    options.push({ id: category.id, name: category.name, isSub: false });

    for (const sub of categories) {
      if (sub.parent_id === category.id) options.push({ id: sub.id, name: sub.name, isSub: true });
    }
  }

  return options;
}
