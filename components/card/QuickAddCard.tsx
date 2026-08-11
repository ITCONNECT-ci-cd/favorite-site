'use client';

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { toast } from '@/components/Toast';
import { CARD_HEIGHT, CARD_HEIGHT_MIN, CARD_PADDING } from '@/components/card/geometry';
import type { QuickAddCategory } from '@/components/card/quick-add-options';
import { REQUEST_FAILED } from '@/lib/constants';
import { collectFavicon, type FaviconResult } from '@/lib/favicon-collect';
import { isFocusNowhere } from '@/lib/focus';
import { createBookmark, type ActionResult } from '@/lib/mutations';
import { hostOf } from '@/lib/url';

/**
 * 카드 한 장 자리 — 라운드·높이·패딩은 전부 LinkCard 의 값이다(C2, `components/card/geometry.ts`).
 * 이 셋이 어긋나면 타일만 격자에서 튀어 보인다. `flex flex-col` 도 카드와 같다.
 */
const CELL = `flex flex-col rounded-[10px] ${CARD_PADDING}`;

/**
 * 접힌 타일 — 점선 상자(EmptyBox 와 같은 `border-dash` 토큰). 호버에서 테두리·글자가 잉크로
 * 진해지는 것은 카드의 `hover:border-ink` 와 같은 결이다.
 *
 * `cursor-pointer` 는 Tailwind v4 preflight 에 버튼 커서 규칙이 없어서다 — 적지 않으면 눌리는
 * 곳 위에서 화살표로 남는다(J2 InlineEdit · I3 LinkAddRow 와 같은 관례).
 */
const TILE = `${CELL} ${CARD_HEIGHT} cursor-pointer items-center justify-center gap-[4px] border border-dashed border-dash bg-side text-[12.5px] font-semibold text-desc hover:border-ink hover:text-ink`;

/**
 * 펼친 폼 — 같은 자리에 앉는 흰 상자. 카드와 같은 테두리 두께라 격자가 흔들리지 않는다.
 *
 * 여기만 **하한**(`CARD_HEIGHT_MIN`)을 쓴다 — 입력 넷 + 버튼 줄이 카드 한 장보다 키가 커서
 * 고정으로 두면 취소 버튼이 잘려 나간다(geometry.ts `CARD_HEIGHT_MIN` 참조).
 */
const FORM = `${CELL} ${CARD_HEIGHT_MIN} gap-[5px] border border-border-strong bg-card`;

/** 네 입력의 공통 몸통 — 높이 30px, 라운드 6px, 좌우 8px (J2 InlineEdit 의 값 그대로). */
const FIELD = 'h-[30px] w-full rounded-[6px] bg-card px-[8px]';
/** 주소 — 이 폼의 유일한 필수값이라 이름 칸과 같은 강조 테두리를 쓴다(InlineEdit 의 TITLE_FIELD). */
const URL_FIELD = `${FIELD} border-[1.5px] border-ink text-[12.5px] font-semibold`;
/** 이름·설명·분류 — 옅은 입력 테두리. */
const THIN_FIELD = `${FIELD} border border-border-strong text-[12px]`;

/** 두 버튼의 공통 몸통 — 높이 28px, 라운드 6px, 11.5px (InlineEdit 의 저장·취소와 같은 짝). */
const BUTTON =
  'flex h-[28px] cursor-pointer items-center rounded-[6px] text-[11.5px] disabled:cursor-default disabled:opacity-60';
const SUBMIT = `${BUTTON} flex-1 justify-center bg-ink font-semibold text-white`;
const CANCEL = `${BUTTON} shrink-0 border border-border-strong bg-card px-[10px] text-desc`;

/** 파비콘 수집 **요청 자체가** 거부된 경우. 서버가 준 사유가 없으니 화면이 한 문장을 만든다(I3 와 같은 값). */
const FAVICON_REQUEST_FAILED = '파비콘을 가져오지 못했습니다.';

