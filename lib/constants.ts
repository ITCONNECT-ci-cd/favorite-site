export const OPERATING_CATEGORY_NAME = '현재 운영 중인 사이트';

/**
 * 홈의 즐겨찾기를 세 묶음으로 나누는 기준이 되는 **상위 분류 이름 두 개**
 * (2026-08-10 사용자 요청 — 나머지 상위는 전부 '업무용 서비스'로 떨어진다).
 *
 * 판정은 `lib/fav-groups.ts` 가 한다. 여기 값과 실제 분류 이름이 어긋나면 그 분류의 즐겨찾기가
 * 조용히 '업무용 서비스'로 밀린다 — `OPERATING_CATEGORY_NAME` 과 같은 성질의 이름 결합이라
 * **분류를 개명하면 이 상수도 함께 고쳐야 한다.**
 */
export const NEWS_CATEGORY_NAME = '뉴스·인사이트';
export const AI_TOOLS_CATEGORY_NAME = 'AI 도구 모음';

/**
 * 홈 섹션 제목 겸 전용 목록 화면의 제목. 사용자에게 **글자 그대로 보이는** 문자열이고,
 * G4 부터는 '한 번에 열기' 토스트의 탭 그룹 명칭으로도 나가므로 한곳에서만 적는다 — 홈 섹션과
 * `/favorites` 가 서로 다른 이름으로 갈라지면 같은 목록이 화면마다 달리 불린다.
 *
 * '현재 운영 중인 사이트'는 위 `OPERATING_CATEGORY_NAME` 이 겸한다(그 이름으로 카테고리를 찾는
 * 판정에도 쓰이므로 값이 하나여야 한다 — D1·D2).
 *
 * 사이드바·모바일 칩의 항목 이름은 여기 묶지 않는다. 내비게이션은 자기 사정으로 다르게 부를 수
 * 있다(components/MobileChips.tsx 주석).
 *
 * ⓘ **`DAILY_TITLE`·`DAILY_PIN_MAX` 는 없어졌다** — '매일 사용하는 사이트'는 화면·경로·관리자
 * 고정 토글까지 통째로 걷어냈다(2026-08-10 사용자 결정: 실제로 쓰지 않는 자리였다).
 * `bookmarks.is_pinned` 컬럼과 이미 고정돼 있던 표시만 DB 에 남아 있어 되살릴 여지는 있다.
 */
export const FAVORITES_TITLE = '내 즐겨찾기';
export const CLICK_COOLDOWN_MS = 30_000;
export const CLICK_DAILY_CAP = 10;
// FAVS_KEY 는 없어졌다 — 즐겨찾기는 2026-08-11 에 DB(bookmarks.is_favorite·fav_order)로 옮겼다.
export const VISITOR_KEY = 'linkdash:visitor';  // uuid
export const BREAKPOINT_NARROW = 820;

/**
 * 빈 목록 안내 문구 (DESIGN_SPEC 4장). 카테고리·매일 등 목록 화면이 모두 이 문구를 쓴다 —
 * '내 즐겨찾기'만 자기 문구를 갖는다(담는 방법을 알려 줘야 해서).
 */
export const EMPTY_LIST_MESSAGE = '이 분류에 링크가 없습니다.';

/**
 * 서버 액션 호출이 **거부로 끝났을 때**(네트워크 단절 · 배포로 액션 id 가 바뀜) 화면이 대신
 * 보여 줄 문구. 액션이 `{ ok:false, error }` 로 돌려준 문구는 그대로 쓰고, 이 상수는 응답
 * 자체가 없는 경우에만 쓴다.
 *
 * **동작을 가리키지 않는 낱말('처리')인 것은 의도다.** 이 한 문장을 저장·삭제·순서 바꾸기·고정
 * 토글이 모두 쓰는데, '저장'이라고 말하면 삭제가 실패한 자리에서 화면이 하지도 않은 일을
 * 말하게 된다. 무엇을 하려 했는지는 사용자가 방금 누른 버튼이 이미 알려 준다 — 이 문장이 할 일은
 * "닿지 않았으니 잠시 후 다시" 하나다.
 *
 * `lib/mutations.ts` 의 `RETRY_LATER` 와 **같은 문장**이다 — 그 파일은 `'use server'` 라
 * 상수를 내보낼 수 없어(export 는 전부 async 함수여야 한다) 저쪽 값을 여기서 가져다 쓸 수 없다.
 * 저쪽 문구를 고치면 여기도 함께 고쳐라. 대조하는 테스트가 여럿이라 `grep` 으로 전수 확인하라.
 */
export const REQUEST_FAILED = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 외부 Google favicon provider에 bookmark hostname을 보내기 전 운영 privacy 승인 gate 안내. */
export const DISCORD_FAVICON_PROVIDER_APPROVAL_REQUIRED =
  '외부 파비콘 제공자에 호스트명을 보내는 운영 승인이 필요합니다.';
