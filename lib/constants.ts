export const OPERATING_CATEGORY_NAME = '현재 운영 중인 사이트';
export const DAILY_PIN_MAX = 12;
export const CLICK_COOLDOWN_MS = 30_000;
export const CLICK_DAILY_CAP = 10;
export const FAVS_KEY = 'linkdash:favs';        // string[] (bookmark id)
export const VISITOR_KEY = 'linkdash:visitor';  // uuid
export const BREAKPOINT_NARROW = 820;

/**
 * 빈 목록 안내 문구 (DESIGN_SPEC 4장). 카테고리·매일 등 목록 화면이 모두 이 문구를 쓴다 —
 * '내 즐겨찾기'만 자기 문구를 갖는다(담는 방법을 알려 줘야 해서).
 */
export const EMPTY_LIST_MESSAGE = '이 분류에 링크가 없습니다.';
