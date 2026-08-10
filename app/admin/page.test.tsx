import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminPage from '@/app/admin/page';
import CleanupPage from '@/app/admin/cleanup/page';
import StatsPage from '@/app/admin/stats/page';
import { getAllData } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';
import type { BookmarkWithCount, Category } from '@/lib/types';

vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

/**
 * 조회만 갈아 끼운다 — `rollupCounts` 는 진짜를 쓴다. 화면이 패널에 넘기는 숫자가 **사이드바와
 * 같은 규칙**(직속 + 모든 하위)인지가 여기서 볼 것이라, 그 규칙까지 대역으로 바꾸면 아무것도
 * 지키지 못한다.
 */
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData: vi.fn(),
}));

const CATEGORIES: Category[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', parent_id: null, sort_order: 0 },
  { id: 'sub-chat', name: '대화형', parent_id: 'cat-ai', sort_order: 0 },
  { id: 'cat-mkt', name: '마케팅', parent_id: null, sort_order: 1 },
];

/** 클릭 수는 `bookmark_click_counts` 뷰에서 붙어 온 값이다(getAllData → attachCounts). */
function bookmark(
  id: string,
  categoryId: string | null,
  clicks: number,
  source: 'manual' | 'discord' = 'manual',
): BookmarkWithCount {
  return {
    id,
    category_id: categoryId,
    title: id,
    url: `https://example.test/${id}`,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    source,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    click_count: clicks,
  };
}

const BOOKMARKS: BookmarkWithCount[] = [
  bookmark('bm-1', 'cat-ai', 5), // 상위 직속
  bookmark('bm-2', 'sub-chat', 7, 'discord'), // 하위 — 상위 합계에 포함된다
  bookmark('bm-3', 'sub-chat', 1),
  bookmark('bm-4', 'cat-mkt', 0),
];

const linkList = () => screen.getByRole('list', { name: '링크 목록' });

const categoryPanel = () => screen.getByRole('region', { name: '상위 카테고리' });
const categoryRows = () => within(within(categoryPanel()).getByRole('list')).getAllByRole('button');
const headerPanel = () => screen.getByRole('region', { name: '선택한 카테고리' });

