/** F2. POST /api/click 의 순수 판정 로직 (계획서 §2.4). DB 접근은 route.ts 에만 있다. */
import { describe, expect, it } from 'vitest';
import {
  clickWindowStart,
  clientIp,
  judgeClick,
  parseClickBody,
  visitorHash,
} from '@/app/api/click/logic';
import { CLICK_COOLDOWN_MS, CLICK_DAILY_CAP } from '@/lib/constants';

const BOOKMARK_ID = '0f9c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const VISITOR_ID = '11111111-1111-4111-8111-111111111111';

/** `now` 기준 `ms` 밀리초 전의 시각 — clicked_at 이 DB 에서 오는 형식(ISO)으로. */
function ago(now: Date, ms: number): string {
  return new Date(now.getTime() - ms).toISOString();
}

describe('parseClickBody', () => {
  it('정상 body 를 통과시키고 isBulk 는 기본 false 다', () => {
    const result = parseClickBody({ bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID });

    expect(result).toEqual({
      ok: true,
      body: { bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID, isBulk: false },
    });
  });

  it('isBulk:true 를 그대로 실어 나른다 (G4 전체 열기가 쓴다)', () => {
    const result = parseClickBody({
      bookmarkId: BOOKMARK_ID,
      visitorId: VISITOR_ID,
      isBulk: true,
    });

    expect(result).toEqual({
      ok: true,
      body: { bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID, isBulk: true },
    });
  });

  it('대문자 uuid 는 소문자로 정규화한다 (같은 방문자가 두 해시로 갈리지 않도록)', () => {
    const result = parseClickBody({
      bookmarkId: BOOKMARK_ID.toUpperCase(),
      visitorId: VISITOR_ID.toUpperCase(),
    });

    expect(result).toEqual({
      ok: true,
      body: { bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID, isBulk: false },
    });
  });

  it('모르는 키는 무시한다', () => {
    const result = parseClickBody({
      bookmarkId: BOOKMARK_ID,
      visitorId: VISITOR_ID,
      hackerField: 'x',
    });

    expect(result).toEqual({
      ok: true,
      body: { bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID, isBulk: false },
    });
  });

  it('uuid 형식이 아니면 거부한다', () => {
    expect(parseClickBody({ bookmarkId: 'not-a-uuid', visitorId: VISITOR_ID }).ok).toBe(false);
    expect(parseClickBody({ bookmarkId: BOOKMARK_ID, visitorId: '12345' }).ok).toBe(false);
    // 앞뒤 공백도 형식 오류다 — 관대하게 받으면 해시가 조용히 갈린다.
    expect(parseClickBody({ bookmarkId: ` ${BOOKMARK_ID} `, visitorId: VISITOR_ID }).ok).toBe(
      false,
    );
  });

  it('필드가 누락되거나 타입이 다르면 거부한다', () => {
    expect(parseClickBody({ visitorId: VISITOR_ID }).ok).toBe(false);
    expect(parseClickBody({ bookmarkId: BOOKMARK_ID }).ok).toBe(false);
    expect(parseClickBody({ bookmarkId: 123, visitorId: VISITOR_ID }).ok).toBe(false);
    expect(parseClickBody({ bookmarkId: BOOKMARK_ID, visitorId: null }).ok).toBe(false);
  });

  it('isBulk 가 boolean 이 아니면 거부한다', () => {
    const result = parseClickBody({
      bookmarkId: BOOKMARK_ID,
      visitorId: VISITOR_ID,
      isBulk: 'true',
    });

    expect(result.ok).toBe(false);
  });

  it('객체가 아닌 body 는 거부한다', () => {
    expect(parseClickBody(null).ok).toBe(false);
    expect(parseClickBody(undefined).ok).toBe(false);
    expect(parseClickBody('{}').ok).toBe(false);
    expect(parseClickBody([{ bookmarkId: BOOKMARK_ID, visitorId: VISITOR_ID }]).ok).toBe(false);
  });

  it('거부할 때는 무엇이 틀렸는지 알려 준다', () => {
    const result = parseClickBody({ bookmarkId: 'nope', visitorId: VISITOR_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('bookmarkId');
  });
});

describe('clientIp', () => {
  it('x-forwarded-for 의 첫 값을 쓴다 (프록시 체인의 맨 앞이 클라이언트)', () => {
    expect(clientIp('203.0.113.7, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.7');
  });

  it('공백을 정리한다', () => {
    expect(clientIp('  203.0.113.7  ')).toBe('203.0.113.7');
  });

  it('헤더가 없으면 빈 문자열이다 (로컬 dev·직접 접속)', () => {
    expect(clientIp(null)).toBe('');
    expect(clientIp('')).toBe('');
    expect(clientIp('   ')).toBe('');
  });
});

describe('visitorHash', () => {
  it('`visitorId:ip:salt` 의 sha256 hex 다', () => {
    expect(visitorHash(VISITOR_ID, '203.0.113.7', 'test-salt')).toBe(
      'a57d2b9e286fe908302bd2e35323e605fbef71dbe568e1a31e09f25cbe82fb53',
    );
  });

  it('원본 uuid 도 ip 도 결과에 남지 않는다 (DB 에 개인정보를 저장하지 않는 이유)', () => {
    const hash = visitorHash(VISITOR_ID, '203.0.113.7', 'test-salt');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(VISITOR_ID);
    expect(hash).not.toContain('203.0.113.7');
  });

  it('ip·salt 중 하나만 달라도 다른 해시가 된다', () => {
    const base = visitorHash(VISITOR_ID, '203.0.113.7', 'test-salt');

    expect(visitorHash(VISITOR_ID, '198.51.100.9', 'test-salt')).not.toBe(base);
    expect(visitorHash(VISITOR_ID, '203.0.113.7', 'other-salt')).not.toBe(base);
    expect(visitorHash('22222222-2222-4222-8222-222222222222', '203.0.113.7', 'test-salt')).not.toBe(
      base,
    );
  });

  it('ip 가 비어 있어도 동작한다', () => {
    expect(visitorHash(VISITOR_ID, '', 'test-salt')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('clickWindowStart', () => {
  it('보통은 UTC 오늘 자정부터 조회한다 (일일 상한이 UTC 날짜 기준이므로)', () => {
    const now = new Date('2026-08-09T13:24:05.000Z');

    expect(clickWindowStart(now)).toBe('2026-08-09T00:00:00.000Z');
  });

  it('자정 직후에는 쿨다운 창이 자정보다 앞서므로 그쪽까지 넓힌다', () => {
    const now = new Date('2026-08-09T00:00:05.000Z');

    // 어제 23:59:50 의 클릭도 30초 쿨다운 안이다 — 자정에서 잘라 버리면 놓친다.
    expect(clickWindowStart(now)).toBe(
      new Date(now.getTime() - CLICK_COOLDOWN_MS).toISOString(),
    );
  });
});

describe('judgeClick', () => {
  const now = new Date('2026-08-09T13:24:05.000Z');

  it('기록이 없으면 센다', () => {
    expect(judgeClick(now, [])).toEqual({ counted: true });
  });

  it('30초 안에 같은 링크를 다시 누르면 cooldown 이다', () => {
    expect(judgeClick(now, [ago(now, 5_000)])).toEqual({ counted: false, reason: 'cooldown' });
  });

  it('정확히 30초가 지났으면 다시 센다 (경계는 포함하지 않는다)', () => {
    expect(judgeClick(now, [ago(now, CLICK_COOLDOWN_MS)])).toEqual({ counted: true });
  });

  it('자정을 넘긴 직후에도 30초 전 기록이면 cooldown 이다', () => {
    const justAfterMidnight = new Date('2026-08-09T00:00:05.000Z');

    expect(judgeClick(justAfterMidnight, ['2026-08-08T23:59:50.000Z'])).toEqual({
      counted: false,
      reason: 'cooldown',
    });
  });

  it('오늘 상한만큼 쌓였으면 daily-cap 이다', () => {
    const today = Array.from({ length: CLICK_DAILY_CAP }, (_, index) =>
      ago(now, CLICK_COOLDOWN_MS + index * 60_000),
    );

    expect(judgeClick(now, today)).toEqual({ counted: false, reason: 'daily-cap' });
  });

  it(`상한 직전(${CLICK_DAILY_CAP - 1}건)까지는 센다`, () => {
    const today = Array.from({ length: CLICK_DAILY_CAP - 1 }, (_, index) =>
      ago(now, CLICK_COOLDOWN_MS + index * 60_000),
    );

    expect(judgeClick(now, today)).toEqual({ counted: true });
  });

  it('어제 기록은 오늘 상한에 넣지 않는다 (UTC clicked_at 날짜 기준)', () => {
    const yesterday = Array.from(
      { length: CLICK_DAILY_CAP },
      (_, index) => `2026-08-08T${String(index).padStart(2, '0')}:00:00.000Z`,
    );

    expect(judgeClick(now, yesterday)).toEqual({ counted: true });
  });

  it('상한까지 찼어도 방금 누른 기록이 있으면 cooldown 이 먼저다 (계약의 판정 순서)', () => {
    const today = [
      ago(now, 1_000),
      ...Array.from({ length: CLICK_DAILY_CAP }, (_, index) =>
        ago(now, CLICK_COOLDOWN_MS + index * 60_000),
      ),
    ];

    expect(judgeClick(now, today)).toEqual({ counted: false, reason: 'cooldown' });
  });

  it('미래 시각(시계 오차)도 쿨다운으로 본다 — 중복 집계보다 누락이 안전하다', () => {
    expect(judgeClick(now, [new Date(now.getTime() + 5_000).toISOString()])).toEqual({
      counted: false,
      reason: 'cooldown',
    });
  });

  it('해석할 수 없는 시각은 무시한다', () => {
    expect(judgeClick(now, ['그런 시각 없음'])).toEqual({ counted: true });
  });
});
