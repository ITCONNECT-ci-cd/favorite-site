import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileChips } from '@/components/MobileChips';
import { Sidebar } from '@/components/Sidebar';
import type { Category } from '@/lib/types';

/** usePathname 은 라우터 컨텍스트가 없는 단위 테스트에서 쓸 수 없으므로 모킹한다 (C3 사이드바와 같은 방식). */
const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

/** 시드(docs/data/links.json)와 같은 구성 — 상위 10개, 하위는 상위 바로 뒤에 온다. */
const CATEGORIES: Category[] = [
  { id: 'ai', name: 'AI 도구 모음', parent_id: null, sort_order: 0 },
  { id: 'ai-chat', name: '대화·검색', parent_id: 'ai', sort_order: 0 },
  { id: 'ai-img', name: '이미지', parent_id: 'ai', sort_order: 1 },
  { id: 'mkt', name: '마케팅', parent_id: null, sort_order: 1 },
  { id: 'web', name: '웹 도구', parent_id: null, sort_order: 2 },
  { id: 'edu', name: '강의 및 출강', parent_id: null, sort_order: 3 },
  { id: 'pf', name: '자사 포트폴리오', parent_id: null, sort_order: 4 },
  { id: 'uiux', name: 'UI/UX 디자인', parent_id: null, sort_order: 5 },
  { id: 'etc', name: '기타', parent_id: null, sort_order: 6 },
  { id: 'ref', name: '참고자료', parent_id: null, sort_order: 7 },
  { id: 'ref-tool', name: '도구·서비스', parent_id: 'ref', sort_order: 0 },
  { id: 'google', name: '구글 서비스', parent_id: null, sort_order: 8 },
  { id: 'op', name: '현재 운영 중인 사이트', parent_id: null, sort_order: 9 },
];

/** 셸이 넘기는 것과 같은 조합 — 카테고리 전체 + 운영 중 분류 id. */
const renderChips = () => render(<MobileChips categories={CATEGORIES} operatingCategoryId="op" />);

const row = () => screen.getByRole('navigation', { name: '바로 가기' });
const chips = () => within(row()).getAllByRole('link');
const chip = (name: string) => within(row()).getByRole('link', { name });

beforeEach(() => {
  pathname.current = '/';
});

describe('MobileChips — 구성 (프로토타입 navChips)', () => {
  it('빠른 접근 셋 + 나머지 상위 카테고리를 순서대로 놓는다', () => {
    renderChips();

    expect(chips().map((link) => link.textContent)).toEqual([
      '홈',
      '내 즐겨찾기',
      '현재 운영 중인 사이트',
      'AI 도구 모음',
      '마케팅',
      '웹 도구',
      '강의 및 출강',
      '자사 포트폴리오',
      'UI/UX 디자인',
      '기타',
      '참고자료',
      '구글 서비스',
    ]);
  });

  it('운영 중인 사이트를 빠른 접근 뒤로 올리고 분류 줄에서는 뺀다 — 사이드바와 같은 순서', () => {
    renderChips();

    // 우리 시드에서는 맨 뒤라, 거르지 않으면 사이드바와 어긋난다. 빠른 접근 둘 바로 뒤가 자리다.
    expect(chips()).toHaveLength(12);
    expect(chips()[2]).toHaveTextContent('현재 운영 중인 사이트');
    expect(chips().filter((c) => c.textContent === '현재 운영 중인 사이트')).toHaveLength(1);
  });

  it('운영 중 분류가 없는 데이터에서도 나머지 칩은 그대로다', () => {
    render(<MobileChips categories={CATEGORIES} operatingCategoryId={null} />);

    expect(chips().map((link) => link.textContent)).toEqual([
      '홈',
      '내 즐겨찾기',
      'AI 도구 모음',
      '마케팅',
      '웹 도구',
      '강의 및 출강',
      '자사 포트폴리오',
      'UI/UX 디자인',
      '기타',
      '참고자료',
      '구글 서비스',
      '현재 운영 중인 사이트',
    ]);
  });

  it('하위 분류는 칩이 되지 않는다', () => {
    renderChips();

    expect(within(row()).queryByRole('link', { name: '대화·검색' })).toBeNull();
    expect(within(row()).queryByRole('link', { name: '도구·서비스' })).toBeNull();
  });

  it('개수를 적지 않는다 — 칩에는 이름만 있다 (C1 리뷰 확정)', () => {
    renderChips();

    for (const link of chips()) {
      expect(link.textContent).not.toMatch(/\d/);
    }
  });

  it('각 칩이 제 화면으로 간다', () => {
    renderChips();

    expect(chip('홈')).toHaveAttribute('href', '/');
    expect(chip('내 즐겨찾기')).toHaveAttribute('href', '/favorites');
    expect(chip('AI 도구 모음')).toHaveAttribute('href', '/category/ai');
    expect(chip('현재 운영 중인 사이트')).toHaveAttribute('href', '/category/op');
  });
});

