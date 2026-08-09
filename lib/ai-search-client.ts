/**
 * N3. ⌘K 팔레트의 AI 의미 검색 — **브라우저에서 `POST /api/ai-search`(N2) 를 부르는 유일한 경로**.
 *
 * `lib/clicks.ts` 가 클릭 기록의 유일한 클라이언트 경로인 것과 같은 자리다. 팔레트(호스트)는 이
 * 함수만 부르고, 응답 계약의 해석·상태 전이는 `useAiSearch` 훅이, 화면은 `AiSearchResults` 가 맡는다.
 *
 * **키는 절대 여기로 오지 않는다.** Gemini 키는 서버 환경변수라 라우트가 대신 호출하고(N2 route.ts),
 * 이 함수는 우리 서버의 `/api/ai-search` 만 부른다. 그래서 body 는 `{ query }` 하나뿐이다.
 *
 * ### 왜 status code 를 먼저 가른다
 * N2 계약(route.ts JSDoc)은 **비200(400/413)만 `{ error }` 봉투**이고 200 만 `AiSearchResponse` 다.
 * 그래서 `response.ok` 를 응답 본문보다 먼저 본다 — 400/413 을 `AiSearchResponse` 로 읽으려다
 * `source`/`results` 가 없어 조용히 깨지는 일을 막는다(소비자 계약 "status code 먼저 분기").
 *
 * ### 실패를 예외로 던지지 않는다
 * `callGemini`(서버)가 그랬듯 실패를 `ok:false` 판정으로 돌려준다 — 부르는 훅이 try/catch 없이
 * 로딩→결과 전이만 쓰게 하려는 것이다. 네트워크 끊김·JSON 파싱 실패는 `network`, HTTP 오류는 `http`.
 */
import type { AiSearchResponse } from '@/app/api/ai-search/logic';

// 소비자(useAiSearch·AiSearchResults)가 라우트 내부 모듈을 직접 import 하지 않도록 여기서 한 번만
// 되싣는다. `export type` 라 런타임 코드는 딸려오지 않는다(logic.ts 는 서버 전용 — ratelimit·search 를 끈다).
export type { AiSearchResponse, AiSearchReason } from '@/app/api/ai-search/logic';

/** `requestAiSearch` 의 판정 결과. `ok` 만 응답 본문을 갖고, 나머지는 훅이 오류 안내로 내려간다. */
export type AiSearchClientResult =
  | { ok: true; response: AiSearchResponse }
  | { ok: false; kind: 'http'; status: number }
  | { ok: false; kind: 'network' };

/**
 * 질의 하나로 AI 의미 검색을 부른다. **질의는 이미 트림된 값**을 받는다(팔레트가 넘긴다).
 *
 * @param signal 진행 중 요청을 끊기 위한 신호(호스트가 질의를 고치거나 팔레트를 닫을 때). 끊긴 fetch 는
 *   예외를 던지므로 `network` 로 돌아오지만, 훅은 세대(generation) 검사로 그 결과를 이미 버린다.
 */
export async function requestAiSearch(
  query: string,
  signal?: AbortSignal,
): Promise<AiSearchClientResult> {
  let response: Response;
  try {
    response = await fetch('/api/ai-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    });
  } catch {
    // 오프라인·차단·요청 중단 — 모두 재시도 안내로 합쳐도 되는 한 부류다.
    return { ok: false, kind: 'network' };
  }

  // status 를 본문보다 먼저 본다 — 400/413 은 `{ error }` 라 AiSearchResponse 가 아니다.
  if (!response.ok) return { ok: false, kind: 'http', status: response.status };

  try {
    const data = (await response.json()) as AiSearchResponse;
    return { ok: true, response: data };
  } catch {
    // 200 인데 본문이 JSON 이 아니거나 스트림이 끊긴 경우. 화면상 네트워크 오류와 구분할 실익이 없다.
    return { ok: false, kind: 'network' };
  }
}
