import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatsView } from '@/components/admin/StatsView';
import {
  STATS_DEFAULT_PERIOD,
  STATS_PERIODS,
  type StatsCategoryTotal,
  type StatsDailyPoint,
  type StatsKpi,
  type StatsRecentClick,
  type StatsTopLink,
} from '@/lib/stats';

/**
 * K2 통계 화면의 클라이언트 계층 — 프로토타입(`docs/prototype/…dc.html` 460–543행,
 * stats() 870–907행) 실측 수치를 잠근다. 서버 왕복은 여기 없다: 페이지가 다섯 조회를
 * 한 번에 끝내 넘기고, 기간 탭은 이미 받은 daily(365)를 잘라 다시 그릴 뿐이다(읽기 전용).
 */

const KPI: StatsKpi = { total_clicks: 1280, today_clicks: 37, unused_links: 9 };

/** 365일치 daily — 기간 탭이 잘라 쓰는 원본. 마지막 날이 오늘(2026-08-10)이다. */
function daily365(): StatsDailyPoint[] {
  const points: StatsDailyPoint[] = [];
  const start = Date.UTC(2025, 7, 11); // 365일 전
  for (let i = 0; i < 365; i += 1) {
    const d = new Date(start + i * 86400000);
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
    points.push({ day, clicks: i % 7 }); // 0..6 반복 — dmax=6
  }
  return points;
}

const TOP: StatsTopLink[] = [
  {
    bookmark_id: 'b1',
    title: 'ChatGPT',
    url: 'https://chat.openai.com',
    favicon_url: 'https://chat.openai.com/favicon.ico',
    category_id: 'c1',
    category_name: 'AI 도구 모음',
    unique_visitors: 40,
    total_clicks: 120,
  },
  {
    bookmark_id: 'b2',
    title: 'Claude',
    url: 'https://claude.ai',
    favicon_url: null,
    category_id: 'c1',
    category_name: 'AI 도구 모음',
    unique_visitors: 20,
    total_clicks: 25,
  },
  {
    bookmark_id: 'b3',
    title: 'Figma',
    url: 'https://figma.com',
    favicon_url: null,
    category_id: null,
    category_name: null,
    unique_visitors: 10,
    total_clicks: 10,
  },
];

const CATS: StatsCategoryTotal[] = [
  { category_id: 'c1', category_name: 'AI 도구 모음', clicks: 200 },
  { category_id: 'c2', category_name: '마케팅', clicks: 50 },
];

const RECENT: StatsRecentClick[] = [
  {
    id: 2,
    bookmark_id: 'b1',
    title: 'ChatGPT',
    url: 'https://chat.openai.com',
    favicon_url: 'https://chat.openai.com/favicon.ico',
    clicked_at: '2026-08-09T05:05:00.000Z', // KST +9 → 8.9 14:05
  },
  {
    id: 1,
    bookmark_id: 'b2',
    title: 'Claude',
    url: 'https://claude.ai',
    favicon_url: null,
    clicked_at: '2026-08-10T15:30:00.000Z', // KST +9 → 8.11 00:30 (자정 넘김)
  },
];

function renderView(overrides: Partial<Parameters<typeof StatsView>[0]> = {}) {
  return render(
    <StatsView
      kpi={KPI}
      daily={daily365()}
      topLinks={TOP}
      categories={CATS}
      recentClicks={RECENT}
      periods={STATS_PERIODS}
      defaultPeriod={STATS_DEFAULT_PERIOD}
      {...overrides}
    />,
  );
}

describe('StatsView — KPI 3장 (DESIGN_SPEC 6장)', () => {
  it('누적·오늘·미클릭 숫자와 라벨을 낸다', () => {
    renderView();

    // 숫자는 KPI 영역 안에서 읽는다 — 날짜 라벨(1–31)과 값이 겹칠 수 있어 범위를 좁힌다.
    const kpi = within(screen.getByTestId('kpi-grid'));
    expect(kpi.getByText('누적 클릭')).toBeInTheDocument();
    expect(kpi.getByText('1280')).toBeInTheDocument();
    expect(kpi.getByText('오늘 클릭')).toBeInTheDocument();
    expect(kpi.getByText('37')).toBeInTheDocument();
    expect(kpi.getByText('한 번도 안 눌린 링크')).toBeInTheDocument();
    expect(kpi.getByText('9')).toBeInTheDocument();
  });

  it('누적 카드가 bulk 제외 안내를 단다 (K1 인계 — 카드 합계와 다름)', () => {
    renderView();

    // '한 번에 열기'(bulk) 클릭은 통계에서 빠진다 — 카드 표시 클릭 수와 갈린다.
    expect(screen.getByText(/한 번에 열기.*제외|제외.*카드/)).toBeInTheDocument();
  });

  it('<820px 에서 3열 KPI 그리드가 1열로 접힌다', () => {
    renderView();

    const grid = screen.getByTestId('kpi-grid');
    expect(grid).toHaveClass('grid-cols-1', 'min-[820px]:grid-cols-3');
  });
});

