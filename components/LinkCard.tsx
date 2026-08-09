'use client';

import type { MouseEvent } from 'react';
import { CheckIcon, EyeIcon, PinIcon } from '@/components/icons';
import { faviconSrc } from '@/lib/favicon';
import type { BookmarkWithCount } from '@/lib/types';
import { hostOf } from '@/lib/url';

export type LinkCardProps = {
  bookmark: BookmarkWithCount;
  /** 핀 노출 — 홈의 '매일'·'운영 중' 섹션만 false */
  showPin?: boolean;
  /** 체크 노출 — 목록 화면(카테고리·매일·즐겨찾기)만 true */
  showCheck?: boolean;
  checked?: boolean;
  onToggleCheck?: (id: string) => void;
  isFaved?: boolean;
  onToggleFav?: (id: string) => void;
  /**
   * 서버가 관리자 세션을 확인했을 때만 true.
   * 연필·휴지통의 실제 렌더는 3단계(J1 인라인 편집 · J2 삭제 확인) 몫이라 지금은 받아만 둔다.
   */
  isAdmin?: boolean;
  /** 링크를 여는 순간 호출 — F3이 클릭 기록에 배선한다 */
  onOpen?: (id: string) => void;
};

/**
 * DESIGN_SPEC 2-1 컨테이너.
 * transition은 속성마다 easing이 달라 Tailwind의 transition-* 유틸로는 표현되지 않으므로
 * 스펙 문자열을 임의 속성으로 그대로 옮겼다.
 */
const CARD = [
  'relative overflow-hidden flex flex-col gap-[6px] bg-card border rounded-[10px]',
  'p-[10px] min-[820px]:p-[12px] min-h-[104px] min-[820px]:min-h-[126px]',
  'shadow-[0_1px_2px_rgba(20,21,22,.04)]',
  '[transition:transform_.22s_cubic-bezier(.22,.9,.28,1),box-shadow_.22s_ease,border-color_.22s_ease]',
  // 확대만 motion-safe 로 감싼다 (D5, prefers-reduced-motion 가드). 같은 규칙을 reduce 쪽에서
  // 되돌리지 않고 아예 걸지 않는 이유는 우선순위 다툼을 만들지 않기 위해서다 — 두 규칙의
  // 특정도가 같아 CSS 출력 순서에 결과가 좌우된다. 색·그림자 전환은 움직임이 아니라 남긴다.
  'hover:border-ink motion-safe:hover:[transform:scale(1.05)]',
  'hover:shadow-[0_10px_26px_rgba(20,21,22,.14)] hover:z-[5]',
].join(' ');

/**
 * 상단 우측 액션 버튼 21×21px, radius 6px (DESIGN_SPEC 2-1 아이콘 표).
 *
 * 보이는 크기는 스펙대로 두고 **손가락이 닿는 자리만** `::before`로 넓힌다(C3 사이드바의
 * 펼침 버튼과 같은 방식). 세로는 ±11.5px, 가로는 ±0.5px에서 멈춘다 — 버튼 사이 간격이
 * 1px뿐이라(스펙의 `gap 1px`) 그 이상 넓히면 옆 버튼의 **보이는 영역** 위로 히트 영역이 겹쳐
 * 눌린 버튼이 뒤바뀐다. 나란한 21px 버튼 둘이 22px 간격으로 서 있는 한 44×44를 둘 다 갖는
 * 배치는 존재하지 않으므로, 겹침 없이 얻을 수 있는 최대치(22×44)를 취한다.
 *
 * **실제로 눌리는 크기는 22×42.5px다.** 위로 넓힌 11.5px 중 카드 안쪽은 패딩 10px까지고
 * 나머지 1.5px는 카드의 `overflow-hidden`이 잘라 낸다(잘린 영역은 그리기뿐 아니라 히트
 * 테스트에서도 빠진다). 즉 44px는 선언값이고 실측 상한은 42.5px다.
 *
 * 그래서 이 카드는 WCAG 2.5.5(AAA, 44×44)를 **구조적으로 만족시킬 수 없다** — 스펙이 21×21과
 * gap 1px을 고정한 이상 배치를 바꾸지 않고는 도달할 수 없는 값이다. 2.5.8(AA, 24×24)도
 * 가로 22px이라 2px 모자란다. 프로토타입 충실도를 우선한 결과이며, 넓히려면 스펙의
 * 아이콘 크기나 간격을 먼저 바꿔야 한다(3단계에서 연필·휴지통이 더 붙을 때 재검토 대상).
 */
const ACTION =
  'relative flex size-[21px] shrink-0 items-center justify-center rounded-[6px] cursor-pointer hover:bg-[#efede8] before:absolute before:-inset-y-[11.5px] before:-inset-x-[0.5px]';

/**
 * 파비콘 주소를 CSS url() 안에 안전하게 넣는다.
 * 따옴표가 든 주소를 그대로 이어 붙이면 url() 문자열이 중간에서 닫히고
 * background-image 선언 전체가 무효 처리되어 파비콘이 통째로 사라진다.
 */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, '\\$&')}")`;
}

