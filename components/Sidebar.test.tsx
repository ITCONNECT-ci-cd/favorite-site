import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, type SidebarProps } from '@/components/Sidebar';
import type { Category } from '@/lib/types';

/** usePathname 은 라우터 컨텍스트가 없는 단위 테스트에서 쓸 수 없으므로 모킹한다. */
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

const PROPS: SidebarProps = {
  categories: CATEGORIES,
  counts: {
    ai: 118, 'ai-chat': 26, 'ai-img': 14, mkt: 21, web: 30, edu: 12,
    pf: 9, uiux: 17, etc: 8, ref: 24, 'ref-tool': 15, google: 11, op: 16,
  },
  totalCount: 290,
  dailyCount: 12,
  favCount: 3,
  operatingCategoryId: 'op',
};

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  return render(<Sidebar {...PROPS} {...overrides} />);
}

/** 행 하나의 구성 요소 — 링크(마커+이름) · 행 컨테이너 · 우측 개수. */
function row(name: string) {
  const link = screen.getByRole('link', { name });
  const container = link.parentElement!;
  return {
    link,
    container,
    marker: link.firstElementChild!,
    label: link.lastElementChild!,
    count: container.lastElementChild!,
  };
}

const quickList = () => screen.getByRole('list', { name: '빠른 접근' });
const catList = () => screen.getByRole('list', { name: '분류' });

beforeEach(() => {
  pathname.current = '/';
});

