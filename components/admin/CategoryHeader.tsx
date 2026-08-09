'use client';

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

import { useSelectedCategory, type AdminCategory } from '@/components/admin/CategoryPanel';
import { toast } from '@/components/Toast';
import { deleteCategory, renameCategory } from '@/lib/mutations';

/** 헤더 줄 — 프로토타입 원문 `display:flex; align-items:center; gap:12px; padding:14px 16px`. */
const ROW = 'flex items-center gap-[12px] px-[16px] py-[14px]';

/** 줄 오른쪽의 글자 버튼들 — 11.5px. 색만 서로 다르다(프로토타입 334–335행). */
const LINK_BUTTON = 'flex-none text-[11.5px]';
/** 검은 확정 버튼(저장) — 높이 30px, 라운드 6px. */
const SOLID_BUTTON =
  'flex h-[30px] flex-none items-center rounded-[6px] px-[12px] text-[11.5px] font-semibold text-white disabled:opacity-60';

/**
 * 우측 헤더 패널 — DESIGN_SPEC 6장 "헤더 패널".
 *
 * 선택한 상위 카테고리 한 줄이다. 이름·링크 수를 보여 주고, 이름을 **그 자리에서** 고치고
 * (`renameCategory`), 비어 있는 카테고리를 지운다(`deleteCategory`). 어느 카테고리인지는
 * prop 이 아니라 좌측 패널과 공유하는 선택 상태에서 온다(`useSelectedCategory`).
 *
 * ## 상자를 이 컴포넌트가 갖는다 (I2 와의 계약)
 *
 * 프로토타입에서 흰 패널 하나가 **헤더 줄 + 하위 줄**을 함께 담는다(324–357행). 그래서 상자는
 * 여기 있고, 하위 줄(I2)은 `children` 으로 들어와 같은 상자 안 헤더 줄 **아래**에 붙는다.
 * 헤더 줄의 아래 구분선은 그 아래에 무언가 붙을 때만 그린다 — 혼자 있을 때는 상자 테두리 바로
 * 안쪽에 선이 하나 더 그어져 보인다.
 *
 * 링크 추가 줄(I3)·링크 표(I4)는 이 상자가 아니라 **다음 상자**다(프로토타입 359행부터) —
 * 화면(app/admin/page.tsx)이 이 패널 다음에 나란히 세운다.
 */
export function CategoryHeader({ children }: { children?: ReactNode }) {
  const { selected } = useSelectedCategory();

  return (
    <section
      aria-label="선택한 카테고리"
      className="mb-[14px] overflow-hidden rounded-[9px] border border-border bg-card"
    >
      {selected === null ? (
        /* 프로토타입에는 없는 상태다(항상 카테고리가 있었다). 이름 자리가 통째로 비면
           고장으로 보이므로 무엇을 하면 되는지 한 줄로 알린다. 가리키는 자리는 방향("왼쪽")이
           아니라 **패널 이름**이다 — <820px 에서는 그 패널이 왼쪽이 아니라 위에 있다. */
        <p className={`${ROW} text-[12px] text-fainter`}>
          카테고리가 없습니다. ‘상위 카테고리’에서 먼저 추가하세요.
        </p>
      ) : (
        /* `key` 가 이 줄의 상태를 카테고리마다 새로 시작하게 한다 — 고치던 이름·삭제 확인이
           다음 선택으로 새어 나가면 엉뚱한 카테고리를 그 이름으로 바꾸게 된다. */
        <HeaderRow key={selected.id} category={selected} divided={children !== undefined} />
      )}
      {children}
    </section>
  );
}

/** 헤더 줄의 세 갈래. 한 번에 하나만 보이므로 boolean 두 개가 아니라 값 하나로 든다. */
type Mode = 'view' | 'rename' | 'confirm';

/**
 * 선택된 카테고리 한 줄. 바깥에서 `key={category.id}` 로 다시 마운트하므로 여기서는
 * "선택이 바뀌면 상태를 되돌린다"를 신경 쓰지 않는다.
 */
