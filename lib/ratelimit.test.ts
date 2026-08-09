/**
 * L1. IP당 분당 상한의 순수 판정 — **DB 도 요청 객체도 모르는 인메모리 슬라이딩 윈도.**
 *
 * 라우트(`app/api/click/route.ts`)는 이 판정으로 클릭 *기록 여부*만 가른다(사용자 UX 는 그대로).
 * 배포 환경(Vercel)에서는 인스턴스마다 별도 메모리라 전역 정확치가 아니라 **근사치**다 —
 * 그 한계는 `./ratelimit.ts` 주석에 적고, 여기서는 한 인스턴스 안의 계약만 못박는다.
 */
import { describe, expect, it } from 'vitest';

import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  clickRateLimiter,
  createRateLimiter,
} from '@/lib/ratelimit';

const IP = '203.0.113.7';
const T0 = 1_000_000; // 임의의 기준 시각(ms). 절대값은 의미 없다 — 창은 상대 간격으로만 본다.

/** 같은 키로 일반 요청을 n번 던지고, 각 판정의 limited 를 순서대로 돌려준다(모두 같은 시각). */
function hitNormal(limiter: ReturnType<typeof createRateLimiter>, count: number, now = T0): boolean[] {
  return Array.from({ length: count }, () => limiter.check(IP, now, false).limited);
}

describe('createRateLimiter — 일반 요청 상한', () => {
  it(`창 안에서 ${RATE_LIMIT_MAX}회까지 통과시키고 ${RATE_LIMIT_MAX + 1}번째를 막는다`, () => {
    const limiter = createRateLimiter();

    const results = hitNormal(limiter, RATE_LIMIT_MAX + 1);

    // 앞의 30회는 전부 통과, 31번째만 막힌다.
    expect(results.slice(0, RATE_LIMIT_MAX).every((limited) => limited === false)).toBe(true);
    expect(results[RATE_LIMIT_MAX]).toBe(true);
  });

  it('키(IP)가 다르면 서로의 상한에 영향을 주지 않는다', () => {
    const limiter = createRateLimiter();
    hitNormal(limiter, RATE_LIMIT_MAX); // IP 를 가득 채운다

    // 다른 IP 의 첫 요청은 여전히 통과한다 — XFF 로 키를 나누는 배선을 못박는다.
    expect(limiter.check('198.51.100.9', T0, false).limited).toBe(false);
    // 원래 IP 는 막힌 상태 그대로.
    expect(limiter.check(IP, T0, false).limited).toBe(true);
  });

  it('빈 키(로컬 dev·XFF 부재)도 하나의 버킷으로 똑같이 센다', () => {
    const limiter = createRateLimiter();

    const results = Array.from({ length: RATE_LIMIT_MAX + 1 }, () =>
      limiter.check('', T0, false).limited,
    );

    expect(results[RATE_LIMIT_MAX]).toBe(true);
  });
});

describe('createRateLimiter — 슬라이딩 윈도 경계(분 경계에서 리셋)', () => {
  it('창이 다 차기 직전(WINDOW-1ms)에는 아직 막혀 있다', () => {
    const limiter = createRateLimiter();
    hitNormal(limiter, RATE_LIMIT_MAX, T0);

    expect(limiter.check(IP, T0 + RATE_LIMIT_WINDOW_MS - 1, false).limited).toBe(true);
  });

  it('정확히 WINDOW 가 지나면 앞선 기록이 창 밖으로 빠져 다시 통과한다', () => {
    const limiter = createRateLimiter();
    hitNormal(limiter, RATE_LIMIT_MAX, T0);

    // 경계는 배타적이다 — clickWindowStart/judgeClick 의 쿨다운 경계와 같은 관례.
    expect(limiter.check(IP, T0 + RATE_LIMIT_WINDOW_MS, false).limited).toBe(false);
  });

  it('오래된 기록만 빠지고 창 안의 기록은 남는다(부분 슬라이딩)', () => {
    const limiter = createRateLimiter();
    // 29건은 T0, 1건은 T0+WINDOW/2 에 찍는다 → 합쳐 30건(가득).
    hitNormal(limiter, RATE_LIMIT_MAX - 1, T0);
    limiter.check(IP, T0 + RATE_LIMIT_WINDOW_MS / 2, false);

    // T0+WINDOW: T0 의 29건은 빠지지만 절반 지점의 1건은 아직 창 안 → 1건만 남아 통과.
    expect(limiter.check(IP, T0 + RATE_LIMIT_WINDOW_MS, false).limited).toBe(false);
  });
});

