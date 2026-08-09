/**
 * F2. `POST /api/click` — 클릭 집계의 **유일한 기록 경로** (계획서 §2.4).
 *
 * clicks 에는 insert 정책이 없어(계획서 §0 편차 V1) 익명 키로는 직접 쓸 수 없다.
 * 쿨다운·일일 상한 같은 방어 규칙을 클라이언트가 우회하지 못하게 하려는 설계이고,
 * 그 대가로 이 라우트만 service role 로 쓴다.
 *
 * 판정(형식 검증·해시·쿨다운·상한)은 전부 `./logic.ts` 의 순수 함수다.
 * 여기 남은 일은 요청에서 값을 꺼내고, DB 를 두 번 치고, 계약대로 응답하는 것뿐이다.
 *
 * 계약 (§2.4 + 아래 세부):
 *   200 `{ counted: true }`
 *       `{ counted: false, reason: 'cooldown' | 'daily-cap' | 'rate-limit' }`
 *   400 `{ error: string }`                           — body 형식 오류(비uuid·누락·깨진 본문)
 *       `{ error: string, code: 'unknown-bookmark' }` — 없는 bookmarkId (아래 insert 분기 참조)
 *   413 `{ error: string }`                           — body 크기 상한 초과(과대 페이로드)
 *   500 `{ error: string }`                           — CLICK_SALT 부재 · clicks 조회/insert 실패
 *
 * **비200 은 모두 `{ error }` 봉투다 — `counted` 가 실리지 않는다.** 소비자는 `res.ok` 로 먼저
 * 갈라야 하고, 갈래를 구분해야 한다면 `error` 문자열이 아니라 `code` 를 봐라(문구는 바뀔 수 있다).
 * `reason: 'rate-limit'` 은 L1 의 IP당 분당 상한(@/lib/ratelimit) 초과 시 200 으로 나간다.
 *
 * 클라이언트(F3)는 `keepalive: true` 로 던지고 기다리지 않는다. 응답 본문은 진단용이다.
 */
import { clickRateLimiter } from '@/lib/ratelimit';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

import {
  clickWindowStart,
  clientIp,
  judgeClick,
  parseClickBody,
  visitorHash,
  type ClickDecision,
} from './logic';

/** Postgres 외래키 위반 — 여기서는 "없는 bookmark_id" 하나뿐이다. */
const FOREIGN_KEY_VIOLATION = '23503';

