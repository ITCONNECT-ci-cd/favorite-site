/** D2. 홈 화면 — DESIGN_SPEC 3장(섹션 3개). */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeView } from '@/components/HomeView';
import { Toaster } from '@/components/Toast';
import { recordClick } from '@/lib/clicks';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import {
  deleteBookmark,
  reorderBookmarks,
  reorderFavorites,
  setFavorite,
  updateBookmark,
} from '@/lib/mutations';
import { rollupCounts } from '@/lib/queries';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { middleClick } from '@/test/events';
import { BOOKMARKS, CATEGORIES, siteData } from '@/test/fixtures/seed';
import { openedTab, openedTabs, setupWindowOpen } from '@/test/open';
import { pendingResult } from '@/test/pending';
import { setupToastTimers } from '@/test/toast';

/**
 * 클릭 기록은 네트워크를 타므로 여기서는 부르는지만 본다 — 요청의 모양(keepalive·visitorId·
 * 실패를 삼키는 것)은 `lib/clicks.test.ts` 가 못박는다. 문구 함수(`openToastText`)는 진짜를 쓴다.
 */
vi.mock('@/lib/clicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clicks')>()),
  recordClick: vi.fn(),
}));

/**
 * 쓰기 서버 액션(J2 인라인 편집 · J3 삭제)도 갈아 끼운다 — 무엇을 검사하고 어떤 문구를 돌려주는지는
 * `lib/mutations.test.ts` 몫이고, 여기서는 화면이 어느 링크에 무엇을 보내는지만 본다.
 *
 * 위 `@/lib/clicks` 와 같은 **덮어쓰기** 형태다(원본을 펼치고 필요한 것만 vi.fn 으로 바꾼다).
 * 목록을 손으로 적으면 이 화면이 새 액션을 쓰기 시작하는 순간 그 export 가 통째로 사라져,
 * 화면 코드가 아니라 모킹 때문에 테스트가 깨진다.
 */
vi.mock('@/lib/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mutations')>()),
  updateBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  reorderBookmarks: vi.fn(),
  setFavorite: vi.fn(),
  reorderFavorites: vi.fn(),
}));

/**
 * fixture 는 실시드 그대로다 (`test/fixtures/seed.ts`) — 화면에 적히는 실측치
 * (운영 중 16)가 시드와 어긋나면 여기서 먼저 깨진다.
 */
const DATA: SiteData = siteData();

const OPERATING_ID = CATEGORIES.find(
  (category) => category.parent_id === null && category.name === OPERATING_CATEGORY_NAME,
)!.id;

/**
 * 즐겨찾기 순서 검증용 — sort_order 순서(2 → 5 → 40)와 일부러 다르게 담는다.
 *
 * 셋 다 'AI 도구 모음' 소속이라 **한 묶음('AI 서비스')에 모인다** — 카드 배선을 보는 테스트가
 * 묶음 하나만 들여다보면 되게 하려는 것이다. 나누는 것 자체는 아래 `MIXED_FAV_IDS` 가 본다.
 */
const FAV_IDS = [BOOKMARKS[40].id, BOOKMARKS[2].id, BOOKMARKS[5].id];

/** 두 묶음에 걸치는 집합 — 'UI/UX 디자인'(→ 업무용 서비스) 하나와 'AI 도구 모음' 둘. */
const MIXED_FAV_IDS = [BOOKMARKS[200].id, BOOKMARKS[5].id, BOOKMARKS[40].id];

const section = (name: string) => screen.getByRole('region', { name });

/** 섹션 본문 — 헤더 다음에 오는 카드 그리드(또는 빈 상태 박스). */
const body = (name: string) => section(name).lastElementChild as HTMLElement;

/**
 * 섹션 안 **카드들** — 그리드에 놓인 순서 그대로.
 *
 * 관리자에게만 서는 '+ 링크 추가' 타일(K1)은 격자 첫 칸을 차지하지만 카드가 아니므로 뺀다.
 * 빼지 않으면 `cards(...)[n]` 이 관리자 화면에서만 한 칸씩 밀려 엉뚱한 카드를 가리킨다.
 */
const cards = (name: string) =>
  [...body(name).children].filter(
    (cell) => cell.getAttribute('data-testid') !== 'quick-add',
  ) as HTMLElement[];

/** 섹션의 '+ 링크 추가' 타일 — 없으면 null (K1). */
const quickAddTile = (name: string) =>
  within(section(name)).queryByRole('button', { name: '링크 추가' });

/**
 * 섹션이 어떤 링크를 어떤 순서로 놓았는지 확인한다.
 * 카드 내부 구조(C2 LinkCard)에는 기대지 않는다 — 자리마다 그 링크의 제목이 보이면 된다.
 */
function expectCards(name: string, expected: readonly BookmarkWithCount[]): void {
  const rendered = cards(name);

  expect(rendered).toHaveLength(expected.length);
  rendered.forEach((card, index) => {
    expect(card).toHaveTextContent(expected[index].title);
  });
}

/** 섹션 안 카드의 핀 버튼 — 없으면 빈 배열. */
const pins = (name: string) =>
  within(section(name)).queryAllByRole('button', { name: /.+ 즐겨찾기$/ });

/**
 * 섹션의 n 번째 카드에서 링크를 여는 영역. 카드에는 앵커가 둘이지만 파비콘 타일은 aria-hidden
 * 이라 접근성 트리에 없어서 본문 앵커 하나만 잡힌다(C2).
 */
const openLink = (name: string, index = 0) => within(cards(name)[index]).getByRole('link');

/**
 * 이 테스트가 '담긴 것'으로 삼을 id 들 — 아래 `data()` 가 이 값을 반영한 SiteData 를 만든다.
 *
 * 예전에는 같은 이름의 함수가 localStorage 를 심었다. 2026-08-11 에 즐겨찾기가 DB 로 옮겨오면서
 * 담긴 표시는 **서버가 준 행**에 실려 오므로, 이제 심는 자리는 화면에 넘기는 데이터다.
 */
let favIds: readonly string[] = [];

function setFavs(ids: readonly string[]): void {
  favIds = ids;
}

/** `setFavs` 로 정한 차례를 `is_favorite`·`fav_order` 로 옮겨 담은 화면 입력. */
function data(): SiteData {
  const order = new Map(favIds.map((id, index) => [id, index] as const));
  const base = siteData();

  return {
    ...base,
    bookmarks: base.bookmarks.map((bookmark) => {
      const favOrder = order.get(bookmark.id);

      return favOrder === undefined
        ? bookmark
        : { ...bookmark, is_favorite: true, fav_order: favOrder };
    }),
  };
}

