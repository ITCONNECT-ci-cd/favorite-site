'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestAiSearch, type AiSearchClientResult } from '@/lib/ai-search-client';

/**
 * N3. ⌘K 팔레트의 AI 의미 검색 **상태 오너**.
 *
 * 팔레트(CommandPalette)는 질의를 들고 트리거(버튼·`⌘↵`·0건 `↵`)만 위로 알린다(`onAiSearch(query)`).
 * 그 통로를 실제 `/api/ai-search` 호출로 잇고, 로딩/결과/폴백 상태를 쥐는 것이 이 훅이다. 결과 화면은
 * `AiSearchResults` 가 `state` 를 받아 그린다. 호스트(PaletteHost)가 셋을 조립한다.
 *
 * ### 상태가 왜 팔레트가 아니라 여기 사는가
 * 질의는 팔레트 패널의 내부 상태다 — 그래서 트리거는 질의를 **인자로** 올려 준다(팔레트 JSDoc).
 * 결과 상태를 패널 안에 두면 패널이 닫힐 때(언마운트) 사라져 좋지만, 그러면 팔레트가 `/api/ai-search`
 * 를 직접 알아야 해 G2/G3 가 세워 둔 "표시 컴포넌트 + 콜백" 경계가 무너진다. 그래서 호스트가 상태를
 * 쥐고, 대신 아래 세 가지로 팔레트의 생애주기에 맞춘다.
 *
 * - `run(query)` — 트리거. 빈 질의는 **부르지 않는다**(프로토타입 `runAi` 의 `if (!q) return`, 851행).
 * - `clear()` — 입력이 바뀌면 지난 AI 결과를 지운다(프로토타입 `onQ` 의 `ai: 'idle'`, 994행).
 *   팔레트가 타자마다 `onQueryChange` 로 부른다. **API 를 부르지 않는다** — 이미 idle 이면 아무 일도 없다.
 * - `reset()` — 팔레트를 닫을 때(행 열기·esc·오버레이). 프로토타입 `open`/`closePalette` 의 `ai: 'idle'`.
 *
 * ### 경합 처리 — 세대(generation) + AbortController
 * 로딩 중 다시 트리거하거나 질의를 고치면, 먼저 나간 요청의 응답이 **뒤늦게 돌아와 최신 상태를 덮지
 * 않도록** 한다. `runId` 를 올려 그보다 오래된 응답은 버리고, 진행 중 요청은 실제로도 끊는다(abort).
 */

/** 팔레트 AI 영역의 상태. `idle` 이면 호스트가 슬롯을 아예 렌더하지 않는다(`aiBusy=false`). */
export type AiSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'settled'; query: string; result: AiSearchClientResult };

export type UseAiSearch = {
  state: AiSearchState;
  /** 슬롯이 무언가를 그리는가 = idle 이 아니다. 팔레트의 0건 안내를 감추는 `aiBusy` 로 내려간다. */
  busy: boolean;
  /** AI 의미 검색 실행. 질의는 트림된 값(팔레트가 넘긴다). 빈 값이면 아무 일도 하지 않는다. */
  run: (query: string) => void;
  /** 입력 변경 신호 — 지난 결과를 지운다. API 를 부르지 않는다. */
  clear: () => void;
  /** 팔레트 닫힘 — 상태를 idle 로 되돌리고 진행 중 요청을 끊는다. */
  reset: () => void;
};

export function useAiSearch(
  requestImpl: typeof requestAiSearch = requestAiSearch,
): UseAiSearch {
  const [state, setState] = useState<AiSearchState>({ status: 'idle' });

  // 최신 요청만 상태에 반영하기 위한 세대 번호. 요청을 시작할 때 올리고, 응답이 돌아오면
  // 그 사이 세대가 또 바뀌지 않았는지 확인한다. 무효화(clear/reset)도 이 값을 올려 in-flight 를 버린다.
  const runId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  /** 진행 중 요청을 끊고 세대를 올린다 — 이후 돌아오는 응답은 모두 버려진다. */
  const abort = useCallback(() => {
    runId.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const run = useCallback(
    (query: string) => {
      const q = query.trim();
      if (q === '') return; // 빈 질의로는 부르지 않는다(프로토타입 851행).

      abort();
      const id = runId.current;
      const ctrl = new AbortController();
      controller.current = ctrl;

      setState({ status: 'loading' });

      void requestImpl(q, ctrl.signal).then((result) => {
        // 그 사이 더 새로운 트리거·입력 변경·닫힘이 있었으면 이 응답은 낡았다.
        if (id !== runId.current) return;
        controller.current = null;
        setState({ status: 'settled', query: q, result });
      });
    },
    [abort, requestImpl],
  );

  const clear = useCallback(() => {
    abort();
    // 이미 idle 이면 같은 참조를 돌려줘 리렌더를 만들지 않는다(타자마다 불려도 값싸다).
    setState((current) => (current.status === 'idle' ? current : { status: 'idle' }));
  }, [abort]);

  // 닫힘은 지금은 clear 와 같지만, 뜻이 다르므로(입력 변경 vs 팔레트 닫힘) 이름을 나눠 둔다.
  const reset = clear;

  // 호스트는 앱 수명 내내 마운트돼 있어 거의 언마운트되지 않지만, 그럴 때 새는 요청을 끊는다.
  useEffect(() => () => controller.current?.abort(), []);

  return { state, busy: state.status !== 'idle', run, clear, reset };
}
