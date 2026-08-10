import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CleanupView } from '@/components/admin/CleanupView';
import { ADMIN_CLEANUP_PATH } from '@/lib/routes';
import type {
  AbandonedBookmark,
  CleanupBookmark,
  DomainGroup,
  DuplicateUrlGroup,
} from '@/lib/cleanup';

/**
 * M2 — 정리 도구 본문(DESIGN_SPEC 6장 "정리 도구", 프로토타입 545–595행 실측).
 *
 * 데이터는 페이지가 M1(lib/cleanup.ts)에서 받아 넘긴다. 여기서는 넘어온 세 구역(①완전 중복 ·
 * ②도메인 · ③방치)이 스펙대로 그려지는지, 0건 안내와 "정리 대상이 아닙니다" 명시, 기준 탭
 * (URL ?days=), <820px 1단을 본다.
 *
 * 고르고 지우는 **동작**(접힘 토글·체크·확인·액션 호출)은 `CleanupSelection.test.tsx` 가 본다 —
 * 여기서 보는 것은 **배선**이다: 세 구역이 각자 자기 목록 컴포넌트를 갖는가, 그래서 한 북마크가
 * ①과 ②에 동시에 떠도 체크가 서로 번지지 않는가.
 */

/** 액션까지 가는 길은 CleanupSelection.test 의 몫이라, 여기서는 실수로도 나가지 않게 갈아 끼운다. */
vi.mock('@/lib/mutations', () => ({ deleteBookmarks: vi.fn() }));

/** CleanupBookmark 한 건 — 판정 결과가 카드로 그릴 최소 모양(M1 Pick). */
function cb(id: string, url: string, title: string): CleanupBookmark {
  return { id, category_id: null, title, url, created_at: '2024-01-01T00:00:00.000Z' };
}

function ab(id: string, url: string, title: string): AbandonedBookmark {
  return { ...cb(id, url, title), last_clicked_at: null };
}

const DUP: DuplicateUrlGroup[] = [
  {
    url: 'https://dup.test/a',
    bookmarks: [cb('d1', 'https://dup.test/a', '중복 하나'), cb('d2', 'https://dup.test/a', '중복 둘')],
  },
];

const DOMAIN: DomainGroup[] = [
  {
    host: 'github.com',
    bookmarks: [
      cb('g1', 'https://github.com/a', '깃헙 A'),
      cb('g2', 'https://github.com/b', '깃헙 B'),
    ],
  },
];

const ABANDONED: AbandonedBookmark[] = [
  ab('s1', 'https://stale.test/one', '방치 하나'),
  ab('s2', 'https://stale.test/two', '방치 둘'),
];

function renderView(overrides: Partial<Parameters<typeof CleanupView>[0]> = {}) {
  return render(
    <CleanupView
      retentionDays={180}
      duplicateUrlGroups={DUP}
      domainGroups={DOMAIN}
      abandoned={ABANDONED}
      {...overrides}
    />,
  );
}

const dupRegion = () => screen.getByRole('region', { name: '같은 주소를 두 번 등록' });
const domainRegion = () => screen.getByRole('region', { name: '같은 도메인 · 서로 다른 페이지' });
const staleRegion = () => screen.getByRole('region', { name: '오래 손대지 않은 링크' });
const tabs = () => within(staleRegion()).getByRole('group', { name: '방치 판정 기준' });

describe('CleanupView — 2열 레이아웃', () => {
  it('세 구역(완전 중복 · 도메인 · 방치)을 모두 세운다', () => {
    renderView();

    expect(dupRegion()).toBeInTheDocument();
    expect(domainRegion()).toBeInTheDocument();
    expect(staleRegion()).toBeInTheDocument();
  });

  it('<820px 에서 1단으로 접힌다 (DESIGN_SPEC 1장 브레이크포인트 · 프로토타입 546행 grid 1fr 1fr)', () => {
    const { container } = renderView();

    // 뿌리 그리드는 좁은 화면에서 1열, 820px 이상에서 2열이다.
    expect(container.firstElementChild).toHaveClass(
      'grid',
      'grid-cols-1',
      'min-[820px]:grid-cols-2',
      'gap-[18px]',
      'items-start',
    );
  });
});

describe('CleanupView — ① 같은 주소를 두 번 등록', () => {
  it('그룹마다 host · 제목들 · 건수를 한 줄로 그린다 (프로토타입 553–557행)', () => {
    renderView();

    const rows = within(dupRegion()).getAllByRole('listitem');

    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('dup.test')).toBeInTheDocument();
    expect(within(rows[0]).getByText('중복 하나 · 중복 둘')).toBeInTheDocument();
    expect(within(rows[0]).getByText('2개')).toBeInTheDocument();
  });

  it('부제는 완전 동일 URL 그룹 수를 센다 (프로토타입 550행 clusterLabel)', () => {
    renderView();

    expect(within(dupRegion()).getByText('주소가 완전히 같은 것만 잡습니다 · 1건')).toBeInTheDocument();
  });

  it('0건이면 목록 대신 안내문을 낸다 (DESIGN_SPEC 6장 "0건이면 안내문")', () => {
    renderView({ duplicateUrlGroups: [] });

    expect(within(dupRegion()).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(dupRegion()).getByText('주소가 완전히 같은 중복은 없습니다.')).toBeInTheDocument();
    expect(within(dupRegion()).getByText('주소가 완전히 같은 것만 잡습니다 · 0건')).toBeInTheDocument();
  });
});

