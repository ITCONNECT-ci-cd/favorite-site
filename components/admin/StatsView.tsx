'use client';

import { useState } from 'react';

// **타입만** 가져온다(`import type`). `lib/stats` 는 `server-only` 를 import 하는 서버 모듈이라
// 클라이언트 컴포넌트가 런타임 값(STATS_PERIODS 등)을 끌어오면 번들 경계가 깨진다(next build 거부).
// 타입은 컴파일에서 지워지므로 안전하고, 기간 목록·기본값은 서버가 prop 으로 내려 준다(아래 props).
import type {
  StatsCategoryTotal,
  StatsDailyPoint,
  StatsKpi,
  StatsPeriod,
  StatsRecentClick,
  StatsTopLink,
} from '@/lib/stats';

/**
 * K2 — 관리자 통계 화면 본문 (DESIGN_SPEC 6장 "통계", 프로토타입 460–543행 실측).
 *
 * `<main>` 은 페이지가 갖고(`app/admin/stats/page.tsx`), 본문 패딩·스크롤은 셸이 진다
 * (AdminShell 계약). 여기서는 그 안의 콘텐츠만 만든다.
 *
 * ## 왜 클라이언트 컴포넌트인가 — 그리고 왜 서버 재조회가 없는가
 *
 * 기간 탭이 바꾸는 것은 **추이 막대뿐**이다. KPI·순위·카테고리·최근은 기간과 무관하다
 * (K1 API 도 `getStatsDaily(days)` 만 기간을 받고 나머지는 인자가 없다). 그래서 페이지가
 * `getStatsDaily(365)` 를 **한 번** 불러 넘기고, 탭은 이미 받은 그 배열을 `slice(-period)` 로
 * 잘라 다시 그린다. 0003 의 `admin_stats_daily` 가 `order by s.day`(오름차순, 오늘이 끝)이라
 * `daily(365)` 의 마지막 N 개가 곧 `daily(N)` 과 같기 때문이다 — 검증된 등식이다.
 *
 * 결과적으로 탭 전환은 **서버 왕복도, 클라이언트 재조회도 없는** 순수 리렌더다. 쓰기가 없으니
 * (읽기 전용) ref 빗장·startTransition 도 필요 없다(J·I 트랙 표준). 프로토타입도 하나의 `log`
 * 에서 모든 기간을 파생했다 — 같은 모델이다.
 */

/** 서버가 조회해 넘기는 통계 데이터 다섯 조각(기간 무관 — 탭은 daily 를 잘라 쓴다). */
export type StatsViewData = {
  kpi: StatsKpi;
  /** 최근 365일 연속 구간(빈 날 0 포함, 오늘이 마지막). 기간 탭이 `slice(-period)` 로 잘라 쓴다. */
  daily: StatsDailyPoint[];
  topLinks: StatsTopLink[];
  categories: StatsCategoryTotal[];
  recentClicks: StatsRecentClick[];
};

export type StatsViewProps = StatsViewData & {
  /**
   * 기간 탭 목록·기본값 — K1 의 `STATS_PERIODS`·`STATS_DEFAULT_PERIOD` 를 **서버가 내려 준다.**
   * 클라이언트가 `lib/stats`(server-only)를 직접 import 하지 않기 위한 것으로, LoginForm 이
   * 서버 액션을 prop 으로 받는 것과 같은 경계 처리다.
   */
  periods: readonly StatsPeriod[];
  defaultPeriod: StatsPeriod;
};

/** 카드·패널 공통 상자 — 프로토타입 `background:#fff;border:1px solid #e3dfd9;border-radius:9px`. */
const CARD = 'rounded-[9px] border border-border bg-card';
/** 패널 머리 줄 — `padding:13px 16px;border-bottom;background:#f7f5f2;font:700 13px`. */
const PANEL_HEAD = 'border-b border-border bg-page px-[16px] py-[13px] text-[13px] font-bold';
/** 리스트 빈 상태 한 줄 — 프로토타입 `padding:20px 16px;font:12px;color:#9a9791;center`. */
const EMPTY_LINE = 'px-[16px] py-[20px] text-center text-[12px] text-fainter';
/** 막대 트랙(회색 바탕) — 프로토타입 `height:7px;background:#f2f0ec;border-radius:2px;overflow:hidden`. */
const BAR_TRACK = 'h-[7px] min-w-0 flex-1 overflow-hidden rounded-[2px] bg-line';

/**
 * 파비콘 주소를 CSS `url()` 안에 안전하게 넣는다(따옴표 이스케이프). `components/admin/LinkTable.tsx`
 * ·`components/LinkCard.tsx`·`components/palette/CommandPalette.tsx` 에 같은 함수가 있다 — 이번이
 * 넷째 사용처라 원래는 `lib/favicon.ts` 로 올릴 자리지만, K2 는 `lib/**` 를 건드리지 않는 트랙이라
 * 여기서도 로컬로 둔다(O4 게이트에 승격 후보로 넘긴다).
 */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, '\\$&')}")`;
}

