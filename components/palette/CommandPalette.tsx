'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { faviconSrc } from '@/lib/favicon';
import { MATCH_LABEL, searchLinks, type SearchMatch } from '@/lib/search';
import type { BookmarkWithCount, SiteData } from '@/lib/types';
import { hostOf } from '@/lib/url';

/**
 * 빈 입력에서 보여 주는 "고정해 둔 링크" 개수.
 * 프로토타입 1005행 `recent: daily.slice(0, 6)` — daily 는 `is_pinned` 인 링크를 순서대로 모은 것이다.
 */
const PINNED_ROW_COUNT = 6;

/**
 * 0건 안내 문구 — 프로토타입 1003·1004행 원문 그대로다.
 * 프로토타입에는 AI 검색까지 끝난 뒤의 변형(`"…"과 맞는 링크가 없습니다` / `이름 검색 0건 · AI 의미 검색 0건`)이
 * 하나 더 있지만, 그 분기는 AI 상태를 아는 N3 의 몫이라 여기서는 idle 문구만 둔다.
 */
const EMPTY_TITLE = '이름이 일치하는 링크가 없습니다';
const EMPTY_SUB = '문장으로 물어봤다면 아래 AI 검색(⌘↵)을 눌러보세요';

/**
 * 선택된 결과 행. 지금은 늘 첫 행이다 — 이동(↑↓·호버)은 G3 이 이 상수를 `useState` 로 바꾸면서 붙인다.
 * 선택 표시 자체(배경 `#f0eee9` + `↵`)는 DESIGN_SPEC 5장의 UI 스펙이라 지금 그린다.
 */
const SELECTED_INDEX = 0;

/*
 * 이 파일이 임의 값(arbitrary value)으로 적는 색과 그 이유.
 *
 * 기준은 하나다 — **DESIGN_SPEC 1장 색상표가 그 값을 그 용도로 인정하는가**.
 * `#d8d3cb`(패널 테두리)는 표의 "진한 테두리" 행에 있으므로 `border-dash` 토큰을 쓰고,
 * 아래 넷은 표에 그 쓰임이 없거나(`#e7e3dc` 는 "선택 항목 배경 호버"일 뿐 테두리가 아니다)
 * 아예 토큰이 없어서(`#5a5651` · `#f0eee9` · `#f5f3ef`) 값을 직접 쓴다. globals.css 가
 * `#eeece8`·오버레이 `rgba(20,21,22,.36)` 를 토큰화하지 않은 것과 같은 판단이다.
 *
 * - `#e7e3dc` 입력 줄 하단선 · 파비콘 타일 테두리 · 분류 칩 테두리
 * - `#5a5651` 원형 아이콘 선 · 분류 칩 글자
 * - `#f0eee9` 선택된 결과 행 배경
 * - `#f5f3ef` 고정 링크 행 호버 배경
 * - `#eeece8` 하단 바 상단선
 */

/** 패널 — 상단 64px · 폭 800px(모바일 `calc(100% - 24px)`) · 최대 높이 `calc(100% - 128px)`. */
const PANEL = [
  'fixed left-1/2 top-[64px] z-[41] -translate-x-1/2',
  'w-[calc(100%-24px)] min-[820px]:w-[800px] max-h-[calc(100%-128px)]',
  'flex flex-col overflow-hidden rounded-[12px] border border-dash bg-card',
  'shadow-[0_22px_60px_rgba(20,21,22,.28)]',
].join(' ');

/** 결과 행 56px (DESIGN_SPEC 5장). 호버 배경이 없는 것은 프로토타입대로다 — 호버는 선택을 옮긴다(G3). */
const RESULT_ROW = 'flex h-[56px] items-center gap-[12px] border-b border-line px-[18px] cursor-pointer';

/** 고정 링크 행 44px. */
const PINNED_ROW =
  'flex h-[44px] items-center gap-[12px] rounded-[6px] px-[8px] cursor-pointer hover:bg-[#f5f3ef]';

/** 파비콘 타일 공통 뼈대 — 결과 행(26px)과 고정 링크 행(22px)이 크기만 달리해 함께 쓴다. */
const TILE = 'flex-none border border-[#e7e3dc] bg-center bg-no-repeat';

/**
 * 파비콘 주소를 CSS `url()` 안에 안전하게 넣는다.
 * 따옴표가 든 주소를 그대로 이어 붙이면 `url()` 문자열이 중간에서 닫히고 선언 전체가 무효가 된다.
 * (LinkCard 에 같은 함수가 있다. 둘 다 모듈 안에 갇혀 있어 지금은 복제로 두고,
 *  세 번째 사용처가 생기면 `lib/favicon` 으로 올린다.)
 */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, '\\$&')}")`;
}

