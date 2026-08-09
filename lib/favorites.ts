'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { FAVS_KEY } from '@/lib/constants';

export type Favorites = {
  /** 즐겨찾기에 담긴 bookmark id 집합. 읽기 전용으로 다뤄야 한다(직접 변형 금지). */
  favs: Set<string>;
  /** 담겨 있으면 빼고, 없으면 담는다 */
  toggle: (id: string) => void;
  isFaved: (id: string) => boolean;
};

/**
 * 서버 렌더 스냅샷. 서버에는 즐겨찾기가 없으므로 항상 빈 값이며,
 * React는 하이드레이션 첫 렌더에도 이 값을 쓴다 → 하이드레이션 불일치가 생기지 않는다.
 * (useSyncExternalStore 규약상 매번 같은 객체를 돌려줘야 한다.)
 */
const SERVER_SNAPSHOT: Set<string> = new Set();

/** localStorage에 쓸 수 없는 환경(프라이빗 모드·용량 초과)의 세션 한정 폴백. */
let memoryFavs: Set<string> | null = null;

/**
 * getSnapshot 캐시. 저장된 원본 문자열이 그대로면 같은 Set 객체를 돌려준다
 * (useSyncExternalStore는 매번 새 객체를 받으면 무한 렌더로 판단한다).
 */
let cachedRaw: string | null = null;
let cachedFavs: Set<string> = new Set();

const listeners = new Set<() => void>();

function parseFavs(raw: string | null): Set<string> {
  if (raw === null) return new Set();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function safeRead(): string | null {
  try {
    return window.localStorage.getItem(FAVS_KEY);
  } catch {
    return null;
  }
}

/** 저장에 성공하면 true. 실패(프라이빗 모드 등)해도 던지지 않는다. */
function safeWrite(favs: Set<string>): boolean {
  try {
    window.localStorage.setItem(FAVS_KEY, JSON.stringify([...favs]));
    return true;
  } catch {
    return false;
  }
}

function getSnapshot(): Set<string> {
  if (memoryFavs !== null) return memoryFavs;

  const raw = safeRead();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedFavs = parseFavs(raw);
  }
  return cachedFavs;
}

function getServerSnapshot(): Set<string> {
  return SERVER_SNAPSHOT;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function handleStorage(event: StorageEvent): void {
  // key가 null이면 localStorage.clear() — 우리 키도 지워졌으므로 다시 읽는다.
  if (event.key !== null && event.key !== FAVS_KEY) return;
  emit();
}

/** 같은 탭의 다른 인스턴스는 listeners로, 다른 탭은 storage 이벤트로 동기화한다. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (listeners.size === 1) window.addEventListener('storage', handleStorage);

  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage);
  };
}

function commit(next: Set<string>): void {
  // 저장에 실패하면 이번 세션 동안만 메모리로 유지해 화면이라도 반응하게 둔다.
  memoryFavs = safeWrite(next) ? null : next;
  emit();
}

/**
 * 개인 즐겨찾기 훅. 서버에는 저장하지 않고 브라우저 localStorage만 쓴다.
 *
 * SSR 안전: 서버 렌더와 하이드레이션 첫 렌더는 항상 빈 값이고,
 * 하이드레이션이 끝난 뒤 저장된 값으로 동기화된다.
 */
export function useFavorites(): Favorites {
  const favs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback((id: string) => {
    const next = new Set(getSnapshot());
    if (next.has(id)) next.delete(id);
    else next.add(id);

    commit(next);
  }, []);

  const isFaved = useCallback((id: string) => favs.has(id), [favs]);

  return { favs, toggle, isFaved };
}
