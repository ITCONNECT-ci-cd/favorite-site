import type { Metadata } from 'next';

import { StatsView, type StatsViewData } from '@/components/admin/StatsView';
import {
  getCategoryTotals,
  getRecentClicks,
  getStatsDaily,
  getStatsKpi,
  getTopLinks,
  STATS_DEFAULT_PERIOD,
  STATS_PERIODS,
} from '@/lib/stats';
import { getAdminSession } from '@/lib/supabase/server';

/**
 * 관리자 — 통계 (`/admin/stats`, DESIGN_SPEC 6장 "통계", K2).
 *
 * 화면 본문은 `components/admin/StatsView.tsx`(클라이언트)가 그린다. 이 파일은 **서버에서
 * 다섯 조회를 끝내 넘기는 배선**이다 — 게이트 → 조회 → StatsView. 기간 탭은 조회를 다시
 * 부르지 않는다: `getStatsDaily(365)` 한 번이면 모든 기간 창이 그 슬라이스로 나온다
 * (StatsView JSDoc "왜 서버 재조회가 없는가").
 *
 * ## 레이아웃 것을 고치지 않고 화면별 제목만 단다
 *
 * `app/admin/layout.tsx` 의 `metadata.title`('관리자')는 형제 화면(카테고리·정리 도구)까지
 * 덮는 값이라 건드리지 않는다. 통계 탭에서만 탭 제목을 바꾸려고 이 화면이 자기 `metadata` 를
 * 얹는다(Next 가 세그먼트별 metadata 를 병합한다).
 */
export const metadata: Metadata = {
  title: '통계 · 관리자',
};

/**
 * 다섯 조회를 병렬로 끝낸다. 하나라도 던지면(대표적으로 0003 미적용 → `PGRST202`) 전체가
 * 거부되고, 페이지가 그 실패를 잡아 안내 화면으로 접는다. 부분 성공을 반쪽 화면으로 그리지
 * 않는 이유는 조회들이 한 화면의 조각이라, 하나가 비면 나머지 수치의 기준(누적·순위 max)도
 * 함께 흔들리기 때문이다 — 전부 성공했을 때만 본문을 세운다.
 */
async function loadStats(): Promise<StatsViewData> {
  const [kpi, daily, topLinks, categories, recentClicks] = await Promise.all([
    getStatsKpi(),
    getStatsDaily(365), // 최대 창 한 번 — 탭은 이 배열을 slice(-period) 로 잘라 쓴다.
    getTopLinks(),
    getCategoryTotals(),
    getRecentClicks(),
  ]);

  return { kpi, daily, topLinks, categories, recentClicks };
}

export default async function AdminStatsPage() {
  // 첫 줄 게이트 — 미인증 응답의 RSC 페이로드에 통계 수치가 실려 나가지 않게(layout.tsx 주석,
  // app/admin/page.test.tsx 소스 스캔이 강제). 조회는 이 뒤에서만 일어난다.
  if ((await getAdminSession()) === null) return null;

  let data: StatsViewData | null = null;
  try {
    data = await loadStats();
  } catch (error) {
    // 예상되는 도메인 실패(집계 함수 부재·권한)는 warn 으로 남기고 화면은 안내로 접는다 —
    // 던진 예외를 그대로 두면 라우트가 500 이 되고, 아침에 0003 이 적용되기 전까지 통계 탭이
    // 통째로 깨진다. actions.ts 의 관례(도메인 실패=warn, 던진 예외=error)를 따른다.
    console.warn('통계 집계 조회 실패 — 안내 화면으로 접는다 (0003 미적용 가능)', error);
  }

  return (
    <main>
      {data === null ? (
        <div className="rounded-[9px] border border-border bg-card px-[17px] py-[15px]">
          <p className="text-[13px] font-semibold text-ink">통계를 불러오지 못했습니다</p>
          <p className="mt-[6px] text-[12px] text-desc">
            집계 함수가 아직 준비되지 않았을 수 있습니다. 잠시 후 다시 열어 주세요.
          </p>
        </div>
      ) : (
        <StatsView {...data} periods={STATS_PERIODS} defaultPeriod={STATS_DEFAULT_PERIOD} />
      )}
    </main>
  );
}
