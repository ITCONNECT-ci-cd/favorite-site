/** D2. 홈 화면 — DESIGN_SPEC 3장(섹션 3개). */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeView } from '@/components/HomeView';
import { Toaster } from '@/components/Toast';
import { recordClick } from '@/lib/clicks';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { useFavorites } from '@/lib/favorites';
import { rollupCounts } from '@/lib/queries';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { middleClick } from '@/test/events';
import { setFavs, storedFavs } from '@/test/favs';
import { BOOKMARKS, CATEGORIES } from '@/test/fixtures/seed';
import { useToastTimers } from '@/test/toast';

/**
 * 클릭 기록은 네트워크를 타므로 여기서는 부르는지만 본다 — 요청의 모양(keepalive·visitorId·
 * 실패를 삼키는 것)은 `lib/clicks.test.ts` 가 못박는다. 문구 함수(`openToastText`)는 진짜를 쓴다.
 */
vi.mock('@/lib/clicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clicks')>()),
  recordClick: vi.fn(),
}));

/**
 * fixture 는 실시드 그대로다 (`test/fixtures/seed.ts`) — 화면에 적히는 실측치
 * (매일 12 · 운영 중 16)가 시드와 어긋나면 여기서 먼저 깨진다.
 */
const DATA: SiteData = { categories: CATEGORIES, bookmarks: BOOKMARKS };

const OPERATING_ID = CATEGORIES.find(
  (category) => category.parent_id === null && category.name === OPERATING_CATEGORY_NAME,
)!.id;

/** 즐겨찾기 순서 검증용 — sort_order 순서(5 → 40 → 200)와 일부러 다르게 담는다. */
const FAV_IDS = [BOOKMARKS[200].id, BOOKMARKS[5].id, BOOKMARKS[40].id];

const section = (name: string) => screen.getByRole('region', { name });

/** 섹션 본문 — 헤더 다음에 오는 카드 그리드(또는 빈 상태 박스). */
const body = (name: string) => section(name).lastElementChild as HTMLElement;

/** 섹션 안 카드들 — 그리드에 놓인 순서 그대로. */
const cards = (name: string) => [...body(name).children] as HTMLElement[];

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
    render(<HomeView data={DATA} />);

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      '내 즐겨찾기',
      '매일 사용하는 사이트',
      '현재 운영 중인 사이트',
    ]);
  });

  it('섹션 사이를 26px 띄운다 — 모바일은 20px (DESIGN_SPEC 1장 섹션 간격 · 프로토타입 sectionGap)', () => {
    render(<HomeView data={DATA} />);

    expect(screen.getByRole('main')).toHaveClass(
      'flex',
      'flex-col',
      'gap-[20px]',
      'min-[820px]:gap-[26px]',
    );
  });

  it('스펙 3장의 하단 안내 박스는 두지 않는다 (계획서 V6 편차 — 사용자 결정)', () => {
    render(<HomeView data={DATA} />);

    expect(screen.queryByText(/왼쪽 사이드바에서 분류별로/)).not.toBeInTheDocument();
  });

  it('홈에서는 체크 아이콘을 쓰지 않는다 (목록 화면 전용)', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} />);

    expect(screen.queryAllByRole('button', { name: /.+ 선택$/ })).toHaveLength(0);
  });
});

