'use client';

import { useSyncExternalStore } from 'react';

/** 토스트가 화면에 머무는 시간 (DESIGN_SPEC 7장 "2초 후 사라짐"). */
export const TOAST_DURATION_MS = 2000;

type ToastMessage = {
  /** 같은 문구를 연달아 띄워도 말풍선을 새로 마운트해 rise를 다시 재생시키는 키. */
  id: number;
  text: string;
};

/**
 * 모듈 레벨 스토어. 한 화면에 토스트는 하나뿐이라 상태도 하나면 충분하고,
 * 덕분에 어느 클라이언트 코드에서든 훅 없이 `toast('...')`만 부르면 된다.
 */
const listeners = new Set<() => void>();
let current: ToastMessage | null = null;
let nextId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): ToastMessage | null {
  return current;
}

/** 서버 렌더에는 토스트가 없다. (useSyncExternalStore 규약상 항상 같은 값을 돌려줘야 한다.) */
function getServerSnapshot(): ToastMessage | null {
  return null;
}

/**
 * 화면 하단 중앙에 안내 문구를 잠깐 띄운다. `<Toaster />`가 마운트돼 있으면 그려지고,
 * 없으면 조용히 넘어간다.
 *
 * 한 번에 하나만 보인다 — 연속 호출하면 앞선 메시지를 밀어내고 2초를 다시 센다.
 *
 * 이 토스트를 거치는 화면(D6 핀 토글·F3 카드 클릭 등)을 테스트할 때 주의할 점 두 가지:
 *
 * 1. 스토어가 모듈 레벨이라 상태가 테스트 사이에 남는다. 토스트를 띄운 테스트는
 *    afterEach에서 `vi.advanceTimersByTime(TOAST_DURATION_MS)`로 타이머를 흘려보내
 *    비워 줘야 다음 테스트가 앞 테스트의 문구를 보지 않는다 (Toast.test.tsx 참고).
 * 2. React 이벤트 핸들러 밖에서 직접 부르면 상태 갱신이 act() 밖에서 일어난다.
 *    `act(() => { toast('...'); })`로 감싼다. 클릭 등으로 간접 호출되는 경로는
 *    fireEvent/userEvent가 이미 act()로 감싸므로 따로 처리할 필요가 없다.
 */
export function toast(message: string): void {
  clearTimeout(timer);
  nextId += 1;
  current = { id: nextId, text: message };
  emit();

  timer = setTimeout(() => {
    current = null;
    timer = undefined;
    emit();
  }, TOAST_DURATION_MS);
}

/**
 * rise 애니메이션 (DESIGN_SPEC 7장 `rise .18s ease-out`).
 * 전역 스타일(app/globals.css)이 아니라 이 컴포넌트가 직접 싣는다 — 토스트 말고는 쓰는 곳이 없다.
 *
 * 붙이는 쪽은 `motion-safe:` 다 (D5, prefers-reduced-motion 가드). 움직임을 꺼 둔 사용자에게는
 * 애니메이션을 되돌리는 규칙을 얹는 대신 **아예 걸지 않는다** — 같은 특정도의 규칙 둘이
 * CSS 출력 순서로 승부가 갈리는 상황을 만들지 않기 위해서다. 문구는 그 자리에 즉시 나타난다.
 *
 * 가운데 정렬은 바깥 flex가 맡으므로 키프레임은 세로 이동만 건드린다.
 * 프로토타입 키프레임은 `translate(-50%, 8px)`로 가로 -50%를 함께 들고 있는데, 거기서는
 * 가운데 정렬도 `transform: translateX(-50%)`이라 애니메이션이 그 값을 통째로 덮어쓰기 때문이다.
 * Tailwind v4의 `-translate-x-1/2`는 `transform`이 아니라 개별 `translate` 속성이고,
 * 개별 변환 속성은 `transform`을 덮어쓰지 않고 그 앞에 합성된다(CSS Transforms L2).
 * 그래서 저 키프레임을 그대로 가져오면 -50%가 두 번 먹어 -100%가 된다.
 * flex 정렬은 가로 이동을 아예 쓰지 않으므로 이 함정 자체가 생기지 않는다.
 */
const RISE_KEYFRAMES = `
@keyframes toast-rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

/**
 * 토스트를 그리는 자리. 앱에 한 번만 마운트한다 (배선은 C1의 셸 레이아웃 몫).
 *
 * 라이브 리전은 항상 DOM에 있어야 스크린 리더가 나중에 들어온 문구를 읽어 주므로
 * 바깥 껍데기는 늘 렌더하고 말풍선만 조건부로 넣는다.
 */
export function Toaster() {
  const message = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <>
      <style>{RISE_KEYFRAMES}</style>
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[26px] z-[60] flex justify-center"
      >
        {message ? (
          <div
            key={message.id}
            /* 폭 상한은 D5 실측 결과다 — 시드에서 가장 긴 제목 + 가장 긴 꼬리표는 12.5px 기준
               약 444px 라 375px 화면을 넘는다. 좌우 12px(모바일 본문 패딩과 같은 값)을 남기고
               말줄임으로 끊는다. 데스크톱에서는 상한에 닿지 않아 모습이 그대로다. */
            className="motion-safe:animate-[toast-rise_0.18s_ease-out] max-w-[calc(100vw-24px)] truncate rounded-[8px] bg-ink px-[16px] py-[11px] text-[12.5px] whitespace-nowrap text-white shadow-[0_8px_24px_rgba(20,21,22,0.3)]"
          >
            {message.text}
          </div>
        ) : null}
      </div>
    </>
  );
}