export type QuickAddCardProps = {
  /**
   * 선택 상자에 세울 분류 — `toQuickAddOptions` 가 편 차례 그대로 그린다.
   *
   * 비어 있으면 이 컴포넌트는 **아무것도 그리지 않는다**. 넣을 곳이 없는 폼을 열어 두면 등록은
   * 반드시 실패한다(I3 LinkAddRow 가 카테고리 0개에서 줄을 통째로 접는 것과 같은 판단).
   */
  categories: readonly QuickAddCategory[];
  /**
   * 폼을 열 때 미리 골라 둘 분류 — **타일이 앉은 목록의 분류**를 준다(홈의 '운영 중' 섹션이면 그
   * 분류, 분류 화면이면 지금 보고 있는 탭). 지금 보고 있는 목록에 한 건 더 붙이는 것이 가장 흔한
   * 의도라, 그 자리에서 열면 아무것도 고르지 않고 바로 등록할 수 있어야 한다.
   *
   * `categories` 에 없는 id 면 **첫 분류로 떨어진다** — 고른 값과 화면에 보이는 값이 어긋난 채로
   * 등록되면 엉뚱한 분류에 들어간다.
   */
  defaultCategoryId: string;
};

/**
 * 카드 그리드 맨 앞에 서는 '+ 링크 추가' 타일 (K1) — 관리자가 홈·분류 화면에서 그 자리에서
 * 링크를 등록한다.
 *
 * **모달이 아니다.** 누르면 타일이 있던 격자 한 칸이 그대로 폼으로 바뀐다(DESIGN_SPEC 의 모달
 * 금지 방침 · J2 인라인 편집과 같은 결). 폼의 형태·잠금·실패 처리도 J2 를 그대로 본떴고, 등록 한
 * 번의 순서(파비콘 업로드 → `createBookmark` 한 번)는 I3 관리자 추가 줄
 * (`components/admin/LinkAddRow.tsx`)의 계약을 따른다.
 *
 * ## 이 컴포넌트는 '관리자인가'를 묻지 않는다
 *
 * 판정은 서버가 하고(각 page 의 `getAdminSession`), 화면이 `isAdmin` 일 때만 **렌더한다**.
 * 비관리자 응답에는 이 마크업이 통째로 실리지 않아야 한다(README 주의사항 7 — CSS 로 감추는
 * 방식 금지). 그래서 여기에는 관리자 관련 분기가 하나도 없다.
 *
 * ## 열고 닫는 것과 적는 것을 두 컴포넌트로 나눈다
 *
 * 아래 `QuickAddForm` 은 **열릴 때 마운트되고 닫힐 때 언마운트된다.** 그래서 적던 값도 고른
 * 분류도 닫으면 함께 사라지고(다시 열면 빈 폼), `defaultCategoryId` 가 그사이 바뀌었다면
 * (분류 화면에서 하위 탭을 옮겼다) 다음에 열 때 새 기본값을 읽는다. 값을 이 바깥 컴포넌트가
 * 들면 그 둘을 손으로 되돌려야 하고, 한쪽을 빠뜨리는 순간 '지난번에 적다 만 값이 남은 폼'이 된다.
 */
