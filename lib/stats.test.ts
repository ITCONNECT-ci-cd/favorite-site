// @vitest-environment node
// 얇은 rpc 래퍼 + 게이트만 다룬다 — DOM 이 필요 없다. 실제 SQL 함수의 집계 정확성은
// vitest 로는 확인할 수 없고(Postgres 가 없다), 라이브 DB 검증 스크립트가 따로 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCategoryTotals,
  getRecentClicks,
  getStatsDaily,
  getStatsKpi,
  getTopLinks,
  STATS_DEFAULT_PERIOD,
  STATS_PERIODS,
  type StatsCategoryTotal,
  type StatsDailyPoint,
  type StatsKpi,
  type StatsRecentClick,
  type StatsTopLink,
} from '@/lib/stats';
import { createServerSupabaseClient, getAdminSession } from '@/lib/supabase/server';

// stats.ts 의 두 의존을 함께 갈아 끼운다: 게이트(getAdminSession)와 쿠키 클라이언트.
// 둘 다 같은 모듈에서 나오므로 한 번에 mock 한다.
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  getAdminSession: vi.fn(),
}));

type RpcResult = { data: unknown; error: { message: string; code?: string; details?: string | null; hint?: string | null } | null };

/**
 * `supabase.rpc(fn, params)` 만 흉내 내는 최소 클라이언트. 부른 함수 이름·인자를 기록하고,
 * 미리 정한 결과를 Promise 로 돌려준다(실제 rpc 는 await 가능한 빌더다).
 */
function fakeSupabase(byFn: Record<string, RpcResult>) {
  const calls: { fn: string; params: unknown }[] = [];
  const client = {
    rpc(fn: string, params?: unknown) {
      calls.push({ fn, params });
      return Promise.resolve(byFn[fn] ?? { data: [], error: null });
    },
  };

  return { client, calls };
}

function useAdmin(byFn: Record<string, RpcResult> = {}) {
  const fake = fakeSupabase(byFn);
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'u1', email: 'contact@itconnect.dev' });
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fake.client as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
  );

  return fake;
}

beforeEach(() => {
  vi.mocked(getAdminSession).mockReset();
  vi.mocked(createServerSupabaseClient).mockReset();
});

describe('관리자 게이트 — 비관리자는 어떤 통계도 못 받는다', () => {
  // 각 래퍼가 게이트를 통과하지 못하면 rpc 를 아예 부르지 않고 던진다(fail-closed).
  it('getAdminSession 이 null 이면 모든 래퍼가 던지고 rpc 를 부르지 않는다', async () => {
    const fake = fakeSupabase({});
    vi.mocked(getAdminSession).mockResolvedValue(null);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fake.client as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );

    await expect(getStatsKpi()).rejects.toThrow(/관리자/);
    await expect(getStatsDaily(30)).rejects.toThrow(/관리자/);
    await expect(getTopLinks()).rejects.toThrow(/관리자/);
    await expect(getCategoryTotals()).rejects.toThrow(/관리자/);
    await expect(getRecentClicks()).rejects.toThrow(/관리자/);

    expect(fake.calls).toHaveLength(0);
  });
});

describe('getStatsKpi', () => {
  it('admin_stats_kpi 를 부르고 단일 행을 그대로 돌려준다', async () => {
    const row: StatsKpi = { total_clicks: 42, today_clicks: 5, unused_links: 118 };
    const fake = useAdmin({ admin_stats_kpi: { data: [row], error: null } });

    expect(await getStatsKpi()).toEqual(row);
    expect(fake.calls).toEqual([{ fn: 'admin_stats_kpi', params: undefined }]);
  });

  it('결과가 비면(있을 수 없지만) 0 세 개로 접는다', async () => {
    useAdmin({ admin_stats_kpi: { data: [], error: null } });

    expect(await getStatsKpi()).toEqual({ total_clicks: 0, today_clicks: 0, unused_links: 0 });
  });

  it('rpc 오류는 함수 이름·코드를 담아 던지고 원본을 cause 로 잇는다', async () => {
    const error = { message: 'permission denied for function admin_stats_kpi', code: '42501', details: null, hint: null };
    useAdmin({ admin_stats_kpi: { data: null, error } });

    await expect(getStatsKpi()).rejects.toThrow('Supabase admin_stats_kpi 호출 실패: permission denied for function admin_stats_kpi (code 42501)');
    await expect(getStatsKpi()).rejects.toMatchObject({ cause: error });
  });
});

