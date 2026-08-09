/**
 * I3. 링크 추가 줄 — DESIGN_SPEC 6장 "링크 추가 줄: `https://` 주소 / 이름(비우면 도메인에서) /
 * 한 줄 설명 / '○○'에 추가 검은 버튼" + 프로토타입 원문 실측(359–366행).
 *
 * 여기서 못박는 것은 **줄의 모습**과 **등록 한 번의 순서**(파비콘 업로드 → `createBookmark`),
 * 그리고 실패했을 때 무엇을 말하는지다. 주소 검증·이름 자동 채움이 어떤 규칙인지는
 * `lib/mutations.test.ts` 가, 파비콘을 어디서 구해 어디에 올리는지는
 * `lib/favicon-collect.test.ts` 가 고정한다.
 */
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkAddRow } from '@/components/admin/LinkAddRow';
import { SelectedCategoryProvider, type AdminCategory } from '@/components/admin/CategoryPanel';
import { CategoryPanel } from '@/components/admin/CategoryPanel';
import { Toaster } from '@/components/Toast';
import { collectFavicon } from '@/lib/favicon-collect';
import { createBookmark } from '@/lib/mutations';
import { pendingResult } from '@/test/pending';
import { setupToastTimers } from '@/test/toast';

/**
 * 원본을 펼친 위에 이 화면이 부르는 것만 갈아 끼운다 — 팩토리로 통째 대체하면 나중에 액션이
 * 하나 늘 때 **이 트리가 끌어오는 다른 액션이 undefined 가 되어** 엉뚱한 곳에서 터진다
 * (HomeView.test·SubCategoryRow.test 와 같은 관례). createCategory·reorderCategories 는
 * 아래 '선택한 카테고리로 들어간다' 가 함께 세우는 CategoryPanel 의 몫이다.
 */
vi.mock('@/lib/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mutations')>()),
  createBookmark: vi.fn(),
  createCategory: vi.fn(),
  reorderCategories: vi.fn(),
}));
vi.mock('@/lib/favicon-collect', () => ({ collectFavicon: vi.fn() }));

const ROWS: AdminCategory[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', linkCount: 118, clickTotal: 1240 },
  { id: 'cat-dev', name: '개발 도구', linkCount: 21, clickTotal: 87 },
];

const ICON_URL = 'https://proj.supabase.co/storage/v1/object/public/favicons/perplexity.ai.png';

function renderRow(categories: readonly AdminCategory[] = ROWS, children?: ReactNode) {
  return render(
    <SelectedCategoryProvider categories={categories}>
      <LinkAddRow>{children}</LinkAddRow>
      <Toaster />
    </SelectedCategoryProvider>,
  );
}

const box = () => screen.getByRole('region', { name: '링크' });
const form = () => screen.getByRole('form', { name: '링크 추가' });
const field = (name: string) => screen.getByRole('textbox', { name });
const addButton = () => screen.getByRole('button', { name: /에 추가$/ });

/** 액션이 프라미스를 돌려주므로 등록 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** 세 칸을 채운다. 빈 문자열을 주면 그 칸은 건드리지 않는다. */
function fill({ url = '', title = '', description = '' }) {
  if (url !== '') fireEvent.change(field('주소'), { target: { value: url } });
  if (title !== '') fireEvent.change(field('이름'), { target: { value: title } });
  if (description !== '') fireEvent.change(field('한 줄 설명'), { target: { value: description } });
}

/**
 * 거부 경로가 남기는 진단 로그(사용자에게 보일 문장이 아니다) — **그 테스트에서만** 조용히
 * 시킨다. 파일 전역으로 막아 두면 여기서 예상하지 않은 React 경고·오류까지 함께 삼켜,
 * 화면이 조용히 망가져도 초록으로 지나간다(I1 CategoryHeader.test 와 같은 처리).
 */
function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createBookmark).mockResolvedValue({ ok: true });
  vi.mocked(collectFavicon).mockResolvedValue({ ok: true, faviconUrl: ICON_URL });
});

