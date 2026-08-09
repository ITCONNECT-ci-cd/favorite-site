import type { ReactNode } from 'react';

type IconShellProps = {
  /** 아이콘마다 다르다 — DESIGN_SPEC 2-1장 표 */
  strokeWidth: number;
  fill?: 'none' | 'currentColor';
  children: ReactNode;
};

/**
 * DESIGN_SPEC 2-1장의 아이콘 5종. path·stroke-width는 스펙 원문을 그대로 옮긴 값이며
 * 임의로 바꾸지 않는다. 아이콘 라이브러리를 쓰지 않는 것도 스펙의 요구다.
 *
 * 공통 규칙: 12px, `fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round`.
 * 색은 currentColor로 받으므로 감싸는 버튼의 text-* 클래스가 상태를 결정한다.
 * 이름은 언제나 감싸는 버튼이 갖고 아이콘 자체는 보조 기술에서 감춘다.
 */
function Icon({ strokeWidth, fill = 'none', children }: IconShellProps) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** 클릭 수 앞에 붙는다 (stroke-width 2) */
export function EyeIcon() {
  return (
    <Icon strokeWidth={2}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </Icon>
  );
}

/** 개인 즐겨찾기 (stroke-width 1.7). 켜짐은 속을 채운다. */
export function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <Icon strokeWidth={1.7} fill={filled ? 'currentColor' : 'none'}>
      <path d="M9.4 3h5.2l-.8 5.6 3.2 3.1v1.7H6.9v-1.7l3.3-3.1L9.4 3z" />
      <path d="M12 13.4V21" />
    </Icon>
  );
}

/** 인라인 편집 (stroke-width 1.8) — 관리자 전용, 3단계 J1에서 카드에 붙는다. */
export function PencilIcon() {
  return (
    <Icon strokeWidth={1.8}>
      <path d="M4 20.5h4L20 8.5l-4-4L4 16.5v4z" />
      <path d="M14.5 6l4 4" />
    </Icon>
  );
}

/** 삭제 (stroke-width 1.8) — 관리자 전용, 3단계 J2에서 카드에 붙는다. */
export function TrashIcon() {
  return (
    <Icon strokeWidth={1.8}>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V4h6v2.5" />
      <path d="M6.5 6.5l1 13.5h9l1-13.5" />
    </Icon>
  );
}

/** 목록 선택 (stroke-width 2.6) */
export function CheckIcon() {
  return (
    <Icon strokeWidth={2.6}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Icon>
  );
}