/** 셸이 지는 상단 바·탭은 여기 없다 — 화면은 콘텐츠만 만든다(components/admin/AdminShell.tsx). */
const PAGES: Array<[string, () => Promise<ReactElement | null>]> = [
  ['/admin', AdminPage],
  ['/admin/stats', StatsPage],
  ['/admin/cleanup', CleanupPage],
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'admin@example.com' });
  vi.mocked(getAllData).mockResolvedValue({ categories: CATEGORIES, bookmarks: BOOKMARKS });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AdminPage — 카테고리 · 링크 (I1 2단)', () => {
  it.each([undefined, 'false', 'TRUE', '1'])(
    'provider privacy env가 %s이면 자동 favicon 버튼을 비활성화한다',
    async (approval) => {
      vi.stubEnv('DISCORD_FAVICON_PROVIDER_APPROVED', approval);
      render((await AdminPage()) as ReactElement);

      expect(screen.getByRole('button', { name: '자동 파비콘 채우기' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '고아 객체 정리' })).toBeEnabled();
    },
  );

  it('provider privacy env가 exact true일 때만 자동 favicon 버튼을 연다', async () => {
    vi.stubEnv('DISCORD_FAVICON_PROVIDER_APPROVED', 'true');
    render((await AdminPage()) as ReactElement);

    expect(screen.getByRole('button', { name: '자동 파비콘 채우기' })).toBeEnabled();
  });

  it('랜드마크 하나 안에 좌 270px 패널과 우측 헤더 패널을 세운다', async () => {
    const { container } = render((await AdminPage()) as ReactElement);

    const main = container.querySelector('main');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    // <820px 에서 1단으로 접힌다 (DESIGN_SPEC 1장 브레이크포인트 — 관리자 2단 → 1단).
    expect(main).toHaveClass('flex', 'flex-col', 'gap-[20px]', 'min-[820px]:flex-row');
    expect(categoryPanel()).toBeInTheDocument();
    expect(headerPanel()).toBeInTheDocument();
  });

  it('패널에는 상위 카테고리만 올린다 — 하위가 섞이면 정렬 저장이 거부된다', async () => {
    render((await AdminPage()) as ReactElement);

    expect(categoryRows()).toHaveLength(2);
    expect(categoryRows()[0]).toHaveTextContent('AI 도구 모음');
    expect(categoryRows()[1]).toHaveTextContent('마케팅');
    expect(within(categoryPanel()).queryByText('대화형')).not.toBeInTheDocument();
  });

  it('행의 링크 수·클릭 합계는 직속 + 하위다 (사이드바와 같은 규칙)', async () => {
    render((await AdminPage()) as ReactElement);

    // AI 도구 모음: 직속 1건(5회) + 하위 2건(7·1회).
    expect(within(categoryRows()[0]).getByText('3개')).toBeInTheDocument();
    expect(within(categoryRows()[0]).getByText('13회')).toBeInTheDocument();
    expect(within(categoryRows()[1]).getByText('1개')).toBeInTheDocument();
  });

  it('총계는 상위 카테고리 수와 전체 링크 수다', async () => {
    render((await AdminPage()) as ReactElement);

    expect(within(categoryPanel()).getByText('2개 카테고리 · 링크 4개')).toBeInTheDocument();
  });

  it('우측 헤더는 처음에 첫 카테고리를 보여 준다', async () => {
    render((await AdminPage()) as ReactElement);

    expect(within(headerPanel()).getByText('AI 도구 모음')).toBeInTheDocument();
    expect(within(headerPanel()).getByText('3개 링크')).toBeInTheDocument();
  });

  /**
   * I2 — 하위 줄은 헤더와 **같은 상자**에 들어가고, 그 안의 칩은 서버가 접어 내린 목록이다.
   * 줄이 무엇을 할 수 있는지는 `components/admin/SubCategoryRow.test.tsx` 가 본다.
   */
  it('헤더 패널 안에 선택한 카테고리의 하위 칩 줄이 붙는다', async () => {
    render((await AdminPage()) as ReactElement);

    const subRow = within(headerPanel()).getByRole('group', { name: '하위 카테고리' });

    expect(within(subRow).getByText('대화형')).toBeInTheDocument();
    // 하위 개수는 그 하위에 달린 링크 수다 (bm-2 · bm-3).
    expect(within(subRow).getByText('2개')).toBeInTheDocument();
  });

  /**
   * I3 — 링크 추가 줄은 헤더 패널 **다음 상자**이고, 선택 상태를 헤더와 함께 본다(prop 이 아니다).
   * 줄이 무엇을 하는지는 `components/admin/LinkAddRow.test.tsx` 가 본다.
   */
  it('헤더 패널 다음 상자로 링크 추가 줄이 선다', async () => {
    render((await AdminPage()) as ReactElement);

    const linkBox = screen.getByRole('region', { name: '링크' });

    expect(headerPanel().compareDocumentPosition(linkBox)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(linkBox).getByRole('button', { name: '‘AI 도구 모음’에 추가' })).toBeInTheDocument();
  });

  /**
   * I4 — 링크 표는 추가 줄과 **같은 상자** 안, 추가 줄 아래다. 표가 무엇을 할 수 있는지는
   * `components/admin/LinkTable.test.tsx` 가 본다. 여기서 보는 것은 **화면이 무엇을 접어
   * 내리는가**다: 선택한 상위의 트리 전체(직속 + 하위)이고, 다른 상위의 링크는 섞이지 않는다.
   */
  it('링크 추가 줄과 같은 상자 안, 그 아래로 링크 표가 붙는다', async () => {
    render((await AdminPage()) as ReactElement);

    const linkBox = screen.getByRole('region', { name: '링크' });
    const addRow = within(linkBox).getByRole('form', { name: '링크 추가' });

    expect(linkBox).toContainElement(linkList());
    expect(addRow.compareDocumentPosition(linkList())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  /**
   * I5 — 필터 줄은 추가 줄과 표 **사이**다(프로토타입의 상자 안 차례: 추가 줄 360행 → 필터 줄
   * 367행 → 표 382행). 줄이 무엇을 할 수 있는지는 `components/admin/FilterRow.test.tsx` 가 본다.
   */
  it('링크 추가 줄과 표 사이에 필터 줄이 선다', async () => {
    render((await AdminPage()) as ReactElement);

    const linkBox = screen.getByRole('region', { name: '링크' });
    const addRow = within(linkBox).getByRole('form', { name: '링크 추가' });
    const filterRow = within(linkBox).getByTestId('filter-row');

    expect(addRow.compareDocumentPosition(filterRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(filterRow.compareDocumentPosition(linkList())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  /**
   * 칩의 숫자는 표에 오르는 목록과 **같은 한 벌**에서 나온다 — 화면이 링크 목록을 두 번 접으면
   * 칩이 세는 것과 표가 그리는 것이 갈라질 수 있다.
   */
  it('필터 칩은 표에 오른 목록을 센다 (전체 · 하위별 · 하위 미지정)', async () => {
    render((await AdminPage()) as ReactElement);

    const chipRow = screen.getByRole('group', { name: '하위 카테고리 필터' });

    expect(within(chipRow).getAllByRole('button').map((chip) => chip.textContent)).toEqual([
      '전체 3',
      '대화형 2',
      '하위 미지정 1',
    ]);
  });

  it('표에는 선택한 상위의 트리 전체가 오른다 — 하위 소속 링크도 함께다', async () => {
    render((await AdminPage()) as ReactElement);

    const rows = within(linkList()).getAllByRole('listitem');

    // AI 도구 모음: 직속 bm-1 + 하위(대화형) bm-2·bm-3. 마케팅의 bm-4 는 들어오지 않는다.
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) =>
        (within(row).getByRole('textbox', { name: / 제목$/ }) as HTMLInputElement).value,
      ),
    ).toEqual(['bm-1', 'bm-2', 'bm-3']);
    expect(within(linkList()).queryByRole('textbox', { name: 'bm-4 제목' })).not.toBeInTheDocument();
  });

  it('행이 든 값은 표가 그리는 여섯 칸뿐이다 (클릭 수·고정·하위 배정)', async () => {
    render((await AdminPage()) as ReactElement);

    const row = within(linkList()).getAllByRole('listitem')[1];

    expect(row).toHaveTextContent('7'); // bm-2 의 클릭 수 (뷰에서 붙어 온 값)
    expect(within(row).getByRole('combobox', { name: 'bm-2 하위 카테고리' })).toHaveValue('sub-chat');
    expect(within(row).getByRole('button', { name: 'bm-2 매일 고정' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(row).getByTestId('source-badge')).toHaveTextContent('자동');
  });

  it('하위 select 의 옵션은 하위 칩 줄과 같은 목록이다 (한 번 접어 둘이 나눠 쓴다)', async () => {
    render((await AdminPage()) as ReactElement);

    const select = within(linkList()).getByRole('combobox', { name: 'bm-1 하위 카테고리' });

    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '—',
      '대화형',
    ]);
  });

  it('카테고리는 있고 링크가 없으면 표 대신 한 줄로 알린다', async () => {
    vi.mocked(getAllData).mockResolvedValue({ categories: CATEGORIES, bookmarks: [] });
    render((await AdminPage()) as ReactElement);

    expect(screen.queryByRole('list', { name: '링크 목록' })).not.toBeInTheDocument();
    expect(
      screen.getByText('아직 링크가 없습니다. 위 줄에서 첫 링크를 추가하세요.'),
    ).toBeInTheDocument();
  });

  it('갈 곳 없는 링크(카테고리 없음·끊긴 카테고리)는 어느 표에도 오르지 않는다', async () => {
    vi.mocked(getAllData).mockResolvedValue({
      categories: CATEGORIES,
      bookmarks: [...BOOKMARKS, bookmark('bm-orphan', null, 3), bookmark('bm-gone', 'cat-gone', 4)],
    });
    render((await AdminPage()) as ReactElement);

    expect(within(linkList()).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(/bm-orphan|bm-gone/)).not.toBeInTheDocument();
  });
});

/*
 * (삭제됨) 자리 표시 화면 블록 — 통계·정리 도구가 자리 표시였을 때 "준비 중" 한 줄을 확인하던
 * 곳이다. 이제 둘 다 실제 화면으로 들어왔고(K2 → `app/admin/stats/page.test.tsx`,
 * M2 → `app/admin/cleanup/page.test.tsx`) 각자 전용 테스트가 본다. 탭이 404 가 아닌지는
 * 아래 소스 스캔 블록이 계속 강제한다(디렉터리에서 page 를 찾아 미인증 렌더를 실행).
 */

/**
 * **미인증 요청에는 아무것도 그리지 않는다.**
 *
 * 레이아웃이 children 을 렌더하지 않아도 Next 는 page 를 렌더해 응답의 RSC 페이로드에
 * 실어 보낸다 — 화면에 안 보일 뿐 HTML 안에는 들어간다(H2 통합 검증에서 dev·프로덕션
 * 양쪽 실측). 그래서 화면 스스로 한 번 더 막는다. 아래 소스 스캔이 "부르긴 하는가"까지만
 * 본다면, 이 단언은 "부른 결과로 실제 아무것도 내보내지 않는가"를 본다.
 */
describe('관리 화면 — 미인증 요청', () => {
  beforeEach(() => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
  });

  it.each(PAGES)('%s 는 본문을 만들지 않는다', async (_path, Page) => {
    expect(await Page()).toBeNull();
  });

  it.each(PAGES)('%s 는 페이로드에 아무 내용도 싣지 않는다', async (_path, Page) => {
    const { container } = render(<>{await Page()}</>);

    expect(container.textContent).toBe('');
  });
});

/**
 * I·K·M 시리즈가 붙일 **모든** 관리 화면에 같은 규칙을 건다.
 *
 * 위 단언들은 지금 존재하는 화면만 지킨다. 새 관리 화면이 이 줄을 빼먹으면 그 화면의 내용이
 * 미인증 요청의 HTML 로 새어 나가는데, 화면에는 보이지 않아 눈으로는 절대 안 잡힌다.
 */
describe('app/admin 아래 모든 page 가 자기 세션을 다시 확인한다', () => {
  const ADMIN_DIR = join(process.cwd(), 'app/admin');

  /** 확장자를 가리지 않는다 — `page.jsx` 로 붙인 화면이 규칙 밖으로 새지 않게. */
  const PAGE_FILE = /^page\.(t|j)sx?$/;

  /**
   * 부르기만 해서는 부족하다. `getAdminSession()` 을 부르고 **그 결과로 아무것도 그리지 않는
   * 데까지** 가야 미인증 페이로드가 비어 있다. 사이에 `=== null)` 정도만 들어가므로 200자면
   * 넉넉하고, "부르고 나서 한참 뒤 어딘가에서 null 을 돌려준다"는 다른 코드까지 통과시키지는
   * 않는다.
   */
  const GUARD = /getAdminSession\(\)[\s\S]{0,200}return null/;

  function adminPages(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return adminPages(path);

      return PAGE_FILE.test(entry.name) ? [path] : [];
    });
  }

  const pages = adminPages(ADMIN_DIR);

  it('훑을 page 를 실제로 찾았다', () => {
    // 탭 3개가 가리키는 화면이 전부 있어야 한다 — 하나라도 없으면 그 탭은 404 다.
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * **본 단언** — 찾아낸 page 를 그 자리에서 불러 실제로 실행한다.
   *
   * 위쪽 `PAGES` 배열은 손으로 등록한 셋뿐이라 새 화면이 자동으로 들어오지 않는다. 여기서는
   * 디렉터리에서 찾은 경로를 그대로 import 하므로, I·K·M 시리즈가 화면을 붙이는 순간
   * 등록 없이도 이 단언에 걸린다. 파일 경로로 부르는 것이라 `@/` 별칭 목록과도 어긋나지 않는다.
   */
  /**
   * 스캔이 찾아낸 화면에 넘길 최소 props.
   *
   * 인자 없이 부르면 지금은 통과하지만, 동적 세그먼트를 가진 관리 화면(`admin/links/[id]`
   * 같은 것)이 생기는 순간 본문의 `await params` 가 `undefined` 를 만나 TypeError 로 터진다 —
   * **게이트가 뚫린 것이 아닌데 이 단언이 빨개진다.** 그건 이 테스트가 지키려는 것이 아니므로
   * 미리 스텁을 넘긴다. 게이트는 props 를 보기 전에 세션부터 확인하므로 값은 비어 있어도 된다
   * (Next 16 에서 둘 다 Promise 다).
   */
  const PAGE_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

  it.each(pages)('%s 는 미인증이면 아무것도 그리지 않는다', async (path) => {
    vi.mocked(getAdminSession).mockResolvedValue(null);

    const loaded: unknown = await import(/* @vite-ignore */ pathToFileURL(path).href);
    const Page = (loaded as { default: (props: typeof PAGE_PROPS) => Promise<unknown> }).default;

    expect(typeof Page).toBe('function');
    expect(await Page(PAGE_PROPS)).toBeNull();
    // 모킹이 이 모듈까지 닿았다는 증거 — 안 닿았다면 진짜 세션 조회가 돌아 위 null 이
    // 다른 이유로 나왔을 수 있다. 그러면 이 단언은 아무것도 지키지 않는다.
    expect(getAdminSession).toHaveBeenCalled();
  });

  /**
   * 보조 단언 — 위 실행 단언이 본체고, 이것은 **모양**을 잠근다.
   *
   * 실행만 보면 "세션을 안 보고 늘 null 을 돌려주는 화면"도 통과한다(I1 이 내용을 채우다
   * 잠시 그런 상태를 만들 수 있다). 그래서 `getAdminSession()` 을 부르고 그 결과로 곧장
   * null 을 돌려주는 형태까지 본다. 사이에 `=== null)` 정도만 들어가므로 200자면 넉넉하다.
   *
   * ⚠️ 이것만 빨개졌다면 위반이 아니라 **형태 차이**일 수 있다 — 게이트를 헬퍼로 뽑거나 사이에
   * 코드가 길어지면 200자 창을 넘긴다. 위 실행 단언이 초록인지부터 보고, 그렇다면 게이트를
   * 되돌리지 말고 이 창(또는 정규식)을 새 형태에 맞춰라.
   */
  it.each(pages)('%s 가 세션을 보고 나서 null 을 돌려준다 (소스)', (path) => {
    // 주석은 블록·줄 둘 다 걷어낸다 — 규칙을 설명하는 주석 자체가 통과 근거가 되면 안 된다.
    const code = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).toMatch(GUARD);
  });
});
