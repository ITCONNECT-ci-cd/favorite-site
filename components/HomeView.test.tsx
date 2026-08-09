/** D2. 홈 화면 — DESIGN_SPEC 3장(섹션 3개). */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeView } from '@/components/HomeView';
import { Toaster } from '@/components/Toast';
import { recordClick } from '@/lib/clicks';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { useFavorites } from '@/lib/favorites';
import { deleteBookmark, updateBookmark } from '@/lib/mutations';
import { rollupCounts } from '@/lib/queries';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { middleClick } from '@/test/events';
import { setFavs, storedFavs } from '@/test/favs';
import { BOOKMARKS, CATEGORIES, siteData } from '@/test/fixtures/seed';
import { setupWindowOpen } from '@/test/open';
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
}));

/**
 * fixture 는 실시드 그대로다 (`test/fixtures/seed.ts`) — 화면에 적히는 실측치
 * (매일 12 · 운영 중 16)가 시드와 어긋나면 여기서 먼저 깨진다.
 */
const DATA: SiteData = siteData();

const OPERATING_ID = CATEGORIES.find(
  (category) => category.parent_id === null && category.name === OPERATING_CATEGORY_NAME,
)!.id;

/** 즐겨찾기 순서 검증용 — sort_order 순서(5 → 40 → 200)와 일부러 다르게 담는다. */
const FAV_IDS = [BOOKMARKS[200].id, BOOKMARKS[5].id, BOOKMARKS[40].id];

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
 * 다른 화면(목록·카테고리)에서 담는 상황 모사.
 * 홈에는 담을 수단이 없다 — 즐겨찾기 섹션의 핀은 이미 담긴 카드에만 있고, 매일·운영은 핀 자체가
 * 없다. 그래서 '담기 → 카드 등장'은 같은 스토어를 쓰는 바깥 인스턴스로 확인한다.
 */
function FavToggler({ id }: { id: string }) {
  const { toggle } = useFavorites();

  return (
    <button type="button" onClick={() => toggle(id)}>
      다른 화면에서 담기
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('HomeView — 섹션 구성', () => {
  it('내 즐겨찾기 · 매일 사용하는 사이트 · 현재 운영 중인 사이트 순으로 놓는다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      '내 즐겨찾기',
      '매일 사용하는 사이트',
      '현재 운영 중인 사이트',
    ]);
  });

  it('섹션 사이를 26px 띄운다 — 모바일은 20px (DESIGN_SPEC 1장 섹션 간격 · 프로토타입 sectionGap)', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(screen.getByRole('main')).toHaveClass(
      'flex',
      'flex-col',
      'gap-[20px]',
      'min-[820px]:gap-[26px]',
    );
  });

  it('스펙 3장의 하단 안내 박스는 두지 않는다 (계획서 V6 편차 — 사용자 결정)', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(screen.queryByText(/왼쪽 사이드바에서 분류별로/)).not.toBeInTheDocument();
  });

  it('홈에서는 체크 아이콘을 쓰지 않는다 (목록 화면 전용)', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(screen.queryAllByRole('button', { name: /.+ 선택$/ })).toHaveLength(0);
  });
});

