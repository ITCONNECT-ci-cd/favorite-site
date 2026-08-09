import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/Header';

/** 검색 트리거는 플레이스홀더 문구로 찾는다 (⌘K 배지까지 접근가능한 이름에 포함되므로 부분 일치). */
const searchTrigger = () =>
  screen.getByRole('button', { name: /이름·설명·태그·주소로 바로 찾기/ });

describe('Header', () => {
  it('검색창은 입력이 아니라 버튼형 트리거다 (팔레트 연결은 G5)', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    const trigger = searchTrigger();

    expect(trigger).toHaveAttribute('type', 'button');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('이름·설명·태그·주소로 바로 찾기')).toBeInTheDocument();
  });

  it('검색 트리거는 스펙 치수를 그대로 쓴다 (최대 620px · 38px · bg-side · border-border-strong · 라운드 7px)', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    expect(searchTrigger()).toHaveClass(
      'max-w-[620px]',
      'h-[38px]',
      'bg-side',
      'border-border-strong',
      'rounded-[7px]',
    );
  });

  it('검색 트리거는 호버에서 테두리·배경이 바뀐다 (프로토타입 값)', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    expect(searchTrigger()).toHaveClass('hover:border-[#b8b2a8]', 'hover:bg-[#efede8]');
  });

  it('검색 트리거 좌측에 12px 원형 아웃라인 아이콘을 그린다 (SVG circle)', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    const circle = searchTrigger().querySelector('svg circle');

    expect(circle).toBeInTheDocument();
    expect(circle?.getAttribute('fill')).toBe('none');
    expect(circle?.closest('svg')).toHaveAttribute('width', '12');
    expect(circle?.closest('svg')).toHaveAttribute('height', '12');
  });

  it('검색 트리거 우측에 ⌘K 배지(10.5px/600)를 둔다', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    const badge = screen.getByText('⌘K');

    expect(badge).toHaveClass('text-[10.5px]', 'font-semibold');
    expect(searchTrigger()).toContainElement(badge);
  });

  it('검색 트리거를 누르면 onSearchClick을 부른다', () => {
    const onSearchClick = vi.fn();
    render(<Header totalCount={290} faviconCount={262} onSearchClick={onSearchClick} />);

    fireEvent.click(searchTrigger());

    expect(onSearchClick).toHaveBeenCalledTimes(1);
  });

  it('"AI 검색" 버튼은 38px 검은 버튼이고 누르면 onAiClick을 부른다', () => {
    const onAiClick = vi.fn();
    render(<Header totalCount={290} faviconCount={262} onAiClick={onAiClick} />);

    const button = screen.getByRole('button', { name: 'AI 검색' });

    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass(
      'h-[38px]',
      'bg-ink',
      'text-white',
      'text-[13px]',
      'font-semibold',
      'rounded-[7px]',
    );
    // 호버는 배경만 #33352f로 바꾼다 — 테두리까지 같이 바꾸면 1px 외곽선이 사라진다.
    expect(button).toHaveClass('border-ink', 'hover:bg-ink-hover');
    expect(button.className).not.toMatch(/hover:border-/);

    fireEvent.click(button);

    expect(onAiClick).toHaveBeenCalledTimes(1);
  });

  it('콜백을 주지 않아도 클릭이 터지지 않는다', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    expect(() => {
      fireEvent.click(searchTrigger());
      fireEvent.click(screen.getByRole('button', { name: 'AI 검색' }));
    }).not.toThrow();
  });

  it('우측 끝에 "N개 · 파비콘 M개 내장"을 11.5px text-fainter로 적는다', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    const counts = screen.getByText('290개 · 파비콘 262개 내장');

    expect(counts).toHaveClass('text-[11.5px]', 'text-fainter', 'ml-auto');
  });

  it('카운트는 넘겨받은 값을 그대로 쓴다 (0건도 같은 형식)', () => {
    render(<Header totalCount={0} faviconCount={0} />);

    expect(screen.getByText('0개 · 파비콘 0개 내장')).toBeInTheDocument();
  });

  it('isAdmin 기본값은 false — 관리자 칩을 그리지 않는다', () => {
    render(<Header totalCount={290} faviconCount={262} />);

    expect(screen.queryByText('관리자 편집 모드')).not.toBeInTheDocument();
  });

  it('isAdmin이면 "관리자 편집 모드" 칩(26px · bg-ink · 11px/600 · 라운드 7px)을 카운트 오른쪽에 둔다', () => {
    render(<Header totalCount={290} faviconCount={262} isAdmin />);

    const chip = screen.getByText('관리자 편집 모드');
    const counts = screen.getByText('290개 · 파비콘 262개 내장');

    expect(chip).toHaveClass(
      'h-[26px]',
      'bg-ink',
      'text-white',
      'text-[11px]',
      'font-semibold',
      'rounded-[7px]',
    );
    expect(
      counts.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('가로 배치 순서는 검색 → AI 검색 → 카운트다', () => {
    const { container } = render(<Header totalCount={290} faviconCount={262} />);
    const root = container.firstElementChild;

    expect(root).toHaveClass('flex', 'items-center', 'gap-[12px]');
    expect(Array.from(root?.children ?? []).map((el) => el.tagName)).toEqual([
      'BUTTON',
      'BUTTON',
      'SPAN',
    ]);
  });

  it('헤더 자리(60px · bg-card · 좌우 28px)는 C1 셸 몫이라 다시 칠하지 않는다', () => {
    const { container } = render(<Header totalCount={290} faviconCount={262} />);
    const rootClass = container.firstElementChild?.className ?? '';

    expect(rootClass).not.toMatch(/(^|\s)(bg-|h-\[60px\]|px-|border-b)/);
  });
});
