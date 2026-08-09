'use client';

import { CheckIcon, EyeIcon, PinIcon } from '@/components/icons';
import { faviconSrc, hostOf } from '@/lib/favicon';
import type { BookmarkWithCount } from '@/lib/types';

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
  /** 새 탭 열기 직전 호출 — F3이 클릭 기록에 배선한다 */
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
  'hover:border-ink hover:[transform:scale(1.05)]',
  'hover:shadow-[0_10px_26px_rgba(20,21,22,.14)] hover:z-[5]',
].join(' ');

/** 상단 우측 액션 버튼 21×21px, radius 6px (DESIGN_SPEC 2-1 아이콘 표) */
const ACTION =
  'flex size-[21px] shrink-0 items-center justify-center rounded-[6px] cursor-pointer hover:bg-[#efede8]';

/** 파비콘 주소가 CSS url()을 빠져나가지 못하게 막는다. */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, '\\$&')}")`;
}

/**
 * 홈·카테고리·즐겨찾기·매일이 공유하는 단 하나의 링크 카드.
 *
 * 새 탭을 여는 클릭 영역은 **파비콘 타일과 본문 블록뿐**이다(DESIGN_SPEC 2-1).
 * 카드 전체를 클릭 영역으로 만들면 핀·체크를 누를 때마다 탭이 열려 버린다.
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

  function open() {
    onOpen?.(id);
    // noopener면 반환값이 항상 null이라 팝업 차단을 감지할 수 없지만, 카드 단건 열기는
    // 감지가 필요 없고 여러 개를 여는 2단계 G4는 어차피 무조건 안내 토스트(V4)를 띄운다.
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // 체크는 즐겨찾기보다 앞선다 — 선택한 카드를 한눈에 구분하는 쪽이 우선이다.
  const border = checked ? 'border-ink' : isFaved ? 'border-fav-border' : 'border-card-border';

  return (
    <div className={`${CARD} ${border}`}>
      <div className="flex min-h-[32px] items-start gap-[4px]">
        {/* 파비콘이 없으면 이미지 없이 회색(bg-side) 타일만 남긴다 — url("")은 깨진 이미지가 된다. */}
        <button
          type="button"
          aria-label={`${title} 열기`}
          onClick={open}
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
              aria-pressed={checked}
              onClick={() => onToggleCheck?.(id)}
              className={`${ACTION} ${checked ? 'bg-ink text-white' : 'text-check-off'}`}
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

      <button type="button" onClick={open} className="mt-auto w-full cursor-pointer text-left">
        <div className="max-h-[2.6em] overflow-hidden text-[13px] leading-[1.3] font-semibold tracking-[-0.01em] min-[820px]:text-[13.5px]">
          {title}
        </div>
        {description !== null && description !== '' && (
          <div className="mt-[4px] max-h-[2.8em] overflow-hidden text-[12px] leading-[1.4] text-desc">
            {description}
          </div>
        )}
      </button>

      <div className="mt-[5px] flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{hostOf(url)}</span>
        <span className="flex shrink-0 items-center gap-[4px] text-[11px] font-semibold text-faint">
          <EyeIcon />
          {bookmark.click_count}
        </span>
      </div>
    </div>
  );
}
