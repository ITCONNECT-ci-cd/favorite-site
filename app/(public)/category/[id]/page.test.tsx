/**
 * D3. 카테고리 페이지 라우팅 계약 — `/category/<id>`.
 *
 * fixture 는 실시드 그대로다 (`test/fixtures/seed.ts`) — 손으로 적은 숫자가 아니라 시드가 DB 에
 * 넣을 바로 그 형태라, 개수 기대값이 시드와 어긋나면 여기서 먼저 깨진다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CategoryPage, { generateMetadata } from '@/app/(public)/category/[id]/page';
import { OPERATING_CATEGORY_NAME } from '@/lib/constants';
import { getAdminSession } from '@/lib/supabase/server';
import type { BookmarkWithCount, SiteData } from '@/lib/types';
import { adminSession } from '@/test/admin-session';
import { siteData, subId, topId } from '@/test/fixtures/seed';
import { PENCIL_PATH } from '@/test/icon-paths';

const getAllData = vi.hoisted(() => vi.fn());

// 페이지는 서버 컴포넌트라 Supabase 를 직접 부른다. 조회만 갈아 끼우고 롤업 등 나머지 순수 함수는
// 진짜를 그대로 쓴다 — 화면에 찍히는 숫자가 D1 의 계산과 같은지까지 이 테스트가 본다.
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData,
}));

// 인증 관문(H1)의 결과에 따라 화면이 무엇을 그리는지만 본다 — 판정은 그 파일의 테스트 몫이다.
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

/** 서버 컴포넌트를 그대로 await 해 결과 트리를 그린다 (params 는 Next 16 에서 Promise 다). */
async function renderPage(id: string) {
  return render(await CategoryPage({ params: Promise.resolve({ id }) }));
}

function cardCount(container: HTMLElement): number {
  return container.querySelector('.grid')?.children.length ?? 0;
}

/** 규칙만 보는 테스트용 최소 북마크 — 제목이 곧 id다. */
function makeBookmark(title: string, categoryId: string): BookmarkWithCount {
  return {
    id: title,
    category_id: categoryId,
    title,
    url: `https://example.com/${title}`,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    click_count: 0,
  };
}

const chip = (name: string | RegExp) => screen.getByRole('button', { name });
const chipRow = () => screen.getByRole('group', { name: '하위 분류' });

beforeEach(() => {
  localStorage.clear();
  getAllData.mockReset();
  getAllData.mockResolvedValue(siteData() satisfies SiteData);
  vi.mocked(getAdminSession).mockReset();
  vi.mocked(getAdminSession).mockResolvedValue(null);
});

describe('상위 카테고리로 들어왔을 때', () => {
  it('제목·개수와 하위 탭 칩 줄을 그린다 — AI 도구 모음 118건 / 하위 10개', async () => {
    const { container } = await renderPage(topId('AI 도구 모음'));

    expect(screen.getByRole('heading', { name: 'AI 도구 모음' })).toBeInTheDocument();
    expect(screen.getByText('118개')).toBeInTheDocument();
    expect(chip('전체 118')).toHaveAttribute('aria-pressed', 'true');
    // 전체 + 하위 10개
    expect(chipRow().children).toHaveLength(11);
    expect(chip('대화·검색 26')).toBeInTheDocument();
    expect(screen.getByText('아래 탭으로 좁혀서 봅니다.')).toBeInTheDocument();
    expect(cardCount(container)).toBe(118);
  });

  it('하위 링크까지 전부 담는다 — 참고자료 47 = 도구·서비스 30 + 학습·리서치 17', async () => {
    const { container } = await renderPage(topId('참고자료'));

    expect(screen.getByText('47개')).toBeInTheDocument();
    expect(chip('도구·서비스 30')).toBeInTheDocument();
    expect(chip('학습·리서치 17')).toBeInTheDocument();
    expect(cardCount(container)).toBe(47);
  });

  it('하위가 없는 분류는 칩 줄이 없다 — 마케팅 21건', async () => {
    const { container } = await renderPage(topId('마케팅'));

    expect(screen.getByRole('heading', { name: '마케팅' })).toBeInTheDocument();
    expect(screen.getByText('21개')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '하위 분류' })).toBeNull();
    expect(container.querySelector('p')).toBeNull(); // 설명도 없다 (스크린샷 01-shot)
    expect(cardCount(container)).toBe(21);
  });

  it('운영 중인 사이트 분류에는 프로토타입의 설명 문구가 붙는다 — 16건', async () => {
    const { container } = await renderPage(topId(OPERATING_CATEGORY_NAME));

    expect(screen.getByRole('heading', { name: OPERATING_CATEGORY_NAME })).toBeInTheDocument();
    expect(screen.getByText('회사가 직접 운영하는 서비스와 관리 도구')).toBeInTheDocument();
    expect(cardCount(container)).toBe(16);
  });
});