beforeEach(() => {
  favIds = [];
  vi.mocked(setFavorite).mockResolvedValue({ ok: true });
  vi.mocked(reorderFavorites).mockResolvedValue({ ok: true });
});

describe('HomeView — 섹션 구성', () => {
  it('즐겨찾기 묶음 · 현재 운영 중인 사이트 순으로 놓는다', () => {
    setFavs(MIXED_FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    // 'AI 소식'은 담긴 것이 없어 서지 않는다. 묶음 차례는 FAV_GROUPS 가 정한다.
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'AI 서비스',
      '업무용 서비스',
      '현재 운영 중인 사이트',
    ]);
  });

  it('섹션 사이를 26px 띄운다 — 모바일은 20px (DESIGN_SPEC 1장 섹션 간격 · 프로토타입 sectionGap)', () => {
    render(<HomeView data={data()} isAdmin={false} />);

    expect(screen.getByRole('main')).toHaveClass(
      'flex',
      'flex-col',
      'gap-[20px]',
      'min-[820px]:gap-[26px]',
    );
  });

  it('스펙 3장의 하단 안내 박스는 두지 않는다 (계획서 V6 편차 — 사용자 결정)', () => {
    render(<HomeView data={data()} isAdmin={false} />);

    expect(screen.queryByText(/왼쪽 사이드바에서 분류별로/)).not.toBeInTheDocument();
  });

  it('홈에서는 체크 아이콘을 쓰지 않는다 (목록 화면 전용)', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    expect(screen.queryAllByRole('button', { name: /.+ 선택$/ })).toHaveLength(0);
  });
});

