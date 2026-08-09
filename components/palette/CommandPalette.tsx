'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { toast } from '@/components/Toast';
import { openToastText, recordClick } from '@/lib/clicks';
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
 * 팔레트를 열 때·질의를 고칠 때 선택이 돌아오는 자리(프로토타입 838·994행 `sel: 0`).
 * 선택 표시 자체(배경 `#f0eee9` + `↵`)는 DESIGN_SPEC 5장의 UI 스펙이다.
 */
const FIRST_ROW = 0;

/**
 * 패널 안에서 포커스를 받을 수 있는 것들 — 입력 · 결과/고정 링크 행(앵커) · 'AI 검색' 버튼.
 * Tab 가둠(아래 `trapTab`)이 첫·끝을 알아내는 데만 쓴다. 셋 다 `disabled` 가 되는 일이
 * 없어 그 필터는 두지 않았고, jsdom 에는 레이아웃이 없어 가시성 필터도 뜻이 없다.
 */
const FOCUSABLE = 'a[href], button, input, [tabindex]:not([tabindex="-1"])';

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

/** 결과 행 56px (DESIGN_SPEC 5장). 호버 배경이 따로 없는 것은 호버가 선택 자체를 옮기기 때문이다. */
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
  /**
   * 닫기 요청 — 오버레이 클릭 · `esc` · 행을 열었을 때(프로토타입 `open` 이 팔레트를 닫는다).
   *
   * 포커스는 팔레트가 스스로 트리거로 되돌리므로(아래 PalettePanel) 여기서 또 옮길 필요는 없다.
   */
  onClose: () => void;
  /**
   * 전역 `⌘K`·`Ctrl+K` 를 눌렀다는 알림. **열림 상태는 이 컴포넌트가 아니라 상위가 소유한다** —
   * 게이트는 open 을 prop 으로 받는 표시 컴포넌트이고, 리스너만 여기(닫혀도 마운트되는 자리)에 산다.
   * 배선은 G5(헤더·레이아웃) 몫이다.
   */
  onOpenRequest?: () => void;
  /** 서버가 준 한 벌. 분류 이름으로도 찾아야 해서 `categories` 까지 함께 받는다(lib/search). */
  data: SiteData;
  /**
   * 행을 눌러 링크를 여는 순간의 **추가** 알림. 클릭 기록(F3)과 토스트는 팔레트가 이미 스스로 한다.
   *
   * **`useCardHandlers.handleOpen` 을 여기에 넘기면 안 된다** — 기록이 두 번 가고 토스트가 두 번 뜬다.
   * 화면 쪽이 열기에 반응해 따로 할 일(예: 최근 항목 갱신)이 생겼을 때만 쓰는 자리다.
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
  /**
   * AI 의미 검색 실행 — 하단 "AI 검색" 버튼 · `⌘↵` · **결과 0건에서의 `↵`**(프로토타입
   * 646~651행 `if (r) this.open(r); else this.runAi()`)가 모두 이 하나로 들어온다.
   * 지금은 부르기만 하고 실동작은 N3 이 채운다.
   *
   * 세 자리 모두 **질의가 비었는지 보지 않고 부른다** — 프로토타입도 `runAi()` 안에서
   * `if (!q) return;` 로 한 번만 막았다(849~851행). 그 가드는 N3 이 같은 자리에 둔다.
   */
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
 * **키 동작**(DESIGN_SPEC 7장 · 프로토타입 640~653행)은 두 군데로 나뉜다.
 * - 전역 `⌘K`·`Ctrl+K` 는 **이 게이트**가 듣는다 — 닫혀 있는 동안에도 들어야 하기 때문이다.
 *   여는 것은 `onOpenRequest` 를 받은 상위다(열림 상태의 소유자는 G5).
 * - `↑↓`·`↵`·`esc`·`Tab` 은 열린 동안만 뜻이 있으므로 아래 `PalettePanel` 이 듣는다.
 *   패널은 열릴 때만 마운트되므로 "팔레트가 열려 있으면"(프로토타입 642행) 조건이 곧 마운트다.
 *
 * **아직 없는 것과 그 자리**
 * - G5(헤더): 이 컴포넌트를 마운트하고 `open`/`onClose`/`onOpenRequest` 를 헤더의 검색창에 잇는다.
 *   그때 헤더의 `aria-expanded` 도 함께 스레딩한다(components/Header.tsx JSDoc).
 * - N3(AI): `aiSlot` 과 `onAiSearch`.
 */
