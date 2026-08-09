import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminShell } from '@/components/admin/AdminShell';

/** usePathname 은 라우터 컨텍스트가 없는 단위 테스트에서 쓸 수 없다 (C3 사이드바·D5 칩 줄과 같은 방식). */
const pathname = vi.hoisted(() => ({ current: '/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

/** 로그아웃 액션 대역 — 셸이 스스로 부르지 않고 form 에 걸어만 두는지 보려면 실물이 필요 없다. */
const signOutAction = vi.fn(async () => {});

const CHILD_TEXT = '관리 본문';

function renderShell(children: ReactNode = <p>{CHILD_TEXT}</p>) {
  return render(<AdminShell signOutAction={signOutAction}>{children}</AdminShell>);
}

const bar = () => screen.getByRole('banner');
const tabNav = () => screen.getByRole('navigation', { name: '관리 메뉴' });
const tabList = () => within(tabNav()).getByRole('list');
const tab = (name: string) => within(tabNav()).getByRole('link', { name });
const logoutForm = () => within(bar()).getByRole('button', { name: '로그아웃' }).closest('form')!;

/**
 * 콘텐츠 영역 = children 의 직속 부모. 셸이 감싸는 자리를 이름 없이 집는 유일한 길이다.
 *
 * 구조가 한 겹 바뀌면 이 헬퍼는 조용히 **엉뚱한 상자**(children 자신이 감싼 요소 등)를 집고,
 * 그러면 아래 치수 단언들은 전부 그 상자를 재게 된다. 스크롤은 이 영역만 갖는 성질이라
 * 신원 확인에 쓸 수 있다 — 다른 상자를 집었다면 여기서 먼저 멈춘다.
 */
const contentRegion = () => {
  const region = screen.getByText(CHILD_TEXT).parentElement!;
  expect(region).toHaveClass('overflow-y-auto');

  return region;
};

beforeEach(() => {
  vi.clearAllMocks();
  pathname.current = '/admin';
});

/** DESIGN_SPEC 6장 "상단 탭 (60px)" + 프로토타입 원문 수치. */
describe('AdminShell — 상단 바', () => {
  it('60px 고정 높이 + 흰 배경 + 하단 1px 테두리 + 좌우 28px + gap 12px 이다', () => {
    renderShell();

    // 토큰 단위로 본다 — 부분 문자열로 보면 `border-border` 가 `border-border-strong` 에도
    // 맞아 테두리 색이 바뀐 것을 놓친다(이 파일의 클래스 단언 전부가 같은 이유로 toHaveClass 다).
    expect(bar()).toHaveClass(
      'h-[60px]',
      // flex-none 이 빠지면 본문이 길어질 때 상단 바가 눌려 60px 이 깨진다(공개 셸 헤더와 같은 계약).
      'flex-none',
      'bg-card',
      'border-b',
      'border-border',
      'px-[28px]',
      'items-center',
      'gap-[12px]',
    );
    expect(bar()).not.toHaveClass('border-border-strong');
  });

  it('워드마크 `관리자` 는 15px/700 + 자간 -0.02em 이다', () => {
    renderShell();

    expect(within(bar()).getByText('관리자')).toHaveClass(
      'text-[15px]',
      'font-bold',
      'tracking-[-0.02em]',
    );
  });

  it('상단 바가 스크롤되지 않는다 — 스크롤은 콘텐츠 영역에서만 일어난다', () => {
    renderShell();

    expect(bar()).not.toHaveClass('overflow-y-auto');
    // 짝 — 스크롤이 사라진 것이 아니라 콘텐츠 영역으로 내려가 있다(헬퍼가 그 자리를 확인한다).
    expect(contentRegion()).toHaveClass('overflow-y-auto');
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
      expect(link).toHaveClass(
        'h-[32px]',
        'px-[13px]',
        'rounded-[7px]',
        'text-[12.5px]',
        'font-semibold',
        'border-border-strong',
        // 이름이 두 줄로 접히면 32px 줄이 무너진다.
        'whitespace-nowrap',
      );
    }
  });

  it('탭 사이 간격 6px, 워드마크와의 간격 8px (프로토타입 원문)', () => {
    renderShell();

    // 가로 배치와 간격은 목록이 갖고, 워드마크와의 거리는 nav 가 갖는다.
    expect(tabList()).toHaveClass('flex', 'gap-[6px]');
    expect(tabNav()).toHaveClass('ml-[8px]');
  });

  /**
   * 나란한 항목 묶음은 목록으로 낸다 — 사이드바(`Sidebar`)·칩 줄(`MobileChips`)과 같은 관례다.
   * 스크린 리더가 "목록, 항목 3개" 를 먼저 알려 주므로 탭을 하나씩 훑기 전에 개수를 안다.
   */
  it('탭은 목록 항목이다 — 링크만 늘어놓지 않는다', () => {
    renderShell();

    const items = within(tabList()).getAllByRole('listitem');

    expect(items).toHaveLength(3);
    // 항목마다 링크가 하나씩 — 한 항목에 몰아넣으면 "항목 3개" 안내가 거짓이 된다.
    expect(items.map((item) => within(item).queryAllByRole('link').length)).toEqual([1, 1, 1]);
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

      // 양방향으로 본다 — "켜진 것이 있다" 만 보면 두 색이 함께 붙은 탭도 통과한다.
      expect(link).toHaveClass(active ? 'bg-ink' : 'bg-card');
      expect(link).not.toHaveClass(active ? 'bg-card' : 'bg-ink');
      expect(link).toHaveClass(active ? 'text-white' : 'text-[#3a3833]');
      expect(link).not.toHaveClass(active ? 'text-[#3a3833]' : 'text-white');
      // 테두리는 선택과 무관하게 고정이다 — 하위 탭 칩이 선택 시 테두리까지 바꾸는 것과 다르다.
      expect(link).toHaveClass('border-border-strong');
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

  /**
   * 접두어만 보고 켜면 형제 주소까지 끌려온다 — `/admin/stats-export` 는 `/admin/stats` 로
   * 시작하지만 '통계'의 하위 화면이 아니다. isActive 가 경계로 `${href}/` 를 쓰는 이유이고,
   * 그 슬래시를 지우면 이 테스트만 깨진다(하위 경로 테스트는 그대로 통과한다).
   */
  it('형제 접두어 주소(/admin/stats-export)에서는 `통계` 탭이 켜지지 않는다', () => {
    pathname.current = '/admin/stats-export';
    renderShell();

    expect(tab('통계')).not.toHaveAttribute('aria-current');

    const selected = within(tabNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(selected).toHaveLength(0);
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

    // 토큰 단위 — 부분 문자열로 보면 `underline` 이 `underline-offset-[3px]` 에도 맞아
    // 밑줄이 통째로 빠져도 통과한다.
    expect(within(bar()).getByRole('link', { name: '사이트 보기' })).toHaveClass(
      'ml-auto',
      'text-[12px]',
      'font-semibold',
      'underline',
      'underline-offset-[3px]',
    );
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

  it('렌더만으로는 로그아웃하지 않는다 — 셸은 스스로 액션을 부르지 않는다', () => {
    renderShell();

    expect(signOutAction).not.toHaveBeenCalled();
  });

  /**
   * 위 단언의 **짝**이다. "부르지 않는다" 만 잠그면 `action={undefined}` 로 바꿔도 통과한다 —
   * 그러면 로그아웃 버튼은 아무 일도 하지 않는 버튼이 되는데 테스트는 초록으로 남는다.
   * 그래서 실제로 제출해 받은 액션이 그 자리에 걸려 있었는지까지 본다(LoginForm.test 와 같은 방식).
   */
  it('제출하면 받은 서버 액션이 불린다 — form 에 그대로 걸려 있다', async () => {
    renderShell();

    fireEvent.submit(logoutForm());

    await waitFor(() => expect(signOutAction).toHaveBeenCalledTimes(1));
  });

  it('12px 보조 글자색이다 (프로토타입 원문)', () => {
    renderShell();

    expect(within(bar()).getByRole('button', { name: '로그아웃' })).toHaveClass(
      'text-[12px]',
      'text-desc',
      'hover:text-ink',
    );
  });
});

describe('AdminShell — 콘텐츠 영역', () => {
  it('children 을 그대로 그린다', () => {
    renderShell();

    expect(screen.getByText(CHILD_TEXT)).toBeInTheDocument();
  });

  it('혼자 스크롤하고 패딩 18px 28px 32px 을 갖는다 (프로토타입 원문)', () => {
    renderShell();

    expect(contentRegion()).toHaveClass(
      // min-h-0 이 빠지면 flex 자식의 기본 min-height:auto 때문에 영역이 내용만큼 늘어나
      // 스크롤이 바깥(페이지)으로 새고 상단 바가 밀려 올라간다.
      'min-h-0',
      'flex-1',
      'overflow-y-auto',
      'pt-[18px]',
      'px-[28px]',
      'pb-[32px]',
      'bg-surface',
    );
  });

  it('본문 패딩을 화면이 아니라 셸이 갖는다 — 화면은 자기 <main> 만 든다', () => {
    const { container } = renderShell(<main>{CHILD_TEXT}</main>);

    // 셸이 <main> 을 만들면 화면의 <main> 과 겹쳐 랜드마크가 둘이 된다.
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});

/*
 * 셸이 세션을 판정하지 않는다는 사실은 여기서 단언하지 않는다 — 셸은 세션을 **받지도** 않으므로
 * (AdminShellProps 에 그럴 자리가 없다) 렌더 결과에서 세션 흔적을 찾는 단언은 실패할 수가 없다.
 * 타입이 이미 잠근 것을 테스트가 흉내 내면 초록 하나가 더 늘 뿐이다. 의도는 AdminShellProps
 * JSDoc 에 적어 뒀다.
 */