describe('HomeView — 내 즐겨찾기 섹션', () => {
  it('favs(localStorage) 순서 그대로 카드를 놓는다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    expectCards('내 즐겨찾기', [BOOKMARKS[200], BOOKMARKS[5], BOOKMARKS[40]]);
  });

  it('보조문과 열기 버튼에 담긴 개수를 적는다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    const header = section('내 즐겨찾기');

    expect(
      within(header).getByText('핀으로 직접 담은 3개 · 이 브라우저에만 저장됩니다'),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: '3개 한 번에 열기' }),
    ).toBeInTheDocument();
  });

  it('카드의 핀이 켜진 상태로 보인다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    const pinButtons = pins('내 즐겨찾기');

    expect(pinButtons).toHaveLength(3);
    for (const pin of pinButtons) expect(pin).toHaveAttribute('aria-pressed', 'true');
  });

  it('이제 없는 링크 id 가 favs 에 남아 있어도 건너뛴다', () => {
    setFavs([BOOKMARKS[5].id, '사라진-링크', BOOKMARKS[40].id]);
    render(<HomeView data={DATA} isAdmin={false} />);

    expectCards('내 즐겨찾기', [BOOKMARKS[5], BOOKMARKS[40]]);
    expect(
      screen.getByText('핀으로 직접 담은 2개 · 이 브라우저에만 저장됩니다'),
    ).toBeInTheDocument();
  });

  it('0개면 열기 버튼 없이 빈 즐겨찾기 안내만 보여준다 (DESIGN_SPEC 3장)', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    const empty = within(section('내 즐겨찾기')).getByText(
      '다른 화면에서 카드 오른쪽 위의 핀을 누르면 이 자리에 모입니다. 매일 사용하는 사이트와 달리 내가 직접 담고 빼는 목록입니다.',
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
    expect(pins('내 즐겨찾기')).toHaveLength(0);
    expect(
      within(section('내 즐겨찾기')).queryByRole('button', { name: /한 번에 열기$/ }),
    ).not.toBeInTheDocument();
  });
});

describe('HomeView — 매일 사용하는 사이트 섹션', () => {
  it('is_pinned 12개를 sort_order 순으로 놓는다', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    const pinned = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);

    expect(pinned).toHaveLength(12);
    expectCards('매일 사용하는 사이트', pinned);
  });

  it('보조문과 열기 버튼을 스펙 문구 그대로 적는다', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    const header = section('매일 사용하는 사이트');

    expect(
      within(header).getByText('직접 고정한 12개 · 자리가 바뀌지 않습니다'),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: '12개 한 번에 열기' }),
    ).toBeInTheDocument();
  });

  it('카드에 핀을 노출하지 않는다 (관리자 영역)', () => {
    setFavs([BOOKMARKS.find((bookmark) => bookmark.is_pinned)!.id]);
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(pins('매일 사용하는 사이트')).toHaveLength(0);
  });
});