describe('StatsView — 기간 탭 · 추이 막대', () => {
  it('기본은 30일이고 그날 수만큼 막대를 세운다', () => {
    renderView();

    expect(screen.getByRole('button', { name: '30일' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '14일' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('trend-bar')).toHaveLength(30);
    expect(screen.getByText('최근 30일 · 하루 한 칸')).toBeInTheDocument();
  });

  it('탭을 누르면 다시 조회 없이 daily 를 잘라 막대 수가 바뀐다', () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: '90일' }));

    expect(screen.getByRole('button', { name: '90일' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30일' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('trend-bar')).toHaveLength(90);
    expect(screen.getByText('최근 90일 · 하루 한 칸')).toBeInTheDocument();
  });

  it('막대 gap 은 30일 이하 5px · 90일 이하 2px · 그 외 1px', () => {
    renderView();
    const bars = () => screen.getByTestId('trend-bars');

    expect(bars()).toHaveClass('gap-[5px]'); // 30

    fireEvent.click(screen.getByRole('button', { name: '14일' }));
    expect(bars()).toHaveClass('gap-[5px]');

    fireEvent.click(screen.getByRole('button', { name: '90일' }));
    expect(bars()).toHaveClass('gap-[2px]');

    fireEvent.click(screen.getByRole('button', { name: '180일' }));
    expect(bars()).toHaveClass('gap-[1px]');

    fireEvent.click(screen.getByRole('button', { name: '365일' }));
    expect(bars()).toHaveClass('gap-[1px]');
  });

  it('날짜 라벨은 30일 이하에서만 나온다', () => {
    renderView();

    // 30일: 라벨 줄이 있고 마지막 날(10일) 숫자가 보인다.
    const labels = screen.getByTestId('trend-labels');
    expect(within(labels).getByText('10')).toBeInTheDocument();

    // 90일: 라벨 줄 자체가 없다.
    fireEvent.click(screen.getByRole('button', { name: '90일' }));
    expect(screen.queryByTestId('trend-labels')).not.toBeInTheDocument();
  });

  it('클릭 0 인 날도 막대를 그린다 (빈 날 최소 높이)', () => {
    renderView();

    // daily 는 0..6 반복이라 0 인 날이 섞여 있다 — 모든 막대가 렌더된다.
    const zeroBars = screen
      .getAllByTestId('trend-bar')
      .filter((b) => b.style.height === '0%');
    expect(zeroBars.length).toBeGreaterThan(0);
    expect(zeroBars[0]).toHaveClass('min-h-[2px]');
  });
});

describe('StatsView — 많이 눌린 링크 12행', () => {
  it('행마다 순번·이름·분류·총클릭(참고용)을 낸다', () => {
    renderView();

    const rows = screen.getAllByTestId('rank-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('ChatGPT')).toBeInTheDocument();
    expect(within(rows[0]).getByText('AI 도구 모음')).toBeInTheDocument();
    expect(within(rows[0]).getByText('120회')).toBeInTheDocument(); // total_clicks
    expect(within(rows[2]).getByText('—')).toBeInTheDocument(); // 분류 없음
  });

  it('막대 길이는 고유 방문자 기준이라 1위가 100% 다 (총클릭이 아니다)', () => {
    renderView();

    const rows = screen.getAllByTestId('rank-row');
    // 1위 unique 40 → 100%, 2위 20 → 50%, 3위 10 → 25%.
    expect(within(rows[0]).getByTestId('rank-bar-fill').style.width).toBe('100%');
    expect(within(rows[1]).getByTestId('rank-bar-fill').style.width).toBe('50%');
    expect(within(rows[2]).getByTestId('rank-bar-fill').style.width).toBe('25%');
  });

  it('순위 기준이 고유 방문자·클릭은 참고용임을 알린다 (안내문)', () => {
    renderView();

    expect(screen.getByText(/고유 방문자.*기준/)).toBeInTheDocument();
    expect(screen.getByText(/참고용/)).toBeInTheDocument();
  });

  it('순위가 비면 안내 한 줄로 접는다', () => {
    renderView({ topLinks: [] });

    expect(screen.queryAllByTestId('rank-row')).toHaveLength(0);
    expect(screen.getByText('아직 클릭된 링크가 없습니다')).toBeInTheDocument();
  });
});

describe('StatsView — 카테고리별 합계 · 최근 클릭', () => {
  it('카테고리 행은 이름·합계·막대(합계 기준)를 낸다', () => {
    renderView();

    const rows = screen.getAllByTestId('cat-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('AI 도구 모음')).toBeInTheDocument();
    expect(within(rows[0]).getByText('200회')).toBeInTheDocument();
    expect(within(rows[0]).getByTestId('cat-bar-fill').style.width).toBe('100%');
    expect(within(rows[1]).getByTestId('cat-bar-fill').style.width).toBe('25%'); // 50/200
  });

  it('최근 클릭은 M.D HH:MM(한국시간)으로 찍는다', () => {
    renderView();

    const rows = screen.getAllByTestId('recent-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('8.9 14:05')).toBeInTheDocument();
    expect(within(rows[1]).getByText('8.11 00:30')).toBeInTheDocument();
  });

  it('최근 클릭이 비면 프로토타입 문구로 알린다', () => {
    renderView({ recentClicks: [] });

    expect(screen.queryAllByTestId('recent-row')).toHaveLength(0);
    expect(screen.getByText('아직 클릭 기록이 없습니다')).toBeInTheDocument();
  });

  it('<820px 에서 하단 2단(1.4fr/1fr)이 1열로 접힌다', () => {
    renderView();

    const grid = screen.getByTestId('bottom-grid');
    expect(grid).toHaveClass('grid-cols-1', 'min-[820px]:grid-cols-[1.4fr_1fr]');
  });
});
