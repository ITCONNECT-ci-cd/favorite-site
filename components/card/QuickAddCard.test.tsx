/**
 * K1. '+ 링크 추가' 타일 — 카드 그리드 맨 앞에 서고, 누르면 **그 자리에서** 인라인 폼으로 바뀐다.
 *
 * 모달이 아니다(DESIGN_SPEC — 모달 금지). 폼의 결은 J2 인라인 편집(`components/card/InlineEdit.tsx`)
 * 을, 등록 한 번의 순서(파비콘 업로드 → `createBookmark`)는 I3 관리자 추가 줄
 * (`components/admin/LinkAddRow.tsx`)을 그대로 본떴다.
 *
 * 서버 액션은 갈아 끼운다 — 무엇을 검사하고 어떤 문구를 돌려주는지는 `lib/mutations.test.ts` 가,
 * 파비콘을 어디서 구하는지는 `lib/favicon-collect.test.ts` 가 고정한다. 여기서 보는 것은
 * **무엇을 넘기고 결과를 어떻게 쓰는가**다.
 *
 * 타일이 **어느 목록에 서는가**(파생 목록에는 없다)는 화면의 몫이라 HomeView·ListView 테스트가 본다.
 */
import { startTransition } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickAddCard, type QuickAddCardProps } from '@/components/card/QuickAddCard';
import type { QuickAddCategory } from '@/components/card/quick-add-options';
import { Toaster } from '@/components/Toast';
import { collectFavicon } from '@/lib/favicon-collect';
import { createBookmark } from '@/lib/mutations';
import { pendingResult } from '@/test/pending';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mutations')>()),
  createBookmark: vi.fn(),
}));
vi.mock('@/lib/favicon-collect', () => ({ collectFavicon: vi.fn() }));

/**
 * `startTransition` **한 함수만** 진짜 구현을 감싼 스파이로 바꾼다(나머지 react 는 그대로) —
 * J2 InlineEdit.test 와 같은 처리다. 성공 후의 닫힘이 트랜지션에 묶였는지는 결과만 봐서는
 * 알 수 없다(콜백은 어차피 그 자리에서 실행되고 `act()` 는 둘 다 흘려보낸다). 차이가 드러나는
 * 곳은 revalidate 된 새 데이터가 실제로 내려오는 브라우저라, 여기서 붙잡을 수 있는 것은 배선뿐이다.
 */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();

  return { ...actual, startTransition: vi.fn(actual.startTransition) };
});

const CATEGORIES: QuickAddCategory[] = [
  { id: 'cat-ai', name: 'AI 도구 모음', isSub: false },
  { id: 'cat-chat', name: '대화·검색', isSub: true },
  { id: 'cat-ops', name: '현재 운영 중인 사이트', isSub: false },
];

const ICON_URL = 'https://proj.supabase.co/storage/v1/object/public/favicons/perplexity.ai.png';

function renderTile(over: Partial<QuickAddCardProps> = {}) {
  return render(
    <>
      <QuickAddCard categories={CATEGORIES} defaultCategoryId="cat-ops" {...over} />
      <Toaster />
    </>,
  );
}

const tile = () => screen.getByRole('button', { name: '링크 추가' });
const form = () => screen.getByRole('form', { name: '링크 추가' });
const field = (name: string) => screen.getByRole('textbox', { name });
const picker = () => screen.getByRole('combobox', { name: '분류' });
const addButton = () => screen.getByRole('button', { name: '추가' });
const cancelButton = () => screen.getByRole('button', { name: '취소' });

/** 액션이 프라미스를 돌려주므로 등록 경로는 act 안에서 마이크로태스크까지 흘려보낸다. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** 타일을 눌러 폼을 연다. 서버 왕복이 없어 동기 클릭으로 충분하다. */
function open() {
  fireEvent.click(tile());
}

/** 세 칸을 채운다. 빈 문자열을 주면 그 칸은 건드리지 않는다. */
function fill({ url = '', title = '', description = '' }) {
  if (url !== '') fireEvent.change(field('주소'), { target: { value: url } });
  if (title !== '') fireEvent.change(field('이름'), { target: { value: title } });
  if (description !== '') fireEvent.change(field('한 줄 설명'), { target: { value: description } });
}

/**
 * 거부 경로가 남기는 진단 로그(사용자에게 보일 문장이 아니다) — **그 테스트에서만** 조용히
 * 시킨다. 파일 전역으로 막으면 예상하지 않은 React 경고까지 함께 삼켜 조용히 초록이 된다.
 */
