import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyBox } from '@/components/EmptyBox';

describe('EmptyBox', () => {
  it('children을 안내문으로 보여준다', () => {
    render(<EmptyBox>이 분류에 링크가 없습니다.</EmptyBox>);

    expect(screen.getByText('이 분류에 링크가 없습니다.')).toBeInTheDocument();
  });

  it('점선 테두리 안내 박스 형태다 (DESIGN_SPEC 3장)', () => {
    const { container } = render(<EmptyBox>안내</EmptyBox>);

    expect(container.firstElementChild).toHaveClass(
      'border',
      'border-dashed',
      'border-dash',
      'bg-side',
      'rounded-[10px]',
      'p-[16px]',
      'text-[11.5px]',
      'text-desc',
      // 스펙 표에는 없고 프로토타입 마크업에만 있는 값이라 조용히 유실되기 쉽다.
      'leading-[1.6]',
    );
  });

  it('바깥 여백용 className을 덧붙일 수 있다', () => {
    const { container } = render(<EmptyBox className="mt-[16px]">안내</EmptyBox>);

    expect(container.firstElementChild).toHaveClass('border-dashed', 'mt-[16px]');
  });
});
