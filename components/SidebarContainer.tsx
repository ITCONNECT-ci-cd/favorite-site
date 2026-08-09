'use client';

import { Sidebar, type SidebarProps } from '@/components/Sidebar';
import { useFavorites } from '@/lib/favorites';

/** favCount 를 뺀 나머지 — 전부 셸이 서버에서 읽어 그대로 넘긴다. */
export type SidebarContainerProps = Omit<SidebarProps, 'favCount'>;

/**
 * 사이드바의 클라이언트 경계 — '내 즐겨찾기' 개수만 브라우저에서 채운다.
 *
 * 즐겨찾기는 localStorage 에만 있어(E1) 서버가 알 수 없다. 그래서 셸(app/layout.tsx)이
 * 서버에서 읽은 값은 손대지 않고 흘려보내고, favCount 하나만 여기서 훅으로 만든다.
 * 셸을 클라이언트 컴포넌트로 만들지 않고 이 얇은 래퍼만 두는 이유이기도 하다.
 *
 * SSR·하이드레이션 첫 렌더의 favCount 는 0 이다(useFavorites 의 서버 스냅샷).
 * 하이드레이션이 끝난 뒤 저장된 값으로 채워지므로 불일치 경고가 나지 않는다.
 */
export function SidebarContainer(props: SidebarContainerProps) {
  const { favs } = useFavorites();

  return <Sidebar {...props} favCount={favs.size} />;
}
