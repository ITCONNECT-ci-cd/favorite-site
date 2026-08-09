/**
 * 홈 페이지 — `/`.
 *
 * 섹션을 나누는 규칙과 화면 수치는 `components/HomeView.test.tsx` 가 지킨다. 여기서는 **서버
 * 컴포넌트가 무엇을 읽어 무엇을 내려보내는가**만 본다 — 특히 관리자 세션(J1)이 그것이다.
 *
 * fixture 는 실시드 그대로다 (`test/fixtures/seed.ts`).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '@/app/(public)/page';
import { getAdminSession } from '@/lib/supabase/server';
import type { SiteData } from '@/lib/types';
import { adminSession } from '@/test/admin-session';
import { siteData } from '@/test/fixtures/seed';
import { PENCIL_PATH, TRASH_PATH } from '@/test/icon-paths';

const getAllData = vi.hoisted(() => vi.fn());

// 페이지는 서버 컴포넌트라 Supabase 를 직접 부른다. 조회만 갈아 끼우고 나머지는 진짜를 쓴다.
vi.mock('@/lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries')>()),
  getAllData,
}));

// 인증 관문(H1)의 결과에 따라 화면이 무엇을 그리는지만 본다 — 판정은 그 파일의 테스트 몫이다.
vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));

/** 서버 컴포넌트를 그대로 await 해 결과 트리를 그린다. */
async function renderPage() {
  return render(await Home());
}

const edits = () => screen.queryAllByRole('button', { name: /.+ 수정$/ });
const deletes = () => screen.queryAllByRole('button', { name: /.+ 삭제$/ });

beforeEach(() => {
  localStorage.clear();
  getAllData.mockReset();
  getAllData.mockResolvedValue(siteData() satisfies SiteData);
  vi.mocked(getAdminSession).mockReset();
  vi.mocked(getAdminSession).mockResolvedValue(null);
});

describe('홈 — 데이터 배선', () => {
  it('getAllData 한 벌을 그대로 화면에 넘긴다 — 세 섹션이 선다', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: '내 즐겨찾기' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '매일 사용하는 사이트' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '현재 운영 중인 사이트' })).toBeInTheDocument();
  });

  it('revalidate 를 내보내지 않는다 — 매 요청 렌더가 의도다 (lib/queries.ts)', async () => {
    const pageModule = await import('@/app/(public)/page');

    expect(pageModule).not.toHaveProperty('revalidate');
  });
});

/**
 * J1. 현장 편집 노출 — 연필·휴지통은 **서버가 관리자로 확인했을 때만** 렌더된다.
 * 비로그인 응답에는 마크업 자체가 없어야 한다(README 주의사항 7).
 */
describe('홈 — 관리자 편집 노출 (J1)', () => {
  it('비로그인 렌더에는 연필·휴지통이 없다 — 아이콘 마크업도 남지 않는다', async () => {
    const { container } = await renderPage();

    expect(edits()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
    expect(container.innerHTML).not.toContain(PENCIL_PATH);
    expect(container.innerHTML).not.toContain(TRASH_PATH);
  });

  it('관리자 세션이면 매일 12 · 운영 중 16 카드 전부에 연필·휴지통이 붙는다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    await renderPage();

    // 즐겨찾기 섹션은 비어 있다(localStorage 를 비운 상태) — 남은 두 섹션이 28장이다.
    expect(edits()).toHaveLength(28);
    expect(deletes()).toHaveLength(28);
  });

  it('세션 판정은 getAdminSession 하나로만 한다 — 요청당 한 번', async () => {
    await renderPage();

    expect(getAdminSession).toHaveBeenCalledTimes(1);
  });
});

/**
 * K1. '+ 링크 추가' 타일도 같은 관문을 지난다 — 서버가 관리자로 확인했을 때만 렌더된다.
 * 어느 섹션에 서는지와 폼이 무엇을 보내는지는 `components/HomeView.test.tsx` ·
 * `components/card/QuickAddCard.test.tsx` 가 본다.
 */
describe('홈 — 링크 추가 타일 (K1)', () => {
  const tile = () => screen.queryByRole('button', { name: '링크 추가' });

  it('비로그인 렌더에는 타일 마크업이 없다', async () => {
    const { container } = await renderPage();

    expect(tile()).toBeNull();
    expect(container.querySelector('[data-testid="quick-add"]')).toBeNull();
  });

  it('관리자 세션이면 타일이 서고, 분류 상자에 시드의 분류가 모두 온다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(adminSession);

    await renderPage();

    expect(tile()).toBeInTheDocument();

    fireEvent.click(tile()!);

    // 서버가 내려보내는 것은 세 필드짜리 목록이다(components/card/quick-add-options.ts).
    expect(screen.getAllByRole('option')).toHaveLength(siteData().categories.length);
  });
});
