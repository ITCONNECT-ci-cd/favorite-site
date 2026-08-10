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

/**
 * 팝업이 막혔을 때 사용자가 **실제로 할 수 있는 일**. 일부 차단·전부 차단 두 분기가 글자 하나까지
 * 같아야 해서 상수로 둔다 — 한쪽만 고치면 같은 고장을 두 가지로 설명하게 된다.
 *
 * 크롬·엣지는 주소창 오른쪽 끝에, 파이어폭스는 주소창 왼쪽에 아이콘을 세우므로 "주소창의" 까지만
 * 말하고 위치를 더 좁히지 않는다.
 */
const POPUP_BLOCKED_HELP = '주소창의 팝업 차단 아이콘에서 이 사이트를 허용해 주세요';

/** '한 번에 열기'(G4) 한 번의 결과 — `useCardHandlers.openMany` 가 링크마다 세어 넘긴다. */
export type BulkOpenResult = {
  /** `window.open` 이 창 핸들을 돌려준 링크 수 = **실제로 열린 것**. */
  opened: number;
  /** 핸들 대신 null 이 온 링크 수 = 브라우저가 막은 것. */
  blocked: number;
  /** 탭 그룹 명칭 — 홈은 섹션 이름, 목록 화면은 분류 이름(하위 탭이면 `상위 · 하위`) */
  groupLabel: string;
};

/**
 * '한 번에 열기'(G4)의 **결과**를 알리는 토스트 문구. 프로토타입 `openMany` 를 바탕에 두되 탭 그룹
 * 부분을 **권유형으로** 고쳐 적었다 (계획서 V7 편차 — 스펙 리뷰 확정).
 * 원문은 docs/prototype/링크 대시보드 v2.dc.html 825~829행이다:
 *
 * ```js
 * openMany(list, label) {
 *   if (!list.length) { this.say('열 링크를 먼저 선택하세요'); return; }
 *   this.bump(list.map(b => b.id));
 *   this.say(list.length + '개를 새 탭으로 엽니다 · 크롬 탭 그룹 "' + label + '"으로 묶임');
 * }
 * ```
 *
 * **원문의 `"..."으로 묶임` 을 그대로 쓰지 않는 이유**: 스펙 7장이 요구하는 것은 *탭 그룹 명칭
 * 안내*이지 묶기가 끝났다는 *단정*이 아니다. 그리고 저 문장이 참인 프로토타입은 애초에 탭을 열지
 * 않는다 — `openMany` 에 `window.open` 이 없고 `bump`(집계)와 `say`(토스트)만 있는 목업 카피다.
 * 실물은 탭을 진짜로 열지만 그룹으로 묶지는 못하므로(크롬 확장 권한 밖 — PRD '범위 밖'),
 * 명칭은 그대로 안내하되 묶는 일은 사용자 몫이라고 말한다.
 *
 * **팝업 차단 안내가 '미리'에서 '결과'로 바뀌었다.** 예전의 이 함수는 개수 하나만 받고 그 뒤에
 * `열리지 않으면 팝업 차단을 확인하세요` 를 언제나 달았다 — `noopener` 로 연 창은 규격상
 * `window.open` 이 참조 대신 null 을 돌려줘 차단을 알아낼 방법이 없다는 전제였다. 그 전제는 이제
 * 깨졌다: 호출부가 `noopener` 를 빼고 돌려받은 창 핸들로 링크마다 열림/차단을 가른다
 * (`useCardHandlers.openMany` — 맞바꾼 것과 그 이유가 거기 적혀 있다).
 *
 * 그 결과 문구가 **일어난 일만** 말한다. 한 건도 열리지 않았는데 "N개를 새 탭으로 엽니다" 라고
 * 말한 것이 사용자가 신고한 고장 그 자체였다(긴 문구 끝의 예방 안내는 읽히지 않았다). 막혔을
 * 때만, 그리고 막혔으면 반드시 **손댈 곳**을 알려 준다.
 *
 * **개수 하나 대신 이름 붙인 객체를 받는 이유**: 세야 할 수가 둘로 늘었는데 둘 다 number 라 자리를
 * 바꿔 넘겨도 타입이 잡아 주지 못한다 — 그 실수는 "2개 열림 1개 차단"과 "1개 열림 2개 차단"을
 * 뒤집어 정확히 거짓말이 된다. 반대로 분기마다 함수를 쪼개지는 않았다: 어느 문구를 쓸지 고르는
 * 규칙이 호출부로 새어 나가면 화면 둘(HomeView·ListView)이 그 규칙을 나눠 갖게 된다.
 *
 * 0개 분기는 프로토타입 원문 그대로다 — 여는 반복문은 빈 목록에서 저절로 아무 일도 하지 않으므로
 * 호출부에 가드가 없고, '열 것이 없다'는 말은 여기서만 나온다.
 *
 * @param result 열린 수 · 차단된 수 · 탭 그룹 명칭
 */
export function bulkOpenToastText({ opened, blocked, groupLabel }: BulkOpenResult): string {
  // 시도조차 없었던 경우 — 차단과 구별해야 한다. 팝업 아이콘을 보라고 해도 거기엔 아무것도 없다.
  if (opened === 0 && blocked === 0) return '열 링크를 먼저 선택하세요';

  if (blocked === 0) {
    return `${opened}개를 새 탭으로 엽니다 · 크롬에서 "${groupLabel}" 탭 그룹으로 묶어 두면 좋습니다`;
  }

  // 아래 두 분기는 탭 그룹 명칭을 싣지 않는다. 슬롯이 하나뿐인 토스트에서 지금 급한 말은 '무엇이
  // 막혔고 어디를 눌러 푸는가' 하나이고, 묶기 권유는 다시 눌러 열리고 난 다음의 일이다.
  if (opened === 0) {
    return `팝업 차단으로 ${blocked}개 모두 열리지 않았습니다 · ${POPUP_BLOCKED_HELP}`;
  }

  return `${opened}개를 열었고 ${blocked}개는 팝업 차단으로 열리지 않았습니다 · ${POPUP_BLOCKED_HELP}`;
}
