import type { ReactNode } from 'react';

type EmptyBoxProps = {
  /** 안내문. 문구는 화면마다 다르므로 소비자가 넘긴다 (DESIGN_SPEC 3·4장). */
  children: ReactNode;
  /** 바깥 여백 등 배치용 클래스. 박스 자체 값을 덮어쓰는 용도가 아니다. */
  className?: string;
};

/**
 * 비어 있는 자리에 두는 점선 안내 박스 (DESIGN_SPEC 3장 "빈 즐겨찾기 안내").
 * 즐겨찾기 0개·분류에 링크 없음 등 빈 상태에서 카드 그리드 대신 들어간다.
 */
export function EmptyBox({ children, className }: EmptyBoxProps) {
  return (
    <div
      className={`rounded-[10px] border border-dashed border-dash bg-side p-[16px] text-[11.5px] leading-[1.6] text-desc${
        className ? ` ${className}` : ''
      }`}
    >
      {children}
    </div>
  );
}