describe('createRateLimiter — bulk(전체 열기)는 묶음당 1회', () => {
  it('bulk 요청은 개수와 무관하게 절대 막지 않는다(118건 전부 통과)', () => {
    const limiter = createRateLimiter();

    const results = Array.from({ length: 118 }, () => limiter.check(IP, T0, true).limited);

    expect(results.every((limited) => limited === false)).toBe(true);
  });

  it('bulk 한 묶음은 상한 예산을 딱 1회만 소비한다(묶음당 1회)', () => {
    const limiter = createRateLimiter();
    // "전체 열기" 118건 — 창에 bulk 유닛 1개만 남긴다.
    Array.from({ length: 118 }, () => limiter.check(IP, T0, true));

    // 이제 일반 요청 예산은 30 중 1이 소비된 상태여야 한다.
    const normal = hitNormal(limiter, RATE_LIMIT_MAX); // 30회 시도
    // bulk 가 1을 먹었으므로 29번째까지 통과, 30번째에서 막힌다.
    expect(normal[RATE_LIMIT_MAX - 2]).toBe(false); // 29번째(index 28)
    expect(normal[RATE_LIMIT_MAX - 1]).toBe(true); // 30번째(index 29)
  });

  it('bulk 유닛도 창이 지나면 빠진다', () => {
    const limiter = createRateLimiter();
    limiter.check(IP, T0, true); // bulk 유닛 1개

    // 창이 지난 뒤에는 예산이 온전히 30으로 회복된다.
    const later = T0 + RATE_LIMIT_WINDOW_MS;
    const normal = Array.from({ length: RATE_LIMIT_MAX + 1 }, () =>
      limiter.check(IP, later, false).limited,
    );
    expect(normal.slice(0, RATE_LIMIT_MAX).every((limited) => limited === false)).toBe(true);
    expect(normal[RATE_LIMIT_MAX]).toBe(true);
  });
});

describe('createRateLimiter — 지연 스윕이 만료 키를 회수한다(M-3)', () => {
  it('만료 유닛만 남은 키 여럿을 스윕이 회수해 size 가 준다', () => {
    // sweepEvery 를 낮춰 스윕을 결정적으로 튼다. 프로덕션 주기(512)는 그대로 두고 테스트에서만 바꾼다.
    const limiter = createRateLimiter({ sweepEvery: 5 });

    // 서로 다른 IP 50개로 각각 T0 에 1건씩 → 키 50개. (T0 시점의 스윕은 전부 창 안이라 회수 없음.)
    for (let i = 0; i < 50; i += 1) limiter.check(`10.0.0.${i}`, T0, false);
    expect(limiter.size()).toBe(50);

    // 창이 지난 시각에 새 키로 sweepEvery 회 던져 스윕을 튼다. 이 시각 기준 앞선 50개 키의
    // 유닛은 전부 만료됐으므로 스윕이 그 키들을 buckets 에서 지운다. (스윕이 없으면 live() 가
    // 매번 걸러도 Map 은 키를 계속 들고 있어 size 가 51 로 남는다 — 그 누수를 이 단언이 잡는다.)
    const later = T0 + RATE_LIMIT_WINDOW_MS + 1;
    for (let i = 0; i < 5; i += 1) limiter.check('sweeper', later, false);

    // 회수 뒤에는 방금 던진 sweeper 키 1개만 남는다(만료 50개가 사라졌다).
    expect(limiter.size()).toBe(1);
  });
});

describe('createRateLimiter — reset', () => {
  it('reset() 은 모든 키의 누적을 지운다', () => {
    const limiter = createRateLimiter();
    hitNormal(limiter, RATE_LIMIT_MAX);
    expect(limiter.check(IP, T0, false).limited).toBe(true);

    limiter.reset();

    expect(limiter.check(IP, T0, false).limited).toBe(false);
  });
});

describe('공유 상수', () => {
  it('창은 60초, 상한은 30회다(계획서 L1)', () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(RATE_LIMIT_MAX).toBe(30);
  });

  it('라우트가 쓰는 싱글턴이 노출된다', () => {
    expect(typeof clickRateLimiter.check).toBe('function');
    expect(typeof clickRateLimiter.reset).toBe('function');
  });
});