function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createBookmark).mockResolvedValue({ ok: true });
  vi.mocked(collectFavicon).mockResolvedValue({ ok: true, faviconUrl: ICON_URL });
});

describe('QuickAddCard — 접힌 타일', () => {
  it('카드 한 장 자리에 앉는 점선 타일이다', () => {
    renderTile();

    // 카드와 같은 라운드·최소 높이라야 같은 격자에 자연스럽게 앉는다(C2 LinkCard 의 값).
    expect(tile()).toHaveClass(
      'rounded-[10px]',
      'min-h-[104px]',
      'min-[820px]:min-h-[126px]',
      'border-dashed',
    );
  });

  it('손가락 커서를 쓴다 — Tailwind v4 preflight 에는 버튼 커서 규칙이 없다', () => {
    renderTile();

    expect(tile()).toHaveClass('cursor-pointer');
  });

  it('아직 폼이 아니다 — 접힌 채로는 입력이 하나도 없다', () => {
    renderTile();

    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('넣을 분류가 하나도 없으면 타일 자체를 그리지 않는다', () => {
    // 등록할 곳이 없다(I3 LinkAddRow 가 카테고리 0개에서 줄을 통째로 접는 것과 같은 판단).
    const { container } = renderTile({ categories: [] });

    expect(container.querySelector('button')).toBeNull();
  });
});

describe('QuickAddCard — 그 자리에서 폼으로', () => {
  it('타일을 누르면 주소·이름·설명·분류를 받는 폼이 된다', () => {
    renderTile();

    open();

    expect(form()).toBeInTheDocument();
    expect(field('주소')).toHaveAttribute('placeholder', 'https://');
    expect(field('이름')).toBeInTheDocument();
    expect(field('한 줄 설명')).toBeInTheDocument();
    expect(picker()).toBeInTheDocument();
    // 타일은 폼으로 **바뀐다** — 나란히 서지 않는다.
    expect(screen.queryByRole('button', { name: '링크 추가' })).toBeNull();
  });

  it('열리면 주소 칸으로 포커스를 데려온다', () => {
    renderTile();

    open();

    expect(field('주소')).toHaveFocus();
  });

  it('분류 목록을 그대로 옵션으로 세우고 하위는 한 단 들여 보인다', () => {
    renderTile();

    open();

    const options = screen.getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'AI 도구 모음',
      '— 대화·검색',
      '현재 운영 중인 사이트',
    ]);
  });

  it('기본 분류가 골라진 채로 열린다', () => {
    renderTile();

    open();

    expect(picker()).toHaveValue('cat-ops');
  });

  it('기본 분류가 목록에 없으면 첫 분류로 떨어진다', () => {
    // 고른 값과 화면에 보이는 값이 어긋난 채로 등록되면 엉뚱한 분류에 들어간다.
    renderTile({ defaultCategoryId: '사라진분류' });

    open();

    expect(picker()).toHaveValue('cat-ai');
  });

  it('취소하면 타일로 돌아가고 아무것도 보내지 않는다', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await click(cancelButton());

    expect(tile()).toBeInTheDocument();
    expect(createBookmark).not.toHaveBeenCalled();
  });

  it('취소하면 포커스를 타일로 되돌린다 — <body> 로 흘리지 않는다', async () => {
    renderTile();

    open();
    await click(cancelButton());

    expect(tile()).toHaveFocus();
  });

  it('Esc 로도 닫힌다', () => {
    renderTile();

    open();
    fireEvent.keyDown(form(), { key: 'Escape' });

    expect(tile()).toBeInTheDocument();
  });

  it('다시 열면 적던 값이 남아 있지 않다', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/', title: '적다 만 이름' });
    await click(cancelButton());
    open();

    expect(field('주소')).toHaveValue('');
    expect(field('이름')).toHaveValue('');
  });
});