export function QuickAddCard({ categories, defaultCategoryId }: QuickAddCardProps) {
  const [open, setOpen] = useState(false);
  /**
   * 폼을 연 타일 — 닫힐 때 포커스를 돌려줄 자리다.
   *
   * J2·J3 처럼 `document.activeElement` 를 붙들지 않는 것은 그 트리거가 **이 컴포넌트 자신의
   * 버튼**이고, 폼이 열리면서 언마운트되기 때문이다(붙들어 봐야 문서에서 떨어져 나간 노드다).
   * 닫히면 같은 버튼이 다시 마운트되므로 ref 로 그때의 것을 잡는다.
   */
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** 열려 있었는지 — 포커스를 되돌리는 것은 **닫히는 그 순간**뿐이다(첫 마운트에는 움직이지 않는다). */
  const wasOpen = useRef(false);

  /**
   * 폼이 닫히면 포커스를 타일로 되돌린다. 폼 안의 버튼(취소·추가)이 사라지면 브라우저는 포커스를
   * 문서 뿌리로 보내므로, 그대로 두면 키보드 사용자가 방금 있던 자리를 잃는다.
   *
   * 포커스가 정말 떨어져 있을 때만 가져온다(`isFocusNowhere`) — 그사이 사용자가 다른 곳을
   * 잡았다면 뺏지 않는다.
   */
  useEffect(() => {
    const before = wasOpen.current;
    wasOpen.current = open;

    if (open || !before) return;
    if (!isFocusNowhere(document.activeElement)) return;

    triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  // 넣을 곳이 없으면 타일도 없다. 훅 뒤에 두는 것은 훅 호출 수가 렌더마다 달라지면 안 되기 때문이다.
  if (categories.length === 0) return null;

  if (open) {
    return (
      <QuickAddForm
        categories={categories}
        defaultCategoryId={defaultCategoryId}
        onDone={() => setOpen(false)}
      />
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      /* 보이는 글자는 '+ 링크 추가' 지만 이름은 '링크 추가' 다 — 더하기 기호는 장식이고, 폼의
         이름(aria-label)과 같아야 방금 연 것이 이 폼임을 화면 없이도 알 수 있다. */
      aria-label="링크 추가"
      data-testid="quick-add"
      onClick={() => setOpen(true)}
      className={TILE}
    >
      <span aria-hidden="true" className="text-[18px] leading-none font-normal">
        +
      </span>
      링크 추가
    </button>
  );
}

type QuickAddFormProps = QuickAddCardProps & {
  /**
   * 폼을 닫는다. **부르는 쪽은 반드시 이 폼을 언마운트한다** — 성공 경로는 빗장(`sending`)도
   * 잠긴 모습(`busy`)도 되돌리지 않으므로(아래 `submit`), 부르고도 폼을 남기면 입력도 버튼도
   * Esc 도 잠긴 폼이 화면에 남는다(J2 InlineEdit 의 `onDone` 과 같은 계약).
   */
  onDone: () => void;
};

/** 타일이 펼쳐진 모습 — 주소·이름·설명·분류 넷을 받아 링크 한 건을 만든다. */
function QuickAddForm({ categories, defaultCategoryId, onDone }: QuickAddFormProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  /**
   * 고른 분류. 기본값이 목록에 없으면 첫 분류로 떨어진다 — 초기값은 첫 렌더에서 한 번만 읽히므로
   * 폼이 열려 있는 동안 목록이 바뀌어도 고른 값은 흔들리지 않는다.
   */
  const [categoryId, setCategoryId] = useState(() =>
    categories.some((category) => category.id === defaultCategoryId)
      ? defaultCategoryId
      : categories[0].id,
  );
  /** 서버 왕복 중임을 **화면에 알리는** 값 — 버튼을 흐리고 `aria-busy` 를 켠다. */
  const [busy, setBusy] = useState(false);
  /**
   * 진짜 빗장 — 값이 그 자리에서 바뀌므로 렌더를 기다리지 않는다. 상태 하나로 겸할 수 없는 것은
   * 한 틱에 들어온 제출 둘이 같은 렌더의 클로저를 보기 때문이다(그때 `busy` 는 아직 false 이고
   * `disabled` 조차 걸리지 않았다 — J3 실측). 등록은 되돌릴 수 없는 쓰기라(같은 링크가 두 줄이
   * 된다) 그 한 프레임도 열어 두지 않는다.
   */
  const sending = useRef(false);
  const urlRef = useRef<HTMLInputElement>(null);
  /** 실패로 잠금이 풀렸을 때 포커스를 돌려줄 자리 — 다시 누를 컨트롤이다(아래 두 번째 effect). */
  const submitRef = useRef<HTMLButtonElement>(null);

  /**
   * 뜨는 순간 주소 칸으로 포커스를 데려온다. 폼을 연 타일은 방금 사라졌으므로 데려오지 않으면
   * 포커스가 문서 뿌리에 남고, Esc 취소도 폼 안에서 올라오는 keydown 을 듣는 것이라 함께 막힌다.
   *
   * J2 InlineEdit 과 달리 "누가 눌렀는가"를 가리지 않는다 — 이 폼을 여는 길은 자기 타일 하나뿐이라
   * 같은 폼이 두 자리에 동시에 열릴 수 없다.
   */
  useEffect(() => {
    urlRef.current?.focus({ preventScroll: true });
  }, []);

  /** 저장이 **실패해 잠금이 풀린 순간** 포커스를 추가 버튼으로 돌려준다(J2 InlineEdit 과 같은 처방). */
  const wasBusy = useRef(false);

  useEffect(() => {
    const before = wasBusy.current;
    wasBusy.current = busy;

    if (busy || !before) return;
    if (!isFocusNowhere(document.activeElement)) return;

    submitRef.current?.focus({ preventScroll: true });
  }, [busy]);

  /**
   * 지금 고른 분류. 목록에서 다시 찾아 쓰는 것은 **보낼 id 와 알림에 적을 이름이 갈라지지 않게**
   * 하기 위해서다. 초기값이 목록 안의 값임을 보장하므로(위 `useState`) 못 찾는 경우는 없지만,
   * 그때도 첫 분류로 떨어뜨려 "화면에 보이는 것과 다른 곳에 등록"만은 막는다.
   */
  const category = categories.find((option) => option.id === categoryId) ?? categories[0];

  async function submit(): Promise<void> {
    // 상태가 아닌 ref 를 본다 — 같은 커밋 안의 두 번째 제출은 아직 `busy=false` 를 읽는다.
    if (sending.current) return;

    const cleanUrl = url.trim();
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();

    // 빗장부터 건다 — 아래 `await` 로 넘어가기 전에, 그리고 다시 그려지기 전에.
    sending.current = true;
    setBusy(true);

    // **빈 주소도 서버까지 보낸다.** 거절 문구는 서버 하나가 갖는 것이라(저장소 규칙 5),
    // 화면이 "주소를 입력하세요"를 지어내면 서버 문구와 조용히 갈라진다. 다만 빈 문자열에서
    // 파비콘을 구할 길은 없으므로 그 왕복(최대 8초)만 건너뛴다 — 규칙을 복제하는 것이 아니라
    // 구할 것이 없는 호출을 아끼는 것이다.
    const favicon = cleanUrl === '' ? null : await collect(cleanUrl);

    let result: ActionResult;
    try {
      result = await createBookmark({
        url: cleanUrl,
        title: cleanTitle === '' ? undefined : cleanTitle,
        description: cleanDescription === '' ? undefined : cleanDescription,
        categoryId: category.id,
        faviconUrl: favicon !== null && favicon.ok ? favicon.faviconUrl : undefined,
      });
    } catch (error) {
      // 액션이 **거부로 끝난** 경우다(네트워크 단절 · 배포로 액션 id 가 바뀜). 잡지 않으면 빗장이
      // 선 채 남아 폼이 통째로 잠긴다 — 나갈 길이 새로고침뿐인 화면이 된다.
      console.error('[QuickAddCard] 링크 추가 요청이 거부됐다', error);
      sending.current = false;
      setBusy(false);
      toast(REQUEST_FAILED);

      return;
    }

    if (!result.ok) {
      // 적은 것은 지우지 않는다 — 거절 사유를 보고 이어서 고칠 값이다.
      sending.current = false;
      setBusy(false);
      toast(result.error);

      return;
    }

    // 이름을 비웠으면 서버가 채울 이름(`hostOf`)으로 말한다 — 화면이 규칙을 다시 정하는 것이
    // 아니라 서버와 같은 답을 미리 보여 주는 것이다(I3 LinkAddRow 와 같은 문구).
    const shownTitle = cleanTitle === '' ? hostOf(cleanUrl) : cleanTitle;
    // 파비콘을 못 구했으면 그 한 마디를 덧붙인다 — 토스트는 한 번에 하나뿐이라 두 번 띄우면
    // 앞엣것이 지워진다(components/Toast.tsx).
    toast(
      favicon === null || favicon.ok
        ? `${shownTitle} 추가됨 · ${category.name}`
        : `${shownTitle} 추가됨 · ${category.name} — ${favicon.error}`,
    );

    // 폼이 닫히는 것과 새 카드가 그려지는 것을 **한 커밋으로 묶는다.** `await` 뒤의 상태 갱신은
    // 저절로 트랜지션에 들어가지 않으므로(J2 InlineEdit 의 같은 자리 참조), 그냥 부르면 폼이 먼저
    // 닫히고 액션의 revalidate 가 도착하기 전까지 **방금 추가한 카드가 없는 격자**가 한 프레임 스친다.
    //
    // 그때까지 빗장도 잠긴 모습도 되돌리지 않는다 — 지연 구간이 두 번째 제출을 받는 창이 된다.
    // 되돌릴 필요가 없는 이유는 `onDone` 이 이 폼을 언마운트하기 때문이다(onDone 계약).
    startTransition(() => {
      onDone();
    });
  }

  /**
   * 폼 제출 = 추가 버튼 클릭 + **입력에서 Enter**(HTML 암묵적 제출). Enter 를 keydown 으로 직접
   * 듣지 않는 이유는 조합 입력(IME)이다 — 한글을 확정하는 Enter 로 등록이 일어나면 안 되는데,
   * 그 판정은 브라우저가 이미 한다.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    void submit();
  }

  /**
   * Esc 로 닫기(J2 InlineEdit 과 같은 계약). 왕복 중에는 듣지 않는다 — 요청은 이미 떠났으므로
   * 여기서 닫으면 '취소했는데 링크가 생겨 있는' 화면이 되고, 실패 문구를 보여 줄 폼도 사라진다.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape' || busy) return;

    onDone();
  }

  return (
    <form
      aria-label="링크 추가"
      data-testid="quick-add"
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className={FORM}
    >
      {/* placeholder 는 값이 들어가면 사라져 이름 역할을 못 하므로 접근성 이름을 따로 준다.
          카드 한 장 폭(158px)이라 눈에 보이는 라벨 줄은 두지 않는다(J2 InlineEdit 과 같은 사정).

          왕복 중 잠금이 `disabled` 가 아니라 `readOnly` 인 것은 포커스 때문이다 — 브라우저는
          disabled 가 된 요소에서 포커스를 떼어 문서 뿌리로 보낸다. 어느 칸에서 Enter 로 등록한
          사용자의 포커스가 그 순간 폼 밖으로 튀고, 서버가 거절해 값이 남아도 이어 고칠 자리를 잃는다. */}
      <input
        ref={urlRef}
        aria-label="주소"
        placeholder="https://"
        value={url}
        readOnly={busy}
        maxLength={2048}
        onChange={(event) => setUrl(event.target.value)}
        className={URL_FIELD}
      />
      <input
        aria-label="이름"
        /* 비워 두면 서버가 주소의 host 로 채운다 — 그 규칙은 `createBookmark` 의 것이고 화면은
           그렇게 될 것임을 알리기만 한다(문구를 여기서 다시 판정하지 않는다). */
        placeholder="이름 (비우면 주소에서)"
        value={title}
        readOnly={busy}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        className={THIN_FIELD}
      />
      <input
        aria-label="한 줄 설명"
        placeholder="한 줄 설명"
        value={description}
        readOnly={busy}
        maxLength={200}
        onChange={(event) => setDescription(event.target.value)}
        className={THIN_FIELD}
      />

      {/* 어디서 열든 넣을 분류를 여기서 고른다 — 타일이 앉은 목록이 기본값일 뿐, 다른 분류에도
          그대로 넣을 수 있다(그래서 홈 타일 하나로 어떤 분류든 채울 수 있다).

          `<select>` 에는 readOnly 가 없고 disabled 는 포커스를 날린다. 왕복 중에도 열어 두는 것은
          그래서다 — 보낼 분류는 제출하는 순간 이미 정해졌으므로(위 `submit` 의 `category`)
          그사이 값을 바꿔도 이번 등록이 달라지지 않는다. */}
      <select
        aria-label="분류"
        value={categoryId}
        onChange={(event) => setCategoryId(event.target.value)}
        className={THIN_FIELD}
      >
        {categories.map((option) => (
          <option key={option.id} value={option.id}>
            {/* 하위는 한 단 들여 보인다. optgroup 을 쓰지 않는 이유는 quick-add-options.ts 에 있다. */}
            {option.isSub ? `— ${option.name}` : option.name}
          </option>
        ))}
      </select>

      <div className="mt-auto flex gap-[5px]">
        {/* `aria-busy` 는 '눌렀고 지금 처리 중'을 보조 기술에도 알린다 — 파비콘 수집까지 최대
            8초가 걸릴 수 있는 자리라, 흐려지는 모습만으로는 아무 일도 없는 것과 같다. */}
        <button ref={submitRef} type="submit" disabled={busy} aria-busy={busy} className={SUBMIT}>
          추가
        </button>
        {/* `type="button"` 이어야 한다 — 폼 안의 버튼 기본값은 submit 이라 그대로 두면 취소가 등록이 된다. */}
        <button type="button" disabled={busy} onClick={() => onDone()} className={CANCEL}>
          취소
        </button>
      </div>
    </form>
  );
}

/**
 * 파비콘을 구해 온다. **거부는 여기서 실패로 접는다** — 파비콘 한 장 때문에 등록 전체가 멈추면
 * 안 되고(카드는 `favicon_url = null` 을 회색 타일로 그린다), 잡지 않으면 `submit` 이 거부로 끝나
 * 빗장이 선 채 남는다(I3 LinkAddRow 의 같은 함수와 한 글자도 다르지 않은 계약이다).
 */
async function collect(url: string): Promise<FaviconResult> {
  try {
    return await collectFavicon(url);
  } catch (error) {
    console.error('[QuickAddCard] 파비콘 수집 요청이 거부됐다', error);

    return { ok: false, error: FAVICON_REQUEST_FAILED };
  }
}
