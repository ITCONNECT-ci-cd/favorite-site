/**
 * L1. `/api/click` 의 IP당 분당 상한 — **인메모리 슬라이딩 윈도.**
 *
 * 목적은 방문자 방어의 마지막 한 겹이다. 쿨다운·일일 상한(`app/api/click/logic.ts`)은
 * `(visitor_hash, bookmark_id)` 로 좁혀 세므로, visitorId 를 회전시키면 그 둘이 통째로
 * 무력화된다(계획서 F2 리뷰 ⑤). 그때 남는 유일한 방어가 **IP당 분당 30회**다.
 *
 * ⚠️ **인스턴스별 근사치다.** Vercel 서버리스는 요청마다 다른 인스턴스로 갈 수 있고
 * 인스턴스마다 이 Map 이 따로 산다 — 전역 합산이 아니다. 그래서 실제 허용량은 (동시에 뜬
 * 인스턴스 수) × 30/분 근처까지 늘 수 있다. 정확한 전역 상한이 필요해지면 공유 저장소
 * (Redis 등) 로 옮겨야 하지만, 이 단계의 목적(회전 남용의 상한을 *한 자릿수 배수* 안으로
 * 묶기)에는 근사치로 충분하다. **클릭은 fire-and-forget 이라 한 번 덜 세는 쪽이 안전하다.**
 *
 * 키의 신뢰성(F2 리뷰 ④): 라우트는 `clientIp(x-forwarded-for)` 를 키로 넘긴다. 기본 Vercel
 * 배포에서 `x-forwarded-for` 는 **플랫폼이 덮어써** 클라이언트가 위조할 수 없다(외부 IP 를
 * 전달하지 않는다 — Vercel Request headers 문서). 따라서 이 키는 집계용 해시 재료일 때와 달리
 * limiter 키로도 신뢰할 수 있다. 다만 Vercel 위에 **별도 리버스 프록시**를 얹거나 Vercel 이
 * 아닌 곳에 배포하면 그 보장이 깨져 leftmost XFF 가 공격자 통제로 넘어간다 — 그 환경에서는
 * `x-vercel-forwarded-for`/`x-real-ip` 로 키를 바꿔야 한다(라우트 주석에 근거를 남긴다).
 */

/** 창 길이. 이 시간(ms)보다 오래된 기록은 창 밖으로 빠진다. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** 한 창(분) 안에서 IP당 허용하는 일반 요청 수. 31번째부터 막힌다. */
export const RATE_LIMIT_MAX = 30;

export type RateLimitDecision = { limited: boolean };

export type RateLimiter = {
  /**
   * 이 요청을 통과시킬지 판정하고 필요한 만큼 상태를 갱신한다.
   *
   * `isBulk` 가 true 이면(G4 "전체 열기") **절대 막지 않고**, 창에 bulk 유닛이 없을 때만
   * 예산을 1회 소비한다 — 118개 묶음이 상한에 걸려 유실되지 않도록(계획서 V5, "묶음당 1회").
   */
  check(key: string, nowMs: number, isBulk: boolean): RateLimitDecision;
  /** 모든 키의 누적을 지운다. 테스트 격리 전용(운영 경로에서는 부르지 않는다). */
  reset(): void;
  /**
   * 현재 추적 중인 키(=활성 IP) 수. 지연 스윕이 만료 키를 실제로 회수하는지 관찰하기 위한
   * introspection 이다(운영 경로에서는 부르지 않는다).
   */
  size(): number;
};

/** 창 안에 남아 있는 한 번의 소비 단위. `bulk` 는 묶음당 1개만 남긴다. */
type Unit = { at: number; bulk: boolean };

/**
 * 지연 스윕 주기. check() 가 이만큼 불릴 때마다 한 번, 만료 유닛만 남은 키를 buckets 에서
 * 회수한다. 서버리스(주 타깃)에선 인스턴스가 짧게 살아 사실상 무영향이지만, 문서화된 비Vercel
 * 폴백(장수 프로세스)에서는 조용히 떠난 IP 의 키가 이 스윕으로 회수돼 누수를 막는다. 스윕 비용은
 * O(distinct IP) 이고 드물게 돈다.
 */