function HeaderRow({ category, divided }: { category: AdminCategory; divided: boolean }) {
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState(category.name);
  /** 서버 왕복 중 — 두 번째 제출과 Esc 를 막는 빗장이다(J2 InlineEdit 과 같은 계약). */
  const [busy, setBusy] = useState(false);

  const rowClass = `${ROW} ${divided ? 'border-b border-line' : ''}`;

  async function save(): Promise<void> {
    if (busy) return;

    const cleanName = draft.trim();
    // 바뀐 것이 없으면 서버까지 가지 않는다 — 액션은 이런 요청도 성공으로 처리하지만,
    // 고치지 않고 저장을 누른 사람에게는 그냥 닫히는 것이 맞다.
    if (cleanName === category.name.trim()) {
      setMode('view');

      return;
    }

    // 빈 이름을 여기서 막지 않는 것은 의도다 — 사용자에게 보일 문구는 액션이 한곳에서 정한다
    // (`이름을 입력하세요.`). 화면이 한 벌 더 적으면 둘이 조용히 갈라진다.
    setBusy(true);
    const result = await renameCategory(category.id, cleanName);
    setBusy(false);

    if (!result.ok) {
      // 고치던 이름을 그대로 둔다 — 거절 사유를 보고 이어서 고칠 값이다.
      toast(result.error);

      return;
    }

    setMode('view');
    toast(`${category.name} → ${cleanName}으로 바꿈`);
  }

  async function remove(): Promise<void> {
    if (busy) return;

    setBusy(true);
    const result = await deleteCategory(category.id);
    setBusy(false);
    // 성공이든 실패든 확인 줄은 걷는다. 실패는 "하위를 먼저 지워라"·"링크가 남아 있다" 같은
    // **다른 화면에서 할 일**이라, 같은 자리에서 다시 누르게 두면 같은 거절만 반복된다.
    setMode('view');

    toast(result.ok ? `${category.name} 카테고리 삭제됨` : result.error);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    void save();
  }

  /**
   * Esc 취소. 저장 중에는 듣지 않는다 — 요청은 이미 떠났으므로 여기서 닫으면 '취소했는데 이름이
   * 바뀌어 있는' 화면이 된다(J2 InlineEdit 과 같은 판단).
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape' || busy) return;

    setMode('view');
  }

  if (mode === 'rename') {
    return (
      /* Enter 로 저장되는 것은 폼의 암묵적 제출이다 — 조합 입력(IME) 확정 Enter 를 저장으로
         오해하지 않는 판정을 브라우저에 맡긴다. */
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className={rowClass}>
        {/* `autoFocus` 는 사람이 '이름 수정'을 눌러 연 입력이라 정당하다 — 초점이 여기로 오는 것이
            그 클릭의 뜻이고, 방금 사라진 '이름 수정' 버튼에 초점이 남으면 키보드 사용자는 갈 곳을
            잃는다. 화면이 바뀌지 않는 인라인 편집이라 초점이 멀리 튀지도 않는다. */}
        <input
          autoFocus
          aria-label="카테고리 이름"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="h-[34px] w-[240px] flex-none rounded-[6px] border-[1.5px] border-ink bg-card px-[10px] text-[15px] font-bold text-ink"
        />
        <button type="submit" disabled={busy} className={`${SOLID_BUTTON} bg-ink`}>
          저장
        </button>
        {/* `type="button"` 이어야 한다 — 폼 안의 버튼 기본값은 submit 이라 그대로 두면 취소가 저장이 된다. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode('view')}
          className={`${LINK_BUTTON} text-faint hover:text-ink`}
        >
          취소
        </button>
      </form>
    );
  }

  return (
    <div className={rowClass}>
      <span className="text-[16px] font-bold tracking-[-0.01em] text-ink">{category.name}</span>

      {mode === 'confirm' ? (
        <>
          {/* 누른 뒤에 나타나는 안내라 스크린 리더가 그 자리에서 읽어야 한다.
              문구가 "지우려면 비워라" 규칙(lib/mutations.ts deleteCategory)을 미리 알려 준다 —
              하위나 링크가 남아 있으면 서버가 거절하고, 그 이유는 토스트로 온다. */}
          <p role="alert" className="text-[11.5px] text-desc">
            비어 있는 카테고리만 삭제됩니다. 삭제할까요?
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className={`${SOLID_BUTTON} ml-auto bg-danger`}
          >
            삭제
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode('view')}
            className={`${LINK_BUTTON} text-faint hover:text-ink`}
          >
            취소
          </button>
        </>
      ) : (
        <>
          <span className="text-[11.5px] text-fainter">{category.linkCount}개 링크</span>
          <button
            type="button"
            onClick={() => setMode('rename')}
            className={`${LINK_BUTTON} ml-auto text-sub hover:text-ink`}
          >
            이름 수정
          </button>
          <button
            type="button"
            onClick={() => setMode('confirm')}
            className={`${LINK_BUTTON} text-faint hover:text-danger`}
          >
            카테고리 삭제
          </button>
        </>
      )}
    </div>
  );
}