describe('하위 카테고리 id 로 들어왔을 때 (사이드바의 하위 링크)', () => {
  it('404 가 아니라 상위 페이지를 그리고 그 하위 탭을 선택해 둔다', async () => {
    const { container } = await renderPage(subId('AI 도구 모음', '대화·검색'));

    // 제목은 상위 이름이다.
    expect(screen.getByRole('heading', { name: 'AI 도구 모음' })).toBeInTheDocument();
    expect(chip('대화·검색 26')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('전체 118')).toHaveAttribute('aria-pressed', 'false');

    // 본문은 그 하위 링크만 26건이고, 머리말 개수도 함께 줄어든다.
    expect(cardCount(container)).toBe(26);
    expect(screen.getByText('26개')).toBeInTheDocument();
  });

  it('다른 분류에 갔다 돌아오면 앞서 고른 하위 탭이 남지 않는다', async () => {
    const ai = topId('AI 도구 모음');
    const view = await renderPage(ai);

    fireEvent.click(chip(/^영상 \d+$/));
    expect(chip(/^영상 \d+$/)).toHaveAttribute('aria-pressed', 'true');

    // 사이드바로 다른 분류에 들렀다가 돌아온다 — 화면이 바뀌었으므로 선택은 버려야 한다.
    view.rerender(await CategoryPage({ params: Promise.resolve({ id: topId('마케팅') }) }));
    view.rerender(await CategoryPage({ params: Promise.resolve({ id: ai }) }));

    expect(chip('전체 118')).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^영상 \d+$/)).toHaveAttribute('aria-pressed', 'false');
    expect(cardCount(view.container)).toBe(118);
  });

  it('다른 하위(학습·리서치 17)도 같은 방식으로 열린다', async () => {
    const { container } = await renderPage(subId('참고자료', '학습·리서치'));

    expect(screen.getByRole('heading', { name: '참고자료' })).toBeInTheDocument();
    expect(chip('학습·리서치 17')).toHaveAttribute('aria-pressed', 'true');
    expect(cardCount(container)).toBe(17);
  });
});

