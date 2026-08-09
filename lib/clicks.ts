/**
 * F3. 카드 클릭 기록 — `POST /api/click`(F2) 로 보내는 **유일한 클라이언트 경로**.
 *
 * **브라우저 전용이다.** `'use client'` 를 적지 않는 것은 이 파일이 컴포넌트가 아니어서일 뿐,
 * `getVisitorId`(lib/visitor) 가 localStorage 를 쓰고 상대 주소로 fetch 하므로 서버에서는
 * 부를 수 없다. 부르는 쪽(HomeView·ListView 의 열기 콜백)이 클라이언트 컴포넌트다.
 *
 * 토스트는 여기서 띄우지 않는다 — lib 이 components 를 끌어오면 레이어가 뒤집힌다.
 * 문구만 `openToastText` 로 내주고, 실제 `toast()` 호출은 배선하는 화면이 한다
 * (lib/favorites 의 `favToastText` 와 같은 분담).
 */
import { getVisitorId } from '@/lib/visitor';

/**
 * 링크를 여는 순간 클릭 하나를 기록한다. **기다리지 않는다.**
 *
 * PRD 의 약속은 "기록이 이동을 막지 않는다" 이므로 응답도 실패도 보지 않는다 —
 * 카드는 네이티브 앵커라 이 함수가 도는 사이 브라우저는 이미 새 탭을 연다.
 * 그래서 `keepalive: true` 가 필수다: 없으면 문서가 바뀌는 순간 요청이 취소될 수 있다.
 *
 * 세는지 마는지(쿨다운 30초·일일 상한)는 서버가 판정하고 그 결과(`counted`)는 화면에 쓰지
 * 않는다. 카드에 보이는 숫자는 다음 서버 렌더에서 갱신된다(D1).
 *
 * @param bookmarkId 연 링크의 id
 * @param isBulk '한 번에 열기'로 열린 것인지 (2단계 G4). 기본은 사람이 카드를 누른 경우다.
 */
export function recordClick(bookmarkId: string, isBulk = false): void {
  // try 가 fetch 호출뿐 아니라 **인자를 만드는 일까지** 감싼다: 방문자 id 를 얻는 일
  // (`getVisitorId` — localStorage 접근)과 본문 직렬화(`JSON.stringify`)가 모두 이 안에서 일어난다.
  // 셋 중 하나라도 동기적으로 던지면 링크를 여는 이벤트 핸들러가 예외로 끝나므로 여기서 막는다
  // (`.catch` 는 이미 시작된 요청의 거절만 잡는다 — 아래 참조).
  try {
    fetch('/api/click', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookmarkId, visitorId: getVisitorId(), isBulk }),
    }).catch(() => {
      // 오프라인·차단 확장·서버 오류. 집계는 부수 기능이라 사용자에게 알리지 않고 버린다.
      // 삼키지 않으면 unhandled rejection 이 콘솔에 쌓인다.
    });
  } catch {
    // fetch 가 아예 없는 환경, localStorage 접근이 막힌 브라우저, 직렬화 실패 — 어느 쪽이든
    // 집계 하나를 잃을 뿐이므로 조용히 넘어간다. 링크는 그대로 열린다.
  }
}

/**
 * 링크를 열었을 때 띄울 토스트 문구. 프로토타입 `open` 의 원문을 그대로 옮겼다
 * (docs/prototype/링크 대시보드 v2.dc.html 837행):
 *
 * ```js
 * open(b) { this.bump([b.id]); this.say(b.title + ' · 새 탭으로 이동'); ... }
 * ```
 *
 * 프로토타입은 집계에서 걸러진 클릭에 다른 문구('조금 전에 이미 집계된 클릭입니다 …')를 띄우지만
 * 우리는 응답을 기다리지 않으므로 언제나 이 문구다 — 눌렀는데 아무 말이 없는 편보다 낫다.
 * 배선하는 화면이 둘(HomeView·ListView)이라 문구가 갈라지지 않게 여기서 한 번만 적는다.
 */
export function openToastText(title: string): string {
  return `${title} · 새 탭으로 이동`;
}
