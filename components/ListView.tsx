'use client';

import { useCallback, useState } from 'react';
import { CardGrid } from '@/components/CardGrid';
import { EmptyBox } from '@/components/EmptyBox';
import { LinkCard } from '@/components/LinkCard';
import { toast } from '@/components/Toast';
import { openToastText, recordClick } from '@/lib/clicks';
import { favToastText, useFavorites } from '@/lib/favorites';
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
 * 그 귀결로, 칩으로 탭을 옮긴 뒤 지금 활성인 사이드바 하위 링크를 다시 눌러도 URL 이 그대로라
 * 칩은 되돌아오지 않는다(같은 주소로의 이동에는 아무 일도 일어나지 않는다).
 *
 * **선택 상태를 지키는 장치가 셋이고 역할이 다르다. 하나를 지우면 나머지가 대신해 주지 않는다.**
 * 1. 호출부의 `key={분류 id}` (app/category/[id]/page.tsx) — **분류 간 왕복**을 막는다.
 *    A 에서 하위를 고르고 B 에 들렀다 A 로 돌아오면 그 선택은 버려야 한다. 되돌아온 A 에는
 *    그 하위 탭이 그대로 있어 아래 3번으로는 걸러지지 않으므로, 리마운트만이 이 경우를 잡는다.
 * 2. 아래 `seenInitial` 조정 — **같은 분류 안에서 상위↔하위 이동**. 라우트도 화면 정체성도
 *    그대로라 리마운트가 없고, 서버가 준 `initialSubId` 변화만이 신호다.
 * 3. `activeId` 의 fallback — 소비자가 `key` 없이 이 컴포넌트를 재사용해 탭 목록만 갈아 끼우는
 *    경우의 방어선이다. 지금의 앱 경로에서는 1·2 가 먼저 잡아 도달하지 않는다.
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
  const { favs, toggle } = useFavorites();

  /**
   * 핀 토글 — 담고/빼고 토스트로 알린다(DESIGN_SPEC 7장). 방향은 `toggle` 이 돌려준다.
   * 카테고리·매일·즐겨찾기 화면이 모두 이 배선을 쓴다. `/favorites` 에서는 뺀 카드가 곧바로
   * 목록에서 사라진다 — 그 화면이 넘기는 `bookmarks` 자체가 담긴 것만 골라낸 배열이기
   * 때문이다(FavoritesView).
   */
  const handleToggleFav = useCallback(
    (id: string) => {
      // 카드가 돌려준 id 라 이 배열에 반드시 있다. 없더라도 토글은 하고 토스트만 건너뛴다.
      const bookmark = bookmarks.find((item) => item.id === id);
      const faved = toggle(id);

      if (bookmark !== undefined) toast(favToastText(bookmark.title, faved));
    },
    [bookmarks, toggle],
  );

  /**
   * 카드 열기 — 클릭을 기록하고(F2 로 보내는 fire-and-forget) 열었다고 알린다. 홈과 같은 배선이다.
   *
   * 하위 탭으로 좁혀 놓은 화면에서도 `bookmarks`(화면 전체)에서 찾는다 — 보이는 카드는 언제나 그
   * 부분집합이라 못 찾는 일이 없다. 가운데 클릭도 여기로 온다(카드가 양쪽에서 부른다 — C2).
   *
   * ⓘ 토스트 스토어는 슬롯이 하나라(Toast.tsx) 이 문구가 직전의 핀 토스트를 밀어낸다.
   *   프로토타입도 토스트가 하나뿐이라 같은 동작이다.
   */
  const handleOpen = useCallback(
    (id: string) => {
      recordClick(id);

      // 카드가 돌려준 id 라 이 배열에 반드시 있다. 없더라도 기록은 하고 토스트만 건너뛴다.
      const bookmark = bookmarks.find((item) => item.id === id);
      if (bookmark !== undefined) toast(openToastText(bookmark.title));
    },
    [bookmarks],
  );

  const tabs = subTabs ?? [];
  const [selected, setSelected] = useState(initialSubId);

  /**
   * 장치 2 — 같은 분류 안에서 상위↔하위를 오가면 리마운트가 없으므로(위 JSDoc),
   * 서버가 준 선택이 바뀔 때 렌더 중에 맞춘다(렌더 중 상태 조정 패턴 — Sidebar 의 펼침 처리와 같다).
   */
  const [seenInitial, setSeenInitial] = useState(initialSubId);
  if (seenInitial !== initialSubId) {
    setSeenInitial(initialSubId);
    setSelected(initialSubId);
  }

  /**
   * 장치 3 — 고른 하위가 지금 탭 목록에 아예 없으면 전체로 본다.
   * `key` 없이 props 만 갈아 끼우는 소비자를 위한 방어선이지, 분류 간 왕복을 막아 주지는 못한다
   * (돌아온 분류에는 그 하위가 다시 있으므로 이 조건에 걸리지 않는다 — 위 JSDoc 1번 참조).
   */
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
        <div
          role="group"
          aria-label="하위 분류"
          className="mb-[14px] flex flex-wrap gap-[6px]"
        >
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
          2단계 G4 몫이다. 지금은 자리만 비워 둔다.
          G4 에게: 체크한 id 는 탭을 바꿔도 남으므로 그대로 두면 '선택 N개 열기'가 지금 화면에
          보이지도 않는 카드를 연다. 탭 전환 시 선택을 비우거나 `shown` 과 교차시켜라. */}

      {shown.length === 0 ? (
        <EmptyBox>{emptyMessage}</EmptyBox>
      ) : (
        <CardGrid>
          {shown.map((bookmark) => (
            // showPin 은 LinkCard 기본값(true)을 그대로 쓴다 — 목록 화면은 전부 핀이 보인다.
            <LinkCard
              key={bookmark.id}
              bookmark={bookmark}
              isFaved={favs.has(bookmark.id)}
              onToggleFav={handleToggleFav}
              onOpen={handleOpen}
            />
          ))}
        </CardGrid>
      )}
    </main>
  );
}
