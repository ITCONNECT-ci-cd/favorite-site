export const OPERATING_CATEGORY_NAME = '현재 운영 중인 사이트';

/**
 * 홈 섹션 제목 겸 전용 목록 화면의 제목. 셋 다 사용자에게 **글자 그대로 보이는** 문자열이고,
 * G4 부터는 '한 번에 열기' 토스트의 탭 그룹 명칭으로도 나가므로 한곳에서만 적는다 — 홈 섹션과
 * `/favorites`·`/daily` 가 서로 다른 이름으로 갈라지면 같은 목록이 화면마다 달리 불린다.
 *
 * '현재 운영 중인 사이트'는 위 `OPERATING_CATEGORY_NAME` 이 겸한다(그 이름으로 카테고리를 찾는
 * 판정에도 쓰이므로 값이 하나여야 한다 — D1·D2).
 *
 * 사이드바·모바일 칩의 항목 이름은 여기 묶지 않는다. 프로토타입이 칩만 '매일 사용'으로 줄여
 * 적는 등 내비게이션은 자기 사정으로 다르게 부를 수 있다(components/MobileChips.tsx 주석).
 */
export const FAVORITES_TITLE = '내 즐겨찾기';
export const DAILY_TITLE = '매일 사용하는 사이트';
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