describe('LinkAddRow — 줄의 모습 (프로토타입 359–366행)', () => {
  it('상자는 헤더 패널과 같은 흰 상자다', () => {
    renderRow();

    expect(box()).toHaveClass('bg-card', 'border', 'border-border', 'rounded-[9px]', 'overflow-hidden');
  });

  it('줄은 좌우 16px · 위아래 12px 에 8px 씩 띄우고 좁아지면 감싼다', () => {
    renderRow();

    expect(form()).toHaveClass(
      'flex',
      'flex-wrap',
      'items-center',
      'gap-[8px]',
      'px-[16px]',
      'py-[12px]',
    );
  });

  it('맨 앞에 56px 라벨이 선다', () => {
    renderRow();

    expect(within(form()).getByText('링크 추가')).toHaveClass('w-[56px]', 'flex-none', 'text-[11.5px]', 'font-bold');
  });

  it('주소 칸은 220px 를 기준으로 늘어나고 200px 아래로는 줄지 않는다', () => {
    renderRow();

    expect(field('주소')).toHaveAttribute('placeholder', 'https://');
    expect(field('주소')).toHaveClass('flex-[1_1_220px]', 'min-w-[200px]', 'h-[32px]', 'text-[12.5px]');
  });

  it('이름 칸은 180px 고정, 설명 칸은 200px 기준으로 늘어난다', () => {
    renderRow();

    expect(field('이름')).toHaveClass('w-[180px]', 'flex-none', 'h-[32px]');
    expect(field('한 줄 설명')).toHaveAttribute('placeholder', '한 줄 설명');
    expect(field('한 줄 설명')).toHaveClass('flex-[1_1_200px]', 'min-w-[180px]', 'h-[32px]');
  });

  it('버튼은 선택한 카테고리 이름을 달고 있는 검은 버튼이다', () => {
    renderRow();

    expect(addButton()).toHaveTextContent('‘AI 도구 모음’에 추가');
    expect(addButton()).toHaveClass('bg-ink', 'h-[32px]', 'text-white', 'whitespace-nowrap');
  });

  it('검은 버튼도 손가락 커서를 쓰고 잠긴 동안에는 되돌린다', () => {
    // Tailwind v4 preflight 에는 버튼 커서 규칙이 없어 적지 않으면 화살표로 남는다
    // (J2 InlineEdit · J3 DeleteConfirm · I1 CategoryHeader 와 같은 관례).
    renderRow();

    expect(addButton()).toHaveClass('cursor-pointer', 'disabled:cursor-default');
  });

  it('아래에 붙는 줄(I4·I5)은 같은 상자 안 추가 줄 밑으로 들어간다', () => {
    renderRow(ROWS, <p>표 자리</p>);

    const rows = box().children;
    expect(rows).toHaveLength(2);
    expect(within(box()).getByText('표 자리')).toBe(rows[1]);
    expect(rows[0]).toHaveClass('border-b', 'border-border');
  });

  it('아래에 아무것도 없으면 구분선을 그리지 않는다', () => {
    renderRow();

    expect(form()).not.toHaveClass('border-b');
  });

  /**
   * "아래 줄이 있다"의 기준은 **React 가 실제로 무언가를 그리는가**다(J1b LinkCard `hasEditSlot`,
   * `components/admin/CategoryHeader.tsx` 도 같은 규칙). `undefined` 만 걸러 내면 아래 세 값이
   * 전부 검사를 통과해, 상자 테두리 바로 안쪽에 아무것도 나누지 않는 선이 하나 더 그어진다.
   */
  function expectNoDivider(children: ReactNode) {
    const { unmount } = renderRow(ROWS, children);

    expect(form()).not.toHaveClass('border-b');
    expect(box().children).toHaveLength(1);

    unmount();
  }

  it('조건이 거짓일 때 넘어오는 false 는 아래 줄로 치지 않는다 (`<LinkAddRow>{cond && <Table/>}</…>`)', () => {
    expectNoDivider(false);
  });

  it('null 도 아래 줄로 치지 않는다', () => {
    expectNoDivider(null);
  });

  it('빈 문자열도 아래 줄로 치지 않는다', () => {
    expectNoDivider('');
  });

  it('카테고리가 하나도 없으면 줄 자체를 만들지 않는다', () => {
    // 등록할 곳이 없다. 무엇을 해야 하는지는 바로 위 헤더 패널이 이미 말한다(문구를 겹쳐 적지 않는다).
    const { container } = renderRow([]);

    expect(container.querySelector('section')).toBeNull();
  });
});

describe('LinkAddRow — 이름 미리보기', () => {
  it('주소를 적으면 이름 칸이 비었을 때 채워질 이름을 미리 보여 준다', () => {
    renderRow();

    fill({ url: 'https://www.perplexity.ai/search?q=1' });

    // 규칙은 서버(`createBookmark` → `hostOf`)의 것이다 — 화면은 같은 답을 미리 보여 줄 뿐이다.
    expect(field('이름')).toHaveAttribute('placeholder', '이름 (비우면 perplexity.ai)');
  });

  it('주소가 아직 주소 꼴이 아니면 미리보기를 하지 않는다', () => {
    renderRow();

    fill({ url: 'perplexity' });

    expect(field('이름')).toHaveAttribute('placeholder', '이름 (비우면 주소에서)');
  });

  it('처음에는 프로토타입 문구 그대로다', () => {
    renderRow();

    expect(field('이름')).toHaveAttribute('placeholder', '이름 (비우면 주소에서)');
  });
});

