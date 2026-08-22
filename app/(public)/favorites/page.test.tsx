/**
 * D4. 내 즐겨찾기 페이지 — `/favorites`.
 *
 * 이 화면의 목록은 **서버가 정한다** (2026-08-11 서버 이전) — 담긴 표시는 `bookmarks.is_favorite`
 * 에, 차례는 `fav_order` 에 있다. 그래서 이 테스트는 조회 응답에 담긴 표시를 심고 서버 컴포넌트를
 * 그대로 그려, 심은 것만 · 심은 차례대로 나오는지 본다.
 *
 * fixture 는 실시드 그대로다 (`test/fixtures/seed.ts`).
 * 카드 내부 DOM(열기 영역이 앵커인지 등)에는 기대지 않는다 — 제목과 접근성 이름만 본다.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FavoritesPage, { metadata } from '@/app/(public)/favorites/page';
import { Toaster } from '@/components/Toast';
import { setFavorite } from '@/lib/mutations';
import { getAdminSession } from '@/lib/supabase/server';
import type { BookmarkWithCount, SiteData } from '@/lib/types';
import { adminSession } from '@/test/admin-session';
import { BOOKMARKS, siteData } from '@/test/fixtures/seed';
import { PENCIL_PATH } from '@/test/icon-paths';
import { setupToastTimers } from '@/test/toast';

const getAllData = vi.hoisted(() => vi.fn());

// 페이지는 서버 컴포넌트라 Supabase 를 직접 부른다. 조회만 갈아 끼우고 나머지는 진짜를 쓴다.
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData,
}));

// 인증 관문(H1)의 결과에 따라 화면이 무엇을 그리는지만 본다 — 판정은 그 파일의 테스트 몫이다.
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

// 핀 클릭이 실제로 나가는 서버 액션 — 무엇을 보내는지만 본다(검사·문구는 lib/mutations.test.ts).
vi.mock('@/lib/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mutations')>()),
  setFavorite: vi.fn(),
}));

/** 담은 순서 검증용 — sort_order 순서(5 → 40 → 200)와 일부러 다르게 담는다(D2 와 같은 방식). */
const FAV_IDS = [BOOKMARKS[200].id, BOOKMARKS[5].id, BOOKMARKS[40].id];

/** 서버 컴포넌트를 그대로 await 해 결과 트리를 그린다. */
async function renderPage() {
  return render(await FavoritesPage());
}

/** 그리드에 놓인 카드들 — 순서 그대로. 없으면 빈 배열. */
function cards(container: HTMLElement): HTMLElement[] {
  const grid = container.querySelector('.grid');

  return grid === null ? [] : ([...grid.children] as HTMLElement[]);
}

/** 어떤 링크가 어떤 순서로 놓였는지. 카드 안쪽 구조에는 기대지 않는다. */
function expectCards(container: HTMLElement, expected: readonly BookmarkWithCount[]): void {
  const rendered = cards(container);

  expect(rendered).toHaveLength(expected.length);
  rendered.forEach((card, index) => {
    expect(card).toHaveTextContent(expected[index].title);
  });
}

const pins = () => screen.queryAllByRole('button', { name: /.+ 즐겨찾기$/ });

/**
 * 담긴 표시를 심은 조회 응답을 세운다 — 받은 차례가 곧 `fav_order` 다.
 * 예전에는 같은 이름의 함수가 localStorage 를 심었다(2026-08-11 서버 이전).
 */
function setFavs(ids: readonly string[]): void {
  const order = new Map(ids.map((id, index) => [id, index] as const));
  const base = siteData();

  getAllData.mockResolvedValue({
    ...base,
    bookmarks: base.bookmarks.map((bookmark) => {
      const favOrder = order.get(bookmark.id);

      return favOrder === undefined
        ? bookmark
        : { ...bookmark, is_favorite: true, fav_order: favOrder };
    }),
  } satisfies SiteData);
}

