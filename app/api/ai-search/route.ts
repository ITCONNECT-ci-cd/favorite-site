/**
 * N2. `POST /api/ai-search` — AI 의미 검색(N1 결정: Gemini LLM 직접 호출).
 *
 * **공개 엔드포인트다.** ⌘K 팔레트는 공개 화면이라 비관리자도 AI 검색을 쓴다. 그래서 Gemini 키는
 * 서버 환경변수(`AI_SEARCH_API_KEY`)로만 두고 절대 클라이언트로 내보내지 않는다 — 이 라우트가
 * 서버에서 대신 호출한다.
 *
 * 판정·조립·파싱은 전부 순수 함수다(`./logic.ts` + `@/lib/ai-search.ts`). 여기 남은 일은 순서다:
 *   1. body 를 크기 상한 안에서 읽고 질의를 검증한다(과대·형식 오류는 413/400).
 *   2. **레이트리밋**(IP당 분당) — 초과하면 비싼 LLM·DB 를 건너뛰고 rate-limit 폴백(200).
 *   3. 공개 데이터(getAllData)로 링크 요약과 **실존 id 화이트리스트**를 만든다.
 *   4. **env 게이트** — 키가 없으면 500 이 아니라 "준비 중"(키워드 폴백, reason='not-configured').
 *   5. Gemini 호출. 성공하면 AI 결과, 타임아웃·에러·파싱실패면 **키워드 검색으로 폴백**한다.
 *
 * ### 응답 계약 (N3 인계) — 비200(400/413)만 `{ error }` 봉투다.
 *   200 `AiSearchResponse`:
 *     { ok, source: 'ai'|'keyword', reason, results: [{ id, reason }], tookMs }
 *     - `source='ai'`  : Gemini 가 고른 3~5개. `ok=true`, `reason='ok'`, results[].reason=근거 한 줄.
 *     - `source='keyword'`: 폴백. `ok=false`, `reason` 이 이유('not-configured'|'timeout'|
 *       'error'|'parse-error'|'rate-limit'), results[].reason=null. rate-limit 은 results=[].
 *   400 `{ error }`  — query 누락·형식 오류·깨진 본문
 *   413 `{ error }`  — body 크기 상한 초과
 *   **results[].id 는 항상 실존 bookmark id 다** — Gemini 출력은 화이트리스트로 검증되고, 폴백은
 *   실제 검색 결과다. 소비자(N3)는 이 id 로 현재 목록에서 링크를 찾으면 된다.
 *
 * ### 보안
 *   - 키는 서버에만. Gemini 로는 `x-goog-api-key` 헤더로 보내 URL·로그에 새지 않는다(@/lib/ai-search).
 *   - 프롬프트 인젝션: 질의를 systemInstruction 이 아니라 user 데이터로 싣고, 출력 id 를 화이트리스트로
 *     검증한다(지어낸 id 는 버려짐). 서버 로그·응답에 키나 응답 원문을 담지 않는다.
 *   - 남용 방지: body 크기 상한 + IP당 분당 상한. 막힌 요청은 DB·LLM 을 아예 건드리지 않는다.
 */
import { buildLinkSummaries, callGemini } from '@/lib/ai-search';
import { getAllData } from '@/lib/queries';

import {
  aiSearchRateLimiter,
  clientIp,
  keywordFallback,
  parseSearchBody,
  readSearchBody,
  type AiSearchReason,
  type AiSearchResponse,
} from './logic';

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();

  const read = await readSearchBody(request);
  if (!read.ok) {
    // 과대 페이로드는 413, 그 밖의 깨진·빈 본문은 400 — 둘 다 `{ error }` 봉투(results 없음).
    return read.reason === 'too-large'
      ? Response.json({ error: 'body 가 너무 큽니다.' }, { status: 413 })
      : Response.json({ error: 'body 를 JSON 으로 읽을 수 없습니다.' }, { status: 400 });
  }

  const parsed = parseSearchBody(read.value);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { query } = parsed;
  const ip = clientIp(request.headers.get('x-forwarded-for'));

  const respond = (partial: Omit<AiSearchResponse, 'tookMs'>): Response =>
    Response.json({ ...partial, tookMs: Date.now() - started } satisfies AiSearchResponse);

  // 2. 레이트리밋. 막힌 요청은 DB·LLM 을 건드리지 않으므로 여기서 results 없이 즉시 폴백한다.
  //    (인메모리라 Vercel 인스턴스별 근사치 — @/lib/ratelimit 상단 근거.)
  if (aiSearchRateLimiter.check(ip, Date.now(), false).limited) {
    return respond({ ok: false, source: 'keyword', reason: 'rate-limit', results: [] });
  }

  // 3. 공개 데이터 — AI 컨텍스트·id 화이트리스트·키워드 폴백이 모두 이 한 벌을 쓴다.
  const data = await getAllData();

  const fallback = (reason: AiSearchReason): Response =>
    respond({ ok: false, source: 'keyword', reason, results: keywordFallback(query, data) });

  // 4. env 게이트 — 키가 없으면 500 이 아니라 "준비 중". 그래도 키워드로 최소한의 결과는 준다.
  //    어떤 환경변수가 비었는지는 응답에 적지 않는다(공개 엔드포인트).
  const apiKey = process.env.AI_SEARCH_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    return fallback('not-configured');
  }

  // 5. Gemini 호출. summaries·validIds 는 이 요청의 실제 링크에서 만든다(화이트리스트의 원천).
  const summaries = buildLinkSummaries(data);
  const validIds = new Set(data.bookmarks.map((bookmark) => bookmark.id));

  const result = await callGemini({ apiKey, query, summaries, validIds });

  if (result.status === 'ok') {
    return respond({ ok: true, source: 'ai', reason: 'ok', results: result.items });
  }

  // 타임아웃·에러·파싱실패 → 키워드 폴백. 진단만 남기고(키·응답 원문은 로그에도 안 남긴다),
  // reason 으로 왜 폴백했는지 N3 에 알린다.
  console.warn(`[api/ai-search] Gemini ${result.status} — 키워드 검색으로 폴백합니다.`);

  return fallback(result.status);
}
