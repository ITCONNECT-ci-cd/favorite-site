'use client';

import type { ReactNode } from 'react';

type SectionHeaderProps = {
  /** 섹션 제목 (13.5px/700) */
  title: string;
  /** 제목 오른쪽 보조문 (11.5px). DESIGN_SPEC 3장 표의 문구를 그대로 넘긴다. */
  note?: string;
  /**
   * 열기 버튼 라벨 — "N개 한 번에 열기". 없으면 버튼을 그리지 않는다
   * (즐겨찾기 0개면 열기 버튼 없이 안내 박스만).
   */
  openLabel?: string;
  /**
   * 열기 버튼 클릭 — 실제로 탭을 여는 일은 홈이 한다(G4, `useCardHandlers.openMany`).
   * 이 컴포넌트는 사용자 제스처를 그대로 전달만 한다: 중간에 비동기가 끼면 그 뒤의
   * `window.open`이 팝업으로 막힌다.
   */
  onOpenAll?: () => void;
  /**
   * 열기 버튼 왼쪽 slot. 홈 "현재 운영 중인 사이트" 섹션의 "전체 보기" 링크가 여기 들어간다.
   * 링크 자체의 모양은 소비자가 정한다.
   */
  aside?: ReactNode;
};

/**
 * 홈 섹션 헤더 (DESIGN_SPEC 3장 "섹션 헤더 (공통 형태)").
 *
 * 제목 + 보조문은 왼쪽에 붙고, aside와 열기 버튼은 오른쪽 끝으로 밀린다.
 * 오른쪽 무리 중 맨 앞 요소가 `ml-auto`를 갖는 방식으로 민다 —
 * aside가 있으면 aside가, 없으면 버튼이 그 역할을 한다.
 */
export function SectionHeader({ title, note, openLabel, onOpenAll, aside }: SectionHeaderProps) {
  return (
    <div className="mb-[10px] flex flex-wrap items-center gap-[9px]">
      <h2 className="text-[13.5px] font-bold">{title}</h2>
      {note ? <span className="text-[11.5px] text-fainter">{note}</span> : null}
      {aside ? <span className="ml-auto">{aside}</span> : null}
      {openLabel ? (
        <button
          type="button"
          onClick={onOpenAll}
          className={`${
            aside ? 'ml-[10px]' : 'ml-auto'
          } flex h-[30px] cursor-pointer items-center rounded-[7px] bg-ink px-[12px] text-[12px] font-semibold whitespace-nowrap text-white hover:bg-ink-hover`}
        >
          {openLabel}
        </button>
      ) : null}
    </div>
  );
}