describe('getStatsDaily', () => {
  it('기간을 days 인자로 넘기고 행 배열을 돌려준다', async () => {
    const rows: StatsDailyPoint[] = [
      { day: '2026-08-08', clicks: 3 },
      { day: '2026-08-09', clicks: 7 },
    ];
    const fake = useAdmin({ admin_stats_daily: { data: rows, error: null } });

    expect(await getStatsDaily(30)).toEqual(rows);
    expect(fake.calls).toEqual([{ fn: 'admin_stats_daily', params: { days: 30 } }]);
  });

  it('허용된 기간 5종(14·30·90·180·365)을 모두 받는다', async () => {
    const fake = useAdmin({ admin_stats_daily: { data: [], error: null } });

    for (const period of STATS_PERIODS) await getStatsDaily(period);

    expect(fake.calls.map((c) => c.params)).toEqual(STATS_PERIODS.map((days) => ({ days })));
  });

  it('기본 기간은 30일이다', () => {
    expect(STATS_DEFAULT_PERIOD).toBe(30);
    expect(STATS_PERIODS).toContain(30);
  });

  it('허용 밖·비정수·범위 밖 기간은 rpc 전에 던진다', async () => {
    const fake = useAdmin({ admin_stats_daily: { data: [], error: null } });

    await expect(getStatsDaily(0)).rejects.toThrow(/기간/);
    await expect(getStatsDaily(366)).rejects.toThrow(/기간/);
    await expect(getStatsDaily(1.5)).rejects.toThrow(/기간/);
    await expect(getStatsDaily(-30)).rejects.toThrow(/기간/);

    expect(fake.calls).toHaveLength(0);
  });
});

describe('getTopLinks', () => {
  it('기본은 12행·bulk 제외(exclude_bulk=true)로 부른다', async () => {
    const rows: StatsTopLink[] = [
      {
        bookmark_id: 'b1', title: 'A', url: 'https://a', favicon_url: null,
        category_id: 'c1', category_name: '마케팅', unique_visitors: 9, total_clicks: 30,
      },
    ];
    const fake = useAdmin({ admin_stats_top_links: { data: rows, error: null } });

    expect(await getTopLinks()).toEqual(rows);
    expect(fake.calls).toEqual([{ fn: 'admin_stats_top_links', params: { limit_n: 12, exclude_bulk: true } }]);
  });

  it('개수·bulk 포함 여부를 인자로 넘길 수 있다', async () => {
    const fake = useAdmin({ admin_stats_top_links: { data: [], error: null } });

    await getTopLinks(5, false);

    expect(fake.calls).toEqual([{ fn: 'admin_stats_top_links', params: { limit_n: 5, exclude_bulk: false } }]);
  });
});

describe('getCategoryTotals', () => {
  it('admin_stats_by_category 를 부르고 행을 돌려준다', async () => {
    const rows: StatsCategoryTotal[] = [{ category_id: 'c1', category_name: 'AI 도구 모음', clicks: 55 }];
    const fake = useAdmin({ admin_stats_by_category: { data: rows, error: null } });

    expect(await getCategoryTotals()).toEqual(rows);
    expect(fake.calls).toEqual([{ fn: 'admin_stats_by_category', params: undefined }]);
  });
});

describe('getRecentClicks', () => {
  it('기본 14건을 limit_n 으로 부른다', async () => {
    const rows: StatsRecentClick[] = [
      { id: 10, bookmark_id: 'b1', title: 'A', url: 'https://a', favicon_url: null, clicked_at: '2026-08-09T01:00:00.000Z' },
    ];
    const fake = useAdmin({ admin_stats_recent: { data: rows, error: null } });

    expect(await getRecentClicks()).toEqual(rows);
    expect(fake.calls).toEqual([{ fn: 'admin_stats_recent', params: { limit_n: 14 } }]);
  });

  it('개수를 바꿔 부를 수 있다', async () => {
    const fake = useAdmin({ admin_stats_recent: { data: [], error: null } });

    await getRecentClicks(30);

    expect(fake.calls).toEqual([{ fn: 'admin_stats_recent', params: { limit_n: 30 } }]);
  });
});