export function CommandPalette({
  open,
  onClose,
  onOpenRequest,
  data,
  onOpenLink,
  aiSlot,
  onAiSearch,
}: CommandPaletteProps) {
  // 훅은 아래 조기 반환보다 앞이어야 한다 — 닫혀 있을 때도 같은 순서로 불려야 하고,
  // 애초에 이 리스너의 존재 이유가 "닫혀 있는 동안 듣는 것"이다.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // 프로토타입 641행 그대로: 수식키 어느 쪽이든(⌘ = mac, Ctrl = Windows — C4 인계) + k.
      // 대소문자를 내리는 것은 ⇧ 가 섞여 'K' 로 오는 경우 때문이다.
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

      // Chrome·Firefox 의 Ctrl+K(주소창 검색)를 우리가 가져간다.
      event.preventDefault();
      onOpenRequest?.();
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenRequest]);

  // 닫히면 통째로 언마운트한다. 질의를 비우는 일(프로토타입 839행 closePalette)을 따로 하지
  // 않기 위해서다 — 상태가 패널과 함께 사라지므로 다음에 열릴 때 늘 빈 입력에서 시작한다.
  if (!open) return null;

  // 스프레드로 넘기지 않는다 — 소비자가 실수로 얹은 속성이 조용히 패널까지 흘러가는 대신
  // 여기서 타입 오류로 걸리고, N3 이 prop 을 더할 때 이 줄이 반드시 함께 바뀐다.
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

/** 결과 행·고정 링크 행이 공유하는 앵커 계약 — 두 행이 같은 방식으로 열리도록 한곳에서 만든다. */
type RowAnchorProps = Required<Pick<ComponentProps<'a'>, 'href' | 'target' | 'rel' | 'onClick' | 'onAuxClick'>>;

