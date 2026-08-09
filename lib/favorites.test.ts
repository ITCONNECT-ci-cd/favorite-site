/** E1. useFavorites 훅 — localStorage 기반 개인 즐겨찾기(계획서 EPIC E). */
import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAVS_KEY } from '@/lib/constants';
import { type Favorites, useFavorites } from '@/lib/favorites';

/** localStorage에 실제로 저장된 값을 파싱해 돌려준다. */
function storedFavs(): unknown {
  const raw = localStorage.getItem(FAVS_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/** 서버 렌더/하이드레이션 관찰용 최소 컴포넌트 — 담긴 개수를 그대로 뱉는다. */
function Probe() {
  const { favs } = useFavorites();
  return createElement('span', null, String(favs.size));
}

/** 다른 탭이 localStorage를 바꾼 상황 모사 — jsdom은 같은 창의 쓰기로 storage 이벤트를 발생시키지 않는다. */
function dispatchStorage(key: string | null, newValue: string | null): void {
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue, storageArea: localStorage }),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useFavorites', () => {
  it('마운트하면 저장된 즐겨찾기를 복원한다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a', 'b']));

    const { result } = renderHook(() => useFavorites());

    expect(result.current.favs).toEqual(new Set(['a', 'b']));
    expect(result.current.isFaved('a')).toBe(true);
    expect(result.current.isFaved('zzz')).toBe(false);
  });

  it('서버 렌더는 빈 값이고, 하이드레이션 불일치 없이 저장값으로 동기화된다', async () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a', 'b']));

    // 서버 단계: 저장값이 있어도 빈 값으로 렌더돼야 한다.
    expect(renderToString(createElement(Probe))).toBe('<span>0</span>');

    // 위 서버 마크업과 같은 DOM을 만들어 하이드레이션한다.
    const container = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = '0';
    container.appendChild(span);
    document.body.appendChild(container);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = await act(async () => hydrateRoot(container, createElement(Probe)));

    // 하이드레이션 첫 렌더도 빈 값이어야 불일치 경고가 없다.
    expect(consoleError).not.toHaveBeenCalled();
    // 하이드레이션이 끝나면 저장값으로 맞춰진다.
    expect(container.textContent).toBe('2');

    act(() => root.unmount());
    container.remove();
  });

  it('서버 렌더 중에는 localStorage를 읽지 않는다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a']));
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    expect(renderToString(createElement(Probe))).toBe('<span>0</span>');
    expect(getItem).not.toHaveBeenCalled();
  });

  it('window가 없는 서버 렌더에서도 크래시 없이 빈 값으로 렌더된다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a']));
    vi.stubGlobal('window', undefined);

    expect(renderToString(createElement(Probe))).toBe('<span>0</span>');
  });

  it('toggle로 담고, 다시 toggle하면 뺀다', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.favs).toEqual(new Set(['a']));
    expect(result.current.isFaved('a')).toBe(true);
    expect(storedFavs()).toEqual(['a']);

    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.favs).toEqual(new Set());
    expect(result.current.isFaved('a')).toBe(false);
    expect(storedFavs()).toEqual([]);
  });

  it('한 틱에 여러 id를 담아도 모두 반영된다', () => {
    const { result } = renderHook(() => useFavorites());

    act(() => {
      result.current.toggle('a');
      result.current.toggle('b');
    });

    expect(result.current.favs).toEqual(new Set(['a', 'b']));
    expect(storedFavs()).toEqual(['a', 'b']);
  });

  it('저장값에 중복이 있어도 한 번만 유지하고, 중복 없이 다시 저장한다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a', 'a', 'b']));

    const { result } = renderHook(() => useFavorites());
    expect(result.current.favs).toEqual(new Set(['a', 'b']));

    act(() => {
      result.current.toggle('c');
    });
    expect(storedFavs()).toEqual(['a', 'b', 'c']);
  });

  it('다시 마운트해도 저장된 값을 복원한다 (localStorage 왕복)', () => {
    const first = renderHook(() => useFavorites());
    act(() => {
      first.result.current.toggle('a');
    });
    first.unmount();

    const second = renderHook(() => useFavorites());
    expect(second.result.current.favs).toEqual(new Set(['a']));
  });

  it('같은 탭의 다른 인스턴스도 함께 갱신된다', () => {
    const one = renderHook(() => useFavorites());
    const two = renderHook(() => useFavorites());

    act(() => {
      one.result.current.toggle('a');
    });

    expect(two.result.current.favs).toEqual(new Set(['a']));
    expect(two.result.current.isFaved('a')).toBe(true);
  });

  it('다른 탭의 storage 이벤트를 받으면 상태를 갱신한다', () => {
    const { result } = renderHook(() => useFavorites());

    localStorage.setItem(FAVS_KEY, JSON.stringify(['z']));
    dispatchStorage(FAVS_KEY, JSON.stringify(['z']));

    expect(result.current.favs).toEqual(new Set(['z']));
  });

  it('localStorage 전체 삭제(key=null) 이벤트도 반영한다', () => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(['a']));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favs).toEqual(new Set(['a']));

    localStorage.clear();
    dispatchStorage(null, null);

    expect(result.current.favs).toEqual(new Set());
  });

  it('무관한 키의 storage 이벤트는 무시한다', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => {
      result.current.toggle('a');
    });

    // FAVS_KEY 값이 바뀌어 있어도, 다른 키 이벤트로는 다시 읽지 않는다.
    localStorage.setItem(FAVS_KEY, JSON.stringify(['zzz']));
    dispatchStorage('linkdash:other', '1');

    expect(result.current.favs).toEqual(new Set(['a']));
  });

  it('한 인스턴스가 언마운트돼도 남은 인스턴스는 계속 동기화된다', () => {
    const one = renderHook(() => useFavorites());
    const two = renderHook(() => useFavorites());

    one.unmount();

    localStorage.setItem(FAVS_KEY, JSON.stringify(['z']));
    dispatchStorage(FAVS_KEY, JSON.stringify(['z']));

    expect(two.result.current.favs).toEqual(new Set(['z']));
  });

  it('전부 언마운트된 뒤의 storage 이벤트는 아무 데도 반영되지 않는다', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const one = renderHook(() => useFavorites());
    const two = renderHook(() => useFavorites());
    one.unmount();
    two.unmount();

    localStorage.setItem(FAVS_KEY, JSON.stringify(['z']));
    expect(() => dispatchStorage(FAVS_KEY, JSON.stringify(['z']))).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();

    // 스토어가 망가지지 않았으므로 새로 마운트하면 최신 값을 읽는다.
    const three = renderHook(() => useFavorites());
    expect(three.result.current.favs).toEqual(new Set(['z']));
  });

  it('favs는 ReadonlySet이라 소비자가 직접 변형할 수 없다', () => {
    // 실행하지 않는다 — tsc가 잡아야 할 계약이라 타입 검사만이 목적이다.
    // (SSR 스냅샷은 모듈 싱글턴이라 한 번의 add가 요청 간 오염으로 번진다.)
    function probe(favs: Favorites['favs']) {
      // @ts-expect-error ReadonlySet에는 add가 없다.
      favs.add('x');
    }

    expect(typeof probe).toBe('function');
  });

  it('toggle은 렌더가 바뀌어도 같은 참조를 유지한다', () => {
    const { result, rerender } = renderHook(() => useFavorites());
    const before = result.current.toggle;

    act(() => {
      result.current.toggle('a');
    });
    rerender();

    expect(result.current.toggle).toBe(before);
  });

  it('저장값이 손상돼 있어도 크래시 없이 빈 값으로 시작한다', () => {
    localStorage.setItem(FAVS_KEY, 'not json');
    expect(renderHook(() => useFavorites()).result.current.favs).toEqual(new Set());

    localStorage.setItem(FAVS_KEY, JSON.stringify({ a: 1 }));
    expect(renderHook(() => useFavorites()).result.current.favs).toEqual(new Set());

    localStorage.setItem(FAVS_KEY, JSON.stringify(['a', 3, null]));
    expect(renderHook(() => useFavorites()).result.current.favs).toEqual(new Set(['a']));
  });

  it('localStorage 저장이 실패해도(프라이빗 모드 등) 화면 상태는 유지된다', async () => {
    // 메모리 폴백은 모듈 수준 상태라 다른 테스트로 새지 않게 새 모듈 인스턴스에서 검증한다.
    vi.resetModules();
    const { useFavorites: freshUseFavorites } = await import('@/lib/favorites');

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const { result } = renderHook(() => freshUseFavorites());
    act(() => {
      result.current.toggle('a');
    });

    expect(result.current.favs).toEqual(new Set(['a']));
    expect(result.current.isFaved('a')).toBe(true);

    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.favs).toEqual(new Set());
  });
});
