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
 * 가운데 정렬은 바깥 flex가 맡으므로 키프레임은 세로 이동만 건드린다.
 * (Tailwind v4의 translate 유틸은 `transform`이 아니라 `translate` 속성을 쓰기 때문에
 *  `-translate-x-1/2`로 가운데를 잡았다면 애니메이션의 transform과 합성돼 어긋난다.)
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
            className="animate-[toast-rise_0.18s_ease-out] rounded-[8px] bg-ink px-[16px] py-[11px] text-[12.5px] whitespace-nowrap text-white shadow-[0_8px_24px_rgba(20,21,22,0.3)]"
          >
            {message.text}
          </div>
        ) : null}
      </div>
    </>
  );
}