const SWEEP_EVERY_CHECKS = 512;

export function createRateLimiter(
  {
    windowMs = RATE_LIMIT_WINDOW_MS,
    max = RATE_LIMIT_MAX,
    sweepEvery = SWEEP_EVERY_CHECKS,
  }: { windowMs?: number; max?: number; sweepEvery?: number } = {},
): RateLimiter {
  // key(IP) → 창 안에 살아 있는 소비 단위들. 정상 check 경로는 늘 유닛을 하나 남겨 키가 절대
  // 비지 않으므로, 만료된 키의 회수는 아래 지연 스윕(sweep)이 맡는다 — 그래야 "메모리를 활성
  // IP 수로 묶는다"가 실제로 참이 된다.
  const buckets = new Map<string, Unit[]>();
  let checksSinceSweep = 0;

  function live(key: string, nowMs: number): Unit[] {
    const cutoff = nowMs - windowMs;

    // 경계는 배타적이다(`> cutoff`): 정확히 windowMs 가 지난 기록은 창 밖 — judgeClick 의
    // 쿨다운 경계("정확히 30초면 다시 센다")와 같은 관례라 두 곳이 어긋나지 않는다.
    return (buckets.get(key) ?? []).filter((unit) => unit.at > cutoff);
  }

  function save(key: string, units: Unit[]): void {
    // units 가 비면 키를 회수한다. 정상 check 경로는 늘 유닛을 하나 남겨 이 분기에 닿지 않지만,
    // 스윕이 만료된 키를 빈 배열로 이 함수에 넘겨 이 분기를 실제로 태운다(활성 IP 수로 묶기).
    if (units.length === 0) buckets.delete(key);
    else buckets.set(key, units);
  }

  /**
   * 만료 유닛만 남은 키를 회수하는 경량 스윕. 각 키의 live(창 안 유닛)를 다시 계산해 save 로
   * 되쓴다 — 살아 있으면 솎아 낸 배열로 갱신되고, 전부 만료됐으면 save 가 키를 지운다. Map 순회
   * 중 방문한/현재 키의 삭제는 안전하고, save 는 기존 키만 갱신·삭제하므로 새 키를 추가하지 않는다.
   */
  function sweep(nowMs: number): void {
    for (const key of buckets.keys()) {
      save(key, live(key, nowMs));
    }
  }

  return {
    check(key, nowMs, isBulk) {
      // N회마다 한 번, 만료 키를 회수한다. 현재 요청보다 먼저 돌아도 무방하다 — 이 요청의
      // 키는 아래에서 곧바로 다시 채워진다.
      checksSinceSweep += 1;
      if (checksSinceSweep >= sweepEvery) {
        checksSinceSweep = 0;
        sweep(nowMs);
      }

      const units = live(key, nowMs);

      if (isBulk) {
        // 묶음당 1회: 창에 bulk 유닛이 이미 있으면 새로 남기지 않는다. bulk 는 예산을 초과해도
        // 막지 않으므로 여기서 length 검사를 건너뛴다(전체 열기 118건 전부 통과).
        if (!units.some((unit) => unit.bulk)) units.push({ at: nowMs, bulk: true });
        save(key, units);

        return { limited: false };
      }

      if (units.length >= max) {
        save(key, units); // 오래된 기록을 솎아 낸 상태를 되쓴다(다음 판정이 정확하도록).

        return { limited: true };
      }

      units.push({ at: nowMs, bulk: false });
      save(key, units);

      return { limited: false };
    },

    reset() {
      buckets.clear();
      checksSinceSweep = 0;
    },

    size() {
      return buckets.size;
    },
  };
}

/**
 * 라우트가 쓰는 프로세스(=인스턴스) 단위 싱글턴. 모듈 로드 시 한 번 만들어져 요청 사이에
 * 산다 — rate limit 상태가 요청마다 초기화되면 아무것도 못 막는다.
 */
export const clickRateLimiter: RateLimiter = createRateLimiter();