describe('CleanupView — ② 같은 도메인 · 서로 다른 페이지', () => {
  it('그룹마다 host · 제목들 · 건수를 그린다 (프로토타입 564–570행)', () => {
    renderView();

    const rows = within(domainRegion()).getAllByRole('listitem');

    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('github.com')).toBeInTheDocument();
    expect(within(rows[0]).getByText('깃헙 A · 깃헙 B')).toBeInTheDocument();
    expect(within(rows[0]).getByText('2개')).toBeInTheDocument();
  });

  it('정리 대상이 아니라고 명시한다 (DESIGN_SPEC 6장) — 중복 유무와 무관하게 항상', () => {
    renderView();
    expect(within(domainRegion()).getByText(/정리 대상이 아닙니다/)).toBeInTheDocument();

    // 완전 중복이 0건일 때도 도메인 구역의 명시는 그대로 남는다.
    renderView({ duplicateUrlGroups: [] });
    for (const region of screen.getAllByRole('region', { name: '같은 도메인 · 서로 다른 페이지' })) {
      expect(within(region).getByText(/정리 대상이 아닙니다/)).toBeInTheDocument();
    }
  });

  it('0건이면 안내문을 낸다', () => {
    renderView({ domainGroups: [] });

    expect(within(domainRegion()).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(domainRegion()).getByText('같은 도메인으로 묶이는 링크가 없습니다.')).toBeInTheDocument();
  });
});

describe('CleanupView — ③ 오래 손대지 않은 링크', () => {
  it('행마다 제목 · host 를 그리고, 부제에 건수와 기준일을 담는다 (프로토타입 585–589·1148행)', () => {
    renderView({ retentionDays: 90 });

    const rows = within(staleRegion()).getAllByRole('listitem');

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('방치 하나')).toBeInTheDocument();
    expect(within(rows[0]).getByText('stale.test')).toBeInTheDocument();
    expect(
      within(staleRegion()).getByText('2개 · 최근 90일 동안 클릭 0회 + 등록한 지도 90일 지남'),
    ).toBeInTheDocument();
  });

  it('0건이면 안내문을 낸다', () => {
    renderView({ abandoned: [] });

    expect(within(staleRegion()).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(staleRegion()).getByText('오래 손대지 않은 링크가 없습니다.')).toBeInTheDocument();
  });

  /**
   * 0004 미적용(cleanup_abandoned rpc 부재)이면 페이지가 abandoned=null 을 넘긴다. ③만 안내로
   * 접고 ①②는 그대로 뜬다 — 그 분기 판단은 페이지가 지고, 화면은 null 을 "집계 불가" 안내로 그린다.
   */
  it('abandoned 가 null 이면 목록·부제 대신 "집계할 수 없습니다" 안내를 낸다', () => {
    renderView({ abandoned: null });

    expect(within(staleRegion()).queryByRole('listitem')).not.toBeInTheDocument();
    expect(within(staleRegion()).queryByText(/동안 클릭 0회/)).not.toBeInTheDocument();
    expect(within(staleRegion()).getByText(/아직 집계할 수 없습니다/)).toBeInTheDocument();
    // ①②는 영향받지 않는다 — 같은 렌더에서 그대로 뜬다.
    expect(within(dupRegion()).getByText('dup.test')).toBeInTheDocument();
    expect(within(domainRegion()).getByText('github.com')).toBeInTheDocument();
  });
});

