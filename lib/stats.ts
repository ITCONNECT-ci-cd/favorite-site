import 'server-only';

import { createServerSupabaseClient, getAdminSession } from '@/lib/supabase/server';

/**
 * K1. 통계 집계의 **서버 전용 조회 계층** — 관리 통계 화면(K2)이 소비한다.
 *
 * 각 함수는 `supabase/migrations/0003_stats.sql` 의 security definer RPC 하나를 부르는 얇은
 * 타입 래퍼다. 집계(누적·오늘·순위·추이·카테고리·최근)는 전부 DB 가 하고, 여기서는
 *
 *   1) `getAdminSession()` 게이트로 **관리자임을 먼저 확인**하고(fail-closed),
 *   2) anon 키가 아니라 **authenticated 쿠키 클라이언트**(`createServerSupabaseClient`)로 호출한다.
 *
 * 방어는 삼중이고 서로를 대체하지 않는다:
 *   - **앱 겹** — 이 파일의 `requireAdmin()` (게이트). 비관리자는 rpc 를 부르지도 않는다.
 *   - **grant 겹** — 0003 이 함수 실행 권한을 `authenticated` 에게만 준다(anon revoke). anon 키로
 *     부르면 함수 자체를 못 불러 `42501` 로 거부된다.
 *   - **함수 겹** — 0003 의 각 함수 첫머리가 `auth.jwt()->>'email'` 이 관리자인지 확인하고
 *     아니면 예외를 던진다. security definer 라 RLS 를 우회하므로 이 자기 확인이 최종 방어다.
 *
 * clicks 원본(visitor_hash 포함)은 절대 이 계층 밖으로 나가지 않는다 — 순위는
 * `count(distinct visitor_hash)` 만 돌려주고 해시 자체는 어떤 함수도 반환하지 않는다.
 *
 * **service role 을 쓰지 않는 이유**: service role 은 RLS·함수 게이트를 통째로 우회한다.
 * 통계는 화면에서 부르는 조회이므로 H4 의 "이중 방어" 계약대로 authenticated 쿠키 클라이언트로
 * 부르고, 위 세 겹이 2차·3차 방어로 남게 한다.
 *
 * ## bulk 집계 규칙 (G4 품질 리뷰 확정)
 *
 * `bookmark_click_counts` 뷰·카드 표시 카운트는 bulk **포함**(PRD 절대값 참고용 — 수용).
 * 반면 이 계층의 통계·순위는 **is_bulk 를 제외**한다 — bulk 기록은 팝업 차단된 탭까지 포함될
 * 수 있는 best-effort 라(noopener 로 연 창은 감지 불가) 신뢰도가 낮다. 순위만 bulk 포함 여부를
 * 인자로 열어 둔다(`getTopLinks(_, false)`), 나머지는 항상 제외한다.
 */

/** KPI 3장 — DESIGN_SPEC 6장. 전부 bulk 제외 클릭 기준. */
export type StatsKpi = {
  /** 누적 클릭(일반 클릭 총합, bulk 제외). */
  total_clicks: number;
  /** 오늘(Asia/Seoul) 클릭 수, bulk 제외. */
  today_clicks: number;
  /** 한 번도(일반 클릭으로) 안 눌린 링크 수. */
  unused_links: number;
};

/** 일별 추이 한 점 — 기간 안의 하루. 클릭이 없는 날도 `clicks: 0` 으로 포함된다. */
export type StatsDailyPoint = {
  /** `YYYY-MM-DD` (Asia/Seoul 날짜 경계). */
  day: string;
  clicks: number;
};

/** 링크 순위 한 행 — 정렬 기준은 `unique_visitors`(고유 방문자), `total_clicks` 는 참고용. */
export type StatsTopLink = {
  bookmark_id: string;
  title: string;
  url: string;
  favicon_url: string | null;
  category_id: string | null;
  /** 직속 분류 이름(상위·하위 무관, 링크가 실제로 속한 분류). 분류 없으면 null. */
  category_name: string | null;
  /** 순위 기준 — 서로 다른 visitor_hash 수. 해시 자체는 반환하지 않는다. */
  unique_visitors: number;
  /** 참고용 총 클릭 수(같은 필터 안에서의 원클릭 수). */
  total_clicks: number;
};

/** 카테고리별 클릭 합계 — 상위 카테고리 한 개당 한 행(하위·직속 롤업 합, bulk 제외). */
export type StatsCategoryTotal = {
  category_id: string;
  category_name: string;
  clicks: number;
};

/** 최근 클릭 한 건 — 활동 로그. bulk 제외, visitor_hash 미포함. */
export type StatsRecentClick = {
  /** clicks.id (bigserial). */
  id: number;
  bookmark_id: string;
  title: string;
  url: string;
  favicon_url: string | null;
  /** ISO timestamptz. 화면은 `M.D HH:MM` 으로 표기한다(K2). */
  clicked_at: string;
};

