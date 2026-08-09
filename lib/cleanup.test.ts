// @vitest-environment node
// 순수 판정 함수(중복·도메인)와 rpc 오케스트레이션만 다룬다 — DOM 이 필요 없다.
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_EMAIL } from '@/lib/admin-config';
import {
  CLEANUP_RETENTION_DAYS,
  findDomainGroups,
  findDuplicateUrlGroups,
  getCleanupReport,
  isRetentionDays,
  type CleanupBookmark,
} from '@/lib/cleanup';
import { createServerSupabaseClient, getAdminSession } from '@/lib/supabase/server';

// 실 DB 왕복은 하지 않는다 — "관리자 게이트 → 무엇을 어떤 인자로 묻는지 → 어떻게 묶는지"만 본다.
// 방치 판정(시간·clicks)의 실제 동작은 0004_cleanup.sql 의 실 DB 실측이 맡는다(파일 상단 주석).
vi.mock('@/lib/supabase/server', () => ({
  getAdminSession: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

// `process.cwd()` 가 아니라 이 파일 기준으로 읽는다 — Windows 에서 cwd 드라이브 문자 대소문자가
// 실행 방식마다 달라지는 이력이 있다(mutations.test.ts 와 같은 이유).
const cleanupSql = readFileSync(new URL('../supabase/migrations/0004_cleanup.sql', import.meta.url), 'utf8');

type QueryResult = { data: unknown; error: unknown };

/**
 * 최소 supabase 대역. `getCleanupReport` 은 `from('bookmarks').select(...)` 한 번과
 * `rpc('cleanup_abandoned', ...)` 한 번만 부른다 — 그 두 호출만 기록·응답한다.
 */
function fakeClient(bookmarks: QueryResult, abandoned: QueryResult) {
  const calls = { from: [] as string[], select: [] as string[], rpc: [] as { name: string; params: unknown }[] };

  const client = {
    from(table: string) {
      calls.from.push(table);

      return {
        select: (columns: string) => {
          calls.select.push(columns);

          return Promise.resolve(bookmarks);
        },
      };
    },
    rpc(name: string, params: unknown) {
      calls.rpc.push({ name, params });

      return Promise.resolve(abandoned);
    },
  };

  return { client, calls };
}

function signedIn(bookmarks: QueryResult, abandoned: QueryResult = { data: [], error: null }) {
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'admin-1', email: ADMIN_EMAIL });
  const fake = fakeClient(bookmarks, abandoned);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

  return fake;
}

/** 판정 함수에 넘길 최소 북마크 한 건. */
function bm(over: Partial<CleanupBookmark> & { id: string; url: string }): CleanupBookmark {
  return {
    category_id: 'cat-1',
    title: over.url,
    created_at: '2026-01-01T00:00:00+00:00',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────── 완전 동일 URL 중복

describe('findDuplicateUrlGroups — 완전 동일 URL 만 묶는다', () => {
  it('같은 URL 이 둘이면 한 그룹으로 묶는다', () => {
    const groups = findDuplicateUrlGroups([
      bm({ id: 'a', url: 'https://example.com/x' }),
      bm({ id: 'b', url: 'https://example.com/x' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].url).toBe('https://example.com/x');
    expect(groups[0].bookmarks.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('URL 이 서로 다르면 아무 그룹도 없다 (혼자인 URL 은 중복이 아니다)', () => {
    expect(
      findDuplicateUrlGroups([
        bm({ id: 'a', url: 'https://example.com/x' }),
        bm({ id: 'b', url: 'https://example.com/y' }),
      ]),
    ).toEqual([]);
  });

  it('완전 동일만 본다 — 끝의 슬래시가 다르면 다른 URL 이다 (정규화하지 않는다)', () => {
    expect(
      findDuplicateUrlGroups([
        bm({ id: 'a', url: 'https://example.com/x' }),
        bm({ id: 'b', url: 'https://example.com/x/' }),
      ]),
    ).toEqual([]);
  });

  it('그룹 안은 등록순(created_at 오름차순), 그룹은 중복 많은 순으로 정렬한다', () => {
    const groups = findDuplicateUrlGroups([
      bm({ id: 'a2', url: 'https://a.com', created_at: '2026-02-02T00:00:00+00:00' }),
      bm({ id: 'a1', url: 'https://a.com', created_at: '2026-01-01T00:00:00+00:00' }),
      bm({ id: 'b1', url: 'https://b.com', created_at: '2026-01-01T00:00:00+00:00' }),
      bm({ id: 'b2', url: 'https://b.com', created_at: '2026-01-02T00:00:00+00:00' }),
      bm({ id: 'b3', url: 'https://b.com', created_at: '2026-01-03T00:00:00+00:00' }),
    ]);

    expect(groups.map((g) => g.url)).toEqual(['https://b.com', 'https://a.com']); // 3건 먼저
    expect(groups[1].bookmarks.map((b) => b.id)).toEqual(['a1', 'a2']); // 오래된 것 먼저
  });
});

// ───────────────────────────────────────────────────────── 같은 도메인·다른 페이지

describe('findDomainGroups — 같은 host·다른 페이지 (정리 대상 아님, 참고용)', () => {
  it('같은 host 의 서로 다른 페이지는 묶는다', () => {
    const groups = findDomainGroups([
      bm({ id: 'a', url: 'https://example.com/x' }),
      bm({ id: 'b', url: 'https://example.com/y' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].host).toBe('example.com');
    expect(groups[0].bookmarks.map((b) => b.id).sort()).toEqual(['a', 'b']);
  });

  it('www 유무는 hostOf 로 같은 host 가 된다', () => {
    const groups = findDomainGroups([
      bm({ id: 'a', url: 'https://www.example.com/x' }),
      bm({ id: 'b', url: 'https://example.com/y' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].host).toBe('example.com');
  });

  it('host 는 같은데 URL 이 완전 동일하기만 하면 도메인 그룹이 아니다 — 그건 중복이다', () => {
    // 같은 host·"다른 페이지" 가 2개 이상일 때만 도메인 그룹이다(중복 판정과 겹치지 않게).
    expect(
      findDomainGroups([
        bm({ id: 'a', url: 'https://example.com/x' }),
        bm({ id: 'b', url: 'https://example.com/x' }),
      ]),
    ).toEqual([]);
  });

  it('host 가 다르면 묶지 않는다', () => {
    expect(
      findDomainGroups([
        bm({ id: 'a', url: 'https://a.com/x' }),
        bm({ id: 'b', url: 'https://b.com/y' }),
      ]),
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────── 기준일 파라미터

describe('CLEANUP_RETENTION_DAYS · isRetentionDays', () => {
  it('허용 기준일은 30·90·180·365 이다', () => {
    expect(CLEANUP_RETENTION_DAYS).toEqual([30, 90, 180, 365]);
  });

  it('허용 값만 통과시킨다', () => {
    expect(isRetentionDays(90)).toBe(true);
    expect(isRetentionDays(45)).toBe(false);
    expect(isRetentionDays('90')).toBe(false);
    expect(isRetentionDays(null)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────── 관리자 게이트 · 오케스트레이션

describe('getCleanupReport — 관리자 게이트와 rpc 계약', () => {
  it('비관리자면 DB 에 붙지도 않고 거부한다 (1차 방어)', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);

    await expect(getCleanupReport(90)).rejects.toThrow();
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it('허용되지 않은 기준일은 DB 에 붙기 전에 거부한다', async () => {
    signedIn({ data: [], error: null });

    await expect(getCleanupReport(45 as never)).rejects.toThrow();
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it('rpc 를 cleanup_abandoned(retention_days) 로 부르고, 방치 목록을 그대로 싣는다', async () => {
    const abandonedRow = {
      id: 'old-1',
      category_id: 'cat-1',
      title: '안 쓰는 링크',
      url: 'https://old.example.com',
      created_at: '2025-01-01T00:00:00+00:00',
      last_clicked_at: null,
    };
    const fake = signedIn({ data: [], error: null }, { data: [abandonedRow], error: null });

    const report = await getCleanupReport(180);

    expect(fake.calls.rpc).toEqual([{ name: 'cleanup_abandoned', params: { retention_days: 180 } }]);
    expect(report.retentionDays).toBe(180);
    expect(report.abandoned).toEqual([abandonedRow]);
  });

  it('중복·도메인 그룹은 읽어 온 북마크에서 계산한다', async () => {
    const bookmarks = [
      { id: 'a', category_id: 'c', title: 't', url: 'https://dup.com', created_at: '2026-01-01T00:00:00+00:00' },
      { id: 'b', category_id: 'c', title: 't', url: 'https://dup.com', created_at: '2026-01-02T00:00:00+00:00' },
      { id: 'c', category_id: 'c', title: 't', url: 'https://dom.com/1', created_at: '2026-01-01T00:00:00+00:00' },
      { id: 'd', category_id: 'c', title: 't', url: 'https://dom.com/2', created_at: '2026-01-02T00:00:00+00:00' },
    ];
    signedIn({ data: bookmarks, error: null });

    const report = await getCleanupReport(30);

    expect(report.duplicateUrlGroups.map((g) => g.url)).toEqual(['https://dup.com']);
    expect(report.domainGroups.map((g) => g.host)).toEqual(['dom.com']);
  });

  it('북마크 조회가 실패하면 던진다 (빈 화면으로 조용히 넘어가지 않는다)', async () => {
    signedIn({ data: null, error: { message: 'boom', code: '08006' } });

    await expect(getCleanupReport(90)).rejects.toThrow();
  });

  it('rpc 가 실패하면 던진다', async () => {
    signedIn({ data: [], error: null }, { data: null, error: { message: 'denied', code: '42501' } });

    await expect(getCleanupReport(90)).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────── 0004_cleanup.sql 계약

describe('0004_cleanup.sql — clicks 를 definer 로 읽으니 관리자만, bulk 는 사용으로 센다', () => {
  it('security definer + search_path 고정 (definer 함수의 기본 방어, pg_temp 를 끝에 둔다)', () => {
    expect(cleanupSql).toMatch(/security\s+definer/i);
    // pg_temp 를 맨 끝에 둬 temp table shadowing 을 막는다(0003 과 같은 규약).
    expect(cleanupSql).toMatch(/search_path\s*=\s*public\s*,\s*pg_temp/i);
  });

  it('본문에서 관리자 이메일을 확인한다 (2차 방어 — 앱 게이트와 같은 판정)', () => {
    expect(cleanupSql).toMatch(/auth\.jwt\(\)/);
    expect(cleanupSql.toLowerCase()).toContain(`'${ADMIN_EMAIL.toLowerCase()}'`);
  });

  it('실행 권한은 authenticated 에게만 — anon·public 은 회수한다', () => {
    expect(cleanupSql).toMatch(/grant\s+execute[\s\S]*?to\s+authenticated/i);
    expect(cleanupSql).toMatch(/revoke\s+execute[\s\S]*?from\s+anon/i);
    expect(cleanupSql).toMatch(/revoke\s+execute[\s\S]*?from\s+public/i);
  });

  it('고정은 제외한다', () => {
    expect(cleanupSql).toMatch(/is_pinned\s*=\s*false/i);
  });

  it('등록 경과와 최근 클릭 창에 같은 기준일(retention_days)을 쓴다', () => {
    expect(cleanupSql).toContain('created_at');
    // 등록 창 + 클릭 창 두 곳에서 같은 기준일 간격을 만든다.
    expect((cleanupSql.match(/make_interval/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('retention_days 는 정확 집합(30·90·180·365)만 허용하고 null 도 막는다 (앱 화이트리스트 이중화)', () => {
    // 값 집합은 lib/cleanup.ts 의 CLEANUP_RETENTION_DAYS 와 같아야 한다 — REST 직접 호출 방어.
    const set = CLEANUP_RETENTION_DAYS.join('\\s*,\\s*');
    expect(cleanupSql).toMatch(new RegExp(`retention_days\\s+not\\s+in\\s*\\(\\s*${set}\\s*\\)`, 'i'));
    // null 은 `not in` 이 걸러 주지 못하므로(널 비교) 따로 막아야 한다.
    expect(cleanupSql).toMatch(/retention_days\s+is\s+null/i);
  });

  it('방치는 실사용 기준이라 bulk 클릭도 사용으로 센다 — clicks 에 is_bulk 필터가 없다', () => {
    // is_bulk 로 거르는 순간 "bulk 는 사용이 아님" 이 되어 판단 근거가 뒤집힌다.
    expect(cleanupSql).not.toMatch(/is_bulk/);
  });
});
