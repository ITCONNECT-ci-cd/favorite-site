/**
 * D4. 내 즐겨찾기 페이지 — `/favorites`.
 *
 * 이 화면의 목록은 **브라우저에만 있는 favs(localStorage)** 로 정해진다. 서버는 전체 북마크를
 * 넘기기만 하고 거르는 일은 클라이언트가 한다 — 그래서 이 테스트는 localStorage 를 먼저 심고
 * 서버 컴포넌트를 그대로 그려, 심은 것만 · 심은 순서대로 나오는지 본다.
 *
 * fixture 는 실제 `docs/data/links.json` 을 B3 의 `buildSeed` 로 돌려 만든다(D1·D2·D3 관례).
 * 카드 내부 DOM(열기 영역이 앵커인지 등)에는 기대지 않는다 — 제목과 접근성 이름만 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FavoritesPage from '@/app/favorites/page';
import { TOAST_DURATION_MS, Toaster } from '@/components/Toast';
import { FAVS_KEY } from '@/lib/constants';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { buildSeed, toBookmarkRow, type RawLink } from '@/scripts/seed-mapper';

const getAllData = vi.hoisted(() => vi.fn());

// 페이지는 서버 컴포넌트라 Supabase 를 직접 부른다. 조회만 갈아 끼우고 나머지는 진짜를 쓴다.
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData,
}));

// jsdom 에서는 import.meta.url 이 파일 URL 이 아니므로 프로젝트 루트(vitest cwd) 기준으로 읽는다.
const RAW: RawLink[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'docs/data/links.json'), 'utf8'),
) as RawLink[];
const SEED = buildSeed(RAW, new Set<number>());
const CATEGORIES: Category[] = SEED.categories;
const BOOKMARKS: BookmarkWithCount[] = SEED.bookmarks.map((bookmark, index) => ({
  ...toBookmarkRow(bookmark),
  click_count: index,
}));

/** 담은 순서 검증용 — sort_order 순서(5 → 40 → 200)와 일부러 다르게 담는다(D2 와 같은 방식). */
const FAV_IDS = [BOOKMARKS[200].id, BOOKMARKS[5].id, BOOKMARKS[40].id];

function setFavs(ids: readonly string[]): void {
  localStorage.setItem(FAVS_KEY, JSON.stringify(ids));
}

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

beforeEach(() => {
  localStorage.clear();
  getAllData.mockReset();
  getAllData.mockResolvedValue({ categories: CATEGORIES, bookmarks: BOOKMARKS } satisfies SiteData);
});

describe('내 즐겨찾기 — 머리말 (DESIGN_SPEC 4장)', () => {
  it('제목·개수·설명을 적는다', async () => {
    setFavs(FAV_IDS);
    await renderPage();

    expect(screen.getByRole('heading', { name: '내 즐겨찾기' })).toBeInTheDocument();
    expect(screen.getByText('3개')).toBeInTheDocument();
    expect(
      screen.getByText('카드의 핀을 눌러 담은 링크입니다 · 이 브라우저에만 저장됩니다'),
    ).toBeInTheDocument();
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

  it('이제 없는 링크 id 가 favs 에 남아 있어도 건너뛴다', async () => {
    setFavs([BOOKMARKS[5].id, '사라진-링크', BOOKMARKS[40].id]);
    const { container } = await renderPage();

    expectCards(container, [BOOKMARKS[5], BOOKMARKS[40]]);
    expect(screen.getByText('2개')).toBeInTheDocument();
  });

  it('카드의 핀이 켜진 채로 보인다 — 여기서 다시 눌러 뺀다', async () => {
    setFavs(FAV_IDS);
    await renderPage();

    const rendered = pins();

    expect(rendered).toHaveLength(3);
    for (const pin of rendered) expect(pin).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('내 즐겨찾기 — 빈 상태 (DESIGN_SPEC 4장)', () => {
  it('하나도 담지 않았으면 즐겨찾기 전용 안내 문구를 보인다', async () => {
    const { container } = await renderPage();

    expect(
      screen.getByText('아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0개')).toBeInTheDocument();
    expect(container.querySelector('.grid')).toBeNull();
    expect(pins()).toHaveLength(0);
  });

  it('링크가 하나도 없는 저장소에서도 같은 안내 문구다', async () => {
    getAllData.mockResolvedValue({ categories: [], bookmarks: [] } satisfies SiteData);
    setFavs(FAV_IDS);

    await renderPage();

    expect(
      screen.getByText('아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.'),
    ).toBeInTheDocument();
  });
});

describe('내 즐겨찾기 — 핀 해제 (D6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // 모듈 레벨 토스트 스토어가 다음 테스트로 새지 않게 자동 소멸까지 흘려보낸다(Toast.tsx 규약).
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    vi.useRealTimers();
  });

  it('핀을 다시 누르면 그 카드가 곧바로 사라진다 — 이 화면은 담긴 것만 그리기 때문이다', async () => {
    setFavs(FAV_IDS);
    const { container } = await renderPage();
    render(<Toaster />);

    // FAV_IDS 순서라 첫 카드는 BOOKMARKS[200] 이다.
    fireEvent.click(pins()[0]);

    expectCards(container, [BOOKMARKS[5], BOOKMARKS[40]]);
    expect(screen.getByText('2개')).toBeInTheDocument();
    expect(screen.getByText(`${BOOKMARKS[200].title} 즐겨찾기 해제`)).toBeInTheDocument();
  });

  it('마지막 하나를 빼면 빈 상태 안내로 바뀐다', async () => {
    setFavs([BOOKMARKS[5].id]);
    const { container } = await renderPage();

    fireEvent.click(pins()[0]);

    expect(container.querySelector('.grid')).toBeNull();
    expect(screen.getByText('0개')).toBeInTheDocument();
    expect(
      screen.getByText('아직 담은 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.'),
    ).toBeInTheDocument();
  });
});

describe('내 즐겨찾기 — 그 밖의 계약', () => {
  it('revalidate 를 내보내지 않는다 — 매 요청 렌더가 의도다 (lib/queries.ts)', async () => {
    const pageModule = await import('@/app/favorites/page');

    expect(pageModule).not.toHaveProperty('revalidate');
  });
});