describe('CleanupView — 기준 탭 (30·90·180·365, URL ?days=)', () => {
  it('네 기준일을 ?days= 링크로 세운다 (프로토타입 1145행)', () => {
    renderView();

    const links = within(tabs()).getAllByRole('link');

    expect(links.map((link) => link.textContent)).toEqual(['30일', '90일', '180일', '365일']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `${ADMIN_CLEANUP_PATH}?days=30`,
      `${ADMIN_CLEANUP_PATH}?days=90`,
      `${ADMIN_CLEANUP_PATH}?days=180`,
      `${ADMIN_CLEANUP_PATH}?days=365`,
    ]);
  });

  it('현재 기준일 탭만 선택으로 보인다 (기본 180) — 색과 aria-current 양방향', () => {
    renderView();

    for (const link of within(tabs()).getAllByRole('link')) {
      const active = link.textContent === '180일';

      expect(link).toHaveClass(active ? 'bg-ink' : 'bg-card');
      expect(link).not.toHaveClass(active ? 'bg-card' : 'bg-ink');
      expect(link).toHaveClass(active ? 'text-white' : 'text-[#3a3833]');
      expect(link.getAttribute('aria-current')).toBe(active ? 'page' : null);
      // 테두리는 선택과 무관하게 고정(상단 탭·통계 기간 탭과 같은 관례).
      expect(link).toHaveClass('border-border-strong');
    }
  });

  it('기준일이 바뀌면 그 탭으로 선택이 옮겨 간다 (탭 전환)', () => {
    renderView({ retentionDays: 365 });

    expect(within(tabs()).getByRole('link', { name: '365일' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(tabs()).getByRole('link', { name: '180일' })).not.toHaveAttribute('aria-current');

    const selected = within(tabs())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(selected).toHaveLength(1);
  });
});

describe('CleanupView — 고르고 지우기 (구역마다 따로)', () => {
  const groupToggle = (region: HTMLElement, label: string) =>
    within(region).getByRole('button', { name: new RegExp(`^${label}`) });
  const deleteButton = (region: HTMLElement) =>
    within(region).getByRole('button', { name: /^선택한 \d+개 삭제$/ });

  it('세 구역이 모두 자기 삭제 버튼을 갖고, 아무것도 안 골랐으면 잠겨 있다', () => {
    renderView();

    for (const region of [dupRegion(), domainRegion(), staleRegion()]) {
      expect(deleteButton(region)).toBeDisabled();
      expect(deleteButton(region)).toHaveTextContent('선택한 0개 삭제');
    }
  });

  it('①②의 그룹은 접힌 채로 뜬다 — 열 개가 한꺼번에 펼쳐지지 않는다', () => {
    renderView();

    expect(groupToggle(dupRegion(), 'dup.test')).toHaveAttribute('aria-expanded', 'false');
    expect(groupToggle(domainRegion(), 'github.com')).toHaveAttribute('aria-expanded', 'false');
    // 접힌 동안에는 항목 체크박스가 아예 없다(그룹 전체 선택만 있다).
    expect(screen.queryByRole('checkbox', { name: '중복 하나 선택' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '깃헙 A 선택' })).not.toBeInTheDocument();
  });

  it('③ 방치 목록은 줄마다 체크가 있고 구역 전체 선택도 있다 (전부 보이는 목록이라)', () => {
    renderView();

    expect(within(staleRegion()).getByRole('checkbox', { name: '방치 하나 선택' })).toBeInTheDocument();
    expect(
      within(staleRegion()).getByRole('checkbox', { name: '오래 손대지 않은 링크 전체 선택' }),
    ).toBeInTheDocument();
    // ①②에는 구역 전체 선택을 두지 않는다 — 접힌 그룹까지 통째로 골라 버리는 길이다.
    expect(within(dupRegion()).queryByRole('checkbox', { name: /^같은 주소/ })).not.toBeInTheDocument();
  });

  /**
   * M1 인계 — 한 host 가 완전 중복과 다른 페이지를 둘 다 가지면 그 북마크는 ①과 ②에 함께 뜬다.
   * 구역마다 목록 컴포넌트가 따로 서므로 체크도 따로다: 같은 id 인데 한쪽만 골라진다.
   */
  it('한 북마크가 ①②에 함께 떠도 체크는 번지지 않는다', () => {
    const shared = [cb('x1', 'https://github.com/a', '겹친 링크'), cb('x2', 'https://github.com/a', '겹친 둘')];
    renderView({
      duplicateUrlGroups: [{ url: 'https://github.com/a', bookmarks: shared }],
      domainGroups: [
        { host: 'github.com', bookmarks: [...shared, cb('x3', 'https://github.com/b', '다른 페이지')] },
      ],
    });

    fireEvent.click(groupToggle(dupRegion(), 'github.com'));
    fireEvent.click(groupToggle(domainRegion(), 'github.com'));
    fireEvent.click(within(dupRegion()).getByRole('checkbox', { name: '겹친 링크 선택' }));

    expect(within(dupRegion()).getByRole('checkbox', { name: '겹친 링크 선택' })).toBeChecked();
    expect(deleteButton(dupRegion())).toHaveTextContent('선택한 1개 삭제');
    // 같은 id 인데 ②는 그대로다.
    expect(within(domainRegion()).getByRole('checkbox', { name: '겹친 링크 선택' })).not.toBeChecked();
    expect(deleteButton(domainRegion())).toHaveTextContent('선택한 0개 삭제');
    expect(deleteButton(domainRegion())).toBeDisabled();
  });
});

describe('CleanupView — 패널 치수 (프로토타입 원문)', () => {
  it('각 구역 패널은 라운드 9px · 기본 테두리 · 흰 배경이다 (프로토타입 547·573행)', () => {
    renderView();

    // 방치 구역은 자기 자신이 패널이다.
    expect(staleRegion()).toHaveClass('rounded-[9px]', 'border', 'border-border', 'bg-card');
  });

  it('기준 탭은 높이 24px · 라운드 6px · 11px/600 이다 (프로토타입 579행)', () => {
    renderView();

    for (const link of within(tabs()).getAllByRole('link')) {
      expect(link).toHaveClass('h-[24px]', 'rounded-[6px]', 'px-[9px]', 'text-[11px]', 'font-semibold');
    }
  });
});
