/**
 * N3. `useAiSearch` 훅의 **경합 처리** — 세대(runId) 폐기와 in-flight abort 를 못박는다.
 *
 * 상태→화면 매핑은 AiSearchResults.test.tsx, 트리거→호출 흐름은 PaletteHost.test.tsx 가 이미 본다.
 * 여기서 보는 것은 그 사이에 숨은 훅의 핵심 한 가지뿐이다: **먼저 나간 요청이 뒤늦게 돌아와도 최신
 * 상태를 덮지 않는가**, **로딩 중 지워지면 응답이 와도 되살아나지 않는가**, **언마운트가 진행 중 요청을
 * 실제로 끊는가**.
 *
 * 라이브 `/api/ai-search` 를 타지 않으려고 `requestImpl` 을 주입한다(훅이 열어 둔 자리다). 주입한 가짜는
 * 요청마다 deferred 를 쥐여 주어, 응답이 도착하는 **순서**를 테스트가 직접 정한다 — 경합은 타이밍 문제라
 * 그 순서를 손에 쥐어야 검증할 수 있다. signal 도 함께 잡아 두어 abort 여부를 실물로 확인한다.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAiSearch } from '@/components/palette/useAiSearch';
import type { AiSearchClientResult } from '@/lib/ai-search-client';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Call = {
  query: string;
  signal: AbortSignal | undefined;
  /** 이 요청의 응답이 언제·무엇으로 도착할지는 테스트가 정한다. */
  resolve: (result: AiSearchClientResult) => void;
};

/** `requestAiSearch` 자리에 꽂는 가짜 — 부른 질의·signal 을 남기고, 응답은 수동으로 풀 수 있게 쥐고 있다. */
function stubRequest() {
  const calls: Call[] = [];
  const impl = vi.fn((query: string, signal?: AbortSignal): Promise<AiSearchClientResult> => {
    const d = deferred<AiSearchClientResult>();
    calls.push({ query, signal, resolve: d.resolve });
    return d.promise;
  });
  return { impl, calls };
}

/** 성공 응답 하나 — 내용은 아무래도 좋다(state.query 는 run 인자에서 오고, 여기서는 참조로만 구분한다). */
function ok(): AiSearchClientResult {
  return { ok: true, response: { ok: true, source: 'ai', reason: 'ok', results: [], tookMs: 1 } };
}

/** 응답을 풀고 그로 인한 상태 갱신(.then → setState)까지 act 안에서 흘려보낸다. */
async function deliver(call: Call, result: AiSearchClientResult) {
  await act(async () => {
    call.resolve(result);
    // resolve 가 예약한 .then 마이크로태스크가 setState 를 부른 뒤 act 가 마무리되게 한 틱 양보한다.
    await Promise.resolve();
  });
}

describe('useAiSearch — 경합/abort', () => {
  it('(a) 먼저 나간 요청이 나중에 resolve 돼도 최신 결과만 반영하고 낡은 것은 버린다', async () => {
    const { impl, calls } = stubRequest();
    const first = ok();
    const second = ok();
    const { result } = renderHook(() => useAiSearch(impl));

    act(() => {
      result.current.run('first');
    });
    act(() => {
      result.current.run('second');
    });
    expect(calls).toHaveLength(2);

    // 최신(두 번째) 응답이 먼저 도착 — 반영된다.
    await deliver(calls[1], second);
    expect(result.current.state).toEqual({ status: 'settled', query: 'second', result: second });

    // 낡은(첫 번째) 응답이 뒤늦게 도착 — 세대(runId) 가드가 버린다. 최신 결과가 그대로 남는다.
    // (가드를 없애면 이 지점에서 상태가 'first' 로 되덮여 RED 가 된다.)
    await deliver(calls[0], first);
    expect(result.current.state).toEqual({ status: 'settled', query: 'second', result: second });
  });

  it('(b) 로딩 중 clear() 하면 응답이 도착해도 idle 을 지킨다', async () => {
    const { impl, calls } = stubRequest();
    const { result } = renderHook(() => useAiSearch(impl));

    act(() => {
      result.current.run('q');
    });
    expect(result.current.state.status).toBe('loading');

    act(() => {
      result.current.clear();
    });
    expect(result.current.state.status).toBe('idle');

    await deliver(calls[0], ok());
    expect(result.current.state.status).toBe('idle');
  });

  it('(b) 로딩 중 reset() 도 응답 도착 후 idle 을 지킨다', async () => {
    const { impl, calls } = stubRequest();
    const { result } = renderHook(() => useAiSearch(impl));

    act(() => {
      result.current.run('q');
    });
    act(() => {
      result.current.reset();
    });

    await deliver(calls[0], ok());
    expect(result.current.state.status).toBe('idle');
  });

  it('(c) 언마운트 시 진행 중 요청의 controller.abort() 를 부른다', () => {
    const { impl, calls } = stubRequest();
    const { result, unmount } = renderHook(() => useAiSearch(impl));

    act(() => {
      result.current.run('q');
    });
    const { signal } = calls[0];
    expect(signal?.aborted).toBe(false);

    // 언마운트 정리(useEffect cleanup)가 진행 중 요청을 끊는다.
    // (그 cleanup 을 없애면 signal 이 계속 살아 있어 RED 가 된다.)
    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