beforeEach(() => {
  getAllData.mockReset();
  getAllData.mockResolvedValue(siteData() satisfies SiteData);
  vi.mocked(getAdminSession).mockReset();
  vi.mocked(getAdminSession).mockResolvedValue(null);
});

describe('내 즐겨찾기 — 라우트 metadata (D5)', () => {
  it('화면 이름만 댄다 — 꼬리표(— 내 링크)는 셸의 title template 이 붙인다', () => {
    expect(metadata.title).toBe('내 즐겨찾기');
  });
});

describe('내 즐겨찾기 — 머리말 (DESIGN_SPEC 4장)', () => {
  it('제목·개수·설명을 적는다', async () => {
    setFavs(FAV_IDS);
    await renderPage();

    expect(screen.getByRole('heading', { name: '내 즐겨찾기' })).toBeInTheDocument();
    expect(screen.getByText('3개')).toBeInTheDocument();
    expect(screen.getByText('홈에 담아 둔 링크입니다')).toBeInTheDocument();
  });

  it('하위 분류가 없는 화면이라 칩 줄을 만들지 않는다', async () => {
    setFavs(FAV_IDS);
    await renderPage();

    expect(screen.queryByRole('button', { name: /^전체 \d+$/ })).toBeNull();
  });
});

describe('내 즐겨찾기 — favs 반영', () => {
  it('담은 것만 · 담은 순서 그대로 놓는다 (sort_order 로 다시 세우지 않는다 — 홈과 같은 규칙)', async () => {
    setFavs(FAV_IDS);
    const { container } = await renderPage();

    expectCards(container, [BOOKMARKS[200], BOOKMARKS[5], BOOKMARKS[40]]);
  });

  it('담기지 않은 링크는 한 장도 섞이지 않는다', async () => {
    setFavs([BOOKMARKS[5].id, BOOKMARKS[40].id]);
    const { container } = await renderPage();

    expectCards(container, [BOOKMARKS[5], BOOKMARKS[40]]);
    expect(screen.getByText('2개')).toBeInTheDocument();
  });

  it('관리자에게는 카드의 핀이 켜진 채로 보인다 — 여기서 다시 눌러 뺀다', async () => {
    setFavs(FAV_IDS);
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);
    await renderPage();

    const rendered = pins();

    expect(rendered).toHaveLength(3);
    for (const pin of rendered) expect(pin).toHaveAttribute('aria-pressed', 'true');
  });

  it('방문자에게는 핀이 하나도 없다 (2026-08-11 — 담는 일은 관리자 몫)', async () => {
    setFavs(FAV_IDS);
    const { container } = await renderPage();

    expectCards(container, [BOOKMARKS[200], BOOKMARKS[5], BOOKMARKS[40]]);
    expect(pins()).toHaveLength(0);
  });
});

