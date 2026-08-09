import 'server-only';

/**
 * M1. 정리 판정 — 관리 화면(M2)이 "지워도 되는 링크"를 고르도록 세 가지를 판정한다.
 *
 *   ① 완전 동일 URL 중복  — 같은 url 이 둘 이상. **정리 대상**(하나만 남기고 지운다).
 *   ② 같은 도메인·다른 페이지 그룹 — 같은 host 의 서로 다른 페이지. **정리 대상 아님**(참고용).
 *                                     중복(①)과 헷갈리지 않게 따로 보여 준다.
 *   ③ 방치 — 최근 N일 클릭 0 · 등록 N일 경과 · 고정 제외. **정리 후보**.
 *
 * ①·② 는 bookmarks(공개)만 보면 되고 host 추출이 `lib/url.ts` 의 `hostOf` 규칙과 같아야 해서
 * 여기 순수 함수로 판정한다. ③ 은 clicks(비공개)를 읽어야 해서 DB 함수(`cleanup_abandoned`)에
 * 맡긴다 — `supabase/migrations/0004_cleanup.sql` 참조.
 *
 * ## 관리자 전용 — 두 겹의 방어
 *
 * 이 리포트는 clicks 를 읽으므로 익명·비관리자에게 나가면 안 된다.
 *   1차 — `getCleanupReport` 이 `getAdminSession()` 으로 관리자 세션을 먼저 확인한다(아래).
 *   2차 — `cleanup_abandoned()` 가 security definer + JWT 이메일 확인으로 다시 막는다(SQL).
 * 앱을 우회한 REST rpc 는 1차를 지나지 않으므로 2차가 필요하다 — 서로를 대체하지 못한다.
 *
 * 읽기 클라이언트는 `mutations.ts` 와 같은 이유로 **service role 이 아니라** 로그인 관리자의
 * anon+쿠키 클라이언트다(`createServerSupabaseClient`). rpc 는 그 자격으로 나가 2차 방어를 실제로
 * 통과한다 — service role 로 부르면 이메일 확인이 무의미해진다.
 */

import { createServerSupabaseClient, getAdminSession } from '@/lib/supabase/server';
import type { Bookmark } from '@/lib/types';
import { hostOf } from '@/lib/url';

/** 화면이 고를 수 있는 기준일(일). 계획서 M1 절: 30·90·180·365. */
export const CLEANUP_RETENTION_DAYS = [30, 90, 180, 365] as const;
export type RetentionDays = (typeof CLEANUP_RETENTION_DAYS)[number];

/**
 * 판정 결과가 담는 북마크의 최소 모양 — `Bookmark`(lib/types.ts)의 부분집합이다.
 * M2 가 카드로 그릴 수 있게 title·url·소속 카테고리·등록일을 함께 싣는다.
 */
export type CleanupBookmark = Pick<Bookmark, 'id' | 'category_id' | 'title' | 'url' | 'created_at'>;

/** ① 완전 동일 URL 중복 그룹. `bookmarks` 는 2건 이상(등록순). */
export type DuplicateUrlGroup = { url: string; bookmarks: CleanupBookmark[] };

/** ② 같은 host·다른 페이지 그룹(참고용, 정리 대상 아님). `bookmarks` 는 서로 다른 페이지 2건 이상. */
export type DomainGroup = { host: string; bookmarks: CleanupBookmark[] };

/** ③ 방치 후보. `last_clicked_at` 은 최근 사용 시점(null 이면 한 번도 안 씀). */
export type AbandonedBookmark = CleanupBookmark & { last_clicked_at: string | null };

/** M2 가 한 번에 받는 정리 리포트. */
export type CleanupReport = {
  retentionDays: RetentionDays;
  duplicateUrlGroups: DuplicateUrlGroup[];
  domainGroups: DomainGroup[];
  abandoned: AbandonedBookmark[];
};

/** cleanup 판정이 bookmarks 에서 읽는 컬럼 — `CleanupBookmark` 와 1:1. */
const CLEANUP_BOOKMARK_COLUMNS = 'id, category_id, title, url, created_at';

/** 화면이 넘긴 기준일이 허용 집합(30·90·180·365)에 드는지. */
export function isRetentionDays(value: unknown): value is RetentionDays {
  return typeof value === 'number' && (CLEANUP_RETENTION_DAYS as readonly number[]).includes(value);
}

/**
 * ① 완전 동일 URL 중복. **정규화하지 않는다** — 끝의 `/` 하나만 달라도 다른 URL 로 본다
 * (계획서 "완전 동일 URL"). `createBookmark` 도 주소를 정규화하지 않고 저장하므로 문자열 동일성이 곧 판정이다.
 *
 * 그룹은 중복이 많은 순(같으면 url 순), 그룹 안은 등록순(같으면 id 순)으로 정렬한다 —
 * M2 표가 매번 같은 순서로 그려지도록 결정적이어야 한다.
 */
export function findDuplicateUrlGroups(bookmarks: readonly CleanupBookmark[]): DuplicateUrlGroup[] {
  const byUrl = groupBy(bookmarks, (bookmark) => bookmark.url);

  const groups: DuplicateUrlGroup[] = [];
  for (const [url, list] of byUrl) {
    if (list.length < 2) continue; // 혼자인 URL 은 중복이 아니다
    groups.push({ url, bookmarks: [...list].sort(byCreatedThenId) });
  }

  return groups.sort(bySizeDescThenKey((group) => group.url));
}