export async function POST(request: Request): Promise<Response> {
  const body = await readClickBody(request);
  if (!body.ok) {
    // 과대 페이로드는 413, 그 밖의 깨진·빈 본문은 400 이다 — 둘 다 `{ error }` 봉투(counted 없음).
    return body.reason === 'too-large'
      ? Response.json({ error: 'body 가 너무 큽니다.' }, { status: 413 })
      : Response.json({ error: 'body 를 JSON 으로 읽을 수 없습니다.' }, { status: 400 });
  }

  const parsed = parseClickBody(body.value);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { bookmarkId, visitorId, isBulk } = parsed.body;
  const ip = clientIp(request.headers.get('x-forwarded-for'));
  const now = new Date();

  // L1: IP당 분당 상한(@/lib/ratelimit). ip 가 정해진 직후이자 DB 를 치기 전에 판정한다 —
  //   초과해도 클릭을 기록만 하지 않을 뿐 응답은 200, 사용자 UX 는 그대로다(F3 는 fire-and-forget).
  //   bulk("전체 열기")는 묶음당 1회로 세고 막지 않는다 — 118건이 상한에 걸려 유실되지 않도록(V5).
  //
  //   limiter 는 인메모리라 **Vercel 인스턴스별 근사치**다(정밀 전역 상한 아님 — 유틸 상단 참조).
  //   키 신뢰성: 기본 Vercel 은 x-forwarded-for 를 플랫폼이 덮어써 클라이언트가 위조할 수 없다
  //   (외부 IP 미전달 — Vercel Request headers 문서). 그래서 집계용 해시 재료일 때와 달리 limiter
  //   키로도 신뢰할 수 있다. Vercel 위에 별도 프록시를 얹거나 비Vercel 로 배포하면 그 보장이 깨져
  //   leftmost 가 위조 가능해지므로, 그 환경에서는 x-vercel-forwarded-for/x-real-ip 로 키를 바꿔라.
  //   (프레임워크 헬퍼가 아니라 raw 헤더를 읽는다: NextRequest.ip 는 Next 15 에서 제거됐고 이
  //   라우트는 애초에 NextRequest 를 쓰지 않는다 — 구현과 무관한 문서 정확성 차원의 각주다.)
  //   벤더(@vercel/firewall) 권장 키는 x-real-ip 지만, 기본 Vercel 에선 XFF 와 동등하게 신뢰할 수
  //   있고 visitor_hash 의 IP 도출(logic.clientIp = XFF leftmost)과 일관되게 하려고 leftmost 를 쓴다.
  if (clickRateLimiter.check(ip, now.getTime(), isBulk).limited) {
    return Response.json({ counted: false, reason: 'rate-limit' } satisfies ClickDecision);
  }

  // 솔트가 없으면 해시를 만들 수 없다. 임의의 대체값으로 넘어가면 그 순간부터 판정이
  // 조용히 무력화되므로 멈춘다.
  //
  // 응답 본문에는 **어떤 환경변수가 비었는지 적지 않는다** — 공개 엔드포인트라 서버 설정의
  // 형태를 그대로 알려 줄 이유가 없다. 무엇이 비었는지는 아래 서버 로그가 담당한다.
  const salt = process.env.CLICK_SALT;
  if (salt === undefined || salt.trim() === '') {
    console.error('[api/click] 환경변수 CLICK_SALT 가 비어 있어 클릭을 기록할 수 없습니다.');

    return Response.json({ error: '서버 설정 오류로 클릭을 기록하지 못했습니다.' }, { status: 500 });
  }

  const hash = visitorHash(visitorId, ip, salt);

  const supabase = createAdminSupabaseClient();

  // 쿨다운(30초)과 일일 상한(UTC 오늘)을 한 번의 조회로 판정한다 — 창의 하한은 둘 중 더 이른 쪽.
  // 상한에 걸린 뒤로는 insert 가 멈추므로 이 창에 들어오는 행은 방문자·링크당 CLICK_DAILY_CAP 정도다.
  const recent = await supabase
    .from('clicks')
    .select('clicked_at')
    .eq('bookmark_id', bookmarkId)
    .eq('visitor_hash', hash)
    .gte('clicked_at', clickWindowStart(now));

  if (recent.error !== null) {
    console.error('[api/click] clicks 조회 실패', recent.error);

    return Response.json({ error: '클릭 기록을 조회하지 못했습니다.' }, { status: 500 });
  }

  const clickedAt = (recent.data ?? [])
    .map((row) => row.clicked_at)
    .filter((value): value is string => typeof value === 'string');

  const decision = judgeClick(now, clickedAt);
  if (!decision.counted) return Response.json(decision);

  const inserted = await supabase
    .from('clicks')
    .insert({ bookmark_id: bookmarkId, visitor_hash: hash, is_bulk: isBulk });

  if (inserted.error !== null) {
    // 없는 북마크를 가리키는 요청은 서버 고장이 아니라 클라이언트가 낡은 id 를 들고 있는 것이다
    // (북마크 삭제는 clicks 까지 cascade 로 지운다). 500 으로 올리면 진짜 장애에 묻힌다.
    //
    // `code` 를 함께 싣는다 — F3 가 이 갈래("낡은 목록이니 새로고침")를 알아보려면 기계가 읽을
    // 필드가 있어야 한다. 한국어 문구를 파싱하게 두면 문구를 다듬는 순간 조용히 깨진다.
    if (inserted.error.code === FOREIGN_KEY_VIOLATION) {
      return Response.json(
        { error: '존재하지 않는 bookmarkId 입니다.', code: 'unknown-bookmark' },
        { status: 400 },
      );
    }

    console.error('[api/click] clicks insert 실패', inserted.error);

    return Response.json({ error: '클릭을 기록하지 못했습니다.' }, { status: 500 });
  }

  return Response.json({ counted: true });
}

/**
 * 정상 클릭 body 는 uuid 둘 + isBulk 로 ~120B 다. 상한은 그보다 넉넉히(2KB) 두되 과대
 * 페이로드는 거부한다 — 공개 엔드포인트라 무한정 큰 본문을 파싱해 주지 않는다(F2 리뷰 ①).
 */
const MAX_CLICK_BODY_BYTES = 2 * 1024;

type ClickBodyRead =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'too-large' | 'unreadable' };

/**
 * 본문을 **크기 상한 안에서** JSON 으로 읽는다. 깨진 본문·빈 본문은 `unreadable`(400),
 * 상한 초과는 `too-large`(413).
 *
 * 두 겹으로 막는다: 먼저 `content-length` 로 **읽기 전에** 명백한 과대 요청을 끊고, 실제로 읽은
 * 바이트 길이로 다시 확인한다(헤더가 없거나 chunked 인 경우 대비 — 헤더는 위조 가능하므로 이것만
 * 믿지 않는다). 다만 라우트 레벨에서 스트림을 바이트 단위로 중단할 수는 없어, 헤더 없는 초대형
 * chunked 요청은 메모리에 다 읽힌 뒤 걸린다 — 그 완전한 방어는 플랫폼/엣지 계층의 몫이다
 * (middleware 는 이 작업의 경계 밖).
 */
async function readClickBody(request: Request): Promise<ClickBodyRead> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CLICK_BODY_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  if (new TextEncoder().encode(text).length > MAX_CLICK_BODY_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