/** 저장된 파비콘 주소(빈 문자열은 없는 것으로) — `lib/favicon.ts` faviconSrc 와 같은 규칙. */
function iconOf(faviconUrl: string | null): string | null {
  return faviconUrl !== null && faviconUrl.trim() !== '' ? faviconUrl : null;
}

/**
 * 최근 클릭 시각을 `M.D HH:MM`(한국 시간)으로 찍는다 — 프로토타입 fmt(890행)와 같은 모양이나,
 * **타임존을 Asia/Seoul 로 고정**한다. KPI·추이의 날짜 경계가 DB 에서 Asia/Seoul 이라 여기만
 * 브라우저 로컬로 두면 어긋나고, 서버·클라이언트가 같은 값을 내야 하이드레이션도 깨지지 않는다.
 */
const KST_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
function formatKst(iso: string): string {
  const parts = KST_TIME.formatToParts(new Date(iso));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return `${pick('month')}.${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

/** 막대 gap 규칙 — DESIGN_SPEC 6장: 30일 이하 5px · 90일 이하 2px · 그 외 1px(프로토타입 901행). */
function gapClass(period: StatsPeriod): string {
  if (period <= 30) return 'gap-[5px]';
  if (period <= 90) return 'gap-[2px]';

  return 'gap-[1px]';
}

/** 퍼센트(0–100, 정수) — 최댓값 대비. 0 으로 나누지 않게 분모는 최소 1. */
function pct(value: number, max: number): number {
  return Math.round((value / Math.max(1, max)) * 100);
}

function KpiCard({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className={`${CARD} px-[17px] py-[15px]`}>
      <div className="mb-[6px] text-[11.5px] text-desc">{label}</div>
      {/* 숫자 26px/700 — DESIGN_SPEC 6장. tabular-nums 는 body 전역. */}
      <div className="text-[26px] font-bold tracking-[-0.02em]">{value}</div>
      <div className="mt-[4px] text-[11.5px] text-fainter">{note}</div>
    </div>
  );
}

export function StatsView({
  kpi,
  daily,
  topLinks,
  categories,
  recentClicks,
  periods,
  defaultPeriod,
}: StatsViewProps) {
  const [period, setPeriod] = useState<StatsPeriod>(defaultPeriod);

  const series = daily.slice(-period);
  const dayMax = Math.max(1, ...series.map((point) => point.clicks));
  const showLabels = period <= 30; // 날짜 라벨은 30일 이하에서만(DESIGN_SPEC 6장).
  const bars = gapClass(period);

  const uniqueMax = Math.max(1, ...topLinks.map((link) => link.unique_visitors));
  const catMax = Math.max(1, ...categories.map((cat) => cat.clicks));

  return (
    <div className="flex flex-col gap-[16px]">
      {/* ── KPI 3장 (3열 → <820px 1열) ─────────────────────────────── */}
      <section
        aria-label="핵심 지표"
        data-testid="kpi-grid"
        className="grid grid-cols-1 gap-[16px] min-[820px]:grid-cols-3"
      >
        <KpiCard
          label="누적 클릭"
          value={kpi.total_clicks}
          // K1 인계: 통계는 '한 번에 열기'(bulk) 클릭을 뺀다 → 카드 표시 클릭 수와 갈린다.
          note="‘한 번에 열기’ 클릭은 제외 · 카드에 보이는 클릭 수와 다를 수 있습니다"
        />
        <KpiCard label="오늘 클릭" value={kpi.today_clicks} note="자정(한국 시간) 기준으로 다시 셉니다" />
        <KpiCard label="한 번도 안 눌린 링크" value={kpi.unused_links} note="정리 도구에서 함께 확인" />
      </section>

      {/* ── 클릭 추이 (기간 탭 + 막대) ─────────────────────────────── */}
      <section aria-label="클릭 추이" className={`${CARD} px-[17px] pb-[12px] pt-[15px]`}>
        <div className="mb-[10px] flex items-center gap-[10px] text-[13px] font-bold">
          <span>클릭 추이</span>
          <span className="flex gap-[5px]">
            {periods.map((value) => {
              const active = value === period;

              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPeriod(value)}
                  className={`flex h-[26px] items-center rounded-[6px] border border-border-strong px-[10px] text-[11.5px] font-semibold ${
                    active ? 'bg-ink text-white' : 'bg-card text-[#3a3833]'
                  }`}
                >
                  {value}일
                </button>
              );
            })}
          </span>
          <span className="text-[11.5px] font-normal text-fainter">최근 {period}일 · 하루 한 칸</span>
        </div>

        {/* 막대 — 높이 80px, flex-end 정렬, 색 #c9c5be(check-off), 라운드 위쪽 3px, 빈 날 최소 2px. */}
        <div data-testid="trend-bars" className={`flex h-[80px] items-end ${bars}`}>
          {series.map((point) => (
            <div
              key={point.day}
              data-testid="trend-bar"
              title={`${point.day} · ${point.clicks}회`}
              className="min-h-[2px] flex-1 rounded-t-[3px] bg-check-off"
              style={{ height: `${pct(point.clicks, dayMax)}%` }}
            />
          ))}
        </div>

        {showLabels && (
          <div data-testid="trend-labels" className={`mt-[6px] flex ${bars}`}>
            {series.map((point) => (
              <div key={point.day} className="flex-1 text-center text-[9.5px] text-ghost">
                {Number(point.day.slice(8, 10))}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 하단 2단 (1.4fr / 1fr → <820px 1열) ─────────────────────── */}
      <div
        data-testid="bottom-grid"
        className="grid grid-cols-1 items-start gap-[16px] min-[820px]:grid-cols-[1.4fr_1fr]"
      >
        {/* 많이 눌린 링크 12행 */}
        <section aria-label="많이 눌린 링크" className={`${CARD} overflow-hidden`}>
          <h2 className={PANEL_HEAD}>많이 눌린 링크</h2>
          {/* 안내문 — 순위 기준은 고유 방문자, 옆 클릭 수는 참고용(K1: unique 정렬 + total 참고). */}
          <p className="border-b border-line px-[16px] py-[7px] text-[11px] text-fainter">
            순위는 고유 방문자 수 기준입니다 · 옆 클릭 수는 참고용
          </p>
          {topLinks.length === 0 ? (
            <div className={EMPTY_LINE}>아직 클릭된 링크가 없습니다</div>
          ) : (
            topLinks.map((link, index) => {
              const icon = iconOf(link.favicon_url);

              return (
                <div
                  key={link.bookmark_id}
                  data-testid="rank-row"
                  className="flex h-[42px] items-center gap-[11px] border-b border-line px-[16px]"
                >
                  <span className="w-[16px] flex-none text-[11px] text-ghost">{index + 1}</span>
                  <span
                    aria-hidden="true"
                    className="h-[22px] w-[22px] flex-none rounded-[6px] border border-select-hover bg-card bg-[length:14px_14px] bg-center bg-no-repeat"
                    style={icon === null ? undefined : { backgroundImage: cssUrl(icon) }}
                  />
                  <span className="w-[170px] flex-none truncate text-[12.5px] font-semibold">
                    {link.title}
                  </span>
                  <span className="w-[90px] flex-none truncate text-[11px] text-fainter">
                    {link.category_name ?? '—'}
                  </span>
                  <span className={BAR_TRACK}>
                    <span
                      data-testid="rank-bar-fill"
                      className="block h-[7px] rounded-[2px] bg-ink"
                      style={{ width: `${pct(link.unique_visitors, uniqueMax)}%` }}
                    />
                  </span>
                  <span className="w-[44px] flex-none text-right text-[11.5px] font-semibold">
                    {link.total_clicks}회
                  </span>
                </div>
              );
            })
          )}
        </section>

        {/* 우열: 카테고리별 합계 + 최근 클릭 */}
        <div className="flex flex-col gap-[16px]">
          <section aria-label="카테고리별 합계" className={`${CARD} overflow-hidden`}>
            <h2 className={PANEL_HEAD}>카테고리별 합계</h2>
            {categories.length === 0 ? (
              <div className={EMPTY_LINE}>아직 집계된 클릭이 없습니다</div>
            ) : (
              categories.map((cat) => (
                <div
                  key={cat.category_id}
                  data-testid="cat-row"
                  className="flex h-[36px] items-center gap-[10px] border-b border-line px-[16px]"
                >
                  <span className="w-[88px] flex-none truncate text-[12px]">{cat.category_name}</span>
                  <span className={BAR_TRACK}>
                    <span
                      data-testid="cat-bar-fill"
                      className="block h-[7px] rounded-[2px] bg-check-off"
                      style={{ width: `${pct(cat.clicks, catMax)}%` }}
                    />
                  </span>
                  <span className="w-[42px] flex-none text-right text-[11.5px] font-semibold">
                    {cat.clicks}회
                  </span>
                </div>
              ))
            )}
          </section>

          <section aria-label="최근 클릭" className={`${CARD} overflow-hidden`}>
            <h2 className={PANEL_HEAD}>최근 클릭</h2>
            {recentClicks.length === 0 ? (
              <div className={EMPTY_LINE}>아직 클릭 기록이 없습니다</div>
            ) : (
              recentClicks.map((click) => {
                const icon = iconOf(click.favicon_url);

                return (
                  <div
                    key={click.id}
                    data-testid="recent-row"
                    className="flex h-[36px] items-center gap-[10px] border-b border-line px-[16px]"
                  >
                    <span
                      aria-hidden="true"
                      className="h-[20px] w-[20px] flex-none rounded-[5px] border border-select-hover bg-card bg-[length:13px_13px] bg-center bg-no-repeat"
                      style={icon === null ? undefined : { backgroundImage: cssUrl(icon) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                      {click.title}
                    </span>
                    <span className="flex-none text-[11px] text-fainter">
                      {formatKst(click.clicked_at)}
                    </span>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
