'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { FAVS_KEY } from '@/lib/constants';
import type { BookmarkWithCount } from '@/lib/types';

export type Favorites = {
  /**
   * 즐겨찾기에 담긴 bookmark id 집합. 모든 인스턴스가 공유하는 스냅샷이므로
   * ReadonlySet이다 — 직접 변형하면 서버에서는 요청 간 오염으로 번진다.
   */
  favs: ReadonlySet<string>;
  /** 담겨 있으면 빼고, 없으면 담는다 */
  toggle: (id: string) => void;
  isFaved: (id: string) => boolean;
};

/**
 * 서버 렌더 스냅샷. 서버에는 즐겨찾기가 없으므로 항상 빈 값이며,
 * React는 하이드레이션 첫 렌더에도 이 값을 쓴다 → 하이드레이션 불일치가 생기지 않는다.
 * (useSyncExternalStore 규약상 매번 같은 객체를 돌려줘야 한다.)
 *
 * 모듈 수준 싱글턴이라 변형되면 프로세스 수명 내내 모든 방문자의 SSR 결과가 오염된다.
 * 이것이 favs를 ReadonlySet으로 내보내는 이유다.
 */
const SERVER_SNAPSHOT: ReadonlySet<string> = new Set();

/** localStorage에 쓸 수 없는 환경(프라이빗 모드·용량 초과)의 세션 한정 폴백. */
let memoryFavs: ReadonlySet<string> | null = null;

/**
 * getSnapshot 캐시. 저장된 원본 문자열이 그대로면 같은 Set 객체를 돌려준다
 * (useSyncExternalStore는 매번 새 객체를 받으면 무한 렌더로 판단한다).
 */
let cachedRaw: string | null = null;
let cachedFavs: ReadonlySet<string> = new Set();

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
function safeWrite(favs: ReadonlySet<string>): boolean {
  try {
    window.localStorage.setItem(FAVS_KEY, JSON.stringify([...favs]));
    return true;
  } catch {
    return false;
  }
}

function getSnapshot(): ReadonlySet<string> {
  // 메모리 폴백 중에는 localStorage를 신뢰할 수 없으므로 다른 탭과의 동기화도 멈춘다
  // (저장이 안 되는 환경이라 애초에 다른 탭에 전달될 변경도 없다).
  if (memoryFavs !== null) return memoryFavs;

  const raw = safeRead();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedFavs = parseFavs(raw);
  }
  return cachedFavs;
}

function getServerSnapshot(): ReadonlySet<string> {
  return SERVER_SNAPSHOT;
}

function emit(): void {
  // 구독 해제가 순회 중에 일어나도 안전하도록 복사본을 돈다.
  for (const listener of [...listeners]) listener();
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
 *
 * 사용 규칙: **뷰 레벨에서 한 번만 호출하고 `isFaved`·`toggle`을 props로 내려라.**
 * 카드 컴포넌트 안에서 직접 호출하면 렌더마다 카드 수만큼 동기 localStorage 읽기가 발생한다.
 *
 * 반환된 `favs`는 모든 인스턴스가 공유하는 스냅샷이다. 변형하지 말고 새 Set을 만들어 써라.
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

/**
 * 담긴 링크만 **담은 순서대로** 골라낸다. 홈의 즐겨찾기 섹션과 `/favorites` 가 공유하는 규칙이라
 * 한곳에 둔다 — 두 화면이 같은 목록을 같은 순서로 보여야 한다.
 *
 * 순서는 `favs`(localStorage 저장 순서)를 그대로 따르고 `bookmarks` 의 sort_order 로 다시 세우지
 * 않는다. 지워진 링크의 id 가 localStorage 에 남아 있을 수 있으므로 `bookmarks` 에 있는 것만
 * 남긴다 — 그래서 결과 길이가 `favs.size` 보다 작을 수 있다(SidebarContainer 의 favCount 주석 참고).
 *
 * 순수 함수다 — 인자를 건드리지 않고 북마크 객체도 복사하지 않는다.
 */
export function pickFavorites(
  bookmarks: readonly BookmarkWithCount[],
  favs: ReadonlySet<string>,
): BookmarkWithCount[] {
  const byId = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));

  return [...favs]
    .map((id) => byId.get(id))
    .filter((bookmark): bookmark is BookmarkWithCount => bookmark !== undefined);
}

/**
 * 핀을 눌렀을 때 띄울 토스트 문구. 프로토타입 `toggleFav` 의 원문을 그대로 옮겼다
 * (docs/prototype/링크 대시보드 v2.dc.html 701행):
 *
 * ```js
 * this.say(on ? (b.title + ' · 홈 즐겨찾기에 담김') : (b.title + ' 즐겨찾기 해제'));
 * ```
 *
 * `faved` 는 **토글이 끝난 뒤**의 상태다(담겼으면 true). 배선하는 화면이 둘(HomeView·ListView)이라
 * 문구가 갈라지지 않게 여기서 한 번만 적는다.
 */
export function favToastText(title: string, faved: boolean): string {
  return faved ? `${title} · 홈 즐겨찾기에 담김` : `${title} 즐겨찾기 해제`;
}