describe('Sidebar', () => {
  describe('상단 60px 블록 (DESIGN_SPEC 2장)', () => {
    it('"내 링크" 15px/700 과 우측 전체 개수 11px 을 보여준다', () => {
      renderSidebar();

      const brand = screen.getByRole('link', { name: /내 링크/ });
      expect(within(brand).getByText('내 링크')).toHaveClass('text-[15px]', 'font-bold');
      expect(within(brand).getByText('290')).toHaveClass(
        'ml-auto',
        'text-[11px]',
        'text-faint',
      );
    });

    it('상단 블록 전체가 높이 60px 홈 링크다 (프로토타입 goHome)', () => {
      renderSidebar();

      const brand = screen.getByRole('link', { name: /내 링크/ });
      expect(brand).toHaveAttribute('href', '/');
      expect(brand).toHaveClass('h-[60px]', 'border-b', 'border-border');
    });
  });

  describe('빠른 접근', () => {
    it('캡션이 10.5px/700 · letter-spacing 0.08em · text-mist 다', () => {
      renderSidebar();

      expect(screen.getByText('빠른 접근')).toHaveClass(
        'text-[10.5px]',
        'font-bold',
        'tracking-[0.08em]',
        'text-mist',
      );
    });

    it('4항목을 지정된 경로로 건다', () => {
      renderSidebar();

      expect(row('홈').link).toHaveAttribute('href', '/');
      expect(row('내 즐겨찾기').link).toHaveAttribute('href', '/favorites');
      expect(row('매일 사용하는 사이트').link).toHaveAttribute('href', '/daily');
      expect(row('현재 운영 중인 사이트').link).toHaveAttribute('href', '/category/op');
      expect(quickList().children).toHaveLength(4);
    });

    it('항목 글자는 14px/600 이다', () => {
      renderSidebar();

      expect(row('홈').label).toHaveClass('text-[14px]', 'font-semibold');
      expect(row('현재 운영 중인 사이트').label).toHaveClass('text-[14px]', 'font-semibold');
    });

    it('개수는 전체·즐겨찾기·매일·운영 중 순으로 각 prop 을 쓴다', () => {
      renderSidebar();

      expect(row('홈').count).toHaveTextContent('290');
      expect(row('내 즐겨찾기').count).toHaveTextContent('3');
      expect(row('매일 사용하는 사이트').count).toHaveTextContent('12');
      expect(row('현재 운영 중인 사이트').count).toHaveTextContent('16');
    });

    it('운영 중 카테고리 id 가 없으면 그 행을 만들지 않는다', () => {
      renderSidebar({ operatingCategoryId: null });

      expect(quickList().children).toHaveLength(3);
      expect(
        within(quickList()).queryByRole('link', { name: '현재 운영 중인 사이트' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('분류 트리', () => {
    it('상위 카테고리를 13px/500 로 sort_order 순서대로 그린다', () => {
      renderSidebar();

      const names = within(catList())
        .getAllByRole('link')
        .map((link) => link.textContent);
      expect(names).toEqual([
        'AI 도구 모음', '마케팅', '웹 도구', '강의 및 출강', '자사 포트폴리오',
        'UI/UX 디자인', '기타', '참고자료', '구글 서비스',
      ]);
      expect(row('마케팅').label).toHaveClass('text-[13px]', 'font-medium');
      expect(row('마케팅').link).toHaveAttribute('href', '/category/mkt');
    });

    it('운영 중 카테고리는 빠른 접근에만 있고 분류 목록에서는 뺀다', () => {
      renderSidebar();

      expect(
        within(catList()).queryByRole('link', { name: '현재 운영 중인 사이트' }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: '현재 운영 중인 사이트' })).toHaveLength(1);
    });

    it('운영 중 카테고리 id 가 없으면 상위 10개를 그대로 그린다', () => {
      renderSidebar({ operatingCategoryId: null });

      expect(catList().children).toHaveLength(10);
      expect(
        within(catList()).getByRole('link', { name: '현재 운영 중인 사이트' }),
      ).toHaveAttribute('href', '/category/op');
    });

    it('개수는 우측 정렬 11px text-mist 이고, 없는 값은 0 으로 적는다', () => {
      renderSidebar({ counts: { ai: 118 } });

      expect(row('AI 도구 모음').count).toHaveClass('text-right', 'text-[11px]', 'text-mist');
      expect(row('AI 도구 모음').count).toHaveTextContent('118');
      expect(row('마케팅').count).toHaveTextContent('0');
    });
  });

  describe('하위 펼침 토글', () => {
    it('하위가 있는 상위에만 + 버튼을 붙인다', () => {
      renderSidebar();

      expect(screen.getAllByRole('button')).toHaveLength(2);
      expect(
        screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }),
      ).toHaveTextContent('+');
      expect(
        within(row('마케팅').container).queryByRole('button'),
      ).not.toBeInTheDocument();
      // 하위가 없는 행도 기호 자리를 비워 둔다 — 링크·기호칸·개수 3칸 구성은 모든 행이 같다.
      expect(row('마케팅').container.children).toHaveLength(3);
      expect(row('AI 도구 모음').container.children).toHaveLength(3);
    });

    it('두 상위를 모두 펼치면 둘 다 열린 채로 남는다 (아코디언 아님)', () => {
      renderSidebar();

      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }));
      fireEvent.click(screen.getByRole('button', { name: '참고자료 하위 분류 펼치기' }));

      expect(screen.getByRole('link', { name: '대화·검색' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '이미지' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '도구·서비스' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 접기' }),
      ).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByRole('button', { name: '참고자료 하위 분류 접기' }),
      ).toHaveAttribute('aria-expanded', 'true');
    });

    it('+ 를 누르면 하위가 펼쳐지고 기호가 – 로 바뀐다', () => {
      renderSidebar();

      expect(screen.queryByRole('link', { name: '대화·검색' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }));

      const toggle = screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 접기' });
      expect(toggle).toHaveTextContent('–');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(row('대화·검색').link).toHaveAttribute('href', '/category/ai-chat');
      expect(row('이미지').link).toHaveAttribute('href', '/category/ai-img');
    });

    it('– 를 다시 누르면 접힌다', () => {
      renderSidebar();

      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }));
      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 접기' }));

      expect(screen.queryByRole('link', { name: '대화·검색' })).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }),
      ).toHaveAttribute('aria-expanded', 'false');
    });

    it('한 상위를 펼쳐도 다른 상위는 접힌 채로 둔다', () => {
      renderSidebar();

      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }));

      expect(screen.getByRole('link', { name: '대화·검색' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: '도구·서비스' })).not.toBeInTheDocument();
    });

    it('하위 항목은 12.5px/400 에 들여쓰기 30px 이다', () => {
      renderSidebar();

      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }));

      expect(row('대화·검색').label).toHaveClass('text-[12.5px]', 'font-normal');
      expect(row('대화·검색').link).toHaveClass('pl-[30px]');
      expect(row('대화·검색').count).toHaveTextContent('26');
    });
  });

  describe('행 공통 치수 · 활성 표시 (usePathname)', () => {
    it('행은 높이 34px · 라운드 6px · 호버 배경을 갖는다', () => {
      renderSidebar();

      expect(row('마케팅').container).toHaveClass(
        'h-[34px]',
        'rounded-[6px]',
        'hover:bg-select-hover',
      );
    });

    it('현재 경로의 행만 선택 배경 · 마커 · 개수 색을 바꾼다', () => {
      pathname.current = '/category/mkt';
      renderSidebar();

      const active = row('마케팅');
      expect(active.container).toHaveClass('bg-select');
      expect(active.marker).toHaveClass('bg-ink');
      expect(active.label).toHaveClass('text-ink');
      expect(active.count).toHaveClass('text-[#5a5651]');
      expect(active.link).toHaveAttribute('aria-current', 'page');

      const idle = row('웹 도구');
      expect(idle.container).not.toHaveClass('bg-select');
      expect(idle.marker).toHaveClass('bg-transparent');
      expect(idle.count).toHaveClass('text-mist');
      expect(idle.link).not.toHaveAttribute('aria-current');
    });

    it('홈은 경로가 / 일 때만 활성이다', () => {
      renderSidebar();

      expect(row('홈').container).toHaveClass('bg-select');
      expect(row('내 즐겨찾기').container).not.toHaveClass('bg-select');
    });

    it('빠른 접근의 다른 경로에서도 활성 표시가 따라간다', () => {
      pathname.current = '/daily';
      renderSidebar();

      expect(row('매일 사용하는 사이트').container).toHaveClass('bg-select');
      expect(row('홈').container).not.toHaveClass('bg-select');
    });

    it('운영 중 카테고리 경로에서는 빠른 접근 항목이 활성이다', () => {
      pathname.current = '/category/op';
      renderSidebar();

      expect(row('현재 운영 중인 사이트').container).toHaveClass('bg-select');
    });

    it('하위가 활성이면 그 상위를 기본으로 펼쳐 하위 행을 보여준다', () => {
      pathname.current = '/category/ai-chat';
      renderSidebar();

      expect(
        screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 접기' }),
      ).toHaveAttribute('aria-expanded', 'true');
      expect(row('대화·검색').container).toHaveClass('bg-select');
      expect(row('대화·검색').marker).toHaveClass('bg-ink');
      // 하위가 선택된 동안 상위는 활성이 아니다 (프로토타입 `on: key === n && !sub`).
      expect(row('AI 도구 모음').container).not.toHaveClass('bg-select');
    });

    it('상위 자신이 활성이면 그 하위를 기본으로 펼친다', () => {
      pathname.current = '/category/ai';
      renderSidebar();

      expect(row('AI 도구 모음').container).toHaveClass('bg-select');
      expect(
        screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 접기' }),
      ).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('link', { name: '대화·검색' })).toBeInTheDocument();
      // 다른 상위까지 펼쳐지지는 않는다.
      expect(screen.queryByRole('link', { name: '도구·서비스' })).not.toBeInTheDocument();
    });

    it('활성 상위도 사용자가 직접 접으면 접힌 채로 둔다', () => {
      pathname.current = '/category/ai';
      renderSidebar();

      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 접기' }));

      expect(screen.queryByRole('link', { name: '대화·검색' })).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 펼치기' }),
      ).toHaveAttribute('aria-expanded', 'false');
    });

    it('기본으로 펼쳐진 상위도 – 를 눌러 접을 수 있다', () => {
      pathname.current = '/category/ai-chat';
      renderSidebar();

      fireEvent.click(screen.getByRole('button', { name: 'AI 도구 모음 하위 분류 접기' }));

      expect(screen.queryByRole('link', { name: '대화·검색' })).not.toBeInTheDocument();
    });
  });
});