describe('MobileChips — 선택 상태', () => {
  it('현재 경로의 칩만 검은 배경 + aria-current 다', () => {
    pathname.current = '/category/mkt';
    renderChips();

    const selected = chip('마케팅');
    expect(selected).toHaveAttribute('aria-current', 'page');
    expect(selected).toHaveClass('bg-ink', 'text-white');

    const other = chip('홈');
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).toHaveClass('bg-card');
  });

  it('빠른 접근 칩도 같은 규칙을 따른다', () => {
    pathname.current = '/favorites';
    renderChips();

    expect(chip('내 즐겨찾기')).toHaveAttribute('aria-current', 'page');
    expect(chip('홈')).not.toHaveAttribute('aria-current');
  });
});

describe('MobileChips — 프로토타입 수치', () => {
  it('칩 줄은 <820px 에서만 보이고 가로로 스크롤한다', () => {
    renderChips();

    // 프로토타입 showChips 는 narrow 전용이다 — 데스크톱에서는 사이드바가 같은 일을 한다.
    expect(row()).toHaveClass('min-[820px]:hidden', 'overflow-x-auto');
    // 프로토타입 원문: padding 10px 14px · gap 6px · 하단 1px 테두리 · 페이지 배경.
    expect(row()).toHaveClass('px-[14px]', 'py-[10px]', 'border-b', 'border-border', 'bg-page');
    expect(within(row()).getByRole('list')).toHaveClass('gap-[6px]');
  });

  it('칩 한 개의 수치가 프로토타입 원문 그대로다', () => {
    renderChips();

    // height 30px · radius 8px · padding 0 12px · 12.5px/600 · 테두리 #ddd8d1 고정(선택돼도 같다).
    expect(chip('홈')).toHaveClass(
      'h-[30px]',
      'rounded-[8px]',
      'px-[12px]',
      'text-[12.5px]',
      'font-semibold',
      'whitespace-nowrap',
      'border',
      'border-border-strong',
    );

    pathname.current = '/';
    expect(chip('홈')).toHaveClass('border-border-strong');
  });
});

describe('MobileChips ↔ Sidebar 교차 계약', () => {
  /**
   * 칩 줄은 사이드바의 모바일 형태다. 같은 데이터를 받고도 두 내비게이션이 다른 곳을, 다른
   * 순서로 가리키면 화면 폭에 따라 메뉴가 달라 보인다 — 그 어긋남은 어느 한쪽의 단위 테스트로는
   * 잡히지 않아 여기서 둘을 나란히 세워 본다.
   *
   * 사이드바의 '내 링크'(상단 60px)는 nav 밖이라 세지 않는다. 하위 분류는 지금 경로(`/`)에
   * 걸린 가지가 없어 펼쳐지지 않는다 — 칩 줄에는 하위가 아예 없으므로 그 상태에서 비교한다.
   */
  it('두 내비게이션이 같은 곳을 같은 순서로 가리킨다', () => {
    render(
      <>
        <MobileChips categories={CATEGORIES} operatingCategoryId="op" />
        <Sidebar
          categories={CATEGORIES}
          counts={{}}
          totalCount={290}
          favCount={3}
          operatingCategoryId="op"
        />
      </>,
    );

    const hrefsIn = (name: string) =>
      within(screen.getByRole('navigation', { name }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'));

    // 길이도 함께 못박는다 — 양쪽이 똑같이 비어 버린 경우를 통과시키지 않기 위해서다.
    expect(hrefsIn('바로 가기')).toHaveLength(12);
    expect(hrefsIn('바로 가기')).toEqual(hrefsIn('사이드바'));
  });
});