describe('HomeView — 즐겨찾기 묶음 (AI 소식 · AI 서비스 · 업무용 서비스)', () => {
  it('담긴 링크를 그 링크의 상위 분류가 정하는 묶음으로 나눠 놓는다', () => {
    setFavs(MIXED_FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    // 담은 차례(200 → 5 → 40)가 묶음 안에서 그대로 유지된다.
    expectCards('AI 서비스', [BOOKMARKS[5], BOOKMARKS[40]]);
    expectCards('업무용 서비스', [BOOKMARKS[200]]);
  });

  it('담긴 차례는 묶음 안에서 그대로다 (fav_order 순서)', () => {
    // 담은 차례를 뒤집어 담는다 — sort_order 로 다시 세우지 않는다는 것이 이 테스트의 전부다.
    setFavs([BOOKMARKS[40].id, BOOKMARKS[5].id]);
    render(<HomeView data={data()} isAdmin={false} />);

    expectCards('AI 서비스', [BOOKMARKS[40], BOOKMARKS[5]]);
  });

  it("'뉴스·인사이트' 분류의 링크는 'AI 소식'으로 간다", () => {
    const news: Category = { id: 'cat-news', name: '뉴스·인사이트', parent_id: null, sort_order: 99 };
    const article: BookmarkWithCount = {
      ...BOOKMARKS[7],
      id: 'bm-news',
      category_id: 'cat-news',
      is_favorite: true,
      fav_order: 0,
    };
    render(
      <HomeView
        data={{ categories: [...CATEGORIES, news], bookmarks: [...DATA.bookmarks, article] }}
        isAdmin={false}
      />,
    );

    expectCards('AI 소식', [article]);
    // 빈 묶음은 그리지 않는다.
    expect(screen.queryByRole('region', { name: 'AI 서비스' })).toBeNull();
  });

  it('빈 묶음은 그리지 않는다 — 담긴 것이 있는 묶음만 선다', () => {
    setFavs([BOOKMARKS[5].id]);
    render(<HomeView data={data()} isAdmin={false} />);

    expect(screen.getByRole('region', { name: 'AI 서비스' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI 소식' })).toBeNull();
    expect(screen.queryByRole('region', { name: '업무용 서비스' })).toBeNull();
  });

  it('묶음마다 담긴 개수와 열기 버튼을 적는다', () => {
    setFavs(MIXED_FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    const header = section('AI 서비스');

    expect(
      within(header).getByText('핀으로 담은 2개'),
    ).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: '2개 한 번에 열기' })).toBeInTheDocument();
  });

  it('관리자에게는 카드의 핀이 켜진 상태로 보인다', () => {
    setFavs(MIXED_FAV_IDS);
    render(<HomeView data={data()} isAdmin />);

    const pinButtons = [...pins('AI 서비스'), ...pins('업무용 서비스')];

    expect(pinButtons).toHaveLength(3);
    for (const pin of pinButtons) expect(pin).toHaveAttribute('aria-pressed', 'true');
  });

  it('방문자에게는 핀이 하나도 그려지지 않는다 (2026-08-11 — 담는 일은 관리자 몫)', () => {
    setFavs(MIXED_FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    // 카드는 그대로 보이되 담고 빼는 도구만 없다.
    expectCards('AI 서비스', [BOOKMARKS[5], BOOKMARKS[40]]);
    expect([...pins('AI 서비스'), ...pins('업무용 서비스')]).toHaveLength(0);
  });

  it('0개면 묶음 셋 대신 안내 한 장만 남는다', () => {
    render(<HomeView data={data()} isAdmin={false} />);

    const empty = within(section('내 즐겨찾기')).getByText(
      '다른 화면에서 카드 오른쪽 위의 핀을 누르면 이 자리에 모입니다. 담고 빼는 것은 관리자 몫이고, 담긴 목록은 모두에게 같습니다.',
    );

    // 점선 테두리 #d8d3cb · 배경 #f3f1ed · 라운드 10px · 패딩 16px · 11.5px #6d6a65
    expect(empty).toHaveClass(
      'rounded-[10px]',
      'border-dashed',
      'border-dash',
      'bg-side',
      'p-[16px]',
      'text-[11.5px]',
      'text-desc',
    );
    for (const group of ['AI 소식', 'AI 서비스', '업무용 서비스']) {
      expect(screen.queryByRole('region', { name: group })).toBeNull();
    }
    expect(
      within(section('내 즐겨찾기')).queryByRole('button', { name: /한 번에 열기$/ }),
    ).not.toBeInTheDocument();
  });
});

describe('HomeView — 현재 운영 중인 사이트 섹션', () => {
  it('운영 중 카테고리 소속 16개를 sort_order 순으로 놓는다', () => {
    render(<HomeView data={data()} isAdmin={false} />);

    const operating = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

    expect(operating).toHaveLength(16);
    expectCards('현재 운영 중인 사이트', operating);
  });

  it('보조문에 실제 개수를 적는다', () => {
    render(<HomeView data={data()} isAdmin={false} />);

    expect(
      within(section('현재 운영 중인 사이트')).getByText('회사가 직접 운영하는 서비스 16개'),
    ).toBeInTheDocument();
  });

  it('"전체 보기" 링크가 열기 버튼 왼쪽에서 그 카테고리로 간다', () => {
    render(<HomeView data={data()} isAdmin={false} />);

    const header = section('현재 운영 중인 사이트');
    const all = within(header).getByRole('link', { name: '전체 보기' });
    const open = within(header).getByRole('button', { name: '16개 한 번에 열기' });

    expect(all).toHaveAttribute('href', `/category/${OPERATING_ID}`);
    expect(all.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('카드에 핀을 노출하지 않는다', () => {
    setFavs([BOOKMARKS.find((bookmark) => bookmark.category_id === OPERATING_ID)!.id]);
    render(<HomeView data={data()} isAdmin={false} />);

    expect(pins('현재 운영 중인 사이트')).toHaveLength(0);
  });

  it('하위 카테고리에 달린 링크도 이 섹션에 넣는다 — 보조문 개수가 사이드바 개수와 같다', () => {
    // 시드에는 이 카테고리에 하위가 없다. 하위가 생겨도 사이드바 숫자(D1 rollupCounts — 하위
    // 합산)와 섹션의 "N개"가 어긋나지 않아야 하므로, 합성 하위를 하나 만들어 확인한다.
    const sub: Category = {
      id: 'op-sub',
      name: '운영 중 하위',
      parent_id: OPERATING_ID,
      sort_order: 0,
    };
    const subLink: BookmarkWithCount = {
      ...BOOKMARKS[0],
      id: 'op-sub-link',
      title: '하위에 달린 운영 링크',
      category_id: sub.id,
    };
    const data: SiteData = {
      categories: [...CATEGORIES, sub],
      bookmarks: [...BOOKMARKS, subLink],
    };

    render(<HomeView data={data} isAdmin={false} />);

    const sidebarCount = rollupCounts(data.categories, data.bookmarks)[OPERATING_ID];

    expect(sidebarCount).toBe(17);
    expect(cards('현재 운영 중인 사이트')).toHaveLength(sidebarCount);
    expect(section('현재 운영 중인 사이트')).toHaveTextContent('하위에 달린 운영 링크');
    expect(
      within(section('현재 운영 중인 사이트')).getByText(
        `회사가 직접 운영하는 서비스 ${sidebarCount}개`,
      ),
    ).toBeInTheDocument();
  });

  it('운영 중 카테고리가 없으면 섹션을 접는다', () => {
    render(
      <HomeView
        data={{
          categories: CATEGORIES.filter((category) => category.id !== OPERATING_ID),
          bookmarks: [...BOOKMARKS],
        }}
        isAdmin={false}
      />,
    );

    expect(
      screen.queryByRole('region', { name: '현재 운영 중인 사이트' }),
    ).not.toBeInTheDocument();
  });
});

describe('HomeView — 핀 토글 (D6)', () => {
  setupToastTimers();

  /** 핀은 관리자에게만 있다(2026-08-11) — 이 블록의 렌더는 전부 관리자 화면이다. */
  function renderHome() {
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={data()} isAdmin />
        <Toaster />
      </>,
    );
  }

  it('담긴 카드의 핀을 누르면 서버에 "빼기"를 보낸다', async () => {
    renderHome();

    // FAV_IDS 순서라 첫 카드는 BOOKMARKS[40] 이다.
    await act(async () => {
      fireEvent.click(pins('AI 서비스')[0]);
    });

    // 토글이 아니라 **방향**을 보낸다 — 화면이 아는 지금 값(true)을 뒤집은 false 다.
    expect(setFavorite).toHaveBeenCalledWith(BOOKMARKS[40].id, false);
    expect(screen.getByText(`${BOOKMARKS[40].title} 즐겨찾기 해제`)).toBeInTheDocument();
  });

  it('낙관적으로 지우지 않는다 — 목록은 서버가 다시 그릴 때 줄어든다', () => {
    // 연필·휴지통과 같은 취급이다(액션의 revalidatePath 가 새 목록을 가져온다).
    // 여기서 미리 지우면 저장이 실패했을 때 화면만 사라진 채로 남는다.
    renderHome();

    fireEvent.click(pins('AI 서비스')[0]);

    expectCards('AI 서비스', [BOOKMARKS[40], BOOKMARKS[2], BOOKMARKS[5]]);
    expect(screen.getByText('핀으로 담은 3개')).toBeInTheDocument();
  });

  it('저장이 실패하면 그 문구를 그대로 띄운다', async () => {
    vi.mocked(setFavorite).mockResolvedValue({ ok: false, error: '권한이 없습니다.' });
    renderHome();

    await act(async () => {
      fireEvent.click(pins('AI 서비스')[0]);
    });

    expect(screen.getByText('권한이 없습니다.')).toBeInTheDocument();
  });

  it('요청이 거부돼도(네트워크 단절) 오류 화면으로 번지지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(setFavorite).mockRejectedValue(new Error('offline'));
    renderHome();

    await act(async () => {
      fireEvent.click(pins('AI 서비스')[0]);
    });

    expect(screen.getByText('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
  });

  it('운영 중 섹션에는 관리자에게도 핀이 없다', () => {
    renderHome();

    expect(pins('AI 서비스')).toHaveLength(3);
    expect(pins('현재 운영 중인 사이트')).toHaveLength(0);
  });
});

describe('HomeView — 카드 클릭 기록 (F3)', () => {
  const OPERATING = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

  setupToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  function renderHome() {
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={data()} isAdmin={false} />
        <Toaster />
      </>,
    );
  }

  it('즐겨찾기 카드를 열면 그 링크의 클릭을 기록하고 프로토타입 문구로 알린다', () => {
    renderHome();

    fireEvent.click(openLink('AI 서비스'));

    // 인자가 id 하나뿐이다 — isBulk 는 넘기지 않는다(사람이 카드를 누른 클릭 = 기본 false).
    expect(recordClick).toHaveBeenCalledWith(BOOKMARKS[40].id);
    expect(recordClick).toHaveBeenCalledOnce();
    expect(screen.getByText(`${BOOKMARKS[40].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('운영 중 사이트 카드도 기록한다', () => {
    renderHome();

    fireEvent.click(openLink('현재 운영 중인 사이트'));

    expect(recordClick).toHaveBeenCalledWith(OPERATING[0].id);
    expect(screen.getByText(`${OPERATING[0].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('현재 운영 중인 사이트 카드도 기록한다 — 세 섹션 모두 클릭 기록 대상이다', () => {
    renderHome();

    fireEvent.click(openLink('현재 운영 중인 사이트', 2));

    expect(recordClick).toHaveBeenCalledWith(OPERATING[2].id);
    expect(screen.getByText(`${OPERATING[2].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('가운데 클릭(새 탭)도 기록한다', () => {
    renderHome();

    middleClick(openLink('현재 운영 중인 사이트'));

    expect(recordClick).toHaveBeenCalledWith(OPERATING[0].id);
    expect(screen.getByText(`${OPERATING[0].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('기본 동작을 막지 않는다 — 이동은 브라우저에 맡긴다', () => {
    renderHome();

    // preventDefault 를 부르면 dispatchEvent 가 false 를 돌려준다.
    expect(fireEvent.click(openLink('AI 서비스'))).toBe(true);
    expect(middleClick(openLink('현재 운영 중인 사이트'))).toBe(true);
  });

  it('핀을 눌러도 클릭을 기록하지 않는다 (여는 동작이 아니다)', async () => {
    // 핀은 관리자에게만 있으므로(2026-08-11) 이 한 자리만 관리자 화면으로 세운다.
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={data()} isAdmin />
        <Toaster />
      </>,
    );

    await act(async () => {
      fireEvent.click(pins('AI 서비스')[0]);
    });

    expect(recordClick).not.toHaveBeenCalled();
  });
});

describe('HomeView — 섹션 한 번에 열기 (G4)', () => {
  const OPERATING = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);
  const FAV_ITEMS = [BOOKMARKS[40], BOOKMARKS[2], BOOKMARKS[5]];

  setupToastTimers();
  const windowOpen = setupWindowOpen();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  const openAll = (name: string) =>
    within(section(name)).getByRole('button', { name: /한 번에 열기$/ });

  function renderHome() {
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={data()} isAdmin={false} />
        <Toaster />
      </>,
    );
  }

  /** 그 섹션의 카드가 놓인 순서 그대로 새 탭에 열리고 bulk 로 기록됐는지 본다. */
  function expectOpened(expected: readonly BookmarkWithCount[]): void {
    // 인자가 **둘뿐이다**. 기능 문자열(`noopener`/`noreferrer`)을 하나라도 넘기면 규격상 창 핸들
    // 대신 null 이 와서 차단 감지가 통째로 무너진다(useCardHandlers.openMany 의 맞바꿈 설명).
    expect(windowOpen.mock.calls).toEqual(expected.map((bookmark) => [bookmark.url, '_blank']));
    // `noopener` 를 뺀 자리를 메우는 한 줄 — 열린 창마다 되잡는 경로를 끊었는지. 하나라도
    // 빠뜨리면 길이가 맞지 않아 여기서 깨진다.
    expect(openedTabs(windowOpen).map((tab) => tab.opener)).toEqual(expected.map(() => null));
    // 카드 클릭(F3)과 달리 두 번째 인자가 true 다 — 순위 왜곡을 막는 bulk 플래그(PRD).
    expect(vi.mocked(recordClick).mock.calls).toEqual(
      expected.map((bookmark) => [bookmark.id, true]),
    );
  }

  it('즐겨찾기 묶음 — 담긴 순서대로 열고 묶음 이름으로 묶는다', () => {
    renderHome();

    fireEvent.click(openAll('AI 서비스'));

    expectOpened(FAV_ITEMS);
    expect(
      screen.getByText(
        '3개를 새 탭으로 엽니다 · 크롬에서 "AI 서비스" 탭 그룹으로 묶어 두면 좋습니다',
      ),
    ).toBeInTheDocument();
  });

  it('현재 운영 중인 사이트 — 16개를 연다', () => {
    renderHome();

    fireEvent.click(openAll('현재 운영 중인 사이트'));

    expectOpened(OPERATING);
    expect(
      screen.getByText(
        '16개를 새 탭으로 엽니다 · 크롬에서 "현재 운영 중인 사이트" 탭 그룹으로 묶어 두면 좋습니다',
      ),
    ).toBeInTheDocument();
  });

  it('즐겨찾기가 0개면 열기 버튼이 없어 누를 것도 없다 (DESIGN_SPEC 3장)', () => {
    render(<HomeView data={data()} isAdmin={false} />);

    expect(
      within(section('내 즐겨찾기')).queryByRole('button', { name: /한 번에 열기$/ }),
    ).not.toBeInTheDocument();
  });

  it('버튼 라벨과 실제로 여는 수가 같다', () => {
    // 예전에는 핀을 눌러 목록을 줄인 뒤 확인했다. 즐겨찾기가 서버로 옮겨간 뒤(2026-08-11)
    // 핀 한 번으로 목록이 줄지 않으므로(다시 그릴 때 준다) 처음부터 두 장만 담아 확인한다.
    setFavs([BOOKMARKS[2].id, BOOKMARKS[5].id]);
    render(<HomeView data={data()} isAdmin={false} />);

    expect(openAll('AI 서비스')).toHaveAccessibleName('2개 한 번에 열기');

    fireEvent.click(openAll('AI 서비스'));

    expectOpened([BOOKMARKS[2], BOOKMARKS[5]]);
  });

  /**
   * 사용자가 신고한 고장 그대로다 — 탭은 한 개도 열리지 않았는데 화면은 "N개를 새 탭으로 엽니다"
   * 라고 말했고 DB 에는 열리지도 않은 클릭 28건이 남았다. 브라우저가 팝업을 막으면
   * `window.open` 이 null 을 돌려주므로, 그 신호를 무시하는 구현으로 되돌리면 이 셋이 깨진다.
   */
  it('전부 차단되면 한 건도 기록하지 않는다 — 열지 못한 클릭이 통계에 남지 않는다', () => {
    windowOpen.mockReturnValue(null);
    renderHome();

    fireEvent.click(openAll('AI 서비스'));

    // 시도는 목록 끝까지 한다 — 앞이 막혔다고 뒤를 포기하지 않는다.
    expect(windowOpen).toHaveBeenCalledTimes(FAV_ITEMS.length);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it('전부 차단되면 열었다고 말하지 않고 팝업 차단을 푸는 법을 알려 준다', () => {
    windowOpen.mockReturnValue(null);
    renderHome();

    fireEvent.click(openAll('현재 운영 중인 사이트'));

    expect(
      screen.getByText(
        '팝업 차단으로 16개 모두 열리지 않았습니다 · 주소창의 팝업 차단 아이콘에서 이 사이트를 허용해 주세요',
      ),
    ).toBeInTheDocument();
    // "열었다"고 읽히는 말이 화면 어디에도 없어야 한다 — 그것이 이 고장의 본체였다.
    expect(screen.queryByText(/엽니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/열었/)).not.toBeInTheDocument();
  });

  it('일부만 차단되면 열린 것만 기록하고 열림·차단 수를 그대로 알린다', () => {
    // 브라우저가 앞의 몇 개만 허용하고 나머지를 막는 실제 모습이다.
    windowOpen
      .mockReturnValueOnce(openedTab())
      .mockReturnValueOnce(openedTab())
      .mockReturnValue(null);
    renderHome();

    fireEvent.click(openAll('AI 서비스'));

    expect(windowOpen).toHaveBeenCalledTimes(3);
    expect(vi.mocked(recordClick).mock.calls).toEqual([
      [FAV_ITEMS[0].id, true],
      [FAV_ITEMS[1].id, true],
    ]);
    // 열린 두 창만 핸들이 왔고, 그 둘의 opener 는 끊겨 있다.
    expect(openedTabs(windowOpen).map((tab) => tab.opener)).toEqual([null, null]);
    expect(
      screen.getByText(
        '2개를 열었고 1개는 팝업 차단으로 열리지 않았습니다 · 주소창의 팝업 차단 아이콘에서 이 사이트를 허용해 주세요',
      ),
    ).toBeInTheDocument();
  });
});

/**
 * J1. 현장 편집 노출 — 홈은 `isAdmin` 을 받아 **세 섹션 모든 카드**에 그대로 흘린다.
 * 판정은 서버(app/(public)/page.tsx)가 하고, 이 화면은 받은 값을 나르기만 한다.
 */
describe('HomeView — 관리자 편집 노출 (J1)', () => {
  const OPERATING_COUNT = BOOKMARKS.filter(
    (bookmark) => bookmark.category_id === OPERATING_ID,
  ).length;

  const edits = () => screen.queryAllByRole('button', { name: /.+ 수정$/ });
  const deletes = () => screen.queryAllByRole('button', { name: /.+ 삭제$/ });

  it('기본(비관리자)에는 연필·휴지통이 한 장도 없다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    expect(edits()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });

  it('isAdmin 이면 모든 섹션의 카드에 연필·휴지통이 붙는다 (즐겨찾기 3 + 운영 16)', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin />);

    const total = FAV_IDS.length + OPERATING_COUNT;

    expect(total).toBe(19);
    expect(edits()).toHaveLength(total);
    expect(deletes()).toHaveLength(total);
  });

  it('핀을 감춘 섹션(운영 중)에서도 관리자 아이콘은 나온다', () => {
    render(<HomeView data={data()} isAdmin />);

    const operating = within(section(OPERATING_CATEGORY_NAME));

    expect(pins(OPERATING_CATEGORY_NAME)).toHaveLength(0);
    expect(operating.queryAllByRole('button', { name: /.+ 수정$/ })).toHaveLength(OPERATING_COUNT);
    expect(operating.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(OPERATING_COUNT);
  });
});

/**
 * K1. '+ 링크 추가' 타일 — 홈에서는 **'현재 운영 중인 사이트' 섹션 하나에만** 선다.
 *
 * 폼이 무엇을 보내는지는 `components/card/QuickAddCard.test.tsx` 가 못박는다. 여기서 보는 것은
 * 화면의 몫 — **어느 목록에 서는가**와 **비관리자에게는 렌더 자체가 없는가**다.
 */
describe('HomeView — 링크 추가 타일 (K1)', () => {
  it('비관리자에게는 마크업 자체가 없다', () => {
    // 늘 그려 두고 CSS 로 감추는 방식은 금지다(README 주의사항 7) — 응답에 실리지 않아야 한다.
    setFavs(FAV_IDS);
    const { container } = render(<HomeView data={data()} isAdmin={false} />);

    expect(screen.queryByRole('button', { name: '링크 추가' })).toBeNull();
    expect(container.querySelector('[data-testid="quick-add"]')).toBeNull();
  });

  it('관리자에게는 운영 중 섹션 그리드의 **맨 앞** 칸에 선다', () => {
    render(<HomeView data={data()} isAdmin />);

    const grid = body(OPERATING_CATEGORY_NAME);

    expect(grid.firstElementChild).toBe(quickAddTile(OPERATING_CATEGORY_NAME));
    // 카드는 한 장도 밀려나지 않는다 — 타일은 한 칸을 더할 뿐이다.
    expect(cards(OPERATING_CATEGORY_NAME)).toHaveLength(
      BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID).length,
    );
  });

  it('즐겨찾기에는 두지 않는다 — 담는 일은 카드의 핀이 한다', () => {
    // 이 브라우저의 localStorage 에서 나온 목록이라, 거기서 만든 링크가 왜 그 자리에 안 보이는지
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin />);

    expect(quickAddTile('AI 서비스')).toBeNull();
    expect(screen.getAllByRole('button', { name: '링크 추가' })).toHaveLength(1);
  });

  it('기본 분류는 그 섹션의 분류다 — 보고 있는 목록에 한 건 더 붙인다', () => {
    render(<HomeView data={data()} isAdmin />);

    fireEvent.click(quickAddTile(OPERATING_CATEGORY_NAME)!);

    expect(screen.getByRole('combobox', { name: '분류' })).toHaveValue(OPERATING_ID);
  });

  it('분류 상자에는 모든 분류가 온다 — 홈에서 어느 분류로든 넣을 수 있다', () => {
    render(<HomeView data={data()} isAdmin />);

    fireEvent.click(quickAddTile(OPERATING_CATEGORY_NAME)!);

    // 상위·하위를 가리지 않는다(둘 다 링크를 담는다). 시드의 분류 수와 같아야 한다.
    expect(screen.getAllByRole('option')).toHaveLength(CATEGORIES.length);
  });

  it('운영 중 분류가 없으면 그 섹션도 타일도 사라진다', () => {
    render(
      <HomeView
        data={{
          categories: CATEGORIES.filter((category) => category.id !== OPERATING_ID),
          bookmarks: DATA.bookmarks,
        }}
        isAdmin
      />,
    );

    expect(screen.queryByRole('region', { name: OPERATING_CATEGORY_NAME })).toBeNull();
    expect(screen.queryByRole('button', { name: '링크 추가' })).toBeNull();
  });
});

/**
 * J2. 카드 인라인 편집 — 홈은 **모든 섹션의 카드 렌더 지점**에 같은 배선을 흘린다.
 *
 * 폼 자체(필드 구성·수치·저장 실패 처리)는 `components/card/InlineEdit.test.tsx` 가 고정한다.
 * 여기서 보는 것은 화면의 몫인 두 가지다 — **어느 카드가 폼으로 바뀌는가**와
 * **동시에 한 장만인가**(DESIGN_SPEC 2-1).
 */
describe('HomeView — 카드 인라인 편집 (J2)', () => {
  const FAV_FIRST = BOOKMARKS[40];
  const OPERATING_ITEMS = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

  /**
   * **두 섹션에 함께 놓이는 링크** — 운영 중 분류의 링크를 즐겨찾기에도 담으면 '업무용 서비스'
   * 묶음과 '현재 운영 중인 사이트'에 카드가 하나씩 선다. 카드는 둘이지만 링크는 하나라,
   * 한쪽에서 연 폼이 두 자리 모두에 뜨는 것이 의도된 동작이다(아래 별도 테스트).
   */
  const SHARED = OPERATING_ITEMS[0];

  /** 운영 중 섹션에만 있는 카드 — 위 겹치는 하나를 피한다. */
  const OPERATING_ONLY_INDEX = 1;
  const OPERATING_ONLY = OPERATING_ITEMS[OPERATING_ONLY_INDEX];

  /** 섹션의 n 번째 카드에 붙은 연필. 같은 링크가 두 섹션에 나올 수 있어 카드 안에서 찾는다. */
  const pencil = (name: string, index = 0) =>
    within(cards(name)[index]).getByRole('button', { name: /.+ 수정$/ });

  const formIn = (name: string, index = 0) => within(cards(name)[index]).getByRole('form');
  const forms = () => screen.queryAllByRole('form');

  function renderHome() {
    // SHARED 를 함께 담아 '업무용 서비스' 묶음과 운영 중 섹션에 같은 링크가 서게 한다.
    setFavs([...FAV_IDS, SHARED.id]);
    render(<HomeView data={data()} isAdmin />);
  }

  beforeEach(() => {
    vi.mocked(updateBookmark).mockReset();
    vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
  });

  it('연필을 누르면 그 카드의 본문·하단이 편집 폼으로 바뀐다', () => {
    renderHome();

    fireEvent.click(pencil('AI 서비스'));

    const card = cards('AI 서비스')[0];

    expect(within(card).getByRole('form', { name: `${FAV_FIRST.title} 수정` })).toBeInTheDocument();
    expect(within(card).getByRole('textbox', { name: '이름' })).toHaveValue(FAV_FIRST.title);
    // 교체 범위는 본문 + 하단 줄이다 — 본문 앵커가 사라지고 상단 액션 줄은 남는다(LinkCard J1 계약).
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: `${FAV_FIRST.title} 수정` })).toBeInTheDocument();
  });

  it('폼을 연 카드 말고는 그대로다', () => {
    renderHome();

    fireEvent.click(pencil('AI 서비스'));

    expect(forms()).toHaveLength(1);
    expect(within(cards('AI 서비스')[1]).getByRole('link')).toBeInTheDocument();
  });

  it('다른 카드의 연필을 누르면 앞 카드의 폼이 닫힌다 — 동시에 한 장만', () => {
    renderHome();

    fireEvent.click(pencil('AI 서비스', 0));
    fireEvent.click(pencil('AI 서비스', 1));

    expect(forms()).toHaveLength(1);
    expect(formIn('AI 서비스', 1)).toBeInTheDocument();
  });

  it('섹션이 달라도 한 장만 열린다 — 여러 렌더 지점이 같은 상태를 나눠 쓴다', () => {
    // 두 섹션에 함께 놓인 SHARED 는 일부러 피한다 — 그 링크는 두 자리에 함께 열리는 것이
    // 의도된 동작이라(아래 별도 테스트) 여기서 쓰면 무엇을 보는지 흐려진다.
    renderHome();

    fireEvent.click(pencil('AI 서비스'));
    expect(formIn('AI 서비스')).toHaveAccessibleName(`${FAV_FIRST.title} 수정`);

    fireEvent.click(pencil('현재 운영 중인 사이트', OPERATING_ONLY_INDEX));
    expect(forms()).toHaveLength(1);
    expect(formIn('현재 운영 중인 사이트', OPERATING_ONLY_INDEX)).toHaveAccessibleName(
      `${OPERATING_ONLY.title} 수정`,
    );
  });

  it('같은 링크가 두 섹션에 놓였으면 두 자리 모두 폼이 된다 — 고치는 것은 한 건이다', () => {
    // 홈은 한 링크를 여러 섹션에 놓을 수 있다(고정 + 운영 중). 상태가 링크 id 하나라 그 링크의
    // 카드는 어디에 있든 함께 폼이 된다 — 프로토타입(`st.editId === b.id`)과 같은 동작이다.
    // '동시에 한 장만'은 **여러 링크를 동시에 고치지 않는다**는 뜻이지 카드 수를 세는 규칙이 아니다.
    renderHome();


    fireEvent.click(pencil('업무용 서비스', 0));

    expect(screen.getAllByRole('form', { name: `${SHARED.title} 수정` })).toHaveLength(2);
    expect(forms()).toHaveLength(2);
  });

  it('저장에 성공하면 그 링크의 patch 를 보내고 폼이 닫힌다', async () => {
    renderHome();

    fireEvent.click(pencil('업무용 서비스'));
    fireEvent.change(within(cards('업무용 서비스')[0]).getByRole('textbox', { name: '이름' }), {
      target: { value: '고친 이름' },
    });
    await act(async () => {
      fireEvent.click(within(cards('업무용 서비스')[0]).getByRole('button', { name: '저장' }));
    });

    expect(updateBookmark).toHaveBeenCalledWith(SHARED.id, { title: '고친 이름' });
    expect(forms()).toHaveLength(0);
    // 화면의 값은 서버가 다시 그려 준다(액션의 revalidatePath) — 이 테스트의 props 는 그대로다.
    expect(within(cards('업무용 서비스')[0]).getByRole('link')).toBeInTheDocument();
  });

  it('취소하면 아무것도 보내지 않고 폼이 닫힌다', () => {
    renderHome();

    fireEvent.click(pencil('현재 운영 중인 사이트'));
    fireEvent.click(within(cards('현재 운영 중인 사이트')[0]).getByRole('button', { name: '취소' }));

    expect(updateBookmark).not.toHaveBeenCalled();
    expect(forms()).toHaveLength(0);
  });

  /**
   * 섹션이 늘어날 때 `{...editing(bookmark)}` 스프레드를 빠뜨리면 그 섹션의 연필만 조용히 아무
   * 일도 하지 않는다 — 위 테스트들은 섹션을 이름으로 짚어 보므로 새 섹션을 보지 못한다.
   * 그래서 화면에 있는 연필을 **전수** 눌러 본다.
   */
  it('화면의 연필 전부가 폼을 연다 — 배선을 빠뜨린 렌더 지점이 없다', () => {
    renderHome();

    const all = screen.getAllByRole('button', { name: /.+ 수정$/ });
    expect(all).toHaveLength(20);

    for (const button of all) {
      fireEvent.click(button);
      // 같은 링크가 두 섹션에 놓이면 폼도 두 자리에 뜬다 — 개수가 아니라 '열렸는가'를 본다.
      expect(forms().length).toBeGreaterThan(0);
    }
  });

  it('비관리자 화면에는 폼을 여는 길이 없다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    expect(screen.queryAllByRole('button', { name: /.+ 수정$/ })).toHaveLength(0);
    expect(forms()).toHaveLength(0);
  });
});

/**
 * J3. 카드 삭제 확인 — 홈은 **섹션 세 곳의 카드 렌더 지점 전부**에 같은 배선을 흘린다.
 *
 * 오버레이 자체(수치·확인 전 미삭제·실패 처리·포커스)는 `components/card/DeleteConfirm.test.tsx` 가
 * 고정한다. 여기서 보는 것은 화면의 몫 — **어느 카드가 오버레이를 갖는가**와 **편집과의 상호 배제**다.
 */
describe('HomeView — 카드 삭제 확인 (J3)', () => {
  const FAV_FIRST = BOOKMARKS[40];
  const OPERATING_ITEMS = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

  /** 두 섹션에 함께 놓이는 링크 — J2 describe 와 같은 사정이다. */
  const SHARED = OPERATING_ITEMS[0];

  /** 운영 중 섹션에만 있는 카드 — 위 겹치는 하나를 피한다. */
  const OPERATING_ONLY_INDEX = 1;
  const OPERATING_ONLY = OPERATING_ITEMS[OPERATING_ONLY_INDEX];

  /** 섹션의 n 번째 카드에 붙은 휴지통·연필. 같은 링크가 두 섹션에 나올 수 있어 카드 안에서 찾는다. */
  const trash = (name: string, index = 0) =>
    within(cards(name)[index]).getByRole('button', { name: /.+ 삭제$/ });
  const pencil = (name: string, index = 0) =>
    within(cards(name)[index]).getByRole('button', { name: /.+ 수정$/ });

  const overlays = () => screen.queryAllByRole('alertdialog');
  const forms = () => screen.queryAllByRole('form');
  const confirmIn = (name: string, index = 0) =>
    within(cards(name)[index]).getByRole('button', { name: '삭제' });

  function renderHome() {
    // SHARED 를 함께 담아 '업무용 서비스' 묶음과 운영 중 섹션에 같은 링크가 서게 한다.
    setFavs([...FAV_IDS, SHARED.id]);
    render(<HomeView data={data()} isAdmin />);
  }

  beforeEach(() => {
    vi.mocked(updateBookmark).mockReset();
    vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
    vi.mocked(deleteBookmark).mockReset();
    vi.mocked(deleteBookmark).mockResolvedValue({ ok: true });
  });

  it('휴지통을 눌러도 지우지 않는다 — 그 카드 위에 확인 오버레이만 뜬다', () => {
    renderHome();

    fireEvent.click(trash('AI 서비스'));

    expect(deleteBookmark).not.toHaveBeenCalled();
    expect(overlays()).toHaveLength(1);
    expect(
      within(cards('AI 서비스')[0]).getByRole('alertdialog', {
        name: `${FAV_FIRST.title} 삭제 확인`,
      }),
    ).toBeInTheDocument();
  });

  it('오버레이는 덧대기다 — 본문은 그대로 남는다', () => {
    renderHome();

    fireEvent.click(trash('AI 서비스'));

    // 편집 폼(교체)과 달리 본문 앵커가 그대로 있다 — 오버레이가 배경으로 덮을 뿐이다.
    const card = cards('AI 서비스')[0];

    expect(within(card).getByRole('link')).toBeInTheDocument();
    expect(within(card).getByRole('alertdialog')).toBe(card.lastElementChild);
  });

  it('오버레이를 연 카드 말고는 그대로다', () => {
    renderHome();

    fireEvent.click(trash('AI 서비스'));

    expect(overlays()).toHaveLength(1);
    expect(within(cards('AI 서비스')[1]).queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('섹션이 달라도 한 링크만 묻는다 — 여러 렌더 지점이 같은 상태를 나눠 쓴다', () => {
    // 두 섹션에 함께 놓인 SHARED 는 일부러 피한다(J2 의 같은 자리와 같은 사정).
    renderHome();

    fireEvent.click(trash('AI 서비스'));
    expect(overlays()[0]).toHaveAccessibleName(`${FAV_FIRST.title} 삭제 확인`);

    fireEvent.click(trash('현재 운영 중인 사이트', OPERATING_ONLY_INDEX));
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0]).toHaveAccessibleName(`${OPERATING_ONLY.title} 삭제 확인`);
  });

  it('같은 링크가 두 섹션에 놓였으면 두 자리 모두 오버레이가 뜬다 — 지우는 것은 한 건이다', () => {
    renderHome();


    fireEvent.click(trash('업무용 서비스', 0));

    expect(screen.getAllByRole('alertdialog', { name: `${SHARED.title} 삭제 확인` })).toHaveLength(2);
  });

  it('두 자리 중 한쪽에서 확인하면 한 번만 보내고 두 자리가 함께 닫힌다', async () => {
    renderHome();


    fireEvent.click(trash('업무용 서비스', 0));
    await act(async () => {
      fireEvent.click(confirmIn('업무용 서비스', 0));
    });

    expect(deleteBookmark).toHaveBeenCalledExactlyOnceWith(SHARED.id);
    expect(overlays()).toHaveLength(0);
  });

  it('확인하면 그 링크의 id 를 보내고 오버레이가 닫힌다', async () => {
    renderHome();

    fireEvent.click(trash('AI 서비스'));
    await act(async () => {
      fireEvent.click(confirmIn('AI 서비스'));
    });

    expect(deleteBookmark).toHaveBeenCalledWith(FAV_FIRST.id);
    expect(overlays()).toHaveLength(0);
    // 목록은 그대로다 — 삭제도 다른 편집과 같이 서버가 다시 그려 반영한다(액션의 revalidatePath).
    // 즐겨찾기를 따로 청소하던 한 줄은 2026-08-11 서버 이전으로 없어졌다: 담긴 표시가 링크 행에
    // 실려 있어(`is_favorite`) 행이 사라지면 함께 사라진다.
    expect(cards('AI 서비스')).toHaveLength(FAV_IDS.length);
  });

  it('취소하면 아무것도 보내지 않고 오버레이가 닫힌다', () => {
    renderHome();

    fireEvent.click(trash('현재 운영 중인 사이트', OPERATING_ONLY_INDEX));
    fireEvent.click(
      within(cards('현재 운영 중인 사이트')[OPERATING_ONLY_INDEX]).getByRole('button', {
        name: '취소',
      }),
    );

    expect(deleteBookmark).not.toHaveBeenCalled();
    expect(overlays()).toHaveLength(0);
  });

  it('삭제를 물으면 열려 있던 편집이 닫힌다 (프로토타입 askDel)', () => {
    renderHome();

    fireEvent.click(pencil('AI 서비스'));
    expect(forms()).toHaveLength(1);

    fireEvent.click(trash('현재 운영 중인 사이트', OPERATING_ONLY_INDEX));

    expect(forms()).toHaveLength(0);
    expect(overlays()).toHaveLength(1);
  });

  it('편집을 열면 묻고 있던 삭제가 닫힌다 (프로토타입 startEdit)', () => {
    renderHome();

    fireEvent.click(trash('AI 서비스'));
    expect(overlays()).toHaveLength(1);

    fireEvent.click(pencil('현재 운영 중인 사이트', OPERATING_ONLY_INDEX));

    expect(overlays()).toHaveLength(0);
    expect(forms()).toHaveLength(1);
  });

  /**
   * 섹션이 늘어날 때 `{...deleting(bookmark)}` 스프레드를 빠뜨리면 그 섹션의 휴지통만 조용히
   * 아무 일도 하지 않는다 — 위 테스트들은 섹션을 이름으로 짚어 보므로 새 섹션을 보지 못한다.
   * 그래서 화면에 있는 휴지통을 **전수** 눌러 본다.
   */
  it('화면의 휴지통 전부가 오버레이를 연다 — 배선을 빠뜨린 렌더 지점이 없다', () => {
    renderHome();

    const all = screen.getAllByRole('button', { name: /.+ 삭제$/ });
    expect(all).toHaveLength(20);

    for (const button of all) {
      fireEvent.click(button);
      expect(overlays().length).toBeGreaterThan(0);
    }
  });

  it('비관리자 화면에는 확인 오버레이를 여는 길이 없다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    expect(screen.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(0);
    expect(overlays()).toHaveLength(0);
  });
});

/**
 * J5. 관리자가 **공개 화면에서** 카드를 끌어 순서를 바꾼다.
 *
 * 저장이 어떻게 일어나는지(자리 맞바꾸기)는 `lib/mutations.test.ts` 가, 옮김 계산은
 * `lib/reorder.test.ts` 가 못박는다. 여기서 보는 것은 **홈이 어느 목록을 어디로 보내는가**다 —
 * 즐겨찾기 묶음은 localStorage, 운영 중 섹션은 서버라 그 갈래가 이 화면의 계약이다.
 */
describe('HomeView — 드래그 정렬 (J5)', () => {
  /** 끌어서 놓기 한 번 — jsdom 에는 DragEvent 가 없어 dataTransfer 없이 흘려보낸다. */
  async function drag(section: string, from: number, to: number) {
    const list = cards(section);
    fireEvent.dragStart(list[from]);
    fireEvent.dragOver(list[to]);
    await act(async () => {
      fireEvent.drop(list[to]);
    });
  }

  beforeEach(() => {
    // 이 파일에는 전역 clearAllMocks 가 없다 — 호출 기록이 테스트 사이에 넘어오면
    // `not.toHaveBeenCalled()` 가 앞 테스트의 드래그를 보고 실패한다.
    vi.mocked(reorderBookmarks).mockClear();
    vi.mocked(reorderBookmarks).mockResolvedValue({ ok: true });
  });

  it('비관리자 응답에는 드래그 속성이 한 조각도 실리지 않는다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin={false} />);

    for (const card of cards(OPERATING_CATEGORY_NAME)) {
      expect(card).not.toHaveAttribute('draggable');
    }
    // 앵커의 기본 드래그(주소 끌어다 놓기)도 그대로 살아 있다.
    expect(openLink(OPERATING_CATEGORY_NAME)).not.toHaveAttribute('draggable');
  });

  it('관리자 카드는 끌 수 있고, 그때만 앵커가 드래그 소스에서 빠진다', () => {
    render(<HomeView data={data()} isAdmin />);

    expect(cards(OPERATING_CATEGORY_NAME)[0]).toHaveAttribute('draggable', 'true');
    // 앵커를 그대로 두면 본문을 집었을 때 순서 바꾸기가 아니라 주소 끌기가 일어난다.
    expect(openLink(OPERATING_CATEGORY_NAME)).toHaveAttribute('draggable', 'false');
  });

  it('옮긴 자리는 저장을 기다리지 않고 곧바로 보인다 (낙관적 순서)', async () => {
    // 응답을 매달아 둔다 — React 는 액션이 열려 있는 동안에만 낙관값을 들고 있다(test/pending.ts).
    const pending = pendingResult();
    vi.mocked(reorderBookmarks).mockReturnValue(pending.promise);

    render(<HomeView data={data()} isAdmin />);
    const items = DATA.bookmarks.filter((bookmark) => bookmark.category_id === OPERATING_ID);

    await drag(OPERATING_CATEGORY_NAME, 2, 0);

    expect(cards(OPERATING_CATEGORY_NAME)[0]).toHaveTextContent(items[2].title);

    await pending.finish();
  });

  it("'운영 중' 섹션 — 그 분류의 목록만 넘긴다", async () => {
    render(<HomeView data={data()} isAdmin />);
    const items = DATA.bookmarks.filter((bookmark) => bookmark.category_id === OPERATING_ID);

    await drag(OPERATING_CATEGORY_NAME, 1, 0);

    expect(reorderBookmarks).toHaveBeenCalledWith(
      [items[1], items[0], ...items.slice(2)].map((b) => b.id),
    );
  });

  it('즐겨찾기 묶음은 fav_order 축으로 보낸다 — sort_order 를 건드리지 않는다', async () => {
    // 두 축은 다르다: 이 드래그가 `reorderBookmarks` 로 가면 엉뚱한 분류들의 순서가 흔들린다.
    setFavs(FAV_IDS);
    render(<HomeView data={data()} isAdmin />);

    await drag('AI 서비스', 2, 0);

    expect(reorderBookmarks).not.toHaveBeenCalled();
    expect(reorderFavorites).toHaveBeenCalledWith([FAV_IDS[2], FAV_IDS[0], FAV_IDS[1]]);
  });

  it('끌기 시작이 없던 drop 은 무시한다 (바깥에서 끌어 온 것)', async () => {
    render(<HomeView data={data()} isAdmin />);

    await act(async () => {
      fireEvent.drop(cards(OPERATING_CATEGORY_NAME)[0]);
    });

    expect(reorderBookmarks).not.toHaveBeenCalled();
  });

  it('저장이 거절되면 그 문구를 그대로 알린다', async () => {
    setupToastTimers();
    vi.mocked(reorderBookmarks).mockResolvedValue({
      ok: false,
      error: '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    });
    render(
      <>
        <HomeView data={data()} isAdmin />
        <Toaster />
      </>,
    );

    await drag(OPERATING_CATEGORY_NAME, 1, 0);

    expect(screen.getByRole('status')).toHaveTextContent(
      '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    );
  });
});
