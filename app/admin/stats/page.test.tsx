import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StatsPage from '@/app/admin/stats/page';
import {
  getCategoryTotals,
  getRecentClicks,
  getStatsDaily,
  getStatsKpi,
  getTopLinks,
} from '@/lib/stats';
import { getAdminSession } from '@/lib/supabase/server';

/**
 * K2 페이지 배선 — 게이트·조회 다섯 개·우아한 실패를 본다. 렌더 세부(막대·탭·수치)는
 * `components/admin/StatsView.test.tsx` 가 따로 잠근다.
 */
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

// K1 조회 계층은 통째로 대역이다 — 여기서는 화면이 이것들을 부르고 결과를 넘기는지,
// 그리고 던질 때 깨지지 않는지만 본다. 실제 rpc 정확성은 lib/stats.test.ts(+ 라이브 DB) 몫.
vi.mock('@/lib/stats', () => ({
  getStatsKpi: vi.fn(),
  getStatsDaily: vi.fn(),
  getTopLinks: vi.fn(),
  getCategoryTotals: vi.fn(),
  getRecentClicks: vi.fn(),
  STATS_PERIODS: [14, 30, 90, 180, 365],
  STATS_DEFAULT_PERIOD: 30,
}));

function seedSuccess() {
  vi.mocked(getStatsKpi).mockResolvedValue({ total_clicks: 512, today_clicks: 8, unused_links: 3 });
  vi.mocked(getStatsDaily).mockResolvedValue(
    Array.from({ length: 365 }, (_, i) => ({
      day: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`,
      clicks: i % 5,
    })),
  );
  vi.mocked(getTopLinks).mockResolvedValue([
    {
      bookmark_id: 'b1',
      title: 'ChatGPT',
      url: 'https://chat.openai.com',
      favicon_url: null,
      category_id: 'c1',
      category_name: 'AI',
      unique_visitors: 12,
      total_clicks: 30,
    },
  ]);
  vi.mocked(getCategoryTotals).mockResolvedValue([
    { category_id: 'c1', category_name: 'AI', clicks: 30 },
  ]);
  vi.mocked(getRecentClicks).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'u1', email: 'admin@example.com' });
});

describe('AdminStatsPage — 게이트', () => {
  it('미인증이면 아무것도 그리지 않는다 (RSC 페이로드 누출 방지)', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);

    const result = await StatsPage();

    expect(result).toBeNull();
    // 게이트가 조회보다 먼저 — 미인증이면 K1 을 부르지도 않는다.
    expect(getStatsKpi).not.toHaveBeenCalled();
    expect(getStatsDaily).not.toHaveBeenCalled();
  });
});

describe('AdminStatsPage — 인증 + 0003 적용(조회 성공)', () => {
  beforeEach(seedSuccess);

  it('랜드마크 하나 안에 KPI·순위·통계 본문을 세운다', async () => {
    const { container } = render((await StatsPage()) as ReactElement);

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByText('누적 클릭')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30일' })).toBeInTheDocument();
    expect(screen.getByText('많이 눌린 링크')).toBeInTheDocument();
  });

  it('추이는 365일 창을 한 번만 조회한다 (탭 전환은 클라이언트 slice — 서버 재조회 없음)', async () => {
    await StatsPage();

    expect(getStatsDaily).toHaveBeenCalledTimes(1);
    expect(getStatsDaily).toHaveBeenCalledWith(365);
  });
});

describe('AdminStatsPage — 인증 + 0003 미적용(조회 실패)', () => {
  it('집계 함수가 없어 던져도 500 이 아니라 안내로 접는다', async () => {
    // 0003 미적용 → rpc PGRST202 → lib/stats 의 unwrap 이 throw.
    vi.mocked(getStatsKpi).mockRejectedValue(new Error('Supabase admin_stats_kpi 호출 실패'));
    vi.mocked(getStatsDaily).mockResolvedValue([]);
    vi.mocked(getTopLinks).mockResolvedValue([]);
    vi.mocked(getCategoryTotals).mockResolvedValue([]);
    vi.mocked(getRecentClicks).mockResolvedValue([]);

    const { container } = render((await StatsPage()) as ReactElement);

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByText(/통계를 불러오지 못했습니다/)).toBeInTheDocument();
    // 본문(막대·탭)은 그리지 않는다 — 깨진 반쪽 화면이 아니라 안내 한 장이다.
    expect(screen.queryByRole('button', { name: '30일' })).not.toBeInTheDocument();
  });
});