describe('HomeView — 현재 운영 중인 사이트 섹션', () => {
  it('운영 중 카테고리 소속 16개를 sort_order 순으로 놓는다', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    const operating = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

    expect(operating).toHaveLength(16);
    expectCards('현재 운영 중인 사이트', operating);
  });

  it('보조문에 실제 개수를 적는다', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(
      within(section('현재 운영 중인 사이트')).getByText('회사가 직접 운영하는 서비스 16개'),
    ).toBeInTheDocument();
  });

  it('"전체 보기" 링크가 열기 버튼 왼쪽에서 그 카테고리로 간다', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    const header = section('현재 운영 중인 사이트');
    const all = within(header).getByRole('link', { name: '전체 보기' });
    const open = within(header).getByRole('button', { name: '16개 한 번에 열기' });

    expect(all).toHaveAttribute('href', `/category/${OPERATING_ID}`);
    expect(all.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('카드에 핀을 노출하지 않는다', () => {
    setFavs([BOOKMARKS.find((bookmark) => bookmark.category_id === OPERATING_ID)!.id]);
    render(<HomeView data={DATA} isAdmin={false} />);

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

  it('즐겨찾기 카드의 핀을 누르면 그 카드가 곧바로 사라지고 해제 토스트가 뜬다', () => {
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={DATA} isAdmin={false} />
        <Toaster />
      </>,
    );

    // FAV_IDS 순서라 첫 카드는 BOOKMARKS[200] 이다.
    fireEvent.click(pins('내 즐겨찾기')[0]);

    expectCards('내 즐겨찾기', [BOOKMARKS[5], BOOKMARKS[40]]);
    expect(screen.getByText(`${BOOKMARKS[200].title} 즐겨찾기 해제`)).toBeInTheDocument();
    expect(storedFavs()).toEqual([BOOKMARKS[5].id, BOOKMARKS[40].id]);
  });

  it('보조문·열기 버튼의 개수도 함께 줄어든다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    fireEvent.click(pins('내 즐겨찾기')[0]);

    expect(
      screen.getByText('핀으로 직접 담은 2개 · 이 브라우저에만 저장됩니다'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2개 한 번에 열기' })).toBeInTheDocument();
  });

  it('마지막 하나를 빼면 빈 즐겨찾기 안내로 바뀐다', () => {
    setFavs([BOOKMARKS[5].id]);
    render(<HomeView data={DATA} isAdmin={false} />);

    fireEvent.click(pins('내 즐겨찾기')[0]);

    expect(pins('내 즐겨찾기')).toHaveLength(0);
    expect(
      within(section('내 즐겨찾기')).getByText(
        '다른 화면에서 카드 오른쪽 위의 핀을 누르면 이 자리에 모입니다. 매일 사용하는 사이트와 달리 내가 직접 담고 빼는 목록입니다.',
      ),
    ).toBeInTheDocument();
  });

  it('다른 화면에서 담으면 즐겨찾기 섹션에 곧바로 나타난다', () => {
    render(
      <>
        <HomeView data={DATA} isAdmin={false} />
        <FavToggler id={BOOKMARKS[5].id} />
      </>,
    );
    expect(pins('내 즐겨찾기')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '다른 화면에서 담기' }));

    expectCards('내 즐겨찾기', [BOOKMARKS[5]]);
    expect(pins('내 즐겨찾기')[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('핀을 배선한 뒤에도 매일·운영 섹션에는 핀이 없다 (관리자 영역)', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(pins('내 즐겨찾기')).toHaveLength(3);
    expect(pins('매일 사용하는 사이트')).toHaveLength(0);
    expect(pins('현재 운영 중인 사이트')).toHaveLength(0);
  });
});

describe('HomeView — 카드 클릭 기록 (F3)', () => {
  const DAILY = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);
  const OPERATING = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

  setupToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  function renderHome() {
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={DATA} isAdmin={false} />
        <Toaster />
      </>,
    );
  }

  it('즐겨찾기 카드를 열면 그 링크의 클릭을 기록하고 프로토타입 문구로 알린다', () => {
    renderHome();

    fireEvent.click(openLink('내 즐겨찾기'));

    // 인자가 id 하나뿐이다 — isBulk 는 넘기지 않는다(사람이 카드를 누른 클릭 = 기본 false).
    expect(recordClick).toHaveBeenCalledWith(BOOKMARKS[200].id);
    expect(recordClick).toHaveBeenCalledOnce();
    expect(screen.getByText(`${BOOKMARKS[200].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('매일 사용하는 사이트 카드도 기록한다', () => {
    renderHome();

    fireEvent.click(openLink('매일 사용하는 사이트'));

    expect(recordClick).toHaveBeenCalledWith(DAILY[0].id);
    expect(screen.getByText(`${DAILY[0].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('현재 운영 중인 사이트 카드도 기록한다 — 세 섹션 모두 클릭 기록 대상이다', () => {
    renderHome();

    fireEvent.click(openLink('현재 운영 중인 사이트', 2));

    expect(recordClick).toHaveBeenCalledWith(OPERATING[2].id);
    expect(screen.getByText(`${OPERATING[2].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('가운데 클릭(새 탭)도 기록한다', () => {
    renderHome();

    middleClick(openLink('매일 사용하는 사이트'));

    expect(recordClick).toHaveBeenCalledWith(DAILY[0].id);
    expect(screen.getByText(`${DAILY[0].title} · 새 탭으로 이동`)).toBeInTheDocument();
  });

  it('기본 동작을 막지 않는다 — 이동은 브라우저에 맡긴다', () => {
    renderHome();

    // preventDefault 를 부르면 dispatchEvent 가 false 를 돌려준다.
    expect(fireEvent.click(openLink('내 즐겨찾기'))).toBe(true);
    expect(middleClick(openLink('매일 사용하는 사이트'))).toBe(true);
  });

  it('핀을 눌러도 클릭을 기록하지 않는다 (여는 동작이 아니다)', () => {
    renderHome();

    fireEvent.click(pins('내 즐겨찾기')[0]);

    expect(recordClick).not.toHaveBeenCalled();
  });
});

describe('HomeView — 섹션 한 번에 열기 (G4)', () => {
  const DAILY = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);
  const OPERATING = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);
  const FAV_ITEMS = [BOOKMARKS[200], BOOKMARKS[5], BOOKMARKS[40]];

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
        <HomeView data={DATA} isAdmin={false} />
        <Toaster />
      </>,
    );
  }

  /** 그 섹션의 카드가 놓인 순서 그대로 새 탭에 열리고 bulk 로 기록됐는지 본다. */
  function expectOpened(expected: readonly BookmarkWithCount[]): void {
    expect(windowOpen.mock.calls).toEqual(
      expected.map((bookmark) => [bookmark.url, '_blank', 'noopener,noreferrer']),
    );
    // 카드 클릭(F3)과 달리 두 번째 인자가 true 다 — 순위 왜곡을 막는 bulk 플래그(PRD).
    expect(vi.mocked(recordClick).mock.calls).toEqual(
      expected.map((bookmark) => [bookmark.id, true]),
    );
  }

  it('내 즐겨찾기 — 담긴 순서대로 열고 섹션 이름으로 묶는다', () => {
    renderHome();

    fireEvent.click(openAll('내 즐겨찾기'));

    expectOpened(FAV_ITEMS);
    expect(
      screen.getByText(
        '3개를 새 탭으로 엽니다 · 크롬에서 "내 즐겨찾기" 탭 그룹으로 묶어 두면 좋습니다 · 열리지 않으면 팝업 차단을 확인하세요',
      ),
    ).toBeInTheDocument();
  });

  it('매일 사용하는 사이트 — 12개를 연다', () => {
    renderHome();

    fireEvent.click(openAll('매일 사용하는 사이트'));

    expectOpened(DAILY);
    expect(
      screen.getByText(
        '12개를 새 탭으로 엽니다 · 크롬에서 "매일 사용하는 사이트" 탭 그룹으로 묶어 두면 좋습니다 · 열리지 않으면 팝업 차단을 확인하세요',
      ),
    ).toBeInTheDocument();
  });

  it('현재 운영 중인 사이트 — 16개를 연다', () => {
    renderHome();

    fireEvent.click(openAll('현재 운영 중인 사이트'));

    expectOpened(OPERATING);
    expect(
      screen.getByText(
        '16개를 새 탭으로 엽니다 · 크롬에서 "현재 운영 중인 사이트" 탭 그룹으로 묶어 두면 좋습니다 · 열리지 않으면 팝업 차단을 확인하세요',
      ),
    ).toBeInTheDocument();
  });

  it('즐겨찾기가 0개면 열기 버튼이 없어 누를 것도 없다 (DESIGN_SPEC 3장)', () => {
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(
      within(section('내 즐겨찾기')).queryByRole('button', { name: /한 번에 열기$/ }),
    ).not.toBeInTheDocument();
  });

  it('핀을 빼서 줄어든 목록만 연다 — 버튼 라벨과 실제로 여는 수가 같다', () => {
    renderHome();

    fireEvent.click(pins('내 즐겨찾기')[0]);
    vi.mocked(recordClick).mockClear();

    fireEvent.click(openAll('내 즐겨찾기'));

    expectOpened([BOOKMARKS[5], BOOKMARKS[40]]);
  });
});

/**
 * J1. 현장 편집 노출 — 홈은 `isAdmin` 을 받아 **세 섹션 모든 카드**에 그대로 흘린다.
 * 판정은 서버(app/(public)/page.tsx)가 하고, 이 화면은 받은 값을 나르기만 한다.
 */
describe('HomeView — 관리자 편집 노출 (J1)', () => {
  const DAILY_COUNT = BOOKMARKS.filter((bookmark) => bookmark.is_pinned).length;
  const OPERATING_COUNT = BOOKMARKS.filter(
    (bookmark) => bookmark.category_id === OPERATING_ID,
  ).length;

  const edits = () => screen.queryAllByRole('button', { name: /.+ 수정$/ });
  const deletes = () => screen.queryAllByRole('button', { name: /.+ 삭제$/ });

  it('기본(비관리자)에는 연필·휴지통이 한 장도 없다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(edits()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });

  it('isAdmin 이면 세 섹션의 카드 전부에 연필·휴지통이 붙는다 (즐겨찾기 3 + 매일 12 + 운영 16)', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin />);

    const total = FAV_IDS.length + DAILY_COUNT + OPERATING_COUNT;

    expect(total).toBe(31);
    expect(edits()).toHaveLength(total);
    expect(deletes()).toHaveLength(total);
  });

  it('핀을 감춘 섹션(매일·운영 중)에서도 관리자 아이콘은 나온다', () => {
    render(<HomeView data={DATA} isAdmin />);

    const daily = within(section('매일 사용하는 사이트'));

    expect(pins('매일 사용하는 사이트')).toHaveLength(0);
    expect(daily.queryAllByRole('button', { name: /.+ 수정$/ })).toHaveLength(DAILY_COUNT);
    expect(daily.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(DAILY_COUNT);
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
    const { container } = render(<HomeView data={DATA} isAdmin={false} />);

    expect(screen.queryByRole('button', { name: '링크 추가' })).toBeNull();
    expect(container.querySelector('[data-testid="quick-add"]')).toBeNull();
  });

  it('관리자에게는 운영 중 섹션 그리드의 **맨 앞** 칸에 선다', () => {
    render(<HomeView data={DATA} isAdmin />);

    const grid = body(OPERATING_CATEGORY_NAME);

    expect(grid.firstElementChild).toBe(quickAddTile(OPERATING_CATEGORY_NAME));
    // 카드는 한 장도 밀려나지 않는다 — 타일은 한 칸을 더할 뿐이다.
    expect(cards(OPERATING_CATEGORY_NAME)).toHaveLength(
      BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID).length,
    );
  });

  it('파생 목록(즐겨찾기·매일)에는 두지 않는다', () => {
    // 즐겨찾기는 이 브라우저의 localStorage 에서, '매일'은 is_pinned 에서 나온 목록이다 —
    // 거기서 만든 링크는 어느 분류에 들어가는지도, 왜 그 자리에 안 보이는지도 설명할 수 없다.
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin />);

    expect(quickAddTile('내 즐겨찾기')).toBeNull();
    expect(quickAddTile('매일 사용하는 사이트')).toBeNull();
    expect(screen.getAllByRole('button', { name: '링크 추가' })).toHaveLength(1);
  });

  it('기본 분류는 그 섹션의 분류다 — 보고 있는 목록에 한 건 더 붙인다', () => {
    render(<HomeView data={DATA} isAdmin />);

    fireEvent.click(quickAddTile(OPERATING_CATEGORY_NAME)!);

    expect(screen.getByRole('combobox', { name: '분류' })).toHaveValue(OPERATING_ID);
  });

  it('분류 상자에는 모든 분류가 온다 — 홈에서 어느 분류로든 넣을 수 있다', () => {
    render(<HomeView data={DATA} isAdmin />);

    fireEvent.click(quickAddTile(OPERATING_CATEGORY_NAME)!);

    // 상위·하위를 가리지 않는다(둘 다 링크를 담는다). 시드의 분류 수와 같아야 한다.
    expect(screen.getAllByRole('option')).toHaveLength(CATEGORIES.length);
  });

  it('운영 중 분류가 없어 섹션이 접히면 타일도 없다', () => {
    // 홈에 실제 분류 목록이 하나도 없는 데이터다 — 그때는 분류 화면의 타일로 추가한다.
    render(
      <HomeView
        data={{
          categories: CATEGORIES.filter((category) => category.id !== OPERATING_ID),
          bookmarks: DATA.bookmarks,
        }}
        isAdmin
      />,
    );

    expect(screen.queryByRole('button', { name: '링크 추가' })).toBeNull();
  });
});

/**
 * J2. 카드 인라인 편집 — 홈은 **섹션 세 곳의 카드 렌더 지점 전부**에 같은 배선을 흘린다.
 *
 * 폼 자체(필드 구성·수치·저장 실패 처리)는 `components/card/InlineEdit.test.tsx` 가 고정한다.
 * 여기서 보는 것은 화면의 몫인 두 가지다 — **어느 카드가 폼으로 바뀌는가**와
 * **동시에 한 장만인가**(DESIGN_SPEC 2-1).
 */
describe('HomeView — 카드 인라인 편집 (J2)', () => {
  const FAV_FIRST = BOOKMARKS[200];
  const DAILY_ITEMS = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);
  const DAILY_FIRST = DAILY_ITEMS[0];
  const OPERATING_ITEMS = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

  /**
   * 운영 중 섹션에만 있는 카드. 시드에는 **매일과 운영 중에 함께 놓이는 링크가 셋** 있어
   * (구글 드라이브·ITCONNECT·itconnect.co.kr) 아무 카드나 고르면 폼이 두 자리에 열린다 —
   * 그것은 의도된 동작이라 아래 별도 테스트가 따로 못박는다.
   */
  const OPERATING_ONLY_INDEX = OPERATING_ITEMS.findIndex((bookmark) => !bookmark.is_pinned);
  const OPERATING_ONLY = OPERATING_ITEMS[OPERATING_ONLY_INDEX];

  /** 매일·운영 중 두 섹션에 함께 놓이는 링크 — 카드는 둘이지만 링크는 하나다. */
  const SHARED = OPERATING_ITEMS.find((bookmark) => bookmark.is_pinned)!;

  /** 섹션의 n 번째 카드에 붙은 연필. 같은 링크가 두 섹션에 나올 수 있어 카드 안에서 찾는다. */
  const pencil = (name: string, index = 0) =>
    within(cards(name)[index]).getByRole('button', { name: /.+ 수정$/ });

  const formIn = (name: string, index = 0) => within(cards(name)[index]).getByRole('form');
  const forms = () => screen.queryAllByRole('form');

  function renderHome() {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin />);
  }

  beforeEach(() => {
    vi.mocked(updateBookmark).mockReset();
    vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
  });

  it('연필을 누르면 그 카드의 본문·하단이 편집 폼으로 바뀐다', () => {
    renderHome();

    fireEvent.click(pencil('내 즐겨찾기'));

    const card = cards('내 즐겨찾기')[0];

    expect(within(card).getByRole('form', { name: `${FAV_FIRST.title} 수정` })).toBeInTheDocument();
    expect(within(card).getByRole('textbox', { name: '이름' })).toHaveValue(FAV_FIRST.title);
    // 교체 범위는 본문 + 하단 줄이다 — 본문 앵커가 사라지고 상단 액션 줄은 남는다(LinkCard J1 계약).
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: `${FAV_FIRST.title} 수정` })).toBeInTheDocument();
  });

  it('폼을 연 카드 말고는 그대로다', () => {
    renderHome();

    fireEvent.click(pencil('내 즐겨찾기'));

    expect(forms()).toHaveLength(1);
    expect(within(cards('내 즐겨찾기')[1]).getByRole('link')).toBeInTheDocument();
  });

  it('다른 카드의 연필을 누르면 앞 카드의 폼이 닫힌다 — 동시에 한 장만', () => {
    renderHome();

    fireEvent.click(pencil('내 즐겨찾기', 0));
    fireEvent.click(pencil('내 즐겨찾기', 1));

    expect(forms()).toHaveLength(1);
    expect(formIn('내 즐겨찾기', 1)).toBeInTheDocument();
  });

  it('섹션이 달라도 한 장만 열린다 — 세 렌더 지점이 같은 상태를 나눠 쓴다', () => {
    renderHome();

    fireEvent.click(pencil('내 즐겨찾기'));
    expect(formIn('내 즐겨찾기')).toHaveAccessibleName(`${FAV_FIRST.title} 수정`);

    fireEvent.click(pencil('매일 사용하는 사이트'));
    expect(forms()).toHaveLength(1);
    expect(formIn('매일 사용하는 사이트')).toHaveAccessibleName(`${DAILY_FIRST.title} 수정`);

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

    const dailyIndex = DAILY_ITEMS.findIndex((bookmark) => bookmark.id === SHARED.id);

    fireEvent.click(pencil('매일 사용하는 사이트', dailyIndex));

    expect(screen.getAllByRole('form', { name: `${SHARED.title} 수정` })).toHaveLength(2);
    expect(forms()).toHaveLength(2);
  });

  it('저장에 성공하면 그 링크의 patch 를 보내고 폼이 닫힌다', async () => {
    renderHome();

    fireEvent.click(pencil('매일 사용하는 사이트'));
    fireEvent.change(within(cards('매일 사용하는 사이트')[0]).getByRole('textbox', { name: '이름' }), {
      target: { value: '고친 이름' },
    });
    await act(async () => {
      fireEvent.click(within(cards('매일 사용하는 사이트')[0]).getByRole('button', { name: '저장' }));
    });

    expect(updateBookmark).toHaveBeenCalledWith(DAILY_FIRST.id, { title: '고친 이름' });
    expect(forms()).toHaveLength(0);
    // 화면의 값은 서버가 다시 그려 준다(액션의 revalidatePath) — 이 테스트의 props 는 그대로다.
    expect(within(cards('매일 사용하는 사이트')[0]).getByRole('link')).toBeInTheDocument();
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
   * 일도 하지 않는다 — 위 테스트들은 세 섹션을 이름으로 짚어 보므로 새 섹션을 보지 못한다.
   * 그래서 화면에 있는 연필을 **전수** 눌러 본다.
   */
  it('화면의 연필 전부가 폼을 연다 — 배선을 빠뜨린 렌더 지점이 없다', () => {
    renderHome();

    const all = screen.getAllByRole('button', { name: /.+ 수정$/ });
    expect(all).toHaveLength(31);

    for (const button of all) {
      fireEvent.click(button);
      // 같은 링크가 두 섹션에 놓이면 폼도 두 자리에 뜬다 — 개수가 아니라 '열렸는가'를 본다.
      expect(forms().length).toBeGreaterThan(0);
    }
  });

  it('비관리자 화면에는 폼을 여는 길이 없다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

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
  const FAV_FIRST = BOOKMARKS[200];
  const DAILY_ITEMS = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);
  const DAILY_FIRST = DAILY_ITEMS[0];
  const OPERATING_ITEMS = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

  /** 운영 중 섹션에만 있는 카드 — 매일과 겹치는 셋을 피한다(J2 describe 와 같은 사정). */
  const OPERATING_ONLY_INDEX = OPERATING_ITEMS.findIndex((bookmark) => !bookmark.is_pinned);
  const OPERATING_ONLY = OPERATING_ITEMS[OPERATING_ONLY_INDEX];

  /** 매일·운영 중 두 섹션에 함께 놓이는 링크 — 카드는 둘이지만 링크는 하나다. */
  const SHARED = OPERATING_ITEMS.find((bookmark) => bookmark.is_pinned)!;

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
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin />);
  }

  beforeEach(() => {
    vi.mocked(updateBookmark).mockReset();
    vi.mocked(updateBookmark).mockResolvedValue({ ok: true });
    vi.mocked(deleteBookmark).mockReset();
    vi.mocked(deleteBookmark).mockResolvedValue({ ok: true });
  });

  it('휴지통을 눌러도 지우지 않는다 — 그 카드 위에 확인 오버레이만 뜬다', () => {
    renderHome();

    fireEvent.click(trash('내 즐겨찾기'));

    expect(deleteBookmark).not.toHaveBeenCalled();
    expect(overlays()).toHaveLength(1);
    expect(
      within(cards('내 즐겨찾기')[0]).getByRole('alertdialog', {
        name: `${FAV_FIRST.title} 삭제 확인`,
      }),
    ).toBeInTheDocument();
  });

  it('오버레이는 덧대기다 — 본문은 그대로 남는다', () => {
    renderHome();

    fireEvent.click(trash('내 즐겨찾기'));

    // 편집 폼(교체)과 달리 본문 앵커가 그대로 있다 — 오버레이가 배경으로 덮을 뿐이다.
    const card = cards('내 즐겨찾기')[0];

    expect(within(card).getByRole('link')).toBeInTheDocument();
    expect(within(card).getByRole('alertdialog')).toBe(card.lastElementChild);
  });

  it('오버레이를 연 카드 말고는 그대로다', () => {
    renderHome();

    fireEvent.click(trash('내 즐겨찾기'));

    expect(overlays()).toHaveLength(1);
    expect(within(cards('내 즐겨찾기')[1]).queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('섹션이 달라도 한 링크만 묻는다 — 세 렌더 지점이 같은 상태를 나눠 쓴다', () => {
    renderHome();

    fireEvent.click(trash('내 즐겨찾기'));
    expect(overlays()[0]).toHaveAccessibleName(`${FAV_FIRST.title} 삭제 확인`);

    fireEvent.click(trash('매일 사용하는 사이트'));
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0]).toHaveAccessibleName(`${DAILY_FIRST.title} 삭제 확인`);

    fireEvent.click(trash('현재 운영 중인 사이트', OPERATING_ONLY_INDEX));
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0]).toHaveAccessibleName(`${OPERATING_ONLY.title} 삭제 확인`);
  });

  it('같은 링크가 두 섹션에 놓였으면 두 자리 모두 오버레이가 뜬다 — 지우는 것은 한 건이다', () => {
    renderHome();

    const dailyIndex = DAILY_ITEMS.findIndex((bookmark) => bookmark.id === SHARED.id);

    fireEvent.click(trash('매일 사용하는 사이트', dailyIndex));

    expect(screen.getAllByRole('alertdialog', { name: `${SHARED.title} 삭제 확인` })).toHaveLength(2);
  });

  it('두 자리 중 한쪽에서 확인하면 한 번만 보내고 두 자리가 함께 닫힌다', async () => {
    renderHome();

    const dailyIndex = DAILY_ITEMS.findIndex((bookmark) => bookmark.id === SHARED.id);

    fireEvent.click(trash('매일 사용하는 사이트', dailyIndex));
    await act(async () => {
      fireEvent.click(confirmIn('매일 사용하는 사이트', dailyIndex));
    });

    expect(deleteBookmark).toHaveBeenCalledExactlyOnceWith(SHARED.id);
    expect(overlays()).toHaveLength(0);
  });

  it('확인하면 그 링크의 id 를 보내고 오버레이가 닫힌다', async () => {
    renderHome();

    fireEvent.click(trash('매일 사용하는 사이트'));
    await act(async () => {
      fireEvent.click(confirmIn('매일 사용하는 사이트'));
    });

    expect(deleteBookmark).toHaveBeenCalledWith(DAILY_FIRST.id);
    expect(overlays()).toHaveLength(0);
    // 목록은 서버가 다시 그려 준다(액션의 revalidatePath) — 이 테스트의 props 는 그대로다.
    expect(cards('매일 사용하는 사이트')).toHaveLength(DAILY_ITEMS.length);
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

    fireEvent.click(pencil('내 즐겨찾기'));
    expect(forms()).toHaveLength(1);

    fireEvent.click(trash('매일 사용하는 사이트'));

    expect(forms()).toHaveLength(0);
    expect(overlays()).toHaveLength(1);
  });

  it('편집을 열면 묻고 있던 삭제가 닫힌다 (프로토타입 startEdit)', () => {
    renderHome();

    fireEvent.click(trash('내 즐겨찾기'));
    expect(overlays()).toHaveLength(1);

    fireEvent.click(pencil('매일 사용하는 사이트'));

    expect(overlays()).toHaveLength(0);
    expect(forms()).toHaveLength(1);
  });

  /**
   * 섹션이 늘어날 때 `{...deleting(bookmark)}` 스프레드를 빠뜨리면 그 섹션의 휴지통만 조용히
   * 아무 일도 하지 않는다 — 위 테스트들은 세 섹션을 이름으로 짚어 보므로 새 섹션을 보지 못한다.
   * 그래서 화면에 있는 휴지통을 **전수** 눌러 본다.
   */
  it('화면의 휴지통 전부가 오버레이를 연다 — 배선을 빠뜨린 렌더 지점이 없다', () => {
    renderHome();

    const all = screen.getAllByRole('button', { name: /.+ 삭제$/ });
    expect(all).toHaveLength(31);

    for (const button of all) {
      fireEvent.click(button);
      expect(overlays().length).toBeGreaterThan(0);
    }
  });

  it('비관리자 화면에는 확인 오버레이를 여는 길이 없다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} isAdmin={false} />);

    expect(screen.queryAllByRole('button', { name: /.+ 삭제$/ })).toHaveLength(0);
    expect(overlays()).toHaveLength(0);
  });
});
