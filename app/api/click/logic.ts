/**
 * F2. `/api/click` 의 판정 로직 — **DB 도 요청 객체도 모르는 순수 함수들.**
 *
 * 라우트(`./route.ts`)는 이 함수들을 순서대로 부르는 얇은 껍데기다.
 * 쿨다운·일일 상한은 조건 분기가 촘촘한데 실 DB 없이는 재현하기 어려워서,
 * 판정만 여기로 떼어 내 단위 테스트(`./logic.test.ts`)로 못박는다.
 */
import { createHash } from 'node:crypto';

import { CLICK_COOLDOWN_MS, CLICK_DAILY_CAP } from '@/lib/constants';

/** 검증을 통과한 요청 본문. `isBulk` 는 여기서 기본값이 채워져 optional 이 아니다. */
export type ClickBody = {
  bookmarkId: string;
  visitorId: string;
  isBulk: boolean;
};

export type ParseResult = { ok: true; body: ClickBody } | { ok: false; error: string };

/**
 * 계약(§2.4)의 200 응답. `reason` 은 counted:false 일 때만 붙는다.
 *
 * ⚠️ 클라이언트(F3·G4)가 이 타입을 쓸 거라면 **반드시 `import type` 으로** 가져가라.
 * 이 모듈은 맨 위에서 `node:crypto` 를 부르므로 값 import 로 적으면 tsconfig 의
 * `isolatedModules` 때문에 번들러가 런타임 import 로 남겨 브라우저 번들이 깨진다.
 * (`import type` 은 완전히 지워진다.) 값이 필요해지면 그때 `lib/types.ts` 로 옮겨라 —
 * 지금은 소비자가 없어 공유 파일을 건드릴 이유가 없다.
 */
export type ClickDecision =
  | { counted: true }
  | { counted: false; reason: 'cooldown' | 'daily-cap' | 'rate-limit' };

/**
 * uuid 형식만 본다(버전 자리는 강제하지 않는다). `lib/visitor.ts` 의 폴백 생성기와 같은 기준이다 —
 * 여기서 더 엄격하게 굴면 비보안 컨텍스트의 브라우저가 영구히 400을 받는 무성 고장이 된다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 요청 본문 검증. 실패하면 400 으로 나갈 사람이 읽을 이유를 함께 돌려준다.
 *
 * uuid 는 **소문자로 정규화**한다. 대소문자가 섞이면 같은 방문자가 두 개의 다른 해시로 갈려
 * 쿨다운·상한이 통째로 무력화된다(Postgres 는 uuid 를 알아서 정규화하지만 해시 입력은 문자열 그대로다).
 * 앞뒤 공백은 다듬지 않고 형식 오류로 본다 — 조용히 고쳐 주면 클라이언트의 버그가 묻힌다.
 */
export function parseClickBody(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body 는 JSON 객체여야 합니다.' };
  }

  const { bookmarkId, visitorId, isBulk } = raw as Record<string, unknown>;

  if (typeof bookmarkId !== 'string' || !UUID_RE.test(bookmarkId)) {
    return { ok: false, error: 'bookmarkId 는 uuid 형식의 문자열이어야 합니다.' };
  }

  if (typeof visitorId !== 'string' || !UUID_RE.test(visitorId)) {
    return { ok: false, error: 'visitorId 는 uuid 형식의 문자열이어야 합니다.' };
  }

  if (isBulk !== undefined && typeof isBulk !== 'boolean') {
    return { ok: false, error: 'isBulk 는 boolean 이거나 없어야 합니다.' };
  }

  return {
    ok: true,
    body: {
      bookmarkId: bookmarkId.toLowerCase(),
      visitorId: visitorId.toLowerCase(),
      isBulk: isBulk ?? false,
    },
  };
}

/**
 * `x-forwarded-for` 에서 클라이언트 ip 를 뽑는다 — 체인의 **첫 값**이 원 클라이언트다.
 * 헤더가 없거나 비어 있으면 빈 문자열(로컬 dev·프록시 없는 직접 접속).
 *
 * 이 값은 해시 재료로만 쓰이고 어디에도 저장되지 않는다. 위조 가능한 헤더지만,
 * 여기서 막으려는 건 공격이 아니라 같은 방문자의 중복 집계다.
 */
export function clientIp(forwardedFor: string | null): string {
  if (forwardedFor === null) return '';

  return forwardedFor.split(',')[0].trim();
}

/**
 * `sha256(visitorId:ip:salt)` 의 hex. **원본 uuid 도 ip 도 DB 에 남기지 않기 위한 장치다.**
 *
 * salt 를 바꾸면 기존 해시와 이어지지 않아 쿨다운·상한 판정이 초기화된다(.env.example 참조).
 */
export function visitorHash(visitorId: string, ip: string, salt: string): string {
  return createHash('sha256').update(`${visitorId}:${ip}:${salt}`).digest('hex');
}

/**
 * 라우트가 clicks 를 조회할 하한 시각(ISO).
 *
 * 보통은 **UTC 오늘 자정**이다(일일 상한이 UTC `clicked_at` 날짜 기준이므로).
 * 다만 자정 직후에는 30초 쿨다운 창이 자정보다 앞서므로 그쪽까지 넓힌다 —
 * 자정에서 잘라 버리면 23:59:50 의 클릭이 안 보여 쿨다운이 뚫린다.
 */
export function clickWindowStart(now: Date): string {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return new Date(Math.min(utcMidnight, now.getTime() - CLICK_COOLDOWN_MS)).toISOString();
}

/**
 * 이 클릭을 셀지 판정한다. `clickedAt` 은 같은 (visitor_hash, bookmark_id) 로 좁혀
 * `clickWindowStart` 이후를 읽어 온 `clicked_at` 값들이다.
 *
 * 판정 순서는 계약 그대로 **쿨다운 → 일일 상한**이다. 상한까지 찬 상태에서 연타하면
 * 이유가 `cooldown` 으로 나가는데, 둘 다 `counted:false` 라 사용자에게 보이는 결과는 같다.
 *
 * **날짜 경계는 UTC 로 단순화했다**(계획서 §2.4 의 "오늘"). 서버 로컬 시간대를 쓰면 배포 환경
 * (Vercel=UTC)과 로컬(KST)에서 상한이 리셋되는 시점이 달라져 재현이 어려워진다. KST 기준으로는
 * 매일 09:00 에 리셋되는 셈이다.
 */
export function judgeClick(now: Date, clickedAt: readonly string[]): ClickDecision {
  const nowMs = now.getTime();
  const times = clickedAt
    .map((value) => new Date(value).getTime())
    .filter((time) => !Number.isNaN(time));

  // 미래 시각(시계 오차·DB now() 와의 미세한 차이)도 쿨다운으로 본다.
  // 중복으로 세는 것보다 한 번 빠뜨리는 쪽이 안전하다.
  if (times.some((time) => nowMs - time < CLICK_COOLDOWN_MS)) {
    return { counted: false, reason: 'cooldown' };
  }

  const today = utcDateKey(nowMs);
  const todayCount = times.filter((time) => utcDateKey(time) === today).length;

  if (todayCount >= CLICK_DAILY_CAP) return { counted: false, reason: 'daily-cap' };

  return { counted: true };
}

/** UTC 기준 `YYYY-MM-DD` — 같은 날인지 비교하기 위한 키. */
function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
