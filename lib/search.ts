/**
 * G1. ⌘K 검색 팔레트(2단계)의 관문 — 키워드 필터.
 *
 * 프로토타입(`docs/prototype/링크 대시보드 v2.dc.html` 843~847행)의 `results()` 를 옮긴 것이다:
 *
 * ```js
 * results() {
 *   const s = this.state.q.trim().toLowerCase();
 *   if (!s) return [];
 *   return this.state.links.filter(b => (b.title + ' ' + b.raw + ' ' + b.desc + ' ' + b.tags.join(' ')
 *     + ' ' + b.group + ' ' + b.sub + ' ' + b.host).toLowerCase().includes(s)).slice(0, 50);
 * }
 * ```
 *
 * 그대로 지킨 것: 대상 필드(이름·설명·태그·상위/하위 분류·주소 — PRD P4) · 부분 문자열 · 대소문자 무시 ·
 * 빈 질의는 **빈 배열**(전체가 아니다) · 관련도로 다시 정렬하지 않고 입력 순서(sort_order) 유지 ·
 * 50건 상한. 매칭 위치 배지는 997행의 우선순위(이름 → 설명 → 주소 → 그 외)를 따른다.
 *
 * 프로토타입과 다르게 한 곳은 셋뿐이다.
 * 1. **여러 토큰은 AND** — 프로토타입은 질의 전체를 한 덩어리로 `includes` 했다. 계획서 G1 의
 *    완료 기준이 "공백 분리 AND"라 토큰별로 나눠 본다. 건초더미를 공백으로 이어 붙였던 프로토타입에서
 *    공백 없는 한 토큰은 필드 경계를 넘을 수 없으므로 **토큰이 하나면 결과가 완전히 같고**, 여럿이면
 *    리터럴 부분열이 걸리는 경우를 모두 포함하는 상위집합이다(잃는 결과가 없다).
 * 2. **설명도 대소문자를 무시한다** — 997행은 매칭 위치를 고를 때 설명만 원문끼리 비교해서
 *    소문자 'ai' 질의가 설명 'AI …' 를 놓치고 '주소'/'분류' 배지로 새는 자리가 있었다. 버그로 보고 고쳤다.
 * 3. **태그를 별도 배지로 뽑았다** — 프로토타입은 태그로 걸린 것을 '분류'로 뭉뚱그렸다(997행 마지막 else).
 *    DESIGN_SPEC 5장이 적은 배지 넷(이름·설명·주소·분류)을 앞에 두고 `tag` 를 그 뒤에 붙였으므로,
 *    분류로도 걸리는 링크의 배지는 프로토타입과 같다.
 *
 * 재현 못 하는 것 하나: 프로토타입 건초더미의 `b.raw`(다듬기 전 원본 페이지 제목 — 예 `title` 이
 * "Jules" 인 항목의 raw 는 "Jules - An Autonomous Coding Agent")는 우리 DB 스키마에 없는 필드다.
 * 그래서 원본 제목에만 있던 낱말로는 찾을 수 없다. 로직 차이가 아니라 데이터 모델의 한계다.
 *
 * 브라우저 API 를 쓰지 않는 순수 모듈이라 서버 컴포넌트에서도 부를 수 있다.
 */
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { hostOf } from '@/lib/url';

/** 팔레트가 결과 행에 배지로 찍는 "어디서 걸렸나" — DESIGN_SPEC 5장 "매칭 위치(이름·설명·주소·분류)". */
export type MatchField = 'title' | 'desc' | 'url' | 'category' | 'tag';

export type SearchMatch = {
  bookmark: BookmarkWithCount;
  /** 걸린 필드 중 우선순위가 가장 높은 하나. 여러 곳에 걸려도 배지는 한 개다. */
  matchedIn: MatchField;
};

/**
 * 매칭 위치 배지에 적는 말. 넷(이름·설명·주소·분류)은 프로토타입 997행의 원문 그대로이고
 * `tag` 만 G1 에서 새로 붙였다(프로토타입은 태그로 걸린 것을 '분류'라고 적었다).
 *
 * 팔레트(G2)가 문구를 직접 적지 않고 이걸 쓰게 해서, 배지 이름이 두 군데로 갈라지지 않게 한다.
 */
export const MATCH_LABEL: Record<MatchField, string> = {
  title: '이름',
  desc: '설명',
  url: '주소',
  category: '분류',
  tag: '태그',
};

/**
 * 한 번에 돌려주는 최대 건수. 프로토타입 846행의 `.slice(0, 50)` 이다.
 * 팔레트의 "N건" 표시도 이 자른 뒤의 길이를 쓴다(프로토타입 996행 `res.length`).
 */
