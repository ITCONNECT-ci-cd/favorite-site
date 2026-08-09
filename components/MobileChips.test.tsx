import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileChips } from '@/components/MobileChips';
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

const row = () => screen.getByRole('navigation', { name: '바로 가기' });
const chips = () => within(row()).getAllByRole('link');
const chip = (name: string) => within(row()).getByRole('link', { name });

beforeEach(() => {
  pathname.current = '/';
});

describe('MobileChips — 구성 (프로토타입 navChips)', () => {
  it('홈 · 내 즐겨찾기 · 매일 사용 + 상위 카테고리 10개를 순서대로 놓는다', () => {
    render(<MobileChips categories={CATEGORIES} />);

    expect(chips().map((link) => link.textContent)).toEqual([
      '홈',
      '내 즐겨찾기',
      '매일 사용',
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

  it('운영 중인 사이트를 앞으로 끌어올리지 않는다 — 사이드바와 달리 분류 자리에 그대로 둔다', () => {
    render(<MobileChips categories={CATEGORIES} />);

    // 프로토타입 navChips 는 catNames 를 거르지 않는다(사이드바 nav 만 걸러 빠른 접근으로 올린다).
    expect(chips()).toHaveLength(13);
    expect(chips()[12]).toHaveTextContent('현재 운영 중인 사이트');
  });

  it('하위 분류는 칩이 되지 않는다', () => {
    render(<MobileChips categories={CATEGORIES} />);

    expect(within(row()).queryByRole('link', { name: '대화·검색' })).toBeNull();
    expect(within(row()).queryByRole('link', { name: '도구·서비스' })).toBeNull();
  });

  it('개수를 적지 않는다 — 칩에는 이름만 있다 (C1 리뷰 확정)', () => {
    render(<MobileChips categories={CATEGORIES} />);

    for (const link of chips()) {
      expect(link.textContent).not.toMatch(/\d/);
    }
  });

  it('각 칩이 제 화면으로 간다', () => {
    render(<MobileChips categories={CATEGORIES} />);

    expect(chip('홈')).toHaveAttribute('href', '/');
    expect(chip('내 즐겨찾기')).toHaveAttribute('href', '/favorites');
    expect(chip('매일 사용')).toHaveAttribute('href', '/daily');
    expect(chip('AI 도구 모음')).toHaveAttribute('href', '/category/ai');
    expect(chip('현재 운영 중인 사이트')).toHaveAttribute('href', '/category/op');
  });
});

describe('MobileChips — 선택 상태', () => {
  it('현재 경로의 칩만 검은 배경 + aria-current 다', () => {
    pathname.current = '/category/mkt';
    render(<MobileChips categories={CATEGORIES} />);

    const selected = chip('마케팅');
    expect(selected).toHaveAttribute('aria-current', 'page');
    expect(selected).toHaveClass('bg-ink', 'text-white');

    const other = chip('홈');
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).toHaveClass('bg-card');
  });

  it('빠른 접근 칩도 같은 규칙을 따른다', () => {
    pathname.current = '/favorites';
    render(<MobileChips categories={CATEGORIES} />);

    expect(chip('내 즐겨찾기')).toHaveAttribute('aria-current', 'page');
    expect(chip('홈')).not.toHaveAttribute('aria-current');
  });
});

describe('MobileChips — 프로토타입 수치', () => {
  it('칩 줄은 <820px 에서만 보이고 가로로 스크롤한다', () => {
    render(<MobileChips categories={CATEGORIES} />);

    // 프로토타입 showChips 는 narrow 전용이다 — 데스크톱에서는 사이드바가 같은 일을 한다.
    expect(row()).toHaveClass('min-[820px]:hidden', 'overflow-x-auto');
    // 프로토타입 원문: padding 10px 14px · gap 6px · 하단 1px 테두리 · 페이지 배경.
    expect(row()).toHaveClass('px-[14px]', 'py-[10px]', 'border-b', 'border-border', 'bg-page');
    expect(within(row()).getByRole('list')).toHaveClass('gap-[6px]');
  });

  it('칩 한 개의 수치가 프로토타입 원문 그대로다', () => {
    render(<MobileChips categories={CATEGORIES} />);

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
