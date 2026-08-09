import { FAVS_KEY } from '@/lib/constants';

/**
 * 즐겨찾기(localStorage)를 다루는 테스트용 두 줄 — E1 `useFavorites` 를 거치지 않고
 * 저장소를 직접 본다. 훅이 읽는 것과 화면이 쓴 것이 정말 같은지 확인하려면 중간을 건너뛴
 * 이 시점이 필요하다.
 *
 * D5 에서 여러 파일에 복제돼 있던 같은 함수를 여기로 모았다.
 */

/** 화면을 그리기 전에 담긴 상태를 만들어 둔다. */
export function setFavs(ids: readonly string[]): void {
  localStorage.setItem(FAVS_KEY, JSON.stringify(ids));
}

/** localStorage 에 실제로 저장된 값 — 담긴 순서까지 그대로다. 없으면 null. */
export function storedFavs(): unknown {
  const raw = localStorage.getItem(FAVS_KEY);

  return raw === null ? null : JSON.parse(raw);
}
