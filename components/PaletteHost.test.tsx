/**
 * G5. 헤더 ↔ ⌘K 팔레트 배선 — 2단계의 마지막 이음매다.
 *
 * 팔레트 **안쪽** 동작(결과·키 이동·행 열기 마크업)은 palette/CommandPalette.test.tsx 가,
 * 헤더 **생김새**는 Header.test.tsx 가 이미 못박았다. 여기서 보는 것은 그 둘을 잇는 세 가닥뿐이다:
 * 열림 상태의 소유(이 호스트) · 세 입구(검색창 · AI 버튼 · 전역 ⌘K) · 닫힘 경로와 `aria-expanded`.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaletteHost, type PaletteHostProps } from '@/components/PaletteHost';
import type { AiSearchResponse } from '@/lib/ai-search-client';
import { recordClick } from '@/lib/clicks';
import type { SiteData } from '@/lib/types';
import { setupToastTimers } from '@/test/toast';

/**
 * 클릭 기록은 네트워크를 타므로 부르는 **횟수**만 본다 — 요청의 모양은 lib/clicks.test.ts 몫이다.
 * (CommandPalette.test.tsx 와 같은 처리다.)
 */
vi.mock('@/lib/clicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clicks')>()),
  recordClick: vi.fn(),
}));

/**
 * 데이터가 팔레트까지 흘러갔는지만 보는 최소 한 벌.
 * 실시드(290건)를 쓰면 "이 행이 왜 나왔나"를 눈으로 짚을 수 없어 질의어가 든 링크 하나만 둔다.
 */
const DATA: SiteData = {
  categories: [],
  bookmarks: [
    {
      id: 'a',
      category_id: null,
      title: '사내 문서함',
      url: 'https://example.com/a',
      description: null,
      tags: [],
      favicon_url: null,
      is_pinned: false,
      source: 'manual',
      sort_order: 0,
      created_at: '2024-01-01T00:00:00.000Z',
      click_count: 0,
    },
  ],
};

/**
 * 헤더 버튼은 **헤더 안에서만** 찾는다 — 팔레트 하단 바에도 'AI 검색' 버튼이 있어
 * 팔레트가 열린 뒤에는 screen 전체 조회가 둘을 함께 집는다.
 * 호스트가 헤더를 먼저 렌더하므로 컨테이너의 첫 자식이 헤더 줄이다.
 */
function renderHost(over: Partial<PaletteHostProps> = {}) {
  const { container } = render(
    <PaletteHost data={DATA} totalCount={290} faviconCount={262} {...over} />,
  );
  const header = within(container.firstElementChild as HTMLElement);

  return {
    searchTrigger: () => header.getByRole('button', { name: /이름·설명·태그·주소로 바로 찾기/ }),
    aiButton: () => header.getByRole('button', { name: 'AI 검색' }),
  };
}

/** 팔레트 패널. 닫혀 있으면 null 이다(게이트가 아무것도 그리지 않는다). */
const palette = () => screen.queryByRole('dialog');

/** 전역 키는 window 가 듣는다 (CommandPalette 게이트·패널 모두 같은 자리에 건다). */
function press(key: string, init: KeyboardEventInit = {}) {
  return fireEvent.keyDown(window, { key, ...init });
}