describe('그 밖의 계약', () => {
  it('없는 id 는 notFound() 다', async () => {
    const error = await CategoryPage({ params: Promise.resolve({ id: '없는-id' }) }).then(
      () => null,
      (caught: unknown) => caught as { digest?: string },
    );

    expect(error).not.toBeNull();
    expect(error?.digest).toMatch(/^NEXT_(HTTP_ERROR_FALLBACK;404|NOT_FOUND)$/);
  });

  it('빈 분류는 안내 박스를 보인다', async () => {
    getAllData.mockResolvedValue({
      categories: [{ id: '빈분류', name: '빈 분류', parent_id: null, sort_order: 0 }],
      bookmarks: [],
    } satisfies SiteData);

    const { container } = await renderPage('빈분류');

    expect(screen.getByText('이 분류에 링크가 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('0개')).toBeInTheDocument();
    expect(cardCount(container)).toBe(0);
  });

  it('부모가 사라진 하위(데이터 손상)는 404 대신 자기 자신을 상위처럼 그린다', async () => {
    getAllData.mockResolvedValue({
      categories: [{ id: '고아', name: '고아 분류', parent_id: '사라진부모', sort_order: 0 }],
      bookmarks: [makeBookmark('고아링크', '고아')],
    } satisfies SiteData);

    const { container } = await renderPage('고아');

    expect(screen.getByRole('heading', { name: '고아 분류' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '하위 분류' })).toBeNull();
    expect(screen.getByText('1개')).toBeInTheDocument();
    expect(cardCount(container)).toBe(1);
  });

  it("'전체'는 상위 직속 링크와 하위 링크를 모두 담는다", async () => {
    getAllData.mockResolvedValue({
      categories: [
        { id: 'top', name: '상위', parent_id: null, sort_order: 0 },
        { id: 'sub', name: '하위', parent_id: 'top', sort_order: 0 },
        { id: '남', name: '남의 분류', parent_id: null, sort_order: 1 },
      ],
      bookmarks: [
        makeBookmark('직속', 'top'),
        makeBookmark('하위것', 'sub'),
        makeBookmark('남의것', '남'),
      ],
    } satisfies SiteData);

    const { container } = await renderPage('top');

    expect(cardCount(container)).toBe(2);
    expect(screen.getByText('직속')).toBeInTheDocument();
    expect(screen.getByText('하위것')).toBeInTheDocument();
    expect(screen.queryByText('남의것')).toBeNull();
    expect(chip('전체 2')).toBeInTheDocument();
    expect(chip('하위 1')).toBeInTheDocument();
  });

  it('탭 제목이 분류 이름이다 — 꼬리표는 셸의 title template 이 붙인다 (D5)', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: topId('마케팅') }) });

    expect(meta.title).toBe('마케팅');
  });

  it('하위 id 로 들어와도 탭 제목은 화면 제목(상위 이름)과 같다', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ id: subId('AI 도구 모음', '대화·검색') }),
    });

    expect(meta.title).toBe('AI 도구 모음');
  });

  it('없는 id 는 제목을 대지 않는다 — 셸의 default 가 남고 404 판정은 본문 몫이다', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: '없는-id' }) });

    expect(meta).toEqual({});
  });

  it('revalidate 를 내보내지 않는다 — 이 페이지는 매 요청 렌더가 의도다 (lib/queries.ts)', async () => {
    const pageModule = await import('@/app/(public)/category/[id]/page');

    expect(pageModule).not.toHaveProperty('revalidate');
  });
});

/**
 * J1. 현장 편집 노출 — 서버가 관리자로 확인했을 때만 연필·휴지통이 렌더된다.
 * 비로그인 응답에는 마크업 자체가 없어야 한다(README 주의사항 7).
 */
describe('카테고리 — 관리자 편집 노출 (J1)', () => {
  const edits = () => screen.queryAllByRole('button', { name: /.+ 수정$/ });
  const deletes = () => screen.queryAllByRole('button', { name: /.+ 삭제$/ });

  it('비로그인 렌더에는 연필·휴지통이 없다 — 아이콘 마크업도 남지 않는다', async () => {
    const { container } = await renderPage(topId('AI 도구 모음'));

    expect(edits()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
    expect(container.innerHTML).not.toContain(PENCIL_PATH);
  });

  it('관리자 세션이면 보이는 카드마다 연필·휴지통이 붙는다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    const { container } = await renderPage(topId('AI 도구 모음'));

    // 기대값을 cardCount 로 적으면 카드가 0장인 회귀에서 `0 === 0` 으로 통과해 버린다 —
    // "카드마다 붙는다"를 확인하려면 카드가 실제로 있었다는 사실이 먼저 서야 한다.
    expect(cardCount(container)).toBe(118);
    expect(edits()).toHaveLength(cardCount(container));
    expect(deletes()).toHaveLength(cardCount(container));
  });

  it('하위 id 로 들어와도 같다 — 좁혀진 목록에만 붙는다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    const { container } = await renderPage(subId('AI 도구 모음', '대화·검색'));

    expect(cardCount(container)).toBeGreaterThan(0);
    expect(edits()).toHaveLength(cardCount(container));
  });

  it('세션 판정은 getAdminSession 하나로만 한다 — 요청당 한 번', async () => {
    await renderPage(topId('AI 도구 모음'));

    expect(getAdminSession).toHaveBeenCalledTimes(1);
  });
});
