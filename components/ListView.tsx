'use client';

import { useState } from 'react';
import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { useFavorites } from '@/lib/favorites';
import type { BookmarkWithCount } from '@/lib/types';

/** 칩 하나 = 하위 분류 하나. 개수는 사이드바와 같은 값이어야 하므로 화면(서버)이 계산해 넘긴다. */
export type SubTab = {
  id: string;
  name: string;
  count: number;
};

export type ListViewProps = {
  /** 화면 제목 20px/700 — 하위 id 로 들어와도 **상위 이름**이다. */
  title: string;
  /** 제목 아래 한 줄. 없는 화면(하위 없는 분류)도 있어 선택이다. */
  description?: string;
  /**
   * 화면에 걸린 링크 전부 — 상위 직속 + 모든 하위. 탭 필터는 이 배열 안에서만 일어난다.
   * 정렬은 넘겨준 순서를 그대로 따른다(서버가 sort_order 로 정렬해 준다).
   */
  bookmarks: BookmarkWithCount[];
  /** 하위 분류. 비었거나 없으면 칩 줄 자체를 렌더하지 않는다. */
  subTabs?: SubTab[];
  /** 처음 선택된 하위 id. 상위 id 로 들어왔으면 null(= 전체). */
  initialSubId?: string | null;
  /** 빈 상태 문구 — 분류는 `이 분류에 링크가 없습니다.`, 즐겨찾기는 다른 문구다(DESIGN_SPEC 4장). */
  emptyMessage: string;
};

/** 칩 — 12.5px, 패딩 6px 12px, 라운드 7px (DESIGN_SPEC 1장 "칩 6~7px" · 4장). */
const CHIP = 'cursor-pointer rounded-[7px] border px-[12px] py-[6px] text-[12.5px]';
const CHIP_ON = 'border-ink bg-ink font-semibold text-white';
/** 비선택 칩의 글자색은 스펙 표에 없는 프로토타입 고유값이라 임의 값으로 옮긴다(사이드바와 같은 처리). */
const CHIP_OFF = 'border-border-strong bg-card font-normal text-[#3a3833]';

/**
 * 카테고리 · 내 즐겨찾기 · 매일 사용하는 사이트가 공유하는 목록 화면 (DESIGN_SPEC 4장).
 *
 * 본문은 **홈과 똑같은 카드 그리드**다 — 이 화면만의 행 목록을 따로 만들지 않는다.
 *
 * 하위 탭은 URL 이 아니라 이 컴포넌트의 상태다. 사이드바에서 하위 링크(`/category/<하위id>`)로
 * 들어오면 서버가 `initialSubId` 로 알려 주고, 그 뒤 칩 클릭은 URL 을 건드리지 않는다.
 */
export function ListView({
  title,
  description,
  bookmarks,
  subTabs,
  initialSubId = null,
  emptyMessage,
}: ListViewProps) {
  // 뷰 레벨에서 한 번만 읽고 카드에는 결과만 내려보낸다(카드마다 호출하면 렌더당 localStorage 를
  // 카드 수만큼 읽는다 — lib/favorites.ts 사용 규칙).
  const { favs } = useFavorites();

  const tabs = subTabs ?? [];
  const [selected, setSelected] = useState(initialSubId);

  /**
   * 같은 상위 안에서 하위를 오가면(`/category/<상위>` ↔ `/category/<하위>`) 라우트가 같아
   * 이 컴포넌트가 다시 마운트되지 않는다. 그래서 서버가 준 선택이 바뀌면 렌더 중에 맞춘다
   * (렌더 중 상태 조정 패턴 — Sidebar 의 펼침 처리와 같다).
   */
  const [seenInitial, setSeenInitial] = useState(initialSubId);
  if (seenInitial !== initialSubId) {
    setSeenInitial(initialSubId);
    setSelected(initialSubId);
  }

  /** 고른 하위가 지금 화면의 탭에 없으면(다른 분류로 이동) 전체로 본다. */
  const activeId = tabs.some((tab) => tab.id === selected) ? selected : null;
  const shown =
    activeId === null
      ? bookmarks
      : bookmarks.filter((bookmark) => bookmark.category_id === activeId);

  return (
    <main>
      <div className="mb-[14px]">
        <div className="mb-[3px] flex items-baseline gap-[11px]">
          <h1 className="text-[20px] font-bold tracking-[-0.02em]">{title}</h1>
          {/* 개수는 '지금 보이는 링크 수'다 — 하위 탭을 고르면 함께 줄어든다(프로토타입 listCount). */}
          <span className="text-[12px] text-fainter">{shown.length}개</span>
        </div>
        {description !== undefined && description !== '' && (
          <p className="text-[12.5px] text-desc">{description}</p>
        )}
      </div>

      {tabs.length > 0 && (
        <div className="mb-[14px] flex flex-wrap gap-[6px]">
          {[{ id: null, name: '전체', count: bookmarks.length }, ...tabs].map((tab) => {
            const on = tab.id === activeId;

            return (
              <button
                key={tab.id ?? '전체'}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(tab.id)}
                className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
              >
                {tab.name} <span className="opacity-60">{tab.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 툴바(전체 열기 · 선택 열기 · 선택 해제 · 우측 안내문)와 카드의 체크(showCheck)는
          2단계 G4 몫이다. 지금은 자리만 비워 둔다. */}

      {shown.length === 0 ? (
        <EmptyBox>{emptyMessage}</EmptyBox>
      ) : (
        <CardGrid>
          {shown.map((bookmark) => (
            // showPin 은 LinkCard 기본값(true)을 그대로 쓴다 — 목록 화면은 전부 핀이 보인다.
            // 핀 토글(onToggleFav)·클릭 기록(onOpen)·토스트 배선은 D6·F3 몫이다.
            <LinkCard key={bookmark.id} bookmark={bookmark} isFaved={favs.has(bookmark.id)} />
          ))}
        </CardGrid>
      )}
    </main>
  );
}
