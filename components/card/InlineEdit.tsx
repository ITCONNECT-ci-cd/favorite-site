'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';

import { toast } from '@/components/Toast';
import { updateBookmark, type BookmarkPatch } from '@/lib/mutations';
import type { BookmarkWithCount } from '@/lib/types';

export type InlineEditProps = {
  /** 지금 고치는 링크. 폼의 처음 값은 이 값에서 나오고, 저장 판정(무엇이 바뀌었나)도 이것과 비교한다. */
  bookmark: BookmarkWithCount;
  /**
   * 폼을 닫는다 — 화면이 든 `editingId` 를 비우는 일이다(저장 성공 · 취소 · Esc).
   *
   * **실패하면 부르지 않는다.** 고치던 값을 그대로 둔 채 문구만 토스트로 알리고, 사용자가 고쳐
   * 다시 저장하거나 취소로 나가게 한다.
   */
  onDone: () => void;
};

/** 두 입력의 공통 몸통 — 높이 30px, 라운드 6px, 좌우 패딩 8px, 흰 배경 (프로토타입 실측). */
const FIELD = 'h-[30px] w-full rounded-[6px] bg-card px-[8px]';
/** 이름 입력 — 테두리 1.5px `#141516`, 12.5px/600 (DESIGN_SPEC 2-1 "인라인 편집"). */
const TITLE_FIELD = `${FIELD} border-[1.5px] border-ink text-[12.5px] font-semibold`;
/** 설명 입력 — 테두리 1px `#ddd8d1`(= --color-border-strong), 12px. */
const DESC_FIELD = `${FIELD} border border-border-strong text-[12px]`;

/**
 * 두 버튼의 공통 몸통 — 높이 28px, 라운드 6px, 11.5px.
 *
 * 잠긴 모습(저장 중)은 프로토타입에 없다. 프로토타입은 저장이 즉시 끝나는 로컬 상태였지만 여기서는
 * 서버 왕복이라 '누른 것이 먹었는지' 알 수 없는 구간이 생긴다 — 흐리게 + 커서 되돌리기로 그 구간을
 * 보이게만 한다(색·크기는 그대로).
 */
const BUTTON =
  'flex h-[28px] cursor-pointer items-center rounded-[6px] text-[11.5px] disabled:cursor-default disabled:opacity-60';
/** 저장 — 검은 버튼, 남는 폭을 다 쓴다(`flex:1`). */
const SAVE = `${BUTTON} flex-1 justify-center bg-ink font-semibold text-white`;
/** 취소 — 흰 버튼. 글자만큼만 차지한다(`flex:none` + 좌우 10px). */
const CANCEL = `${BUTTON} shrink-0 border border-border-strong bg-card px-[10px] text-desc`;

/**
 * 카드 안에서 이름·설명을 고치는 폼 — DESIGN_SPEC 2-1 "인라인 편집".
 *
 * **모달이 아니다.** 카드의 본문 블록 + 하단 줄 자리에 그대로 들어앉는다(LinkCard 의 `editSlot`).
 * 그래서 뿌리 요소가 `margin-top:auto` 를 들고 있다 — 교체하기 전 본문 블록이 갖던 값이라,
 * 카드가 min-height 로 늘어나도 폼이 아래에 붙어 카드 높이가 출렁이지 않는다.
 *
 * ## 필드는 이름·설명 둘뿐이다
 *
 * 스펙 2-1 과 프로토타입(`b.editTitle`·`b.editDesc`)이 정한 그대로다. 액션이 받을 수 있는
 * 주소·분류·파비콘까지 여기 두지 않는다 — 카드 한 장 폭(158px)에 들어가는 폼이고, 링크를 다른
 * 분류로 옮기는 일은 관리 화면(I4 링크 표)의 몫이다.
 *
 * ## '동시에 한 장만' 은 이 컴포넌트가 모른다
 *
 * 여러 카드를 아는 화면(HomeView·ListView)이 `editingId` 하나를 들고 그 카드에만 이 폼을
 * 내려보낸다. 이 폼이 아는 것은 자기가 고치는 링크 한 건과 나가는 길(`onDone`)뿐이다.
 */
