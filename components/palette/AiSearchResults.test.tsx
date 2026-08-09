/**
 * N3. AI 의미 검색 영역 — 상태(로딩/성공/폴백/오류) → 화면 매핑을 못박는다.
 *
 * 수치의 원본은 프로토타입(`docs/prototype/링크 대시보드 v2.dc.html` 197~228행)과 DESIGN_SPEC 5장,
 * 응답 계약의 원본은 app/api/ai-search/route.ts JSDoc 이다. 실제 호출은 lib/ai-search-client.test.ts 가
 * 보고, 트리거→호출 흐름은 PaletteHost.test.tsx 가 본다 — 이 파일은 상태를 손에 쥐어 주고 그림만 본다.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSearchResults, type AiSearchResultsProps } from '@/components/palette/AiSearchResults';
import { Toaster } from '@/components/Toast';
import type { AiSearchState } from '@/components/palette/useAiSearch';
import type { AiSearchResponse } from '@/lib/ai-search-client';
import { recordClick } from '@/lib/clicks';
import type { BookmarkWithCount, Category, SiteData } from '@/lib/types';
import { middleClick, rightClick } from '@/test/events';
import { setupToastTimers } from '@/test/toast';

vi.mock('@/lib/clicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clicks')>()),
  recordClick: vi.fn(),
}));

function makeBookmark(
  over: Partial<BookmarkWithCount> & Pick<BookmarkWithCount, 'id'>,
): BookmarkWithCount {
  return {
    category_id: null,
    title: over.id,
    url: `https://example.com/${over.id}`,
    description: null,
    tags: [],
    favicon_url: null,
    is_pinned: false,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    click_count: 0,
    ...over,
  };
}

const DATA: SiteData = {
  categories: [{ id: 'cat', name: '영상 도구', parent_id: null, sort_order: 0 } satisfies Category],
  bookmarks: [
    makeBookmark({ id: 'a', title: 'Zoom', url: 'https://zoom.us/', category_id: 'cat', description: '화상 회의' }),
    makeBookmark({ id: 'b', title: 'Meet', url: 'https://meet.google.com/', description: '구글 화상 회의' }),
  ],
};

function settled(response: AiSearchResponse, query = '화상 회의'): AiSearchState {
  return { status: 'settled', query, result: { ok: true, response } };
}

function renderResults(state: AiSearchState, over: Partial<AiSearchResultsProps> = {}) {
  return render(
    <>
      <AiSearchResults
        state={state as Exclude<AiSearchState, { status: 'idle' }>}
        data={DATA}
        onClose={vi.fn()}
        {...over}
      />
      <Toaster />
    </>,
  );
}

const hits = () => screen.getByTestId('ai-hits');
const rows = () => within(hits()).getAllByRole('link');

describe('로딩', () => {
  it('점 3개와 안내 문구를 보여 준다 (프로토타입 199~207행)', () => {
    renderResults({ status: 'loading' });

    const loading = screen.getByTestId('ai-loading');
    expect(loading).toHaveTextContent('뜻이 비슷한 링크를 찾는 중');
    // 점 셋은 flex 컨테이너 안의 span 3개다.
    expect(loading.querySelector('span.flex')?.children).toHaveLength(3);
  });

  it('로딩 중에는 결과·안내 블록이 없다', () => {
    renderResults({ status: 'loading' });

    expect(screen.queryByTestId('ai-hits')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-notice')).not.toBeInTheDocument();
  });
});

describe('AI 성공 (source=ai)', () => {
  const RESPONSE: AiSearchResponse = {
    ok: true,
    source: 'ai',
    reason: 'ok',
    results: [
      { id: 'a', reason: '화상 회의에 바로 쓰는 도구입니다' },
      { id: 'b', reason: '같은 목적의 대안입니다' },
    ],
    tookMs: 742,
  };

  it('"AI가 의미로 찾은 링크 N건" 헤더와 소요 시간을 적는다', () => {
    renderResults(settled(RESPONSE));

    expect(screen.getByText('AI가 의미로 찾은 링크 2건')).toBeInTheDocument();
    expect(screen.getByText('이름이 안 겹쳐도 하는 일이 맞으면 가져옵니다')).toBeInTheDocument();
    // tookMs 742 → "0.74초" (프로토타입 214행 "0.75초" 형식).
    expect(screen.getByText('0.74초')).toBeInTheDocument();
  });

  it('근거 행을 실존 링크로 렌더한다 (id 매칭)', () => {
    renderResults(settled(RESPONSE));

    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveAttribute('href', 'https://zoom.us/');
    expect(rows()[0]).toHaveTextContent('Zoom');
    expect(rows()[0]).toHaveTextContent('화상 회의에 바로 쓰는 도구입니다');
    // 분류 칩도 붙는다.
    expect(within(rows()[0]).getByText('영상 도구')).toBeInTheDocument();
  });

  it('근거가 null 이면 링크 설명으로 대신 채운다', () => {
    renderResults(settled({ ...RESPONSE, results: [{ id: 'a', reason: null }] }));

    expect(rows()[0]).toHaveTextContent('화상 회의');
  });

  it('실존하지 않는 id 는 버리고 N건도 남은 것만 센다', () => {
    renderResults(settled({ ...RESPONSE, results: [{ id: 'a', reason: '있음' }, { id: 'ghost', reason: '없음' }] }));

    expect(rows()).toHaveLength(1);
    expect(screen.getByText('AI가 의미로 찾은 링크 1건')).toBeInTheDocument();
  });

  it('결과 행 60px + 호버 배경 (프로토타입 217행)', () => {
    renderResults(settled(RESPONSE));

    expect(rows()[0]).toHaveClass('h-[60px]', 'gap-[12px]', 'px-[18px]', 'border-b', 'border-line', 'hover:bg-page');
  });
});

describe('AI 성공 — 링크 열기 (팔레트 결과 행과 같은 계약)', () => {
  setupToastTimers();

  const RESPONSE: AiSearchResponse = {
    ok: true,
    source: 'ai',
    reason: 'ok',
    results: [{ id: 'a', reason: '화상 회의 도구' }],
    tookMs: 700,
  };

  beforeEach(() => {
    vi.mocked(recordClick).mockClear();
  });

  it('왼쪽 클릭은 새 탭 앵커 + 기록·토스트 + 닫기', () => {
    const onClose = vi.fn();
    renderResults(settled(RESPONSE), { onClose });

    expect(fireEvent.click(rows()[0])).toBe(true); // 기본 이동을 막지 않는다
    expect(recordClick).toHaveBeenCalledWith('a');
    expect(screen.getByText('Zoom · 새 탭으로 이동')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('가운데 클릭은 집계만 하고 팔레트를 닫지 않는다', () => {
    const onClose = vi.fn();
    renderResults(settled(RESPONSE), { onClose });

    expect(middleClick(rows()[0])).toBe(true);
    expect(recordClick).toHaveBeenCalledWith('a');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('우클릭은 세지 않는다', () => {
    renderResults(settled(RESPONSE));

    rightClick(rows()[0]);

    expect(recordClick).not.toHaveBeenCalled();
  });
});

describe('빈 AI 결과 (source=ai · results=[]) — 의미상 못 찾음', () => {
  const EMPTY: AiSearchResponse = { ok: true, source: 'ai', reason: 'ok', results: [], tookMs: 500 };

  it('폴백이 아니라 "의미상 못 찾음" 안내다', () => {
    renderResults(settled(EMPTY, '점심 메뉴 추천'));

    expect(screen.getByText('AI가 의미상 맞는 링크를 찾지 못했습니다')).toBeInTheDocument();
    expect(screen.getByText('“점심 메뉴 추천” — 다른 말로 다시 물어보세요')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-hits')).not.toBeInTheDocument();
  });
});

describe('rate-limit (DB 미접촉) — 구분 표시', () => {
  const RATE: AiSearchResponse = {
    ok: false,
    source: 'keyword',
    reason: 'rate-limit',
    results: [],
    tookMs: 2,
  };

  it('"잠시 후 재시도"로 다른 폴백과 구분한다', () => {
    renderResults(settled(RATE));

    expect(screen.getByText('AI 검색 요청이 많습니다')).toBeInTheDocument();
    expect(screen.getByText('잠시 후 다시 시도해 주세요')).toBeInTheDocument();
    // 빈 AI 결과 안내("의미상 못 찾음")와 다른 문구다.
    expect(screen.queryByText('AI가 의미상 맞는 링크를 찾지 못했습니다')).not.toBeInTheDocument();
  });
});

describe('키워드 폴백 (not-configured·timeout·error·parse-error) — 실결과 채움', () => {
  function fallback(reason: AiSearchResponse['reason'], results: AiSearchResponse['results']): AiSearchState {
    return settled({ ok: false, source: 'keyword', reason, results, tookMs: 30 });
  }

  it('실결과가 있으면 "이름 검색 결과로 대신합니다" + 이유 + 링크를 그린다', () => {
    renderResults(fallback('timeout', [{ id: 'a', reason: null }, { id: 'b', reason: null }]));

    expect(screen.getByText('이름 검색 결과로 대신합니다')).toBeInTheDocument();
    expect(screen.getByText('AI 검색이 시간을 초과했습니다')).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    // 폴백 행은 AI 근거가 없어 링크 설명을 적는다.
    expect(rows()[0]).toHaveTextContent('화상 회의');
  });

  it('이유마다 다른 한 줄 설명을 적는다', () => {
    const { rerender } = renderResults(fallback('not-configured', [{ id: 'a', reason: null }]));
    expect(screen.getByText('AI 검색을 아직 준비 중입니다')).toBeInTheDocument();

    rerender(
      <AiSearchResults
        state={fallback('parse-error', [{ id: 'a', reason: null }]) as Exclude<AiSearchState, { status: 'idle' }>}
        data={DATA}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('AI 응답을 이해하지 못했습니다')).toBeInTheDocument();
  });

  it('폴백 결과도 0건이면 "이름 검색 결과도 없습니다"', () => {
    renderResults(fallback('error', []));

    expect(screen.getByText('AI 검색에 문제가 생겼습니다')).toBeInTheDocument();
    expect(screen.getByText('이름 검색 결과도 없습니다')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-hits')).not.toBeInTheDocument();
  });
});

describe('HTTP·네트워크 오류 (비200)', () => {
  it('http 오류(400/413)는 실행 실패 안내다', () => {
    renderResults({ status: 'settled', query: 'x', result: { ok: false, kind: 'http', status: 413 } });

    expect(screen.getByText('AI 검색을 실행하지 못했습니다')).toBeInTheDocument();
    expect(screen.getByText('잠시 후 다시 시도해 주세요')).toBeInTheDocument();
  });

  it('network 오류도 같은 안내다', () => {
    renderResults({ status: 'settled', query: 'x', result: { ok: false, kind: 'network' } });

    expect(screen.getByText('AI 검색을 실행하지 못했습니다')).toBeInTheDocument();
  });
});

describe('접근성 — AI 영역 라이브 (I-2)', () => {
  it('AI 영역을 role="status" aria-live="polite" 로 감싸 전환을 SR 에 낭독한다', () => {
    // 로딩 내용의 가장 가까운 조상이 폴라이트 라이브 영역이어야 로딩→결과/오류가 무음이 아니다.
    // (형제로 붙은 Toaster 의 role="status" 와 헷갈리지 않게 로딩 요소에서 위로 짚는다.)
    renderResults({ status: 'loading' });

    expect(screen.getByTestId('ai-loading').closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  });
});