/**
 * 분류 칩 문구 — 하위에 속하면 하위 이름, 아니면 상위 이름이다.
 * 우리 스키마의 `category_id` 는 상위·하위 어느 쪽도 가리킬 수 있어 그 이름을 그대로 쓰면
 * 프로토타입 914행 `groupLabel: b.sub || b.group` 과 같은 값이 된다.
 * 분류가 없거나(`null`) 조회에서 짝이 빠진 링크는 빈 문자열 — 칩 자체를 그리지 않는다.
 */
function categoryLabel(categoryId: string | null, names: Map<string, string>): string {
  return categoryId === null ? '' : (names.get(categoryId) ?? '');
}

/** 파비콘 타일 한 칸 — 이미지가 없으면 회색 타일만 남긴다(LinkCard 와 같은 처리). */
function FaviconTile({ bookmark, size }: { bookmark: BookmarkWithCount; size: 26 | 22 }) {
  const icon = faviconSrc(bookmark);
  const box =
    size === 26 ? 'size-[26px] rounded-[7px] bg-[length:16px_16px]' : 'size-[22px] rounded-[6px] bg-[length:14px_14px]';

  return (
    <span
      aria-hidden="true"
      style={icon === null ? undefined : { backgroundImage: cssUrl(icon) }}
      className={`${TILE} ${box} ${icon === null ? 'bg-side' : 'bg-card'}`}
    />
  );
}

export type CommandPaletteProps = {
  /** 열림 여부. 닫혀 있으면 아무것도 그리지 않고, 다시 열릴 때 질의가 비워진다. */
  open: boolean;
  /** 닫기 요청 — 지금은 오버레이 클릭에서만 나온다. `esc` 와 전역 `⌘K` 는 G3 이 붙인다. */
  onClose: () => void;
  /** 서버가 준 한 벌. 분류 이름으로도 찾아야 해서 `categories` 까지 함께 받는다(lib/search). */
  data: SiteData;
  /**
   * 행을 눌러 링크를 여는 순간 호출 — G3 이 클릭 기록(F3)·토스트에 배선한다.
   * 행 자체는 진짜 앵커라서 이 콜백이 없어도 새 탭은 열린다. 이동을 가로채지 않는다.
   */
  onOpenLink?: (id: string) => void;
  /**
   * N3(AI 의미 검색)이 끼울 자리. 결과 목록 아래·하단 바 위, 즉 프로토타입 197~228행의
   * 로딩 점·"AI가 의미로 찾은 링크 N건" 블록이 있던 그 위치다.
   *
   * N3 이 여기에 내용을 넣을 때 함께 손봐야 하는 것 하나: 아래 `showEmpty` 는 지금
   * "질의가 있는데 키워드 결과가 0건"만 본다. 프로토타입 1002행은 AI 가 도는 중이거나
   * AI 결과가 있으면 0건 안내를 감췄으므로, 그 조건을 N3 이 되살려야 한다.
   */
  aiSlot?: ReactNode;
  /** 하단 "AI 검색 ⌘↵" 버튼 — 지금은 렌더만 하고 실동작은 N3 이 채운다. */
  onAiSearch?: () => void;
};

/**
 * ⌘K 검색 팔레트 — DESIGN_SPEC 5장, 프로토타입 175~257행.
 *
 * 결과 행은 카드(C2 LinkCard)가 아니라 팔레트 전용 마크업이다. 스펙 5장이 56px 한 줄짜리
 * 별도 형태를 정의하고 있어, 카드를 재사용하면 그 줄이 만들어지지 않는다.
 *
 * 입력은 이 컴포넌트가 들고 타자마다 `searchLinks`(G1)를 다시 부른다 — 290건 × 5필드
 * 부분 문자열이라 디바운스 없이도 한 프레임 안에 끝난다. 결과 상한(50건)과 "N건" 라벨은
 * 모두 `searchLinks` 가 자른 뒤의 길이를 쓴다.
 *
 * **아직 없는 것과 그 자리**
 * - G3(키보드): 위 `SELECTED_INDEX` 를 상태로 바꾸고, `↑↓` 순환 · 행 호버 시 선택 이동 ·
 *   `↵` 로 선택 행 열기 · `esc`(→ `onClose`) · 전역 `⌘K` 리스너를 붙인다.
 * - G5(헤더): 이 컴포넌트를 마운트하고 `open`/`onClose` 를 헤더의 검색창에 잇는다.
 *   그때 헤더의 `aria-expanded` 도 함께 스레딩한다(components/Header.tsx JSDoc).
 * - N3(AI): `aiSlot` 과 `onAiSearch`.
 *
 * 포커스 가둠(focus trap)은 두지 않았다. 열린 동안 포커스를 받는 요소가 입력·행·AI 버튼뿐이고
 * 그 전부가 패널 안에 있어, 가두는 장치보다 `esc`(G3)로 빠져나가는 길이 먼저다.
 */