export function InlineEdit({ bookmark, onDone }: InlineEditProps) {
  const [title, setTitle] = useState(bookmark.title);
  const [description, setDescription] = useState(bookmark.description ?? '');
  /** 서버 왕복 중 — 두 번째 제출과 Esc 를 막는 빗장이다. */
  const [saving, setSaving] = useState(false);

  /**
   * **바뀐 키만** 담는다. `updateBookmark` 는 준 키만 쓰므로(BookmarkPatch), 건드리지 않은
   * 필드를 굳이 실어 보내면 그 사이 다른 창이 고친 값을 우리가 읽어 온 옛 값으로 되돌린다.
   *
   * 다듬은 값끼리 비교하는 것은 액션도 `asText` 로 다듬어 저장하기 때문이다 — 공백만 더 찍은
   * 입력을 '바뀌었다'고 보면 서버에 가서 같은 값을 다시 쓰게 된다.
   */
  function buildPatch(): BookmarkPatch {
    const patch: BookmarkPatch = {};
    const nextTitle = title.trim();
    const nextDescription = description.trim();

    if (nextTitle !== bookmark.title.trim()) patch.title = nextTitle;
    if (nextDescription !== (bookmark.description ?? '').trim()) patch.description = nextDescription;

    return patch;
  }

  /**
   * 저장. 빈 이름을 여기서 막지 않는 것은 의도다 — 사용자에게 보일 문구는 액션이 한곳에서
   * 정하고(`이름을 입력하세요.`), 화면은 결과만 표시한다. 문구를 여기에 한 벌 더 적으면
   * 둘이 조용히 갈라진다.
   */
  async function save(): Promise<void> {
    if (saving) return;

    const patch = buildPatch();
    // 바뀐 것이 없으면 서버까지 가지 않는다. 액션은 이런 요청에 '수정할 내용이 없습니다.' 를
    // 돌려주는데, 아무것도 고치지 않고 저장을 누른 사람에게는 오류가 아니라 그냥 닫히는 것이 맞다.
    if (Object.keys(patch).length === 0) {
      onDone();

      return;
    }

    setSaving(true);
    const result = await updateBookmark(bookmark.id, patch);

    // 성공하면 폼이 사라지므로 빗장을 되돌리지 않는다. 화면 갱신은 액션의
    // revalidatePath('/', 'layout') 가 하고, 이 폼은 닫히기만 한다.
    if (result.ok) {
      onDone();

      return;
    }

    setSaving(false);
    toast(result.error);
  }

  /**
   * 폼 제출 = 저장 버튼 클릭 + **입력에서 Enter**(HTML 암묵적 제출).
   *
   * Enter 를 keydown 으로 직접 듣지 않는 이유는 조합 입력(IME)이다 — 한글을 확정하는 Enter 로
   * 저장이 일어나면 안 되는데, 브라우저는 조합 중 Enter 를 제출로 바꾸지 않는다. 그 판정을
   * 우리가 다시 구현하지 않고 그대로 쓴다.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    void save();
  }

  /**
   * Esc 취소 (DESIGN_SPEC 2-1). 저장 중에는 듣지 않는다 — 요청은 이미 떠났으므로 여기서 닫으면
   * '취소했는데 값이 바뀌어 있는' 화면이 된다. 실패했을 때 문구를 보여 줄 폼도 사라진다.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape' || saving) return;

    onDone();
  }

  return (
    <form
      // 카드마다 폼이 하나씩 열릴 수 있으므로 어느 링크의 폼인지 이름에 담는다
      // (카드 액션 버튼의 `${title} 수정`·`${title} 삭제` 와 같은 방식).
      aria-label={`${bookmark.title} 편집`}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="mt-auto flex flex-col gap-[5px]"
    >
      {/* placeholder 는 프로토타입 원문이고, 접근성 이름은 따로 준다 — placeholder 는 값을 입력하면
          사라져 이름 역할을 하지 못한다. 카드 폭이 좁아 눈에 보이는 라벨 줄은 두지 않는다. */}
      <input
        aria-label="이름"
        placeholder="이름"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className={TITLE_FIELD}
      />
      <input
        aria-label="한 줄 설명"
        placeholder="한 줄 설명"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        className={DESC_FIELD}
      />

      <div className="flex gap-[5px]">
        <button type="submit" disabled={saving} className={SAVE}>
          저장
        </button>
        {/* `type="button"` 이어야 한다 — 폼 안의 버튼 기본값은 submit 이라 그대로 두면 취소가 저장이 된다. */}
        <button type="button" disabled={saving} onClick={() => onDone()} className={CANCEL}>
          취소
        </button>
      </div>
    </form>
  );
}
