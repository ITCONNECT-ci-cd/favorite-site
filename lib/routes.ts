/**
 * 관리 라우트의 주소 — **여기 한 곳에만 적는다.**
 *
 * 같은 문자열이 여러 파일에 흩어져 있었다(로그인·로그아웃이 돌아갈 자리, 로그인 화면의 주소
 * 표기, 상단 탭의 링크). 주소가 바뀔 때 한 곳이라도 빠지면 그 자리만 조용히 404 로 떨어지는데,
 * 문자열이라 타입도 못 잡아 준다. 특히 `app/admin/actions.ts` 는 `'use server'` 파일이라
 * **async 함수 말고는 export 할 수 없어** 자기 상수를 남에게 나눠 줄 수 없다 — 그래서 상수는
 * 서버·클라이언트 어느 쪽에도 속하지 않는 이 중립 모듈에 둔다.
 *
 * 여기에 값을 더 넣더라도 서버 전용 코드(`server-only`·env 읽기 등)는 들이지 마라.
 * 관리자 셸이 **클라이언트 컴포넌트**로서 이 모듈을 import 한다.
 *
 * 경계: **`routes.ts` 는 URL 지도, `lib/constants.ts` 는 값 계약이다.** 주소가 아닌 것
 * (기간·개수·문구 같은 화면 규칙)은 저쪽으로 간다 — 이 파일이 잡동사니 상자가 되면
 * "주소는 여기 한 곳" 이라는 규칙 자체를 아무도 믿지 않게 된다.
 * `lib/routes.test.ts` 가 이 파일에 import 도 env 도 없다는 것을 잠근다.
 */

/** 관리 화면의 뿌리이자 로그인·로그아웃이 돌아갈 자리. 탭 '카테고리 · 링크'가 가리킨다. */
export const ADMIN_PATH = '/admin';

/** 탭 '통계' (DESIGN_SPEC 6장). K2 가 채운다. */
export const ADMIN_STATS_PATH = '/admin/stats';

/** 탭 '정리 도구' (DESIGN_SPEC 6장). M2 가 채운다. */
export const ADMIN_CLEANUP_PATH = '/admin/cleanup';