/**
 * 추이 기간 탭 — DESIGN_SPEC 6장이 고정한 다섯 값. K2 가 탭으로 그대로 쓴다.
 * 임의 값을 막는 계약이기도 하다(아래 `getStatsDaily` 가 이 집합으로 검증한다).
 */
export const STATS_PERIODS = [14, 30, 90, 180, 365] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

/** 기본 기간(DESIGN_SPEC — 30일 선택). */
export const STATS_DEFAULT_PERIOD: StatsPeriod = 30;

/** 순위 기본 행 수(DESIGN_SPEC — 12행). */
const DEFAULT_TOP_LIMIT = 12;
/** 최근 클릭 기본 건수(DESIGN_SPEC — 14건). */
const DEFAULT_RECENT_LIMIT = 14;

type RpcError = { message: string; code?: string; details?: string | null; hint?: string | null };

/**
 * 관리자 게이트 + 쿠키 클라이언트. 비관리자면 rpc 를 부르기 전에 던진다(fail-closed).
 * 게이트를 통과했다는 것은 이 요청이 `ADMIN_EMAIL` 계정임을 뜻한다(`getAdminSession` 계약).
 */
async function requireAdmin() {
  const session = await getAdminSession();
  if (session === null) throw new Error('통계 조회는 관리자 전용입니다.');

  return createServerSupabaseClient();
}

/**
 * rpc 응답에서 오류를 던지고 데이터만 꺼낸다. 실패를 삼키지 않는 이유는 `lib/queries` 의
 * `unwrap` 과 같다 — 빈 화면으로 조용히 넘어가면 "데이터가 없다"와 "권한/함수가 없다"를
 * 구분할 수 없다. `42501`(grant·게이트 거부)·`PGRST202`(0003 미적용)를 코드로 실어 던진다.
 */
function unwrap<T>(fn: string, result: { data: unknown; error: RpcError | null }): T {
  const { error } = result;

  if (error !== null) {
    const diagnostics: string[] = [];
    if (error.code) diagnostics.push(`code ${error.code}`);
    if (error.details) diagnostics.push(error.details);
    if (error.hint) diagnostics.push(`hint: ${error.hint}`);
    const suffix = diagnostics.length > 0 ? ` (${diagnostics.join(' · ')})` : '';

    throw new Error(`Supabase ${fn} 호출 실패: ${error.message}${suffix}`, { cause: error });
  }

  return result.data as T;
}

/** KPI 3장. 함수는 항상 정확히 한 행을 내지만, 방어적으로 비면 0 으로 접는다. */
export async function getStatsKpi(): Promise<StatsKpi> {
  const supabase = await requireAdmin();
  const rows = unwrap<StatsKpi[]>('admin_stats_kpi', await supabase.rpc('admin_stats_kpi'));

  return rows[0] ?? { total_clicks: 0, today_clicks: 0, unused_links: 0 };
}

/**
 * 일별 추이. `days` 는 DESIGN_SPEC 이 고정한 다섯 값 중 하나여야 한다 — 임의의 큰 값이
 * 들어와 DB 가 거대한 generate_series 를 돌지 않게 여기서 막는다(방어).
 */
export async function getStatsDaily(days: number): Promise<StatsDailyPoint[]> {
  if (!(STATS_PERIODS as readonly number[]).includes(days)) {
    throw new Error(`허용되지 않은 기간입니다: ${days} (${STATS_PERIODS.join('·')} 중 하나여야 합니다)`);
  }

  const supabase = await requireAdmin();

  return unwrap<StatsDailyPoint[]>('admin_stats_daily', await supabase.rpc('admin_stats_daily', { days }));
}

/**
 * 링크 순위. 기본 12행·bulk 제외. `excludeBulk` 를 false 로 주면 bulk 포함 순위를 본다
 * (참고용 — 기본은 제외다).
 */
export async function getTopLinks(
  limit: number = DEFAULT_TOP_LIMIT,
  excludeBulk = true,
): Promise<StatsTopLink[]> {
  const supabase = await requireAdmin();

  return unwrap<StatsTopLink[]>(
    'admin_stats_top_links',
    await supabase.rpc('admin_stats_top_links', { limit_n: limit, exclude_bulk: excludeBulk }),
  );
}

/** 카테고리별 클릭 합계(상위 카테고리 롤업, bulk 제외). */
export async function getCategoryTotals(): Promise<StatsCategoryTotal[]> {
  const supabase = await requireAdmin();

  return unwrap<StatsCategoryTotal[]>('admin_stats_by_category', await supabase.rpc('admin_stats_by_category'));
}

/** 최근 클릭(기본 14건, bulk 제외). */
export async function getRecentClicks(limit: number = DEFAULT_RECENT_LIMIT): Promise<StatsRecentClick[]> {
  const supabase = await requireAdmin();

  return unwrap<StatsRecentClick[]>('admin_stats_recent', await supabase.rpc('admin_stats_recent', { limit_n: limit }));
}