export const SEARCH_RESULT_LIMIT = 50;

/**
 * 링크가 속한 분류의 이름들. 하위 카테고리에 속하면 상위 이름까지 함께 담는다
 * (프로토타입 건초더미의 `b.group + ' ' + b.sub`).
 */
function categoryNames(categoryId: string | null, byId: Map<string, Category>): string {
  if (categoryId === null) return '';

  const category = byId.get(categoryId);
  // 조회(D1)가 늘 짝을 맞춰 주지만, 순수 함수가 입력을 믿고 터지지는 않게 한다.
  if (category === undefined) return '';

  const parent = category.parent_id === null ? undefined : byId.get(category.parent_id);

  return parent === undefined ? category.name : `${parent.name} ${category.name}`;
}

/**
 * 검색 대상 필드 — **배열 순서가 곧 배지 우선순위다**(이름 → 설명 → 주소 → 분류 → 태그,
 * 프로토타입 997행). 이름표와 값 뽑는 법을 한 자리에 묶어 둔 이유는 둘을 따로 선언하면
 * 나중에 필드를 끼워 넣을 때 한쪽만 고쳐도 조용히 어긋나기 때문이다.
 */
const FIELDS: readonly {
  name: MatchField;
  of: (bookmark: BookmarkWithCount, byId: Map<string, Category>) => string;
}[] = [
  { name: 'title', of: (bookmark) => bookmark.title },
  { name: 'desc', of: (bookmark) => bookmark.description ?? '' },
  // 주소는 화면에 적히는 것과 같은 host 다 — 전체 URL 을 훑으면 'https'·'com' 이 전건을 끌고 온다.
  // 다만 `hostOf` 는 주소로 해석되지 않으면 입력을 그대로 돌려주므로, 그런 링크는 경로까지 걸린다.
  { name: 'url', of: (bookmark) => hostOf(bookmark.url) },
  { name: 'category', of: (bookmark, byId) => categoryNames(bookmark.category_id, byId) },
  { name: 'tag', of: (bookmark) => bookmark.tags.join(' ') },
];

/** 검색 대상 필드를 `FIELDS` 순서로, 전부 소문자로. */
function fieldsOf(bookmark: BookmarkWithCount, byId: Map<string, Category>): string[] {
  // 유니코드 정규화(NFC)는 하지 않는다: 시드도 브라우저 IME 입력도 NFC 라 실측 차이가 없는데,
  // 넣으면 타자마다 290건 × 5필드를 normalize 하게 된다. NFD 가 실제로 섞여 들어오면 그때 판단한다.
  return FIELDS.map((field) => field.of(bookmark, byId).toLowerCase());
}

/**
 * 질의어로 링크를 거른다. ⌘K 팔레트(G2)가 타자마다 부르는 함수다.
 *
 * 규칙: 질의를 공백으로 쪼갠 **모든** 토큰이 한 링크의 어느 필드엔가 부분 문자열로 들어 있어야 한다
 * (대소문자 무시). 토큰마다 걸리는 필드가 달라도 된다 — "figma 디자인" 은 이름이 Figma 이고
 * 분류가 디자인인 링크를 찾는다.
 *
 * @param q 사용자가 입력한 질의. 앞뒤·중간 공백은 정규화한다. 비었거나 공백뿐이면 **빈 배열**을 준다
 *          (프로토타입 845행 — 팔레트는 이때 결과 대신 "고정해 둔 링크"를 보여준다).
 * @param data 서버가 준 한 벌. 분류 이름으로도 찾아야 해서 `categories` 까지 함께 받는다.
 * @returns 입력(`data.bookmarks`) 순서를 그대로 지킨 매칭 목록, 최대 {@link SEARCH_RESULT_LIMIT} 건.
 *          관련도 정렬은 하지 않는다. 인자를 변형하지 않으며 `bookmark` 는 입력 객체 그대로다.
 */
export function searchLinks(q: string, data: SiteData): SearchMatch[] {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter((token) => token !== '');
  if (tokens.length === 0) return [];

  const byId = new Map(data.categories.map((category) => [category.id, category]));
  const matches: SearchMatch[] = [];

  for (const bookmark of data.bookmarks) {
    const fields = fieldsOf(bookmark, byId);
    if (!tokens.every((token) => fields.some((field) => field.includes(token)))) continue;

    // 위 every 가 통과했으므로 걸린 필드가 반드시 하나는 있다 — findIndex 는 -1 이 아니다.
    const first = fields.findIndex((field) => tokens.some((token) => field.includes(token)));
    matches.push({ bookmark, matchedIn: FIELDS[first].name });

    if (matches.length === SEARCH_RESULT_LIMIT) break;
  }

  return matches;
}
