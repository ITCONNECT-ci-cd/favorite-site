import type { ReactNode } from 'react';

type CardGridProps = {
  children: ReactNode;
  /**
   * 카드보다 **앞**에 놓이는 격자 한 칸 — 지금 여기 오는 것은 관리자의 '+ 링크 추가' 타일
   * (K1 `components/card/QuickAddCard.tsx`) 하나다.
   *
   * children 의 맨 앞에 끼워 넣는 것과 결과는 같지만, 자리를 이름으로 두면 "타일은 언제나
   * 첫 칸"이라는 규칙이 그리드 한곳에 남는다 — 렌더 지점이 여럿이라(홈의 섹션 · 분류 화면)
   * 호출부마다 순서를 다시 적으면 한 곳만 뒤로 밀려도 아무도 모른다.
   *
   * 주지 않으면 **아무 자리도 만들지 않는다.** 비관리자 응답에는 타일 마크업이 한 조각도
   * 실리지 않아야 하므로(README 주의사항 7), 빈 칸을 그려 두고 감추는 방식을 쓰지 마라.
   */
  lead?: ReactNode;
  /** 바깥 여백 등 배치용 클래스. 그리드 자체 값을 덮어쓰는 용도가 아니다. */
  className?: string;
};

/**
 * 링크 카드를 까는 그리드. 홈·카테고리 목록·즐겨찾기가 모두 이 그리드를 쓴다.
 *
 * ≥820px에서는 열 수를 고정하지 않고 `auto-fill`로 폭에 맞춰 채운다 (DESIGN_SPEC 1장
 * 브레이크포인트 표). 최소 폭 158px는 카드 상단 액션 아이콘 4개가 파비콘과 한 줄에 들어가는
 * 하한선이다.
 *
 * <820px에서는 **2열 고정 · gap 8px**이다 (프로토타입 `tileCols`·`tileGap`의 narrow 값).
 * 좁은 화면에서 auto-fill을 그대로 두면 375px에서 2열이 되긴 하지만 폭에 따라 1열로도
 * 떨어지므로, 프로토타입처럼 열 수를 못박는다. `grid-cols-2`가 곧 `repeat(2,minmax(0,1fr))`다.
 */
export function CardGrid({ children, lead, className }: CardGridProps) {
  return (
    <div
      className={`grid grid-cols-2 gap-[8px] min-[820px]:grid-cols-[repeat(auto-fill,minmax(158px,1fr))] min-[820px]:gap-[10px]${
        className ? ` ${className}` : ''
      }`}
    >
      {lead}
      {children}
    </div>
  );
}