describe('PaletteHost — 열림 상태의 소유자', () => {
  it('처음에는 닫혀 있다 — 패널이 없고 aria-expanded 는 false 다', () => {
    const { searchTrigger } = renderHost();

    expect(palette()).not.toBeInTheDocument();
    // 닫힘도 상태다. 속성 자체를 빼면 보조기술이 "펼칠 수 있는 것"임을 알 길이 없다.
    expect(searchTrigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('검색창을 누르면 팔레트가 열린다', () => {
    const { searchTrigger } = renderHost();

    fireEvent.click(searchTrigger());

    expect(palette()).toBeInTheDocument();
    expect(searchTrigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('"AI 검색" 버튼도 지금은 팔레트를 열기만 한다 (AI 모드 진입은 5단계 N3)', () => {
    const { aiButton } = renderHost();

    fireEvent.click(aiButton());

    expect(palette()).toBeInTheDocument();
  });

  it('전역 ⌘K 로 열린다 — 닫혀 있는 동안에도 게이트가 듣고 있다', () => {
    renderHost();

    press('k', { metaKey: true });

    expect(palette()).toBeInTheDocument();
  });

  it('Ctrl+K 도 같은 자리를 연다 (Windows)', () => {
    renderHost();

    press('k', { ctrlKey: true });

    expect(palette()).toBeInTheDocument();
  });

  it('esc 로 닫히고 aria-expanded 가 false 로 돌아온다', () => {
    const { searchTrigger } = renderHost();
    fireEvent.click(searchTrigger());

    press('Escape');

    expect(palette()).not.toBeInTheDocument();
    expect(searchTrigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('오버레이를 눌러도 닫힌다 (onClose 는 한 자리로 모인다)', () => {
    const { searchTrigger } = renderHost();
    fireEvent.click(searchTrigger());

    // 오버레이는 접근성 트리에서 감춰져 있어 역할로 잡을 수 없다 — 패널의 형제 중 fixed inset-0.
    fireEvent.click(document.querySelector('.fixed.inset-0') as HTMLElement);

    expect(palette()).not.toBeInTheDocument();
    expect(searchTrigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('닫은 뒤에도 ⌘K 가 다시 연다 — 팔레트를 조건부로 렌더하지 않는다', () => {
    // 조건부 렌더(`{open && <CommandPalette/>}`)로 바꾸면 닫히는 순간 전역 리스너가 함께
    // 사라져 이 두 번째 ⌘K 가 죽는다. 그 회귀를 여기서 잡는다.
    const { searchTrigger } = renderHost();
    fireEvent.click(searchTrigger());
    press('Escape');

    press('k', { metaKey: true });

    expect(palette()).toBeInTheDocument();
  });
});

describe('PaletteHost — 셸이 준 값의 통과', () => {
  it('헤더 카운트는 받은 값을 그대로 쓴다', () => {
    renderHost({ totalCount: 12, faviconCount: 3 });

    expect(screen.getByText('12개 · 파비콘 3개 내장')).toBeInTheDocument();
  });

  it('나머지 헤더 props 도 그대로 흘려보낸다 (isAdmin — J1 이 셸에서 채운다)', () => {
    renderHost({ isAdmin: true });

    expect(screen.getByText('관리자 편집 모드')).toBeInTheDocument();
  });

  it('팔레트는 셸이 준 data 로 검색한다', () => {
    const { searchTrigger } = renderHost();
    fireEvent.click(searchTrigger());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '문서함' } });

    expect(screen.getByRole('link', { name: /사내 문서함/ })).toBeInTheDocument();
  });
});

describe('PaletteHost — 행 열기 (G3 인계)', () => {
  setupToastTimers();

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  it('클릭 기록이 한 번만 간다 — onOpenLink 를 넘기지 않는다', () => {
    // 팔레트는 기록·토스트를 스스로 한다. 여기에 useCardHandlers.handleOpen 을 이어 붙이면
    // 기록이 두 번 가고 토스트가 두 번 뜬다(CommandPalette 의 onOpenLink JSDoc).
    const { searchTrigger } = renderHost();
    fireEvent.click(searchTrigger());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '문서함' } });

    fireEvent.click(screen.getByRole('link', { name: /사내 문서함/ }));

    expect(recordClick).toHaveBeenCalledTimes(1);
    // 행을 열면 팔레트도 닫힌다(프로토타입) — onClose 가 이어져 있다는 뜻이다.
    expect(palette()).not.toBeInTheDocument();
  });
});

/**
 * N3. AI 의미 검색 — 트리거(⌘↵·0건 ↵)가 실제 `/api/ai-search`(N2) 호출로 이어지고, 로딩→결과로
 * 바뀌며, 팔레트의 0건 안내를 가리고, 질의를 고치거나 닫으면 지워지는지를 본다.
 *
 * 호출의 모양은 lib/ai-search-client.test.ts, 상태→화면 매핑은 AiSearchResults.test.tsx 가 이미
 * 못박았다 — 여기서는 팔레트↔호스트↔훅이 실제로 이어지는지(라이브 호출 없이 fetch 모킹)만 본다.
 */
describe('PaletteHost — AI 의미 검색 (N3)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  function aiResponse(body: AiSearchResponse | { error: string }, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const AI_HIT: AiSearchResponse = {
    ok: true,
    source: 'ai',
    reason: 'ok',
    results: [{ id: 'a', reason: '문서를 모아 두는 곳입니다' }],
    tookMs: 812,
  };

  /** 마이크로태스크(fetch → json → then)를 모두 흘려보낸다. */
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function openAndType(text: string) {
    fireEvent.click(renderHost().searchTrigger());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  }

  function pressAi() {
    // ⌘↵ — 어디에 포커스가 있든 AI 검색이다(팔레트 키 리스너는 window 가 듣는다).
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
  }

  it('⌘↵ 는 typed 질의로 /api/ai-search 를 부른다 (타자만으로는 안 부른다)', () => {
    fetchMock.mockResolvedValue(aiResponse(AI_HIT));
    openAndType('문서');
    // 여기까지(입력 변경만) 로는 호출이 없다.
    expect(fetchMock).not.toHaveBeenCalled();

    pressAi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ai-search');
    expect(JSON.parse(String(init?.body))).toEqual({ query: '문서' });
  });

  it('로딩 점 3개가 뜬 뒤 "AI가 의미로 찾은 링크 N건" + 소요 시간으로 바뀐다', async () => {
    fetchMock.mockResolvedValue(aiResponse(AI_HIT));
    openAndType('문서');

    pressAi();
    // 호출이 끝나기 전 — 로딩.
    expect(screen.getByTestId('ai-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-hits')).not.toBeInTheDocument();

    await flush();

    expect(screen.queryByTestId('ai-loading')).not.toBeInTheDocument();
    expect(screen.getByText('AI가 의미로 찾은 링크 1건')).toBeInTheDocument();
    expect(screen.getByText('0.81초')).toBeInTheDocument();
    // 실존 링크로 렌더된다 — 키워드 본문에도 같은 링크가 있으니 AI 영역 안으로 좁혀 본다.
    expect(within(screen.getByTestId('ai-hits')).getByRole('link', { name: /사내 문서함/ })).toBeInTheDocument();
  });

  it('결과 0건에서의 ↵ 도 AI 를 부르고, 그동안 이름 검색 0건 안내를 감춘다', async () => {
    fetchMock.mockResolvedValue(aiResponse(AI_HIT));
    openAndType('존재하지않는말'); // 키워드 0건
    expect(screen.getByText('이름이 일치하는 링크가 없습니다')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Enter' }); // 0건이라 ↵ 가 AI 로 샌다

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // AI 가 도는 동안 0건 안내는 감춰진다(aiBusy).
    expect(screen.queryByText('이름이 일치하는 링크가 없습니다')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-loading')).toBeInTheDocument();

    await flush();
    expect(screen.getByText('AI가 의미로 찾은 링크 1건')).toBeInTheDocument();
  });

  it('rate-limit 은 "잠시 후 재시도"로 구분해 보여 준다', async () => {
    fetchMock.mockResolvedValue(
      aiResponse({ ok: false, source: 'keyword', reason: 'rate-limit', results: [], tookMs: 1 }),
    );
    openAndType('문서');

    pressAi();
    await flush();

    expect(screen.getByText('AI 검색 요청이 많습니다')).toBeInTheDocument();
    expect(screen.getByText('잠시 후 다시 시도해 주세요')).toBeInTheDocument();
  });

  it('400/413 등 비200 은 실행 실패 안내로 떨어진다', async () => {
    fetchMock.mockResolvedValue(aiResponse({ error: 'body 가 너무 큽니다.' }, 413));
    openAndType('문서');

    pressAi();
    await flush();

    expect(screen.getByText('AI 검색을 실행하지 못했습니다')).toBeInTheDocument();
  });

  it('결과가 뜬 뒤 질의를 고치면 지난 AI 결과가 사라진다 (프로토타입 onQ)', async () => {
    fetchMock.mockResolvedValue(aiResponse(AI_HIT));
    openAndType('문서');
    pressAi();
    await flush();
    expect(screen.getByText('AI가 의미로 찾은 링크 1건')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '문서함' } });

    expect(screen.queryByText('AI가 의미로 찾은 링크 1건')).not.toBeInTheDocument();
  });

  it('닫았다 다시 열면 지난 AI 결과가 남아 있지 않다', async () => {
    fetchMock.mockResolvedValue(aiResponse(AI_HIT));
    const { searchTrigger } = renderHost();
    fireEvent.click(searchTrigger());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '문서' } });
    pressAi();
    await flush();
    expect(screen.getByText('AI가 의미로 찾은 링크 1건')).toBeInTheDocument();

    press('Escape');
    press('k', { metaKey: true });

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText('AI가 의미로 찾은 링크 1건')).not.toBeInTheDocument();
  });
});