export function CommandPalette({
  open,
  onClose,
  data,
  onOpenLink,
  aiSlot,
  onAiSearch,
}: CommandPaletteProps) {
  // 닫히면 통째로 언마운트한다. 질의를 비우는 일(프로토타입 839행 closePalette)을 따로 하지
  // 않기 위해서다 — 상태가 패널과 함께 사라지므로 다음에 열릴 때 늘 빈 입력에서 시작한다.
  if (!open) return null;

  // 스프레드로 넘기지 않는다 — 소비자가 실수로 얹은 속성이 조용히 패널까지 흘러가는 대신
  // 여기서 타입 오류로 걸리고, G3·N3 이 prop 을 더할 때 이 줄이 반드시 함께 바뀐다.
  return (
    <PalettePanel
      onClose={onClose}
      data={data}
      onOpenLink={onOpenLink}
      aiSlot={aiSlot}
      onAiSearch={onAiSearch}
    />
  );
}

/** 열려 있는 동안의 팔레트. 마운트 = 열림이라 상태 초기화가 곧 열기 동작이다. */
function PalettePanel({
  onClose,
  data,
  onOpenLink,
  aiSlot,
  onAiSearch,
}: Omit<CommandPaletteProps, 'open'>) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K 를 누른 사람은 이어서 타자를 친다 — 열리자마자 입력을 잡는다(프로토타입 993행 paletteRef).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => searchLinks(query, data), [query, data]);
  const categoryNames = useMemo(
    () => new Map(data.categories.map((category) => [category.id, category.name])),
    [data.categories],
  );
  const pinned = useMemo(
    () => data.bookmarks.filter((bookmark) => bookmark.is_pinned).slice(0, PINNED_ROW_COUNT),
    [data.bookmarks],
  );

  const trimmed = query.trim();
  const showRecent = trimmed === '' && pinned.length > 0;
  const showEmpty = trimmed !== '' && results.length === 0;

  return (
    <>
      {/* 오버레이 — 누르면 닫힌다(프로토타입 176행). 키보드로 같은 일을 하는 것은 `esc`(G3)라
          여기에 역할·탭 순서를 주지 않고 접근성 트리에서 감춘다. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[40] bg-[rgba(20,21,22,.36)]"
      />

      <div role="dialog" aria-modal="true" aria-label="검색" className={PANEL}>
        {/* 입력 줄 58px */}
        <div
          data-testid="palette-input-row"
          className="flex h-[58px] flex-none items-center gap-[12px] border-b border-[#e7e3dc] px-[18px]"
        >
          <span
            aria-hidden="true"
            className="size-[14px] flex-none rounded-full border-[1.5px] border-[#5a5651]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="무엇을 찾나요"
            aria-label="검색어"
            spellCheck={false}
            autoComplete="off"
            // 전역 :focus-visible 링(globals.css)을 이 입력에서만 끈다. 팔레트는 열리는 즉시
            // 여기에 포커스를 주는 것이 유일한 목적이라 링이 "지금 어디에 있나"를 새로 알려
            // 주지 않는 반면, 스펙 5장·프로토타입 어디에도 없는 테두리를 58px 줄 안에 그린다.
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[16.5px] text-ink focus-visible:outline-none"
          />
          {/* 결과 수는 타자마다 바뀌는데 화면 반대쪽 끝이라 눈이 따라가지 못한다.
              Toast 와 같은 처리로 스크린리더에 조용히 읽어 준다(polite — 타자를 끊지 않는다). */}
          <span
            role="status"
            aria-live="polite"
            data-testid="palette-count"
            className="flex-none text-[11px] text-faint"
          >
            {trimmed === '' ? '' : `${results.length}건`}
          </span>
        </div>

        {/* 결과 목록 — 패널에서 유일하게 스크롤하는 영역 */}
        <div data-testid="palette-scroll" className="min-h-0 flex-1 overflow-y-auto">
          {results.map((match, index) => (
            <ResultRow
              key={match.bookmark.id}
              match={match}
              categoryName={categoryLabel(match.bookmark.category_id, categoryNames)}
              selected={index === SELECTED_INDEX}
              onOpenLink={onOpenLink}
            />
          ))}

          {/* N3 자리 — 로딩 점 · "AI가 의미로 찾은 링크 N건" 블록 */}
          {aiSlot}

          {showEmpty && (
            <div className="px-[24px] pt-[34px] pb-[28px] text-center">
              <div className="mb-[7px] text-[14.5px] font-bold">{EMPTY_TITLE}</div>
              <div className="text-[12.5px] leading-[1.75] text-desc">{EMPTY_SUB}</div>
            </div>
          )}

          {showRecent && (
            <div className="px-[18px] pt-[14px] pb-[18px]">
              <div className="mb-[8px] text-[10.5px] font-bold tracking-[0.06em] text-fainter">
                고정해 둔 링크
              </div>
              {pinned.map((bookmark) => (
                <PinnedRow key={bookmark.id} bookmark={bookmark} onOpenLink={onOpenLink} />
              ))}
            </div>
          )}
        </div>

        {/* 하단 바 48px */}
        <div
          data-testid="palette-footer"
          className="flex h-[48px] flex-none items-center gap-[18px] border-t border-[#eeece8] bg-page px-[18px]"
        >
          <span className="text-[10.5px] text-desc">↑↓ 이동</span>
          <span className="text-[10.5px] text-desc">↵ 열기</span>
          <span className="text-[10.5px] text-desc">esc 닫기</span>

          <button
            type="button"
            onClick={onAiSearch}
            aria-keyshortcuts="Meta+Enter"
            className="ml-auto flex h-[30px] flex-none cursor-pointer items-center gap-[8px] rounded-[6px] bg-ink px-[13px] hover:bg-ink-hover"
          >
            <span className="text-[12.5px] font-semibold text-white">AI 검색</span>
            {/* Header 의 ⌘K 배지와 같은 처리 — U+2318 은 스크린리더가 읽지 않아
                접근 이름만 어지럽히므로 시각 표시 전용으로 감추고 단축키는 aria 로 알린다. */}
            <kbd aria-hidden="true" className="font-sans text-[10px] text-mist">
              ⌘↵
            </kbd>
          </button>
        </div>
      </div>
    </>
  );
}

