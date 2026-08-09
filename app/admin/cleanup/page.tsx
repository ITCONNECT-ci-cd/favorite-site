import type { Metadata } from 'next';

import { CleanupView } from '@/components/admin/CleanupView';
import {
  findDomainGroups,
  findDuplicateUrlGroups,
  getCleanupReport,
  isRetentionDays,
  type AbandonedBookmark,
  type DomainGroup,
  type DuplicateUrlGroup,
  type RetentionDays,
} from '@/lib/cleanup';
import { getAllData } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';

/**
 * 관리자 — 정리 도구 (`/admin/cleanup`, DESIGN_SPEC 6장 "정리 도구").
 *
 * 판정은 M1(`lib/cleanup.ts`)이 하고 표시는 `CleanupView` 가 한다. 이 페이지는 그 사이에서
 * **관문·기준일 해석·데이터 조회**만 진다.
 *
 * ## 첫 줄의 세션 확인을 지우지 마라 (H3 승계)
 *
 * 레이아웃이 미인증에 children 을 렌더하지 않아도 Next 는 이 page 세그먼트를 렌더해 RSC
 * 페이로드에 싣는다 — 여기에 링크 목록·방치 판정이 그대로 새어 나간다. 그래서 화면 스스로
 * 첫 줄에서 다시 막는다(`app/admin/layout.tsx` 주석, `app/admin/page.test.tsx` 가 소스로 강제).
 *
 * ## 기준일은 URL(`?days=`) 에 싣는다
 *
 * 방치 판정(③)은 기준일마다 `cleanup_abandoned(retention_days)` rpc 를 새로 쳐야 하므로(clicks
 * 는 비공개 — M1) 통계(K2)의 기간 탭처럼 이미 받은 배열을 클라이언트에서 자를 수 없다. 그래서
 * 기준일을 URL 에 싣고 서버가 그 값으로 다시 조회한다. `CleanupView` 가 서버 컴포넌트로 남는
 * 근거이기도 하다(방치 데이터가 클라이언트 번들로 새지 않는다).
 *
 * ## 0004 미적용이면 ③만 접는다
 *
 * `getCleanupReport` 는 rpc 실패를 **통째로 throw** 한다(빈 리포트로 삼키지 않는 M1 방침).
 * 라이브에 0004 마이그레이션이 아직 없으면(PGRST202) 그 throw 로 화면 전체가 깨질 수 있다.
 * ①②는 공개 bookmarks 만 보는 **순수 함수**(findDuplicateUrlGroups·findDomainGroups)라 rpc
 * 없이도 판정되므로, throw 를 잡아 공개 데이터로 ①②를 되살리고 ③(방치)만 안내로 접는다.
 * 0004 가 적용되면 정상 경로가 세 구역을 한 번에 받는다.
 */
export const metadata: Metadata = { title: '정리 도구' };

/** 기준 탭 기본값 — 30·90·180(기본)·365 중 180(DESIGN_SPEC 6장). */
const DEFAULT_RETENTION_DAYS: RetentionDays = 180;

/**
 * `searchParams` 를 선택적으로(기본 `{}`) 받는 이유: `app/admin/page.test.tsx` 의 미인증 스캔이
 * 이 페이지를 인자 없이(`Page()`) 불러 "미인증이면 null" 을 확인한다. 필수 구조 분해로 두면 그
 * 호출이 게이트에 닿기도 전에 터진다. 실제 렌더에서는 Next 가 늘 넘겨 준다(정적 라우트는 `{}`).
 */
type CleanupPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function AdminCleanupPage({ searchParams }: CleanupPageProps = {}) {
  if ((await getAdminSession()) === null) return null;

  const params = (await searchParams) ?? {};
  const retentionDays = parseRetentionDays(params.days);

  let duplicateUrlGroups: DuplicateUrlGroup[];
  let domainGroups: DomainGroup[];
  let abandoned: AbandonedBookmark[] | null;

  try {
    const report = await getCleanupReport(retentionDays);
    duplicateUrlGroups = report.duplicateUrlGroups;
    domainGroups = report.domainGroups;
    abandoned = report.abandoned;
  } catch (error) {
    // rpc(cleanup_abandoned)가 실패해 getCleanupReport 가 통째로 던졌다 — ③만 포기한다.
    // ①②는 공개 bookmarks 만으로 판정되는 순수 함수라 여기서 되살린다(위 JSDoc "0004 미적용").
    console.warn('[cleanup] 방치 판정 실패 — ①②만 렌더한다(0004 미적용일 수 있음)', error);
    const { bookmarks } = await getAllData();
    duplicateUrlGroups = findDuplicateUrlGroups(bookmarks);
    domainGroups = findDomainGroups(bookmarks);
    abandoned = null;
  }

  return (
    <main>
      <CleanupView
        retentionDays={retentionDays}
        duplicateUrlGroups={duplicateUrlGroups}
        domainGroups={domainGroups}
        abandoned={abandoned}
      />
    </main>
  );
}

/**
 * `?days=` 를 허용 집합(30·90·180·365)의 값으로 좁힌다. 배열(같은 키 중복)·숫자 아님·집합 밖은
 * 전부 기본 180 으로 접는다 — DB 에 붙기 전 걸러 낸다(getCleanupReport 도 다시 검증한다 — M1).
 */
function parseRetentionDays(raw: string | string[] | undefined): RetentionDays {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);

  return isRetentionDays(parsed) ? parsed : DEFAULT_RETENTION_DAYS;
}