describe('LinkAddRow — 등록', () => {
  setupToastTimers();

  it('주소가 비어 있으면 아무것도 보내지 않는다', async () => {
    renderRow();

    fill({ title: '이름만 적음' });
    await click(addButton());

    expect(collectFavicon).not.toHaveBeenCalled();
    expect(createBookmark).not.toHaveBeenCalled();
  });

  it('파비콘을 먼저 올리고, 그 주소를 실어 한 번에 등록한다', async () => {
    renderRow();

    fill({ url: 'https://perplexity.ai/', title: 'Perplexity', description: '검색형 AI' });
    await click(addButton());

    expect(collectFavicon).toHaveBeenCalledWith('https://perplexity.ai/');
    expect(createBookmark).toHaveBeenCalledTimes(1);
    expect(createBookmark).toHaveBeenCalledWith({
      url: 'https://perplexity.ai/',
      title: 'Perplexity',
      description: '검색형 AI',
      categoryId: 'cat-ai',
      faviconUrl: ICON_URL,
    });
    // 순서가 뒤집히면 파비콘 없는 행이 만들어지고 두 번 쓰게 된다.
    expect(vi.mocked(collectFavicon).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createBookmark).mock.invocationCallOrder[0],
    );
  });

  it('이름·설명을 비우면 넘기지 않는다 — 서버가 주소의 host 로 채운다', async () => {
    renderRow();

    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledWith({
      url: 'https://perplexity.ai/',
      title: undefined,
      description: undefined,
      categoryId: 'cat-ai',
      faviconUrl: ICON_URL,
    });
  });

  it('앞뒤 공백은 다듬어 보낸다', async () => {
    renderRow();

    fill({ url: '  https://perplexity.ai/  ', title: '  Perplexity  ', description: '  검색형 AI  ' });
    await click(addButton());

    expect(collectFavicon).toHaveBeenCalledWith('https://perplexity.ai/');
    expect(createBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://perplexity.ai/', title: 'Perplexity', description: '검색형 AI' }),
    );
  });

  it('성공하면 세 칸을 비우고 프로토타입 문구로 알린다', async () => {
    renderRow();

    fill({ url: 'https://perplexity.ai/', title: 'Perplexity', description: '검색형 AI' });
    await click(addButton());

    expect(field('주소')).toHaveValue('');
    expect(field('이름')).toHaveValue('');
    expect(field('한 줄 설명')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Perplexity 추가됨 · AI 도구 모음');
  });

  it('이름을 비웠으면 알림도 서버가 채울 이름으로 말한다', async () => {
    renderRow();

    fill({ url: 'https://www.perplexity.ai/' });
    await click(addButton());

    expect(screen.getByRole('status')).toHaveTextContent('perplexity.ai 추가됨 · AI 도구 모음');
  });

  it('Enter 로도 등록된다', async () => {
    renderRow();

    fill({ url: 'https://perplexity.ai/' });
    await act(async () => {
      fireEvent.submit(form());
    });

    expect(createBookmark).toHaveBeenCalledTimes(1);
  });

  it('보내는 중에 다시 눌러도 한 번만 나간다', async () => {
    const add = pendingResult();
    vi.mocked(createBookmark).mockReturnValue(add.promise);
    renderRow();

    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledTimes(1);
    // 파비콘 수집까지 최대 8초가 걸릴 수 있는 자리다 — 보내는 중임이 보조기기에도 닿아야 한다.
    expect(addButton()).toBeDisabled();
    expect(addButton()).toHaveAttribute('aria-busy', 'true');

    await add.finish();

    expect(addButton()).not.toBeDisabled();
    expect(addButton()).toHaveAttribute('aria-busy', 'false');
  });

  it('왕복 중에는 세 칸을 readOnly 로 잠근다 — disabled 면 포커스가 줄 밖으로 튄다', async () => {
    // 브라우저는 disabled 가 된 요소에서 포커스를 떼어 <body> 로 보낸다. 어느 칸에서 Enter 로
    // 등록한 사용자의 포커스가 그 순간 줄 밖으로 튀고, 서버가 거절해 값이 남아도 이어 고칠
    // 자리를 잃는다(J2 InlineEdit 의 두 입력과 같은 근거).
    const add = pendingResult();
    vi.mocked(createBookmark).mockReturnValue(add.promise);
    renderRow();

    fill({ url: 'https://perplexity.ai/', title: 'Perplexity', description: '검색형 AI' });
    await click(addButton());

    for (const name of ['주소', '이름', '한 줄 설명']) {
      expect(field(name)).toHaveAttribute('readonly');
      expect(field(name)).toBeEnabled();
    }

    await add.finish();

    for (const name of ['주소', '이름', '한 줄 설명']) {
      expect(field(name)).not.toHaveAttribute('readonly');
    }
  });

  it('같은 틱에 두 번 눌러도 한 번만 나간다 (아직 다시 그려지기 전이다)', async () => {
    // 위 테스트는 두 클릭 사이에 렌더가 한 번 끼어 `busy=true` 가 화면에 닿은 뒤를 본다.
    // 여기는 그 앞이다 — 두 이벤트가 **한 커밋 안에서** 처리되면 두 번째 핸들러가 읽는
    // `busy` 는 여전히 첫 렌더의 `false` 이므로, 상태 하나로는 막히지 않는다(J3 실측).
    // 그 틈을 막는 것이 ref 빗장이고, 이 테스트가 그 빗장의 유일한 증인이다.
    renderRow();

    fill({ url: 'https://perplexity.ai/' });
    await act(async () => {
      fireEvent.click(addButton());
      fireEvent.click(addButton());
    });

    expect(collectFavicon).toHaveBeenCalledTimes(1);
    expect(createBookmark).toHaveBeenCalledTimes(1);
  });
});

