/**
 * D4. 매일 사용하는 사이트 목록 — `/daily`.
 *
 * 홈의 '매일' 섹션과 **같은 링크(is_pinned)** 를 보여 주지만 핀 노출 규칙이 다르다.
 * 홈은 관리자 영역이라 핀을 감추고(D2), 이 목록 화면은 핀을 노출한다(PRD P10 "홈 외 모든 화면").
 *
 * fixture 는 실시드 그대로다 (`test/fixtures/seed.ts`) —
 * 고정 12개라는 숫자가 시드와 어긋나면 여기서 먼저 깨진다.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DailyPage, { metadata } from '@/app/(public)/daily/page';
import { getAdminSession } from '@/lib/supabase/server';
import type { BookmarkWithCount, SiteData } from '@/lib/types';
import { adminSession } from '@/test/admin-session';
import { setFavs } from '@/test/favs';
import { BOOKMARKS, siteData } from '@/test/fixtures/seed';
import { PENCIL_PATH } from '@/test/icon-paths';

const getAllData = vi.hoisted(() => vi.fn());

vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData,
}));

// 인증 관문은 H1 의 계약대로 non-null=관리자다(lib/supabase/server.ts). 여기서는 그 결과에 따라
// 화면이 무엇을 그리는지만 본다 — 판정 자체는 그 파일의 테스트가 지킨다.
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

/** getAllData 는 sort_order 순으로 준다(D1) — 걸러 내도 그 순서가 그대로 남아야 한다. */
const PINNED = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);

/** 규칙만 보는 합성 북마크 — 제목이 곧 id 다. */
function makeBookmark(title: string, isPinned: boolean): BookmarkWithCount {
  return {
    id: title,
    category_id: 'top',
    title,
    url: `https://example.com/${title}`,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: isPinned,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    click_count: 0,
  };
}

async function renderPage() {
  return render(await DailyPage());
}

function cards(container: HTMLElement): HTMLElement[] {
  const grid = container.querySelector('.grid');

  return grid === null ? [] : ([...grid.children] as HTMLElement[]);
}

function expectCards(container: HTMLElement, expected: readonly BookmarkWithCount[]): void {
  const rendered = cards(container);

  expect(rendered).toHaveLength(expected.length);
  rendered.forEach((card, index) => {
    expect(card).toHaveTextContent(expected[index].title);
  });
}

const pins = () => screen.queryAllByRole('button', { name: /.+ 즐겨찾기$/ });

beforeEach(() => {
  localStorage.clear();
  getAllData.mockReset();
  getAllData.mockResolvedValue(siteData() satisfies SiteData);
  vi.mocked(getAdminSession).mockReset();
  vi.mocked(getAdminSession).mockResolvedValue(null);
});

describe('매일 사용하는 사이트 — 라우트 metadata (D5)', () => {
  it('화면 이름만 댄다 — 꼬리표(— 내 링크)는 셸의 title template 이 붙인다', () => {
    expect(metadata.title).toBe('매일 사용하는 사이트');
  });
});

describe('매일 사용하는 사이트 — 머리말 (DESIGN_SPEC 4장)', () => {
  it('제목·개수·설명을 적는다 — 실측 12개', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: '매일 사용하는 사이트' })).toBeInTheDocument();
    expect(screen.getByText('12개')).toBeInTheDocument();
    expect(
      screen.getByText('직접 고정한 링크만 모입니다. 순서가 바뀌지 않습니다.'),
    ).toBeInTheDocument();
  });

  it('하위 분류가 없는 화면이라 칩 줄을 만들지 않는다', async () => {
    await renderPage();

    expect(screen.queryByRole('button', { name: /^전체 \d+$/ })).toBeNull();
  });
});

describe('매일 사용하는 사이트 — 목록', () => {
  it('is_pinned 12개만 sort_order 순으로 놓는다', async () => {
    const { container } = await renderPage();

    expect(PINNED).toHaveLength(12);
    expectCards(container, PINNED);
  });

  it('고정하지 않은 링크는 섞이지 않고, 받은 순서를 다시 세우지도 않는다', async () => {
    getAllData.mockResolvedValue({
      categories: [],
      bookmarks: [
        makeBookmark('고정B', true),
        makeBookmark('보통', false),
        makeBookmark('고정A', true),
      ],
    } satisfies SiteData);

    const { container } = await renderPage();

    expect(cards(container)).toHaveLength(2);
    expect(screen.getByText('고정B')).toBeInTheDocument();
    expect(screen.getByText('고정A')).toBeInTheDocument();
    expect(screen.queryByText('보통')).toBeNull();
    // 서버가 준 순서(고정B → 고정A) 그대로다.
    expect(cards(container)[0]).toHaveTextContent('고정B');
  });
});

describe('매일 사용하는 사이트 — 핀 노출 (홈 섹션과 다름)', () => {
  it('카드마다 핀이 보인다 — PRD P10 "홈 외 모든 화면"', async () => {
    await renderPage();

    expect(pins()).toHaveLength(12);
  });

  it('즐겨찾기에 담긴 고정 링크는 핀이 켜져 있다', async () => {
    setFavs([PINNED[1].id]);
    await renderPage();

    expect(screen.getByLabelText(`${PINNED[1].title} 즐겨찾기`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText(`${PINNED[0].title} 즐겨찾기`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('매일 사용하는 사이트 — 그 밖의 계약', () => {
  it('고정한 링크가 하나도 없으면 안내 박스를 보인다', async () => {
    getAllData.mockResolvedValue({
      categories: [],
      bookmarks: [makeBookmark('보통', false)],
    } satisfies SiteData);

    const { container } = await renderPage();

    expect(screen.getByText('이 분류에 링크가 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('0개')).toBeInTheDocument();
    expect(container.querySelector('.grid')).toBeNull();
  });

  it('revalidate 를 내보내지 않는다 — 매 요청 렌더가 의도다 (lib/queries.ts)', async () => {
    const pageModule = await import('@/app/(public)/daily/page');

    expect(pageModule).not.toHaveProperty('revalidate');
  });
});

/**
 * J1. 현장 편집 노출 — 연필·휴지통은 **서버가 관리자로 확인했을 때만** 렌더된다.
 * 비로그인 응답에는 마크업 자체가 없어야 한다(README 주의사항 7).
 */
describe('매일 사용하는 사이트 — 관리자 편집 노출 (J1)', () => {
  it('비로그인 렌더에는 연필·휴지통이 없다 — 아이콘 마크업도 남지 않는다', async () => {
    const { container } = await renderPage();

    expect(screen.queryAllByRole('button', { name: /.+ 수정$/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(0);
    expect(container.innerHTML).not.toContain(PENCIL_PATH);
  });

  it('관리자 세션이면 카드마다 연필·휴지통이 붙는다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    await renderPage();

    expect(screen.queryAllByRole('button', { name: /.+ 수정$/ })).toHaveLength(12);
    expect(screen.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(12);
  });

  it('세션 판정은 getAdminSession 하나로만 한다 — 요청당 한 번', async () => {
    await renderPage();

    expect(getAdminSession).toHaveBeenCalledTimes(1);
  });
});
