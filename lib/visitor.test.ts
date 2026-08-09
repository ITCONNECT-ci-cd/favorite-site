/** F1. 방문자 ID — 클릭 집계(F2)에서 쓰는 브라우저 전용 익명 식별자. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISITOR_KEY } from '@/lib/constants';
import { getVisitorId } from '@/lib/visitor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 모듈 수준 메모리 폴백이 다른 테스트로 새지 않도록 새 모듈 인스턴스를 얻는다. */
async function freshModule() {
  vi.resetModules();
  return import('@/lib/visitor');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getVisitorId', () => {
  it('최초 호출에서 UUID를 만들어 localStorage에 영속한다', () => {
    expect(localStorage.getItem(VISITOR_KEY)).toBeNull();

    const id = getVisitorId();

    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem(VISITOR_KEY)).toBe(id);
  });

  it('crypto.randomUUID로 값을 만든다', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID');

    const id = getVisitorId();

    expect(randomUUID).toHaveBeenCalledOnce();
    expect(id).toBe(randomUUID.mock.results[0]?.value);
  });

  it('재호출하면 같은 값을 돌려준다 (재생성하지 않는다)', () => {
    const first = getVisitorId();
    const randomUUID = vi.spyOn(crypto, 'randomUUID');

    expect(getVisitorId()).toBe(first);
    expect(getVisitorId()).toBe(first);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('이미 저장된 값이 있으면 그 값을 그대로 쓴다 (새로고침 후 유지)', () => {
    localStorage.setItem(VISITOR_KEY, 'ffffffff-ffff-4fff-bfff-ffffffffffff');

    expect(getVisitorId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(localStorage.getItem(VISITOR_KEY)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('localStorage 읽기가 막혀 있어도(프라이빗 모드) 세션 한정 값을 돌려준다', async () => {
    const { getVisitorId: fresh } = await freshModule();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    const id = fresh();

    expect(id).toMatch(UUID_RE);
    expect(fresh()).toBe(id);
  });

  it('localStorage 쓰기가 막혀 있어도 세션 내내 같은 값을 돌려준다', async () => {
    const { getVisitorId: fresh } = await freshModule();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const id = fresh();

    expect(id).toMatch(UUID_RE);
    expect(fresh()).toBe(id);
    expect(fresh()).toBe(id);
  });

  it('crypto.randomUUID를 못 쓰는 환경에서도 값을 만들어 낸다', async () => {
    const { getVisitorId: fresh } = await freshModule();
    // 비보안 컨텍스트(http)에서는 crypto.randomUUID가 없다.
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function');
    });

    const id = fresh();

    // F2가 그대로 API로 보내므로 폴백도 UUID 형식이어야 한다.
    expect(id).toMatch(UUID_RE);
    expect(fresh()).toBe(id);
  });

  it('crypto 폴백으로 만든 값도 매번 다르다', async () => {
    const { getVisitorId: fresh } = await freshModule();
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function');
    });

    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      localStorage.clear();
      ids.add(fresh());
    }

    expect(ids.size).toBe(50);
  });

  it('window가 없는 서버에서는 모듈에 값을 남기지 않는다 (요청 간 공유 방지)', async () => {
    const { getVisitorId: fresh } = await freshModule();
    vi.stubGlobal('window', undefined);

    // 서버에서 캐시해 버리면 프로세스의 모든 요청이 한 id를 공유하게 된다.
    expect(fresh()).not.toBe(fresh());

    vi.unstubAllGlobals();

    // 서버 호출이 브라우저 쪽 동작을 오염시키지도 않는다.
    const browserId = fresh();
    expect(localStorage.getItem(VISITOR_KEY)).toBe(browserId);
    expect(fresh()).toBe(browserId);
  });

  it('저장된 값이 비어 있으면 새로 만든다', () => {
    localStorage.setItem(VISITOR_KEY, '');

    const id = getVisitorId();

    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem(VISITOR_KEY)).toBe(id);
  });

  it('저장된 값이 UUID 형식이 아니면 새로 만들어 덮어쓴다', () => {
    // 손상된 값을 그대로 쓰면 F2의 클릭 집계가 그 브라우저에서 영구히 400으로 죽는다.
    localStorage.setItem(VISITOR_KEY, 'not-a-uuid');

    const id = getVisitorId();

    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem(VISITOR_KEY)).toBe(id);
    expect(getVisitorId()).toBe(id);
  });
});