describe('LinkAddRow — 파비콘을 못 구한 경우', () => {
  setupToastTimers();

  it('파비콘 없이 등록하고, 알림에 그 사실을 덧붙인다', async () => {
    vi.mocked(collectFavicon).mockResolvedValue({ ok: false, error: '파비콘을 찾지 못했습니다.' });
    renderRow();

    fill({ url: 'https://perplexity.ai/', title: 'Perplexity' });
    await click(addButton());

    // 회색 타일 경로는 카드가 처음부터 지원한다(lib/favicon.ts) — 등록 자체를 막을 이유가 없다.
    expect(createBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://perplexity.ai/', faviconUrl: undefined }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Perplexity 추가됨 · AI 도구 모음 — 파비콘을 찾지 못했습니다.',
    );
  });

  it('수집 요청 자체가 거부돼도 등록은 그대로 진행한다', async () => {
    const spy = silenceConsoleError();
    vi.mocked(collectFavicon).mockRejectedValue(new Error('fetch failed'));
    renderRow();

    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('파비콘을 가져오지 못했습니다.');
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('LinkAddRow — 등록 실패', () => {
  setupToastTimers();

  it('서버가 주소를 거절하면 그 문구를 그대로 띄우고 적은 것을 남긴다', async () => {
    vi.mocked(createBookmark).mockResolvedValue({
      ok: false,
      error: '주소 형식이 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.',
    });
    renderRow();

    fill({ url: 'ftp://example.com/x', title: '고칠 이름' });
    await click(addButton());

    expect(screen.getByRole('status')).toHaveTextContent('주소 형식이 올바르지 않습니다.');
    // 거절 사유를 보고 이어서 고칠 값이다(CategoryPanel 추가 실패와 같은 판단).
    expect(field('주소')).toHaveValue('ftp://example.com/x');
    expect(field('이름')).toHaveValue('고칠 이름');
  });

  it('파비콘 주소가 거절당해도 그 문구를 그대로 띄운다', async () => {
    vi.mocked(createBookmark).mockResolvedValue({
      ok: false,
      error: '파비콘 주소가 올바르지 않습니다. http(s) 주소이거나 data:image URI 여야 합니다.',
    });
    renderRow();

    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    expect(screen.getByRole('status')).toHaveTextContent('파비콘 주소가 올바르지 않습니다.');
  });

  it('등록 요청이 거부되면 빗장을 풀어 다시 시도할 수 있게 한다', async () => {
    const spy = silenceConsoleError();
    vi.mocked(createBookmark).mockRejectedValue(new Error('fetch failed'));
    renderRow();

    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    expect(screen.getByRole('status')).toHaveTextContent('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    expect(addButton()).not.toBeDisabled();
    expect(spy).toHaveBeenCalled();

    vi.mocked(createBookmark).mockResolvedValue({ ok: true });
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });
});

describe('LinkAddRow — 선택한 카테고리로 들어간다', () => {
  setupToastTimers();

  it('선택이 바뀌면 버튼 라벨과 등록 대상이 함께 따라간다', async () => {
    render(
      <SelectedCategoryProvider categories={ROWS}>
        <CategoryPanel totalLinkCount={139} />
        <LinkAddRow />
        <Toaster />
      </SelectedCategoryProvider>,
    );

    await click(screen.getByRole('button', { name: /개발 도구/ }));
    expect(addButton()).toHaveTextContent('‘개발 도구’에 추가');

    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-dev' }));
    expect(screen.getByRole('status')).toHaveTextContent('perplexity.ai 추가됨 · 개발 도구');
  });
});
