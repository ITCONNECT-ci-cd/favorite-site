'use client';

import { useCallback, useState } from 'react';
import { Header, type HeaderProps } from '@/components/Header';
import { AiSearchResults } from '@/components/palette/AiSearchResults';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { useAiSearch } from '@/components/palette/useAiSearch';
import type { SiteData } from '@/lib/types';

/**
 * 헤더가 받던 것 그대로 + 팔레트가 검색할 한 벌.
 *
 * 헤더 props 를 나열하지 않고 `Omit` 으로 잇는다. 그래서 J1 이 `isAdmin` 을 채울 때 셸
 * (`app/(public)/layout.tsx`)에 `isAdmin={isAdmin}` 한 줄만 더하면 됐고, 이 파일은 손대지
 * 않았다. 빼는 셋은 이 호스트가 직접 채우는 값들이다.
 */
export type PaletteHostProps = Omit<HeaderProps, 'onSearchClick' | 'onAiClick' | 'isSearchOpen'> & {
  /** 팔레트가 훑을 데이터 — 셸이 서버에서 읽은 그대로다. */
  data: SiteData;
};

/**
 * 헤더와 ⌘K 팔레트를 잇는 클라이언트 경계 (G5) — **팔레트 열림 상태의 유일한 소유자**다.
 *
 * 셸(app/layout.tsx)은 서버 컴포넌트라 `useState` 를 가질 수 없다. 그렇다고 셸 전체를
 * 클라이언트로 내리면 서버 조회가 통째로 브라우저 쪽 경계로 넘어간다. 그래서 헤더 자리에
 * 상태만 드는 이 얇은 호스트를 둔다 — 셸은 서버 컴포넌트로 남는다.
 *
 * (사이드바에도 같은 이유의 래퍼가 한 겹 있었지만, 즐겨찾기가 서버로 옮겨가며 브라우저만 아는
 *  값이 사라져 없앴다 — 2026-08-11.)
 *
 * 헤더와 팔레트는 **형제**다. 팔레트는 `fixed` 오버레이라 DOM 상의 위치가 화면 위치를 바꾸지
 * 않고(플렉스 레이아웃에도 참여하지 않는다), 대신 둘이 한 부모를 가지면 열림 상태를
 * 컨텍스트 없이 그대로 나눠 쓸 수 있다.
 *
 * **CommandPalette 를 조건부로 렌더하면 안 된다.** 전역 `⌘K` 리스너는 게이트(CommandPalette
 * 자신)가 들고 있고, 그 리스너의 존재 이유가 "닫혀 있는 동안 듣는 것"이다. `{open && …}` 로
 * 감싸는 순간 팔레트는 한 번 닫히면 키보드로 다시 열리지 않는다(G2 계약).
 * 닫힘 상태에서 아무것도 그리지 않는 일은 게이트가 안에서 이미 한다.
 *
 * **`onOpenLink` 는 넘기지 않는다.** 클릭 기록(F3)과 토스트는 팔레트가 스스로 하므로,
 * 여기에 카드 쪽 핸들러(useCardHandlers.handleOpen)를 이어 붙이면 기록이 두 번 가고
 * 토스트가 두 번 뜬다(CommandPalette 의 onOpenLink JSDoc).
 *
 * **AI 의미 검색(N3)**: 상태는 `useAiSearch` 훅이 쥐고, 팔레트에는 슬롯(`aiSlot`)·바쁨 표시
 * (`aiBusy`)·트리거(`onAiSearch`)·입력 변경 신호(`onQueryChange`)로 내려간다. 팔레트 안의 AI 경로
 * (하단 'AI 검색' 버튼 · `⌘↵` · 0건에서의 `↵`)가 모두 `onAiSearch(query)` 로 모여 실제
 * `/api/ai-search` 호출로 이어진다. 결과 행을 열거나(닫힘) 질의를 고치면 지난 AI 결과를 지운다.
 *
 * **헤더**의 AI 버튼은 여전히 팔레트를 열기만 한다 — 계획서 G5 가 "우선 팔레트 열기로 연결"로 확정한
 * 자리다. 질의 없이 AI 를 부를 수는 없으니(빈 질의는 no-op), 헤더 버튼은 AI 검색의 입구이고
 * 실제 실행은 팔레트 안의 세 트리거가 맡는다.
 */
export function PaletteHost({ data, ...header }: PaletteHostProps) {
  const [open, setOpen] = useState(false);
  const { state: aiState, busy: aiBusy, run: runAi, clear: clearAi, reset: resetAi } = useAiSearch();

  // 둘 다 `useCallback` 인 것은 팔레트 때문이다. 게이트의 전역 ⌘K 리스너는 `onOpenRequest` 를,
  // 패널의 키 리스너는 `onClose` 를 의존성으로 잡고 있어, 렌더마다 새 함수가 내려가면
  // window 리스너를 붙였다 떼는 일이 그만큼 반복된다(CommandPalette 의 두 useEffect).
  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);

  // 닫힘은 곧 AI 결과의 초기화다 — 행을 열거나(onClose 로 닫힌다) esc·오버레이 어느 쪽이든,
  // 다음에 열릴 땐 빈 입력에서 시작하므로 지난 AI 결과가 남아 있으면 안 된다(프로토타입 open/closePalette).
  const closePalette = useCallback(() => {
    setOpen(false);
    resetAi();
  }, [resetAi]);

  // idle 이면 슬롯을 아예 그리지 않는다 — 그래야 팔레트의 0건 안내(`aiBusy` 로 감춘다)가 정상 동작한다.
  const aiSlot =
    aiState.status === 'idle' ? undefined : (
      <AiSearchResults state={aiState} data={data} onClose={closePalette} />
    );

  return (
    <>
      <Header
        {...header}
        isSearchOpen={open}
        onSearchClick={openPalette}
        // 헤더 AI 버튼은 팔레트를 열기만 한다(G5). 실제 AI 실행은 팔레트 안 세 트리거(onAiSearch)다.
        onAiClick={openPalette}
      />

      <CommandPalette
        open={open}
        onOpenRequest={openPalette}
        onClose={closePalette}
        data={data}
        aiSlot={aiSlot}
        aiBusy={aiBusy}
        onAiSearch={runAi}
        onQueryChange={clearAi}
      />
    </>
  );
}