describe('내 즐겨찾기 — 빈 상태 (DESIGN_SPEC 4장)', () => {
  it('방문자에게는 행동을 지시하지 않는 문구를 보인다 — 누를 핀이 없다', async () => {
    const { container } = await renderPage();

    expect(screen.getByText('아직 담긴 즐겨찾기가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText(/핀을 눌러/)).toBeNull();
    expect(screen.getByText('0개')).toBeInTheDocument();
    expect(container.querySelector('.grid')).toBeNull();
    expect(pins()).toHaveLength(0);
  });

  it('링크가 하나도 없는 저장소에서도 같은 안내 문구다', async () => {
    getAllData.mockResolvedValue({ categories: [], bookmarks: [] } satisfies SiteData);

    await renderPage();

    expect(screen.getByText('아직 담긴 즐겨찾기가 없습니다.')).toBeInTheDocument();
  });

  it('관리자에게는 담는 방법을 알려 준다 — 그 사람에게는 핀이 있다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    await renderPage();

    expect(
      screen.getByText('아직 담긴 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.'),
    ).toBeInTheDocument();
  });
});

describe('내 즐겨찾기 — 핀 해제 (D6)', () => {
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(setFavorite).mockReset();
    vi.mocked(setFavorite).mockResolvedValue({ ok: true });
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);
  });

  it('핀을 다시 누르면 서버에 "빼기"를 보낸다', async () => {
    setFavs(FAV_IDS);
    await renderPage();
    render(<Toaster />);

    // FAV_IDS 순서라 첫 카드는 BOOKMARKS[200] 이다.
    await act(async () => {
      fireEvent.click(pins()[0]);
    });

    expect(setFavorite).toHaveBeenCalledWith(BOOKMARKS[200].id, false);
    expect(screen.getByText(`${BOOKMARKS[200].title} 즐겨찾기 해제`)).toBeInTheDocument();
  });

  it('낙관적으로 지우지 않는다 — 목록은 서버가 다시 그릴 때 줄어든다', async () => {
    // 즐겨찾기가 서버로 옮겨간 뒤(2026-08-11) 이 화면도 다른 편집과 같은 취급이다:
    // 액션의 revalidatePath 가 새 목록을 가져온다. 미리 지우면 저장이 실패했을 때
    // 화면에서만 사라진 채로 남는다.
    setFavs(FAV_IDS);
    const { container } = await renderPage();

    await act(async () => {
      fireEvent.click(pins()[0]);
    });

    expectCards(container, [BOOKMARKS[200], BOOKMARKS[5], BOOKMARKS[40]]);
    expect(screen.getByText('3개')).toBeInTheDocument();
  });
});

describe('내 즐겨찾기 — 그 밖의 계약', () => {
  it('revalidate 를 내보내지 않는다 — 매 요청 렌더가 의도다 (lib/queries.ts)', async () => {
    const pageModule = await import('@/app/(public)/favorites/page');

    expect(pageModule).not.toHaveProperty('revalidate');
  });
});

/**
 * J1. 현장 편집 노출 — 서버가 관리자로 확인했을 때만 연필·휴지통이 렌더된다.
 *
 * 이 화면은 서버 → ListView → LinkCard 로 `isAdmin` 이 한 번 더 건너간다.
 * 목록 자체를 서버가 정하므로 담긴 카드에만 아이콘이 붙는다.
 */
describe('내 즐겨찾기 — 관리자 편집 노출 (J1)', () => {
  it('비로그인 렌더에는 연필·휴지통이 없다 — 아이콘 마크업도 남지 않는다', async () => {
    setFavs(FAV_IDS);

    const { container } = await renderPage();

    expect(screen.queryAllByRole('button', { name: /.+ 수정$/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(0);
    expect(container.innerHTML).not.toContain(PENCIL_PATH);
  });

  it('관리자 세션이면 담긴 카드마다 연필·휴지통이 붙는다', async () => {
    setFavs(FAV_IDS);
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    await renderPage();

    expect(screen.queryAllByRole('button', { name: /.+ 수정$/ })).toHaveLength(FAV_IDS.length);
    expect(screen.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(FAV_IDS.length);
  });

  it('세션 판정은 getAdminSession 하나로만 한다 — 요청당 한 번', async () => {
    await renderPage();

    expect(getAdminSession).toHaveBeenCalledTimes(1);
  });

  it('관리자여도 링크 추가 타일은 서지 않는다 — 파생 목록이다 (K1)', async () => {
    // 이 목록은 담긴 표시(`is_favorite`)로 걸러 낸 파생 목록이다. 담는 일은 카드의 핀이 하므로
    // 여기서 만든 링크는 이 화면에 나타나지도 않는다(ListView 의 QuickAdd 계약).
    setFavs(FAV_IDS);
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    const { container } = await renderPage();

    expect(screen.queryByRole('button', { name: '링크 추가' })).toBeNull();
    expect(container.querySelector('[data-testid="quick-add"]')).toBeNull();
  });
});