/** 열려 있는 동안의 팔레트. 마운트 = 열림이라 상태 초기화가 곧 열기 동작이다. */
function PalettePanel({
  onClose,
  data,
  onOpenLink,
  aiSlot,
  onAiSearch,
}: Omit<CommandPaletteProps, 'open' | 'onOpenRequest'>) {
  const [query, setQuery] = useState('');
  /** 선택된 결과 행. 프로토타입의 `sel` 이다(838·840·994·998행). */
  const [selected, setSelected] = useState(FIRST_ROW);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** 선택된 **그 한 행**만 이 ref 를 받는다 — `↵`(앵커 클릭)와 스크롤 인투 뷰가 쓴다. */
  const selectedRowRef = useRef<HTMLAnchorElement>(null);

  /**
   * ⌘K 를 누른 사람은 이어서 타자를 친다 — 열리자마자 입력을 잡는다(프로토타입 993행 paletteRef).
   *
   * 닫힐 때는 열기 직전에 포커스가 있던 곳(헤더의 검색 버튼)으로 되돌린다. 팔레트가 통째로
   * 사라지면 포커스가 `<body>` 로 떨어져 키보드 사용자가 문서 처음부터 다시 훑어야 한다.
   * 소비자가 `onClose` 에서 따로 되돌려도 결과는 같아 부딪히지 않는다.
   */
  useEffect(() => {
    const trigger = document.activeElement;

    inputRef.current?.focus();

    return () => {
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);

  /**
   * 열려 있는 동안 문서 스크롤을 잠근다 — 오버레이 위에서 휠을 굴리면 뒤 화면이 따라 움직인다.
   * 원래 값을 기억했다가 그대로 되돌린다(빈 문자열이면 인라인 선언이 지워진다).
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
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

  /** 선택 이동 — 끝에서 반대편으로 돈다(프로토타입 840행 `(s.sel + d + n) % n`). */
  const moveSelection = useCallback(
    (delta: number) => {
      setSelected((current) =>
        results.length === 0 ? current : (current + delta + results.length) % results.length,
      );
    },
    [results.length],
  );

  /**
   * 링크 하나를 연 것으로 처리한다 — 기록(F3)·토스트·소비자 알림. **이동은 앵커(브라우저)가 한다.**
   * `recordClick` 은 응답을 기다리지 않고, isBulk 는 넘기지 않는다(사람이 행 하나를 누른 클릭).
   */
  const reportOpen = useCallback(
    (bookmark: BookmarkWithCount) => {
      recordClick(bookmark.id);
      toast(openToastText(bookmark.title));
      onOpenLink?.(bookmark.id);
    },
    [onOpenLink],
  );

  /**
   * 결과 행·고정 링크 행의 앵커 속성 한 벌 (LinkCard 의 `openLink` 와 같은 모양).
   *
   * `preventDefault` 를 부르지 않는다 — 새 탭은 앵커가 열고 우리는 기록만 얹는다.
   * 왼쪽 클릭은 프로토타입 `open()`(837행)대로 팔레트를 닫지만, **가운데 클릭은 닫지 않는다**:
   * 뒤 탭으로 열어 두고 계속 찾으려는 동작이라 화면을 뺏으면 그 뜻이 사라진다.
   * (프로토타입의 행은 `div` 라 가운데 클릭 자체가 없었다. 집계는 LinkCard 와 맞춘다 — C2.)
   */
  const anchorProps = (bookmark: BookmarkWithCount): RowAnchorProps => ({
    href: bookmark.url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: () => {
      reportOpen(bookmark);
      onClose();
    },
    onAuxClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button === 1) reportOpen(bookmark);
    },
  });

  /**
   * `↵` — 선택 행의 **앵커를 그대로 누른다**. `window.open` 을 따로 부르지 않는 이유가 둘이다:
   * 새 탭·`rel`·기록·토스트가 마우스 클릭과 한 경로로 합쳐지고, 팝업 차단에도 걸리지 않는다
   * (사용자 제스처 안에서 도는 앵커 활성화다).
   *
   * 선택된 행이 없다 = 결과가 0건이다 → AI 검색(프로토타입 649~651행).
   */
  const openSelected = useCallback(() => {
    const row = selectedRowRef.current;

    if (row === null) {
      onAiSearch?.();
      return;
    }

    row.click();
  }, [onAiSearch]);

  /**
   * Tab 가둠 — `aria-modal="true"` 로 "뒤는 없는 셈"이라고 알린 이상 Tab 도 뒤로 새면 안 된다.
   * 경계(첫·끝)에서만 반대편으로 돌리고 가운데에서는 브라우저의 순서를 그대로 둔다.
   * 포커스가 이미 패널 밖이면(오버레이 클릭 등) 다음 Tab 에 데려온다.
   */
  const trapTab = useCallback((event: KeyboardEvent) => {
    const panel = panelRef.current;
    if (panel === null) return;

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const edge = event.shiftKey ? first : last;

    if (active !== edge && panel.contains(active)) return;

    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }, []);

  /**
   * 팔레트가 열려 있는 동안의 키 (프로토타입 643~652행). 패널이 마운트돼 있을 때만 산다.
   *
   * `window` 에 거는 것은 프로토타입(653행)과 같고, 포커스가 입력에 있든 행에 있든 같은 규칙이
   * 되기 때문이다. 전역 `⌘K` 는 여기가 아니라 게이트가 듣는다(닫혀 있을 때도 들어야 한다).
   */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // 한글을 조합하는 중의 ↵·↑↓ 는 IME 의 것이다 — 조합을 끝내는 ↵ 로 링크가 열리면 안 된다.
      // (프로토타입에는 없는 가드다. 한글 질의가 기본인 이 제품에서는 없으면 오작동한다.)
      if (event.isComposing) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        trapTab(event);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        // 입력 안의 캐럿이 함께 뛰지 않도록 막는다.
        event.preventDefault();
        moveSelection(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.key !== 'Enter') return;

      // 앵커·버튼에 포커스가 있으면 그 요소를 누르는 것이 ↵ 의 뜻이다. 가로채면 'AI 검색'
      // 버튼이 눌리지 않고, 탭으로 짚어 둔 행 대신 선택된 행이 열려 탭이 두 개 열린다.
      if (event.target instanceof Element && event.target.closest('a, button') !== null) return;

      event.preventDefault();

      if (event.metaKey || event.ctrlKey) {
        onAiSearch?.();
        return;
      }

      openSelected();
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moveSelection, onAiSearch, onClose, openSelected, trapTab]);

  /**
   * 선택 행을 목록 안으로 끌어온다 — 결과는 50건까지라 ↓ 를 몇 번만 눌러도 화면 밖으로 나간다.
   * `block: 'nearest'` 라 이미 보이는 행에는 아무 일도 일어나지 않는다.
   * 옵셔널 호출인 것은 jsdom 등 이 메서드가 없는 환경에서 이동 자체가 죽지 않게 하기 위해서다.
   */
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, results]);

  return (
    <>
      {/* 오버레이 — 누르면 닫힌다(프로토타입 176행). 키보드로 같은 일을 하는 것은 `esc` 라
          여기에 역할·탭 순서를 주지 않고 접근성 트리에서 감춘다. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[40] bg-[rgba(20,21,22,.36)]"
      />

      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="검색" className={PANEL}>
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
            onChange={(event) => {
              setQuery(event.target.value);
              // 결과가 통째로 바뀌므로 선택도 첫 행으로 돌아온다(프로토타입 994행 `sel: 0`).
              setSelected(FIRST_ROW);
            }}
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
              selected={index === selected}
              // 선택된 행만 ref 를 받는다. 선택이 옮겨가는 커밋에서 React 가 옛 행에서 떼고
              // 새 행에 붙이므로, 그 뒤에 도는 위 effect 는 늘 새 행을 본다.
              rowRef={index === selected ? selectedRowRef : undefined}
              onHover={() => setSelected(index)}
              anchor={anchorProps(match.bookmark)}
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
                <PinnedRow key={bookmark.id} bookmark={bookmark} anchor={anchorProps(bookmark)} />
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
  rowRef,
  onHover,
  anchor,
}: {
  match: SearchMatch;
  categoryName: string;
  selected: boolean;
  rowRef?: RefObject<HTMLAnchorElement | null>;
  onHover: () => void;
  anchor: RowAnchorProps;
}) {
  const { bookmark, matchedIn } = match;
  const { title, url, description, click_count: clicks } = bookmark;

  return (
    <a
      {...anchor}
      ref={rowRef}
      // 마우스를 올리면 선택이 그 행으로 옮겨간다(프로토타입 998행 `hover`). 키보드로 짚어 둔
      // 자리와 마우스가 가리키는 자리가 갈라지지 않게 하는 장치다 — ↵ 는 늘 눈이 보는 행을 연다.
      //
      // 알려진 맞물림: 포인터를 목록 위에 세워 둔 채 ↑↓ 로 스크롤하면, 커서 아래 행이 바뀌면서
      // 브라우저가 mouseenter 를 쏘아 선택이 그리로 끌려간다. 프로토타입도 같고, 막으려면
      // "마지막 입력이 키보드였는지"를 따로 들고 mousemove 까지 봐야 해 지금은 그대로 둔다.
      onMouseEnter={onHover}
      // 선택은 배경색으로만 보인다. 색을 못 보는 사람에게도 "지금 이 행"이 읽히도록 이름을 빌린다.
      // (행은 링크 목록이지 listbox 가 아니라 `aria-selected` 가 아니라 `aria-current` 다.)
      aria-current={selected ? 'true' : undefined}
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

/**
 * 빈 입력에서 보여 주는 "고정해 둔 링크" 행 44px.
 * 여는 계약은 결과 행과 같다 — 프로토타입도 `recent` 에 같은 `open` 을 걸었다(914·1003행).
 * 선택(↑↓·↵)은 결과 행에만 있다: 질의가 있어야 결과가 있고, 이 줄은 질의가 없을 때만 보인다.
 */
function PinnedRow({ bookmark, anchor }: { bookmark: BookmarkWithCount; anchor: RowAnchorProps }) {
  const { title, url, description } = bookmark;

  return (
    <a {...anchor} className={PINNED_ROW}>
      <FaviconTile bookmark={bookmark} size={22} />
      <span className="w-[200px] flex-none truncate text-[13.5px] font-semibold">{title}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-desc">{description ?? ''}</span>
      <span className="flex-none text-[10.5px] text-fainter">{hostOf(url)}</span>
    </a>
  );
}