describe('QuickAddCard — 등록', () => {
  setupToastTimers();

  it('파비콘을 먼저 올리고, 그 주소를 실어 한 번에 등록한다', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/', title: 'Perplexity', description: '검색형 AI' });
    await click(addButton());

    expect(collectFavicon).toHaveBeenCalledWith('https://perplexity.ai/');
    expect(createBookmark).toHaveBeenCalledTimes(1);
    expect(createBookmark).toHaveBeenCalledWith({
      url: 'https://perplexity.ai/',
      title: 'Perplexity',
      description: '검색형 AI',
      categoryId: 'cat-ops',
      faviconUrl: ICON_URL,
    });
    // 순서가 뒤집히면 파비콘 없는 행이 만들어지고 두 번 쓰게 된다(I3 와 같은 계약).
    expect(vi.mocked(collectFavicon).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createBookmark).mock.invocationCallOrder[0],
    );
  });

  it('이름·설명을 비우면 넘기지 않는다 — 서버가 주소의 host 로 채운다', async () => {
    renderTile();

    open();
    fill({ url: 'https://www.perplexity.ai/' });
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ title: undefined, description: undefined }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'perplexity.ai 추가됨 · 현재 운영 중인 사이트',
    );
  });

  it('앞뒤 공백은 다듬어 보낸다', async () => {
    renderTile();

    open();
    fill({ url: '  https://perplexity.ai/  ', title: '  Perplexity  ', description: '  검색형 AI  ' });
    await click(addButton());

    expect(collectFavicon).toHaveBeenCalledWith('https://perplexity.ai/');
    expect(createBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://perplexity.ai/', title: 'Perplexity', description: '검색형 AI' }),
    );
  });

  it('폼에서 고른 분류로 들어간다', async () => {
    renderTile();

    open();
    fireEvent.change(picker(), { target: { value: 'cat-chat' } });
    fill({ url: 'https://perplexity.ai/', title: 'Perplexity' });
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-chat' }));
    expect(screen.getByRole('status')).toHaveTextContent('Perplexity 추가됨 · 대화·검색');
  });

  it('Enter 로도 등록된다', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await act(async () => {
      fireEvent.submit(form());
    });

    expect(createBookmark).toHaveBeenCalledTimes(1);
  });

  it('성공하면 폼이 닫히고 타일로 돌아온다', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/', title: 'Perplexity' });
    await click(addButton());

    expect(screen.queryByRole('form')).toBeNull();
    expect(tile()).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Perplexity 추가됨 · 현재 운영 중인 사이트');
  });

  it('성공하면 닫힘을 트랜지션에 묶는다 — 새 카드와 같은 커밋에서 사라지게', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    vi.mocked(startTransition).mockClear();
    await click(addButton());

    expect(startTransition).toHaveBeenCalledOnce();
  });

  it('성공한 뒤 다시 열면 빈 폼이다', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/', title: 'Perplexity', description: '검색형 AI' });
    await click(addButton());
    open();

    expect(field('주소')).toHaveValue('');
    expect(field('이름')).toHaveValue('');
    expect(field('한 줄 설명')).toHaveValue('');
  });

  it('성공하면 포커스를 타일로 되돌린다', async () => {
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    expect(tile()).toHaveFocus();
  });

  it('보내는 중에 다시 눌러도 한 번만 나간다', async () => {
    const add = pendingResult();
    vi.mocked(createBookmark).mockReturnValue(add.promise);
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledTimes(1);
    // 파비콘 수집까지 최대 8초가 걸릴 수 있는 자리다 — 보내는 중임이 보조기기에도 닿아야 한다.
    expect(addButton()).toBeDisabled();
    expect(addButton()).toHaveAttribute('aria-busy', 'true');

    await add.finish();
  });

  it('같은 틱에 두 번 눌러도 한 번만 나간다 (아직 다시 그려지기 전이다)', async () => {
    // 두 이벤트가 **한 커밋 안에서** 처리되면 두 번째 핸들러가 읽는 상태는 여전히 첫 렌더의
    // false 다 — 상태 가드로는 막히지 않는다(J3 실측). 그 틈을 막는 것이 ref 빗장이고,
    // 이 테스트가 그 빗장의 유일한 증인이다. 등록은 되돌릴 수 없는 쓰기라 한 프레임도 열지 않는다.
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await act(async () => {
      fireEvent.click(addButton());
      fireEvent.click(addButton());
    });

    expect(collectFavicon).toHaveBeenCalledTimes(1);
    expect(createBookmark).toHaveBeenCalledTimes(1);
  });

  it('왕복 중에는 세 칸을 readOnly 로 잠근다 — disabled 면 포커스가 폼 밖으로 튄다', async () => {
    const add = pendingResult();
    vi.mocked(createBookmark).mockReturnValue(add.promise);
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    for (const name of ['주소', '이름', '한 줄 설명']) {
      expect(field(name)).toHaveAttribute('readonly');
      expect(field(name)).toBeEnabled();
    }

    await add.finish();
  });

  it('왕복 중에는 Esc 를 듣지 않는다 — 요청은 이미 떠났다', async () => {
    const add = pendingResult();
    vi.mocked(createBookmark).mockReturnValue(add.promise);
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());
    fireEvent.keyDown(form(), { key: 'Escape' });

    expect(form()).toBeInTheDocument();

    await add.finish();
  });
});

