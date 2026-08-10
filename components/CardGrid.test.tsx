import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardGrid } from '@/components/CardGrid';

describe('CardGrid', () => {
  it('children을 순서대로 배치한다', () => {
    const { container } = render(
      <CardGrid>
        <span>카드 A</span>
        <span>카드 B</span>
      </CardGrid>,
    );

    expect(screen.getByText('카드 A')).toBeInTheDocument();
    expect(screen.getByText('카드 B')).toBeInTheDocument();
    expect(container.firstElementChild?.children).toHaveLength(2);
  });

  it('≥820px 에서는 열 수를 고정하지 않는 auto-fill 그리드다 (DESIGN_SPEC 1장 브레이크포인트 표)', () => {
    const { container } = render(
      <CardGrid>
        <span>카드</span>
      </CardGrid>,
    );

    // 최소 폭 158px는 액션 아이콘 4개가 파비콘과 한 줄에 들어가는 하한선이다.
    expect(container.firstElementChild).toHaveClass(
      'grid',
      'min-[820px]:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]',
      'min-[820px]:gap-[10px]',
    );
  });

  it('<820px 에서는 2열로 고정하고 gap 을 8px 로 줄인다 (프로토타입 tileCols·tileGap)', () => {
    const { container } = render(
      <CardGrid>
        <span>카드</span>
      </CardGrid>,
    );

    // Tailwind 의 grid-cols-2 가 곧 프로토타입의 `repeat(2,minmax(0,1fr))` 다.
    expect(container.firstElementChild).toHaveClass('grid-cols-2', 'gap-[8px]');
  });

  it('lead 를 주면 첫 칸에 놓는다 — 카드보다 앞이다', () => {
    const { container } = render(
      <CardGrid lead={<span>타일</span>}>
        <span>카드 A</span>
        <span>카드 B</span>
      </CardGrid>,
    );

    const cells = [...(container.firstElementChild?.children ?? [])];

    expect(cells.map((cell) => cell.textContent)).toEqual(['타일', '카드 A', '카드 B']);
  });

  it('lead 를 주지 않으면 아무 자리도 만들지 않는다 — 마크업이 종전 그대로다', () => {
    // 비관리자 응답에 타일 마크업이 한 조각도 실리지 않아야 한다(README 주의사항 7).
    const { container } = render(
      <CardGrid>
        <span>카드 A</span>
      </CardGrid>,
    );

    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it('className을 덧붙일 수 있다', () => {
    const { container } = render(
      <CardGrid className="mt-[10px]">
        <span>카드</span>
      </CardGrid>,
    );

    expect(container.firstElementChild).toHaveClass('grid', 'mt-[10px]');
  });
});
