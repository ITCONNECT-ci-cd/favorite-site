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
 *       `{ counted: false, reason: 'cooldown' | 'daily-cap' }`
 *   400 `{ error: string }`                           — body 형식 오류(비uuid·누락·깨진 본문)
 *       `{ error: string, code: 'unknown-bookmark' }` — 없는 bookmarkId (아래 insert 분기 참조)
 *   500 `{ error: string }`                           — CLICK_SALT 부재 · clicks 조회/insert 실패
 *
 * **비200 은 모두 `{ error }` 봉투다 — `counted` 가 실리지 않는다.** 소비자는 `res.ok` 로 먼저
 * 갈라야 하고, 갈래를 구분해야 한다면 `error` 문자열이 아니라 `code` 를 봐라(문구는 바뀔 수 있다).
 * `reason: 'rate-limit'` 은 4단계 L1 예약 — 지금은 내보내지 않는다.
 *
 * 클라이언트(F3)는 `keepalive: true` 로 던지고 기다리지 않는다. 응답 본문은 진단용이다.
 */
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

import { clickWindowStart, clientIp, judgeClick, parseClickBody, visitorHash } from './logic';

/** Postgres 외래키 위반 — 여기서는 "없는 bookmark_id" 하나뿐이다. */
const FOREIGN_KEY_VIOLATION = '23503';

export async function POST(request: Request): Promise<Response> {
  const raw = await readJson(request);
  if (raw === undefined) {
    return Response.json({ error: 'body 를 JSON 으로 읽을 수 없습니다.' }, { status: 400 });
  }

  const parsed = parseClickBody(raw);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { bookmarkId, visitorId, isBulk } = parsed.body;
  const ip = clientIp(request.headers.get('x-forwarded-for'));

  // ⓘ 4단계 L1 의 "ip 당 분당 30회" rate limit 이 들어올 자리다 — ip 가 정해진 직후이자
  //   DB 를 치기 전. 초과 시 `{ counted: false, reason: 'rate-limit' }` 을 200 으로 돌린다.

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
  const now = new Date();

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

/** 본문을 JSON 으로 읽는다. 깨진 본문·빈 본문은 `undefined` (호출부가 400 으로 돌린다). */
async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}