describe('QuickAddCard — 등록 실패', () => {
  setupToastTimers();

  it('주소를 비운 채 눌러도 문구는 서버가 준 것을 그대로 쓴다', async () => {
    // 화면이 "주소를 입력하세요" 를 지어내면 서버 문구와 조용히 갈라진다(저장소 규칙 5).
    // 다만 빈 주소로 파비콘을 구하러 갈 이유는 없다 — 최대 8초를 헛되이 기다리게 된다.
    vi.mocked(createBookmark).mockResolvedValue({
      ok: false,
      error: '주소 형식이 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.',
    });
    renderTile();

    open();
    await click(addButton());

    expect(collectFavicon).not.toHaveBeenCalled();
    expect(createBookmark).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('주소 형식이 올바르지 않습니다.');
    expect(form()).toBeInTheDocument();
  });

  it('서버가 거절하면 그 문구를 그대로 띄우고 적은 것을 남긴다', async () => {
    vi.mocked(createBookmark).mockResolvedValue({ ok: false, error: '카테고리를 찾을 수 없습니다.' });
    renderTile();

    open();
    fill({ url: 'ftp://example.com/x', title: '고칠 이름' });
    await click(addButton());

    expect(screen.getByRole('status')).toHaveTextContent('카테고리를 찾을 수 없습니다.');
    // 거절 사유를 보고 이어서 고칠 값이다 — 폼도 값도 남는다.
    expect(field('주소')).toHaveValue('ftp://example.com/x');
    expect(field('이름')).toHaveValue('고칠 이름');
  });

  it('요청이 거부되면 빗장을 풀어 다시 시도할 수 있게 한다', async () => {
    const spy = silenceConsoleError();
    vi.mocked(createBookmark).mockRejectedValue(new Error('fetch failed'));
    renderTile();

    open();
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

  it('실패로 잠금이 풀리면 포커스를 추가 버튼으로 돌려준다', async () => {
    // 잠긴 버튼에서 브라우저가 포커스를 떼어 문서 뿌리로 보낸다 — 그대로 두면 실패 문구를 읽고도
    // 다시 누르려면 화면 맨 앞에서 Tab 으로 걸어와야 한다(J2 InlineEdit 과 같은 처방).
    vi.mocked(createBookmark).mockResolvedValue({ ok: false, error: '카테고리를 찾을 수 없습니다.' });
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    // 실제 브라우저에서는 누른 버튼이 그 자리에서 잠기며 포커스가 떨어진다. jsdom 의 클릭은
    // 포커스를 옮기지 않으므로 그 결과 상태를 손으로 만든다(InlineEdit.test 와 같은 처리).
    field('주소').blur();
    await click(addButton());

    expect(addButton()).toHaveFocus();
  });

  it('실패해도 이미 다른 곳에 있는 포커스는 뺏지 않는다', async () => {
    // 주소 칸에서 Enter 로 등록한 경우다 — 입력이 `readOnly` 라 포커스가 그 자리에 남아 있고,
    // 뺏으면 거절 사유를 보고 이어 고칠 자리를 잃는다.
    vi.mocked(createBookmark).mockResolvedValue({ ok: false, error: '카테고리를 찾을 수 없습니다.' });
    renderTile();

    open();
    fill({ url: 'ftp://example.com/x' });
    field('주소').focus();
    await act(async () => {
      fireEvent.submit(form());
    });

    expect(field('주소')).toHaveFocus();
  });
});

describe('QuickAddCard — 파비콘을 못 구한 경우', () => {
  setupToastTimers();

  it('파비콘 없이 등록하고, 알림에 그 사실을 덧붙인다', async () => {
    vi.mocked(collectFavicon).mockResolvedValue({ ok: false, error: '파비콘을 찾지 못했습니다.' });
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/', title: 'Perplexity' });
    await click(addButton());

    // 회색 타일 경로는 카드가 처음부터 지원한다(lib/favicon.ts) — 등록 자체를 막을 이유가 없다.
    expect(createBookmark).toHaveBeenCalledWith(expect.objectContaining({ faviconUrl: undefined }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Perplexity 추가됨 · 현재 운영 중인 사이트 — 파비콘을 찾지 못했습니다.',
    );
  });

  it('수집 요청 자체가 거부돼도 등록은 그대로 진행한다', async () => {
    const spy = silenceConsoleError();
    vi.mocked(collectFavicon).mockRejectedValue(new Error('fetch failed'));
    renderTile();

    open();
    fill({ url: 'https://perplexity.ai/' });
    await click(addButton());

    expect(createBookmark).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('파비콘을 가져오지 못했습니다.');
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});
