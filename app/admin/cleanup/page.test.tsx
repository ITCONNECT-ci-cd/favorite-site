import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CleanupPage, { metadata } from '@/app/admin/cleanup/page';
import { getCleanupReport, type CleanupBookmark, type CleanupReport } from '@/lib/cleanup';
import { getAllData } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';
import type { BookmarkWithCount } from '@/lib/types';

/**
 * M2 — 정리 도구 페이지. 화면(CleanupView)의 표시는 CleanupView.test 가 본다. 여기서는
 * 페이지의 몫만 본다: 미인증 게이트, `?days=` 해석, 그리고 **0004 미적용 분기** —
 * getCleanupReport 가 통째로 throw 하면 ①②는 공개 bookmarks 로 되살리고 ③만 안내로 접는지.
 */

/** getCleanupReport 만 대역으로 바꾼다 — 순수 판정 함수(find*, isRetentionDays)는 진짜를 쓴다. */
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData: vi.fn(),
}));
vi.mock('@/lib/cleanup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cleanup')>()),
  getCleanupReport: vi.fn(),
}));

function cb(id: string, url: string, title: string): CleanupBookmark {
  return { id, category_id: null, title, url, created_at: '2024-01-01T00:00:00.000Z' };
}

/** getAllData 가 돌려주는 공개 북마크(BookmarkWithCount). ①② 되살리기 분기에서 쓴다. */
function bm(id: string, url: string): BookmarkWithCount {
  return {
    id,
    category_id: null,
    title: id,
    url,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    click_count: 0,
  };
}

/** rpc 까지 성공한 정상 리포트(세 구역 모두 내용 있음). */
const REPORT: CleanupReport = {
  retentionDays: 180,
  duplicateUrlGroups: [
    {
      url: 'https://dup.test/a',
      bookmarks: [cb('d1', 'https://dup.test/a', '중복 하나'), cb('d2', 'https://dup.test/a', '중복 둘')],
    },
  ],
  domainGroups: [
    {
      host: 'labs.google',
      bookmarks: [cb('g1', 'https://labs.google/a', 'A'), cb('g2', 'https://labs.google/b', 'B')],
    },
  ],
  abandoned: [{ ...cb('s1', 'https://stale.test/1', '방치 하나'), last_clicked_at: null }],
};

const renderPage = async (searchParams: Record<string, string | string[] | undefined> = {}) =>
  render((await CleanupPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement);

const staleRegion = () => screen.getByRole('region', { name: '오래 손대지 않은 링크' });
const dupRegion = () => screen.getByRole('region', { name: '같은 주소를 두 번 등록' });
const domainRegion = () => screen.getByRole('region', { name: '같은 도메인 · 서로 다른 페이지' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'admin@example.com' });
  vi.mocked(getCleanupReport).mockResolvedValue(REPORT);
});

describe('AdminCleanupPage — 제목·미인증', () => {
  it('탭 제목을 자기 것으로 단다 (레이아웃 것을 고치지 않는다)', () => {
    expect(metadata.title).toBe('정리 도구');
  });

  it('미인증이면 아무것도 그리지 않는다 — getCleanupReport 에 닿지도 않는다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);

    expect(await CleanupPage({ searchParams: Promise.resolve({}) })).toBeNull();
    expect(getCleanupReport).not.toHaveBeenCalled();
  });

  it('랜드마크 <main> 은 하나다 (셸/화면 계약)', async () => {
    const { container } = await renderPage();

    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});

describe('AdminCleanupPage — 기준일(?days=) 해석', () => {
  it('없으면 기본 180일로 묻고, 180일 탭이 선택된다', async () => {
    await renderPage();

    expect(getCleanupReport).toHaveBeenCalledWith(180);
    expect(within(staleRegion()).getByRole('link', { name: '180일' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('허용 값이면 그 값으로 묻고 그 탭이 선택된다', async () => {
    await renderPage({ days: '90' });

    expect(getCleanupReport).toHaveBeenCalledWith(90);
    expect(within(staleRegion()).getByRole('link', { name: '90일' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('허용 밖(숫자 아님·집합 밖)이면 기본 180일로 접는다', async () => {
    await renderPage({ days: 'abc' });
    expect(getCleanupReport).toHaveBeenLastCalledWith(180);

    vi.clearAllMocks();
    vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'a@b.c' });
    vi.mocked(getCleanupReport).mockResolvedValue(REPORT);

    await renderPage({ days: '45' });
    expect(getCleanupReport).toHaveBeenLastCalledWith(180);
  });

  it('같은 키가 배열로 오면 첫 값을 쓴다', async () => {
    await renderPage({ days: ['90', '30'] });

    expect(getCleanupReport).toHaveBeenCalledWith(90);
  });
});

describe('AdminCleanupPage — 정상(rpc 성공)', () => {
  it('세 구역을 M1 리포트 그대로 그린다', async () => {
    await renderPage();

    expect(within(dupRegion()).getByText('dup.test')).toBeInTheDocument();
    expect(within(domainRegion()).getByText('labs.google')).toBeInTheDocument();
    expect(within(staleRegion()).getByText('방치 하나')).toBeInTheDocument();
    // ③ 안내(집계 불가)는 나오지 않는다 — 데이터가 있다.
    expect(screen.queryByText(/아직 집계할 수 없습니다/)).not.toBeInTheDocument();
    // rpc 가 성공했으므로 폴백 조회는 하지 않는다.
    expect(getAllData).not.toHaveBeenCalled();
  });
});

describe('AdminCleanupPage — 0004 미적용(rpc 실패) 분기', () => {
  beforeEach(() => {
    // getCleanupReport 는 rpc 실패로 통째 throw 한다(M1 보고: PGRST202).
    vi.mocked(getCleanupReport).mockRejectedValue(new Error('cleanup_abandoned 없음(PGRST202)'));
    vi.mocked(getAllData).mockResolvedValue({
      categories: [],
      bookmarks: [
        bm('a', 'https://dup.test/a'),
        bm('b', 'https://dup.test/a'), // 완전 동일 URL → ①
        bm('c', 'https://github.com/x'),
        bm('d', 'https://github.com/y'), // 같은 host·다른 페이지 → ②
      ],
    });
  });

  it('①②는 공개 bookmarks 로 되살리고 ③만 "집계 불가"로 접는다', async () => {
    await renderPage();

    // ①② 는 순수 판정 함수로 그대로 뜬다.
    expect(within(dupRegion()).getByText('dup.test')).toBeInTheDocument();
    expect(within(domainRegion()).getByText('github.com')).toBeInTheDocument();
    // ③ 만 안내로 접힌다.
    expect(within(staleRegion()).getByText(/아직 집계할 수 없습니다/)).toBeInTheDocument();
    expect(within(staleRegion()).queryByRole('listitem')).not.toBeInTheDocument();
    // 폴백 경로에서만 공개 데이터를 읽는다.
    expect(getAllData).toHaveBeenCalledTimes(1);
  });
});
