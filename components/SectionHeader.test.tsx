import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionHeader } from '@/components/SectionHeader';

describe('SectionHeader', () => {
  it('제목과 보조문을 보여준다 (DESIGN_SPEC 3장)', () => {
    render(
      <SectionHeader
        title="내 즐겨찾기"
        note="핀으로 직접 담은 3개 · 이 브라우저에만 저장됩니다"
      />,
    );

    expect(screen.getByRole('heading', { name: '내 즐겨찾기' })).toHaveClass(
      'text-[13.5px]',
      'font-bold',
    );
    expect(
      screen.getByText('핀으로 직접 담은 3개 · 이 브라우저에만 저장됩니다'),
    ).toHaveClass('text-[11.5px]', 'text-fainter');
  });

  it('보조문이 없으면 보조문 자리를 만들지 않는다', () => {
    const { container } = render(<SectionHeader title="내 즐겨찾기" />);

    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it('openLabel을 주면 "N개 한 번에 열기" 검은 버튼을 그린다', () => {
    render(<SectionHeader title="매일 사용하는 사이트" openLabel="12개 한 번에 열기" />);

    const button = screen.getByRole('button', { name: '12개 한 번에 열기' });

    expect(button).toHaveClass(
      'h-[30px]',
      'rounded-[7px]',
      'bg-ink',
      'text-white',
      'text-[12px]',
      'font-semibold',
    );
    expect(button).toHaveAttribute('type', 'button');
  });

  it('열기 버튼을 누르면 onOpenAll을 부른다 (실제 열기 동작은 G4 몫)', () => {
    const onOpenAll = vi.fn();
    render(
      <SectionHeader
        title="매일 사용하는 사이트"
        openLabel="12개 한 번에 열기"
        onOpenAll={onOpenAll}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '12개 한 번에 열기' }));

    expect(onOpenAll).toHaveBeenCalledTimes(1);
  });

  it('openLabel이 없으면 열기 버튼을 그리지 않는다 (즐겨찾기 0개)', () => {
    render(<SectionHeader title="내 즐겨찾기" note="핀으로 직접 담은 0개" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('aside slot을 열기 버튼 왼쪽에 놓는다 (홈 운영 중 섹션의 "전체 보기")', () => {
    render(
      <SectionHeader
        title="현재 운영 중인 사이트"
        note="회사가 직접 운영하는 서비스 16개"
        openLabel="16개 한 번에 열기"
        aside={<a href="/c/service">전체 보기</a>}
      />,
    );

    const link = screen.getByRole('link', { name: '전체 보기' });
    const button = screen.getByRole('button', { name: '16개 한 번에 열기' });

    expect(
      link.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('aside가 없으면 열기 버튼이, 있으면 aside가 오른쪽으로 밀린다', () => {
    render(<SectionHeader title="매일 사용하는 사이트" openLabel="12개 한 번에 열기" />);

    expect(screen.getByRole('button', { name: '12개 한 번에 열기' })).toHaveClass('ml-auto');

    render(
      <SectionHeader
        title="현재 운영 중인 사이트"
        openLabel="16개 한 번에 열기"
        aside={<a href="/c/service">전체 보기</a>}
      />,
    );

    const pushedButton = screen.getByRole('button', { name: '16개 한 번에 열기' });

    expect(pushedButton).not.toHaveClass('ml-auto');
    expect(screen.getByRole('link', { name: '전체 보기' }).parentElement).toHaveClass('ml-auto');
  });
});
