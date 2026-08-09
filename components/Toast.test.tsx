import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION_MS, Toaster, toast } from '@/components/Toast';
import { useToastTimers } from '@/test/toast';

describe('Toast', () => {
  useToastTimers();

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

  it('전폭 고정 래퍼가 화면 아래쪽 클릭을 가로채지 않는다', () => {
    render(<Toaster />);

    // 래퍼는 inset-x-0으로 가로 전체를 덮는다. pointer-events-none이 빠지면
    // 토스트가 떠 있는 2초 동안 하단 클릭이 통째로 막힌다.
    expect(screen.getByRole('status')).toHaveClass('pointer-events-none', 'inset-x-0');
  });

  it('rise 애니메이션을 컴포넌트가 직접 싣는다 (globals.css는 A2 소유)', () => {
    const { container } = render(<Toaster />);

    const style = container.querySelector('style');

    expect(style?.textContent).toContain('@keyframes toast-rise');
    expect(style?.textContent).toContain('translateY(8px)');

    act(() => {
      toast('새 탭에서 열었습니다');
    });

    // 움직임을 꺼 둔 사용자에게는 규칙 자체가 컴파일되지 않도록 motion-safe 로만 건다(D5).
    expect(screen.getByText('새 탭에서 열었습니다')).toHaveClass(
      'motion-safe:animate-[toast-rise_0.18s_ease-out]',
    );
    // 클래스 이름을 통째로 적지 않고 정규식으로 본다 — 적으면 Tailwind 스캐너가 그 문자열을
    // 후보로 주워 쓰지 않는 유틸이 최종 CSS 에 실린다.
    expect(screen.getByText('새 탭에서 열었습니다').className).not.toMatch(/(?:^|\s)animate-\[/);
  });

  /**
   * D5 실측 판정 — 시드에서 가장 긴 제목("지식을 담다. 지식을 나누다. 학술논문 전문 검…")에
   * 가장 긴 꼬리표(" · 홈 즐겨찾기에 담김")가 붙으면 12.5px 기준 말풍선 폭이 약 444px 다.
   * 375px 화면에서는 좌우로 삐져나가 앞뒤 글자를 읽을 수 없으므로 폭 상한을 둔다.
   * (`fixed` 요소라 가로 스크롤은 생기지 않는다 — 읽을 수 없다는 것이 문제였다.)
   */
  it('말풍선이 화면 밖으로 나가지 않는다 — 좌우 12px 을 남기고 말줄임', () => {
    render(<Toaster />);

    act(() => {
      toast('지식을 담다. 지식을 나누다. 학술논문 전문 검… · 홈 즐겨찾기에 담김');
    });

    expect(screen.getByRole('status').firstElementChild).toHaveClass(
      'max-w-[calc(100vw-24px)]',
      'truncate',
      // 한 줄 유지는 그대로다 — 넘칠 때 줄바꿈이 아니라 말줄임으로 끊는다.
      'whitespace-nowrap',
    );
  });

  it('2초가 지나면 스스로 사라진다', () => {
    // 아래 단언들은 상수 기준이라 상수 자체를 못박아야 "2초"가 잠긴다 (DESIGN_SPEC 7장).
    expect(TOAST_DURATION_MS).toBe(2000);

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