/**
 * ② 같은 host·다른 페이지 그룹. host 는 `hostOf`(www 제거·주소 아니면 입력 그대로)로 뽑는다 —
 * 카드 하단 줄과 같은 규칙이라 화면과 판정이 어긋나지 않는다.
 *
 * **서로 다른 페이지가 2건 이상일 때만** 그룹이다(같은 URL 만 여럿이면 그건 ①의 몫이라 여기서 뺀다).
 * 그래서 두 판정이 겹치지 않고, "정리 대상 아님(다른 페이지)" 과 "정리 대상(완전 중복)" 을 나눠 볼 수 있다.
 *
 * 다만 완전히 배타적이지는 않다: 한 host 가 완전중복 URL 과 다른 페이지를 둘 다 가지면 그 중복
 * 북마크는 ①과 ②에 모두 등장한다(distinctUrls≥2 는 "중복뿐인 host" 만 제외한다) — 소비자(M2)는
 * 한 북마크가 두 구역에 함께 나타나는 것을 견뎌야 한다.
 */
export function findDomainGroups(bookmarks: readonly CleanupBookmark[]): DomainGroup[] {
  const byHost = groupBy(bookmarks, (bookmark) => hostOf(bookmark.url));

  const groups: DomainGroup[] = [];
  for (const [host, list] of byHost) {
    const distinctUrls = new Set(list.map((bookmark) => bookmark.url));
    if (distinctUrls.size < 2) continue; // 다른 페이지가 없으면(=완전 중복뿐) 도메인 그룹이 아니다
    groups.push({ host, bookmarks: [...list].sort(byUrlThenCreatedThenId) });
  }

  return groups.sort(bySizeDescThenKey((group) => group.host));
}

/**
 * M2 가 한 번에 받는 정리 리포트를 만든다.
 *
 * 1차 방어(관리자 게이트)를 먼저 지나고, bookmarks 읽기와 방치 rpc 를 함께 던진다.
 * 실패는 삼키지 않고 던진다 — 빈 리포트로 조용히 넘어가면 "정리할 게 없다"와 "판정이 실패했다"를
 * 구분할 수 없다(`lib/queries.ts` 의 `unwrap` 과 같은 방침).
 *
 * @param retentionDays 30·90·180·365 중 하나. 그 밖의 값은 DB 에 붙기 전에 던진다.
 */
export async function getCleanupReport(retentionDays: RetentionDays): Promise<CleanupReport> {
  // 1차 방어: 관리자가 아니면 DB 에 붙지도 않는다. fail-closed — 모르는 상태는 거부다.
  const session = await getAdminSession();
  if (session === null) throw new Error('정리 판정은 관리자 전용입니다.');

  if (!isRetentionDays(retentionDays)) {
    throw new Error(`정리 기준일은 ${CLEANUP_RETENTION_DAYS.join('·')} 중 하나여야 합니다.`);
  }

  const supabase = await createServerSupabaseClient();

  const [bookmarksResult, abandonedResult] = await Promise.all([
    supabase.from('bookmarks').select(CLEANUP_BOOKMARK_COLUMNS),
    supabase.rpc('cleanup_abandoned', { retention_days: retentionDays }),
  ]);

  const bookmarks = unwrap<CleanupBookmark>('bookmarks', bookmarksResult);
  const abandoned = unwrap<AbandonedBookmark>('cleanup_abandoned', abandonedResult);

  return {
    retentionDays,
    duplicateUrlGroups: findDuplicateUrlGroups(bookmarks),
    domainGroups: findDomainGroups(bookmarks),
    abandoned,
  };
}

// ───────────────────────────────────────────────────────── 내부 helpers

/** PostgREST 응답의 실패 부분 — `message` 만으로는 갈리지 않아 진단 필드를 함께 받는다. */
type QueryError = { message: string; code?: string; details?: string | null; hint?: string | null };

/**
 * Supabase/rpc 응답에서 행 배열만 꺼낸다. 실패는 던진다(진단은 메시지에 싣고 원본은 `cause` 로).
 * `lib/queries.ts` 의 unwrap 과 같은 형태지만 그 파일은 이 스토리에서 손대지 않으므로 여기 따로 둔다.
 */
function unwrap<T>(source: string, result: { data: unknown; error: QueryError | null }): T[] {
  const { error } = result;

  if (error !== null) {
    const diagnostics: string[] = [];
    if (error.code) diagnostics.push(`code ${error.code}`);
    if (error.details) diagnostics.push(error.details);
    if (error.hint) diagnostics.push(`hint: ${error.hint}`);
    const suffix = diagnostics.length > 0 ? ` (${diagnostics.join(' · ')})` : '';

    throw new Error(`Supabase ${source} 조회 실패: ${error.message}${suffix}`, { cause: error });
  }

  return (result.data ?? []) as T[];
}

/** 키별로 묶는다. Map 은 삽입순을 지키지만 결과 정렬은 호출부가 결정적으로 다시 한다. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }

  return map;
}

/** 등록순(created_at) → id 순. created_at 은 같은 소스의 ISO 8601 이라 문자열 비교가 시간순과 같다. */
function byCreatedThenId(a: CleanupBookmark, b: CleanupBookmark): number {
  return compare(a.created_at, b.created_at) || compare(a.id, b.id);
}

/** url 순 → 등록순 → id 순. 도메인 그룹 안에서 "어떤 페이지들인지" 가 먼저 보이도록 url 을 앞세운다. */
function byUrlThenCreatedThenId(a: CleanupBookmark, b: CleanupBookmark): number {
  return compare(a.url, b.url) || byCreatedThenId(a, b);
}

/** 그룹은 큰 것 먼저(같으면 키 오름차순). */
function bySizeDescThenKey<T extends { bookmarks: readonly unknown[] }>(keyOf: (group: T) => string) {
  return (a: T, b: T): number => b.bookmarks.length - a.bookmarks.length || compare(keyOf(a), keyOf(b));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
