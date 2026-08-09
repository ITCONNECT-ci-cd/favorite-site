import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION_MS, Toaster, toast } from '@/components/Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // 모듈 레벨 스토어가 다음 테스트로 새지 않도록 자동 소멸 경로로 비운다.
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    vi.useRealTimers();
  });

  it('띄운 토스트가 없으면 라이브 리전만 비어 있다', () => {
    render(<Toaster />);

    const region = screen.getByRole('status');

    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('toast()를 부르면 메시지가 뜬다', () => {
    render(<Toaster />);

    act(() => {
      toast('새 탭에서 열었습니다');
    });

    expect(screen.getByText('새 탭에서 열었습니다')).toBeInTheDocument();
  });

  it('하단 중앙 검은 말풍선이다 (DESIGN_SPEC 7장)', () => {
    render(<Toaster />);

    act(() => {
      toast('새 탭에서 열었습니다');
    });

    expect(screen.getByRole('status')).toHaveClass('fixed', 'bottom-[26px]', 'justify-center');
    expect(screen.getByText('새 탭에서 열었습니다')).toHaveClass(
      'bg-ink',
      'text-white',
      'text-[12.5px]',
      'rounded-[8px]',
      'py-[11px]',
      'px-[16px]',
    );
  });

  it('rise 애니메이션을 컴포넌트가 직접 싣는다 (globals.css는 A2 소유)', () => {
    const { container } = render(<Toaster />);

    const style = container.querySelector('style');

    expect(style?.textContent).toContain('@keyframes toast-rise');
    expect(style?.textContent).toContain('translateY(8px)');

    act(() => {
      toast('새 탭에서 열었습니다');
    });

    expect(screen.getByText('새 탭에서 열었습니다')).toHaveClass(
      'animate-[toast-rise_0.18s_ease-out]',
    );
  });

  it('2초가 지나면 스스로 사라진다', () => {
    render(<Toaster />);

    act(() => {
      toast('새 탭에서 열었습니다');
    });

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText('새 탭에서 열었습니다')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('새 탭에서 열었습니다')).not.toBeInTheDocument();
  });

  it('연속 호출하면 앞선 메시지를 밀어내고 2초를 다시 센다', () => {
    render(<Toaster />);

    act(() => {
      toast('내 즐겨찾기에 담았습니다');
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      toast('내 즐겨찾기에서 뺐습니다');
    });

    expect(screen.queryByText('내 즐겨찾기에 담았습니다')).not.toBeInTheDocument();
    expect(screen.getByText('내 즐겨찾기에서 뺐습니다')).toBeInTheDocument();

    // 앞선 호출의 타이머가 살아 있었다면 2000ms 시점(= 여기서 500ms 뒤)에 사라졌을 것이다.
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByText('내 즐겨찾기에서 뺐습니다')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('내 즐겨찾기에서 뺐습니다')).not.toBeInTheDocument();
  });

  it('연속 호출하면 말풍선을 새로 마운트해 rise를 다시 재생한다', () => {
    render(<Toaster />);

    act(() => {
      toast('내 즐겨찾기에 담았습니다');
    });
    const first = screen.getByText('내 즐겨찾기에 담았습니다');

    act(() => {
      toast('내 즐겨찾기에서 뺐습니다');
    });

    expect(screen.getByText('내 즐겨찾기에서 뺐습니다')).not.toBe(first);
  });

  it('Toaster가 붙기 전에 부른 토스트도 마운트되면 보인다 (모듈 레벨 pub/sub)', () => {
    act(() => {
      toast('새 탭에서 열었습니다');
    });

    render(<Toaster />);

    expect(screen.getByText('새 탭에서 열었습니다')).toBeInTheDocument();
  });

  it('Toaster가 없어도 toast() 호출이 터지지 않는다', () => {
    expect(() => {
      toast('마운트 전 호출');
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    }).not.toThrow();
  });
});
