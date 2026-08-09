import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminShell } from '@/components/admin/AdminShell';

/** usePathname 은 라우터 컨텍스트가 없는 단위 테스트에서 쓸 수 없다 (C3 사이드바·D5 칩 줄과 같은 방식). */
const pathname = vi.hoisted(() => ({ current: '/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

/** 셸은 로그아웃 액션을 실행하지 않는다 — form 에 그대로 걸어 두는지만 본다. */
const signOutAction = vi.fn(async () => {});

const CHILD_TEXT = '관리 본문';

function renderShell(children: ReactNode = <p>{CHILD_TEXT}</p>) {
  return render(<AdminShell signOutAction={signOutAction}>{children}</AdminShell>);
}

const bar = () => screen.getByRole('banner');
const tabNav = () => screen.getByRole('navigation', { name: '관리 메뉴' });
const tab = (name: string) => within(tabNav()).getByRole('link', { name });
/** 콘텐츠 영역 = children 의 직속 부모. 셸이 감싸는 자리를 이름 없이 집는 유일한 길이다. */
const contentRegion = () => screen.getByText(CHILD_TEXT).parentElement!;

beforeEach(() => {
  vi.clearAllMocks();
  pathname.current = '/admin';
});

/** DESIGN_SPEC 6장 "상단 탭 (60px)" + 프로토타입 원문 수치. */
describe('AdminShell — 상단 바', () => {
  it('60px 고정 높이 + 흰 배경 + 하단 1px 테두리 + 좌우 28px + gap 12px 이다', () => {
    renderShell();

    const className = bar().className;

    expect(className).toContain('h-[60px]');
    // flex-none 이 빠지면 본문이 길어질 때 상단 바가 눌려 60px 이 깨진다(공개 셸 헤더와 같은 계약).
    expect(className).toContain('flex-none');
    expect(className).toContain('bg-card');
    expect(className).toContain('border-b');
    expect(className).toContain('border-border');
    expect(className).toContain('px-[28px]');
    expect(className).toContain('items-center');
    expect(className).toContain('gap-[12px]');
  });

  it('워드마크 `관리자` 는 15px/700 + 자간 -0.02em 이다', () => {
    renderShell();

    const wordmark = within(bar()).getByText('관리자');

    expect(wordmark.className).toContain('text-[15px]');
    expect(wordmark.className).toContain('font-bold');
    expect(wordmark.className).toContain('tracking-[-0.02em]');
  });

  it('상단 바가 스크롤되지 않는다 — 스크롤은 콘텐츠 영역에서만 일어난다', () => {
    renderShell();

    expect(bar().className).not.toContain('overflow-y-auto');
    expect(contentRegion().className).toContain('overflow-y-auto');
  });
});

describe('AdminShell — 탭 3개', () => {
  it('스펙 순서대로 이름과 주소를 갖는다', () => {
    renderShell();

    const tabs = within(tabNav()).getAllByRole('link');

    expect(tabs.map((link) => link.textContent)).toEqual(['카테고리 · 링크', '통계', '정리 도구']);
    expect(tabs.map((link) => link.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/stats',
      '/admin/cleanup',
    ]);
  });

  it('탭 줄에는 탭만 있다 — 사이트 보기·로그아웃은 탭이 아니다', () => {
    renderShell();

    expect(within(tabNav()).getAllByRole('link')).toHaveLength(3);
    expect(within(tabNav()).queryByText('사이트 보기')).not.toBeInTheDocument();
    expect(within(tabNav()).queryByText('로그아웃')).not.toBeInTheDocument();
  });

  it('탭 공통 치수 — 높이 32px, 좌우 13px, 라운드 7px, 12.5px/600, 1px 테두리', () => {
    renderShell();

    for (const link of within(tabNav()).getAllByRole('link')) {
      expect(link.className).toContain('h-[32px]');
      expect(link.className).toContain('px-[13px]');
      expect(link.className).toContain('rounded-[7px]');
      expect(link.className).toContain('text-[12.5px]');
      expect(link.className).toContain('font-semibold');
      expect(link.className).toContain('border-border-strong');
      // 이름이 두 줄로 접히면 32px 줄이 무너진다.
      expect(link.className).toContain('whitespace-nowrap');
    }
  });

  it('탭 사이 간격 6px, 워드마크와의 간격 8px (프로토타입 원문)', () => {
    renderShell();

    expect(tabNav().className).toContain('gap-[6px]');
    expect(tabNav().className).toContain('ml-[8px]');
  });
});

/**
 * 활성 탭 — 프로토타입 `adminTabs` 의 `bg`/`fg`: 선택 `#141516`/흰 글자, 비선택 흰 배경/`#3a3833`.
 * 테두리는 선택 여부와 무관하게 `#ddd8d1` 고정이다(`bd` 를 넘기지 않는다).
 */
describe('AdminShell — 활성 탭', () => {
  const CASES: Array<[string, string]> = [
    ['/admin', '카테고리 · 링크'],
    ['/admin/stats', '통계'],
    ['/admin/cleanup', '정리 도구'],
  ];

  it.each(CASES)('%s 에서는 `%s` 탭만 선택으로 보인다', (path, activeName) => {
    pathname.current = path;
    renderShell();

    for (const link of within(tabNav()).getAllByRole('link')) {
      const active = link.textContent === activeName;

      expect(link.className).toContain(active ? 'bg-ink' : 'bg-card');
      expect(link.className).toContain(active ? 'text-white' : 'text-[#3a3833]');
      // 선택 여부는 색뿐 아니라 프로그램적으로도 알려야 한다 — 스크린 리더는 배경색을 못 읽는다.
      expect(link.getAttribute('aria-current')).toBe(active ? 'page' : null);
    }
  });

  it.each(CASES)('%s 에서 선택된 탭은 정확히 하나다', (path) => {
    pathname.current = path;
    renderShell();

    const selected = within(tabNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(selected).toHaveLength(1);
  });

  it('하위 경로(/admin/stats/2026)에서도 그 탭이 선택으로 남는다', () => {
    pathname.current = '/admin/stats/2026';
    renderShell();

    expect(tab('통계').getAttribute('aria-current')).toBe('page');
    // `/admin` 은 접두어 일치로 잡으면 모든 관리 주소에서 켜진다 — 정확히 일치할 때만이다.
    expect(tab('카테고리 · 링크').getAttribute('aria-current')).toBeNull();
  });

  it('관리 밖 주소에서는 어느 탭도 선택되지 않는다', () => {
    pathname.current = '/';
    renderShell();

    const selected = within(tabNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(selected).toHaveLength(0);
  });
});

describe('AdminShell — 사이트 보기', () => {
  it('공개 홈으로 가는 링크다 (같은 탭)', () => {
    renderShell();

    const link = within(bar()).getByRole('link', { name: '사이트 보기' });

    expect(link).toHaveAttribute('href', '/');
    expect(link).not.toHaveAttribute('target');
  });

  it('우측으로 밀려나고 밑줄 12px/600 이다 (프로토타입 원문)', () => {
    renderShell();

    const className = within(bar()).getByRole('link', { name: '사이트 보기' }).className;

    expect(className).toContain('ml-auto');
    expect(className).toContain('text-[12px]');
    expect(className).toContain('font-semibold');
    expect(className).toContain('underline');
    expect(className).toContain('underline-offset-[3px]');
  });
});

/**
 * 로그아웃 — H2 의 임시 화면에서 **옮겨 온** form POST 다(재작성이 아니다).
 * GET 링크가 되면 브라우저·프록시가 미리 훑는 것만으로 로그아웃이 일어난다.
 */
describe('AdminShell — 로그아웃', () => {
  it('form 안의 submit 버튼이다 — 링크가 아니다', () => {
    renderShell();

    const button = within(bar()).getByRole('button', { name: '로그아웃' });

    expect(button).toHaveAttribute('type', 'submit');
    expect(button.closest('form')).not.toBeNull();
    expect(screen.queryByRole('link', { name: '로그아웃' })).not.toBeInTheDocument();
  });

  it('받은 서버 액션을 그대로 form 에 건다 — 셸은 스스로 로그아웃하지 않는다', () => {
    renderShell();

    expect(signOutAction).not.toHaveBeenCalled();
  });

  it('12px 보조 글자색이다 (프로토타입 원문)', () => {
    renderShell();

    const className = within(bar()).getByRole('button', { name: '로그아웃' }).className;

    expect(className).toContain('text-[12px]');
    expect(className).toContain('text-desc');
    expect(className).toContain('hover:text-ink');
  });
});

describe('AdminShell — 콘텐츠 영역', () => {
  it('children 을 그대로 그린다', () => {
    renderShell();

    expect(screen.getByText(CHILD_TEXT)).toBeInTheDocument();
  });

  it('혼자 스크롤하고 패딩 18px 28px 32px 을 갖는다 (프로토타입 원문)', () => {
    renderShell();

    const className = contentRegion().className;

    expect(className).toContain('min-h-0');
    expect(className).toContain('flex-1');
    expect(className).toContain('overflow-y-auto');
    expect(className).toContain('pt-[18px]');
    expect(className).toContain('px-[28px]');
    expect(className).toContain('pb-[32px]');
    expect(className).toContain('bg-surface');
  });

  it('본문 패딩을 화면이 아니라 셸이 갖는다 — 화면은 자기 <main> 만 든다', () => {
    const { container } = renderShell(<main>{CHILD_TEXT}</main>);

    // 셸이 <main> 을 만들면 화면의 <main> 과 겹쳐 랜드마크가 둘이 된다.
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});

/**
 * 셸은 세션을 판정하지 않는다 — 그건 `app/admin/layout.tsx` 와 각 page 의 몫이다.
 * 여기서 다시 판정하면 판정 지점이 셋으로 늘어나 서로 어긋날 수 있다.
 */
describe('AdminShell — 판정하지 않는다', () => {
  it('세션 정보를 받지도 그리지도 않는다', () => {
    const { container } = renderShell();

    expect(container.textContent).not.toMatch(/@|user-|token/i);
  });
});