describe('HomeView — 내 즐겨찾기 섹션', () => {
  it('favs(localStorage) 순서 그대로 카드를 놓는다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} />);

    expectCards('내 즐겨찾기', [BOOKMARKS[200], BOOKMARKS[5], BOOKMARKS[40]]);
  });

  it('보조문과 열기 버튼에 담긴 개수를 적는다', () => {
    setFavs(FAV_IDS);
    render(<HomeView data={DATA} />);

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
    render(<HomeView data={DATA} />);

    const pinButtons = pins('내 즐겨찾기');

    expect(pinButtons).toHaveLength(3);
    for (const pin of pinButtons) expect(pin).toHaveAttribute('aria-pressed', 'true');
  });

  it('이제 없는 링크 id 가 favs 에 남아 있어도 건너뛴다', () => {
    setFavs([BOOKMARKS[5].id, '사라진-링크', BOOKMARKS[40].id]);
    render(<HomeView data={DATA} />);

    expectCards('내 즐겨찾기', [BOOKMARKS[5], BOOKMARKS[40]]);
    expect(
      screen.getByText('핀으로 직접 담은 2개 · 이 브라우저에만 저장됩니다'),
    ).toBeInTheDocument();
  });

  it('0개면 열기 버튼 없이 빈 즐겨찾기 안내만 보여준다 (DESIGN_SPEC 3장)', () => {
    render(<HomeView data={DATA} />);

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
    render(<HomeView data={DATA} />);

    const pinned = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);

    expect(pinned).toHaveLength(12);
    expectCards('매일 사용하는 사이트', pinned);
  });

  it('보조문과 열기 버튼을 스펙 문구 그대로 적는다', () => {
    render(<HomeView data={DATA} />);

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
    render(<HomeView data={DATA} />);

    expect(pins('매일 사용하는 사이트')).toHaveLength(0);
  });
});

describe('HomeView — 현재 운영 중인 사이트 섹션', () => {
  it('운영 중 카테고리 소속 16개를 sort_order 순으로 놓는다', () => {
    render(<HomeView data={DATA} />);

    const operating = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

    expect(operating).toHaveLength(16);
    expectCards('현재 운영 중인 사이트', operating);
  });

  it('보조문에 실제 개수를 적는다', () => {
    render(<HomeView data={DATA} />);

    expect(
      within(section('현재 운영 중인 사이트')).getByText('회사가 직접 운영하는 서비스 16개'),
    ).toBeInTheDocument();
  });

  it('"전체 보기" 링크가 열기 버튼 왼쪽에서 그 카테고리로 간다', () => {
    render(<HomeView data={DATA} />);

    const header = section('현재 운영 중인 사이트');
    const all = within(header).getByRole('link', { name: '전체 보기' });
    const open = within(header).getByRole('button', { name: '16개 한 번에 열기' });

    expect(all).toHaveAttribute('href', `/category/${OPERATING_ID}`);
    expect(all.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('카드에 핀을 노출하지 않는다', () => {
    setFavs([BOOKMARKS.find((bookmark) => bookmark.category_id === OPERATING_ID)!.id]);
    render(<HomeView data={DATA} />);

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

    render(<HomeView data={data} />);

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
          bookmarks: BOOKMARKS,
        }}
      />,
    );

    expect(
      screen.queryByRole('region', { name: '현재 운영 중인 사이트' }),
    ).not.toBeInTheDocument();
  });
});

describe('HomeView — 핀 토글 (D6)', () => {
  useToastTimers();

  it('즐겨찾기 카드의 핀을 누르면 그 카드가 곧바로 사라지고 해제 토스트가 뜬다', () => {
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={DATA} />
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
    render(<HomeView data={DATA} />);

    fireEvent.click(pins('내 즐겨찾기')[0]);

    expect(
      screen.getByText('핀으로 직접 담은 2개 · 이 브라우저에만 저장됩니다'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2개 한 번에 열기' })).toBeInTheDocument();
  });

  it('마지막 하나를 빼면 빈 즐겨찾기 안내로 바뀐다', () => {
    setFavs([BOOKMARKS[5].id]);
    render(<HomeView data={DATA} />);

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
        <HomeView data={DATA} />
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
    render(<HomeView data={DATA} />);

    expect(pins('내 즐겨찾기')).toHaveLength(3);
    expect(pins('매일 사용하는 사이트')).toHaveLength(0);
    expect(pins('현재 운영 중인 사이트')).toHaveLength(0);
  });
});

describe('HomeView — 카드 클릭 기록 (F3)', () => {
  const DAILY = BOOKMARKS.filter((bookmark) => bookmark.is_pinned);
  const OPERATING = BOOKMARKS.filter((bookmark) => bookmark.category_id === OPERATING_ID);

  useToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  function renderHome() {
    setFavs(FAV_IDS);
    render(
      <>
        <HomeView data={DATA} />
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
