/**
 * N2. `/api/ai-search` 의 **HTTP 인접 순수 헬퍼** + 라우트가 공유하는 상태(rate limiter).
 *
 * 라우트(`./route.ts`)는 이 헬퍼들과 `lib/ai-search.ts`(Gemini 로직)를 순서대로 부르는 얇은
 * 껍데기다. 여기 모은 것: 요청 본문을 크기 상한 안에서 읽기, 질의 검증, 클라이언트 IP 추출,
 * Gemini 가 안 될 때의 **키워드 폴백**(lib/search 재사용), 그리고 남용 방지용 IP 레이트리미터.
 *
 * `lib/ratelimit.ts`·`lib/search.ts`·`lib/queries.ts` 는 **읽기만** 재사용한다(파일 경계).
 */
import { createRateLimiter } from '@/lib/ratelimit';
import { searchLinks } from '@/lib/search';
import type { AiSearchItem } from '@/lib/ai-search';
import { AI_RESULT_MAX } from '@/lib/ai-search';
import type { SiteData } from '@/lib/types';

/**
 * 정상 body 는 `{ query: string }` 하나뿐이라 수백 바이트다. 상한은 넉넉히 4KB — 질의가 최대
 * {@link MAX_QUERY_LENGTH}자(멀티바이트)여도 들어가되, 그 너머의 과대 페이로드는 파싱 전에 끊는다.
 */
const MAX_AI_BODY_BYTES = 4 * 1024;

/** 질의 길이 상한(문자). 프롬프트가 무한정 커지지 않게 하고, 남용 페이로드를 막는다. */
export const MAX_QUERY_LENGTH = 500;

/**
 * IP당 분당 AI 검색 허용 횟수. **클릭(30)보다 훨씬 낮다** — LLM 호출은 비싸고, 팔레트가
 * 타자마다가 아니라 명시적 트리거(버튼·⌘↵·0건 ↵)로만 부르므로 정상 사용은 이 안에 넉넉히 든다.
 * 초과 시 라우트는 500 이 아니라 키워드 폴백(reason='rate-limit')으로 내려간다.
 */
export const AI_RATE_LIMIT_MAX = 10;

/**
 * 라우트가 쓰는 프로세스(=인스턴스) 단위 싱글턴 리미터. 클릭용(`clickRateLimiter`)과 별도 인스턴스라
 * 서로의 예산을 나눠 쓰지 않는다. 인메모리라 Vercel 인스턴스별 근사치인 점은 `lib/ratelimit.ts` 참조.
 */
export const aiSearchRateLimiter = createRateLimiter({ max: AI_RATE_LIMIT_MAX });

/** 라우트가 N3 에 돌려주는 폴백/실패 이유. `ok` 는 AI 성공(source='ai')일 때만 true. */
export type AiSearchReason =
  | 'ok'
  | 'not-configured'
  | 'timeout'
  | 'error'
  | 'parse-error'
  | 'rate-limit';

/**
 * `/api/ai-search` 의 응답 계약(N3 인계). 비200(400/413)만 이 봉투가 아니라 `{ error }` 다.
 * - `source='ai'` : Gemini 가 고른 결과, `results[].reason` 은 근거 한 줄.
 * - `source='keyword'` : 폴백. `reason` 이 왜 폴백했는지 말하고, `results[].reason` 은 null.
 */
export type AiSearchResponse = {
  ok: boolean;
  source: 'ai' | 'keyword';
  reason: AiSearchReason;
  results: AiSearchItem[];
  tookMs: number;
};

export type SearchBodyParse = { ok: true; query: string } | { ok: false; error: string };

/**
 * 요청 본문 검증. 성공하면 **트림한** 질의를 준다(앞뒤 공백은 검색에 의미 없다). 실패하면 400 으로
 * 나갈 사람이 읽을 이유를 함께 돌려준다. 빈 질의는 거부한다 — 검색어 없는 AI 호출은 의미가 없다.
 */
export function parseSearchBody(raw: unknown): SearchBodyParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body 는 JSON 객체여야 합니다.' };
  }

  const { query } = raw as Record<string, unknown>;
  if (typeof query !== 'string') {
    return { ok: false, error: 'query 는 문자열이어야 합니다.' };
  }

  const trimmed = query.trim();
  if (trimmed === '') return { ok: false, error: 'query 가 비어 있습니다.' };
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `query 는 ${MAX_QUERY_LENGTH}자 이하여야 합니다.` };
  }

  return { ok: true, query: trimmed };
}

/**
 * `x-forwarded-for` 의 첫 값이 원 클라이언트다(기본 Vercel 은 플랫폼이 덮어써 위조 불가 —
 * `lib/ratelimit.ts` 주석 참조). 헤더가 없으면 빈 문자열(로컬·프록시 없는 직접 접속).
 * 이 값은 리미터 키로만 쓰이고 어디에도 저장되지 않는다.
 */
export function clientIp(forwardedFor: string | null): string {
  if (forwardedFor === null) return '';

  return forwardedFor.split(',')[0].trim();
}

export type SearchBodyRead =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'too-large' | 'unreadable' };

/**
 * 본문을 크기 상한 안에서 JSON 으로 읽는다. `/api/click` 의 방어를 그대로 따른다 — content-length 로
 * **읽기 전에** 명백한 과대 요청을 끊고, 실제로 읽은 바이트로 다시 확인한다(헤더 없거나 chunked 대비).
 * 라우트 층에서 스트림을 바이트 단위로 중단할 수는 없어, 헤더 없는 초대형 chunked 는 다 읽힌 뒤 걸린다.
 */
export async function readSearchBody(request: Request): Promise<SearchBodyRead> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_AI_BODY_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  if (new TextEncoder().encode(text).length > MAX_AI_BODY_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/**
 * Gemini 를 못 쓸 때의 폴백 — 기존 키워드 검색(lib/search)으로 상위 결과의 id 를 돌려준다.
 * 근거(reason)는 AI 만 다는 것이라 null 이다. 시각 일관성을 위해 AI 와 같은 상한으로 자른다
 * (전체 키워드 목록은 팔레트 본문이 이미 보여 준다 — 여기 AI 영역은 상위 몇 개만).
 */
export function keywordFallback(query: string, data: SiteData): AiSearchItem[] {
  return searchLinks(query, data)
    .slice(0, AI_RESULT_MAX)
    .map((match) => ({ id: match.bookmark.id, reason: null }));
}