/**
 * 홈·카테고리·즐겨찾기·매일이 공유하는 단 하나의 링크 카드.
 *
 * 링크를 여는 영역은 **파비콘 타일과 본문 블록뿐**이다(DESIGN_SPEC 2-1).
 * 카드 전체를 클릭 영역으로 만들면 핀·체크를 누를 때마다 탭이 열려 버린다.
 *
 * 두 영역 모두 진짜 앵커라서 가운데 클릭·Ctrl+클릭·우클릭 메뉴·상태바 미리보기가
 * 브라우저 기본 동작 그대로 살아 있다. 우리는 기록만 남기고 이동을 가로채지 않는다.
 *
 * 즐겨찾기·선택 상태와 클릭 기록은 카드 밖(소비자)이 들고 있고, 카드는 콜백만 부른다.
 */
export function LinkCard({
  bookmark,
  showPin = true,
  showCheck = false,
  checked = false,
  onToggleCheck,
  isFaved = false,
  onToggleFav,
  onOpen,
}: LinkCardProps) {
  const { id, title, url, description } = bookmark;
  const icon = faviconSrc(bookmark);

  /** 가운데 클릭(새 탭)도 여는 것이다. 우클릭(button 2)은 메뉴만 여니 세지 않는다. */
  function recordAuxOpen(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 1) onOpen?.(id);
  }

  /**
   * 두 열기 영역이 같은 계약을 쓰도록 한곳에 모은다.
   * preventDefault를 부르지 않는다 — 이동은 브라우저에 맡기고 우리는 기록만 얹는다.
   */
  const openLink = {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: () => onOpen?.(id),
    onAuxClick: recordAuxOpen,
  } as const;

  // 체크를 감춘 화면에서 넘어온 checked는 무시한다 — 보이지 않는 상태로 테두리만 바뀌면 안 된다.
  const isChecked = showCheck && checked;
  // 체크는 즐겨찾기보다 앞선다 — 선택한 카드를 한눈에 구분하는 쪽이 우선이다.
  const border = isChecked ? 'border-ink' : isFaved ? 'border-fav-border' : 'border-card-border';

  return (
    <div className={`${CARD} ${border}`}>
      <div className="flex min-h-[32px] items-start gap-[4px]">
        {/* 파비콘 타일은 본문과 같은 곳으로 가는 마우스 전용 보조 영역이다.
            탭 순서에 290번 중복으로 끼어들지 않도록 접근성 트리에서는 감춘다.
            파비콘이 없으면 이미지 없이 회색(bg-side) 타일만 남는다. */}
        <a
          {...openLink}
          aria-hidden="true"
          tabIndex={-1}
          style={icon === null ? undefined : { backgroundImage: cssUrl(icon) }}
          className={`size-[32px] shrink-0 cursor-pointer rounded-[9px] border border-border bg-center bg-no-repeat bg-[length:19px_19px] ${
            icon === null ? 'bg-side' : 'bg-card'
          }`}
        />

        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-px">
          {showCheck && (
            <button
              type="button"
              aria-label={`${title} 선택`}
              aria-pressed={isChecked}
              onClick={() => onToggleCheck?.(id)}
              className={`${ACTION} ${isChecked ? 'bg-ink text-white' : 'text-check-off'}`}
            >
              <CheckIcon />
            </button>
          )}

          {showPin && (
            <button
              type="button"
              aria-label={`${title} 즐겨찾기`}
              aria-pressed={isFaved}
              onClick={() => onToggleFav?.(id)}
              className={`${ACTION} ${isFaved ? 'bg-select text-ink' : 'text-ghost'}`}
            >
              <PinIcon filled={isFaved} />
            </button>
          )}

          {/* 3단계: 연필(J1) · 휴지통(J2)이 isAdmin일 때 여기에 붙는다 */}
        </span>
      </div>

      {/* ↓ J1(인라인 편집)이 통째로 교체할 범위: 본문 블록 + 하단 줄 ↓ */}
      <a {...openLink} className="mt-auto block w-full cursor-pointer">
        {/* button과 달리 a는 흐름 콘텐츠를 담을 수 있지만, 스펙의 2줄 말줄임
            (max-height + overflow)만 필요하므로 span + block으로 충분하다. */}
        <span className="block max-h-[2.6em] overflow-hidden text-[13px] leading-[1.3] font-semibold tracking-[-0.01em] min-[820px]:text-[13.5px]">
          {title}
        </span>
        {description !== null && description !== '' && (
          <span className="mt-[4px] block max-h-[2.8em] overflow-hidden text-[12px] leading-[1.4] text-desc">
            {description}
          </span>
        )}
      </a>

      <div className="mt-[5px] flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{hostOf(url)}</span>
        <span className="flex shrink-0 items-center gap-[4px] text-[11px] font-semibold text-faint">
          <EyeIcon />
          {bookmark.click_count}
        </span>
      </div>
      {/* ↑ J1 교체 범위 끝 ↑ */}
    </div>
  );
}