/** 결과 행 — DESIGN_SPEC 5장 "결과 행 56px". 칸 순서가 곧 스펙의 나열 순서다. */
function ResultRow({
  match,
  categoryName,
  selected,
  onOpenLink,
}: {
  match: SearchMatch;
  categoryName: string;
  selected: boolean;
  onOpenLink?: (id: string) => void;
}) {
  const { bookmark, matchedIn } = match;
  const { id, title, url, description, click_count: clicks } = bookmark;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onOpenLink?.(id)}
      className={`${RESULT_ROW} ${selected ? 'bg-[#f0eee9]' : 'bg-transparent'}`}
    >
      <FaviconTile bookmark={bookmark} size={26} />

      <span className="w-[230px] min-w-0 flex-none">
        <span className="block truncate text-[14px] font-semibold">{title}</span>
        <span className="block truncate text-[10.5px] text-fainter">{hostOf(url)}</span>
      </span>

      <span className="min-w-0 flex-1 truncate text-[12.5px] text-sub">{description ?? ''}</span>

      {/* 분류가 없는 링크에는 칩을 그리지 않는다 — 글자 없는 테두리만 남으면 고장으로 보인다.
          프로토타입에는 분류 없는 링크가 없어 이 분기가 없었다(모든 링크에 group 이 있었다). */}
      {categoryName !== '' && (
        <span className="flex-none rounded-[4px] border border-[#e7e3dc] bg-side px-[8px] py-[2px] text-[10.5px] text-[#5a5651]">
          {categoryName}
        </span>
      )}

      {/* 프로토타입 914행 clickLabel — 카드(2-1장)와 달리 0회는 숫자가 아니라 가운뎃점이다. */}
      <span className="w-[44px] flex-none text-right text-[11px] font-semibold text-faint">
        {clicks > 0 ? `${clicks}회` : '·'}
      </span>

      {/* 매칭 위치는 "왜 이게 걸렸나"를 눈으로 훑게 해 주는 표시다. 행의 접근 이름에 섞이면
          링크마다 "… 3회 설명" 같은 꼬리가 붙어 이름과 주소를 가리므로 트리에서 감춘다.
          같은 정보가 이미 이름·설명·주소·분류 칸에 글자로 다 들어 있다. */}
      <span
        aria-hidden="true"
        className="w-[44px] flex-none text-right text-[10px] text-fainter"
      >
        {MATCH_LABEL[matchedIn]}
      </span>

      <span
        aria-hidden="true"
        className="w-[44px] flex-none text-right text-[10px] font-semibold text-ink"
      >
        {selected ? '↵' : ''}
      </span>
    </a>
  );
}

/** 빈 입력에서 보여 주는 "고정해 둔 링크" 행 44px. */
function PinnedRow({
  bookmark,
  onOpenLink,
}: {
  bookmark: BookmarkWithCount;
  onOpenLink?: (id: string) => void;
}) {
  const { id, title, url, description } = bookmark;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onOpenLink?.(id)}
      className={PINNED_ROW}
    >
      <FaviconTile bookmark={bookmark} size={22} />
      <span className="w-[200px] flex-none truncate text-[13.5px] font-semibold">{title}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-desc">{description ?? ''}</span>
      <span className="flex-none text-[10.5px] text-fainter">{hostOf(url)}</span>
    </a>
  );
}
