'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { useSelectedCategory } from '@/components/admin/CategoryPanel';
import { toast } from '@/components/Toast';
import { REQUEST_FAILED } from '@/lib/constants';
import { collectFavicon, type FaviconResult } from '@/lib/favicon-collect';
import { createBookmark, type ActionResult } from '@/lib/mutations';
import { rendersSomething } from '@/lib/slots';
import { hostOf } from '@/lib/url';

/** 줄 — 프로토타입 원문 `display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:12px 16px`. */
const ROW = 'flex flex-wrap items-center gap-[8px] px-[16px] py-[12px]';

/** 세 입력의 공통 몸통 — 높이 32px, 라운드 6px, 좌우 10px, 12.5px (프로토타입 362–364행). */
const FIELD = 'h-[32px] rounded-[6px] border border-border-strong bg-card px-[10px] text-[12.5px] text-ink';

/**
 * 검은 확정 버튼 — 높이 32px, 좌우 14px. 줄바꿈을 막는 것은 flex-wrap 줄에서 라벨이 길기 때문이다.
 *
 * `cursor-pointer` 는 Tailwind v4 preflight 에 버튼 커서 규칙이 없어서다 — 적지 않으면 브라우저
 * 기본값 `default` 라 눌리는 곳 위에서 화살표로 남는다. 잠긴 동안에는 되돌린다(J2 InlineEdit ·
 * J3 DeleteConfirm · I1 CategoryHeader 와 같은 관례).
 */
const BUTTON =
  'flex h-[32px] flex-none cursor-pointer items-center rounded-[6px] bg-ink px-[14px] text-[12px] font-semibold whitespace-nowrap text-white hover:bg-ink-hover disabled:cursor-default disabled:opacity-60';

/** 파비콘 수집 **요청 자체가** 거부된 경우. 서버가 준 사유가 없으니 여기서 한 문장을 만든다. */
const FAVICON_REQUEST_FAILED = '파비콘을 가져오지 못했습니다.';

/**
 * 링크 추가 줄 — DESIGN_SPEC 6장, 프로토타입 359–366행.
 *
 * 주소·이름·설명 세 칸과 "‘○○’에 추가" 버튼 하나다. 어디에 넣을지는 prop 이 아니라 좌측 패널과
 * 공유하는 선택 상태에서 온다(`useSelectedCategory`).
 *
 * ## 등록 한 번의 순서 — 파비콘 먼저, 그다음 행 하나
 *
 * `collectFavicon(url)` → `createBookmark({ ..., faviconUrl })` 다. 행을 먼저 만들면 파비콘을
 * 채우려고 한 번 더 써야 하고(그사이 화면에는 회색 타일이 스친다), 무엇보다 `createBookmark` 는
 * insert 전에 `favicon_url` 을 받도록 만들어져 있다(lib/mutations.ts "favicon_url 계약").
 *
 * **파비콘 실패는 등록을 막지 않는다.** 카드는 `favicon_url = null` 을 회색 타일로 그리므로
 * (lib/favicon.ts), 못 구했으면 그 사실만 알림에 덧붙이고 등록은 그대로 간다.
 *
 * ## 문구는 서버가 정한다
 *
 * 주소 검증(http/https)·이름 자동 채움(`hostOf`)은 `createBookmark` 가 한다. 이 줄은 같은 규칙을
 * **미리 보여 주기만** 한다 — 이름 칸의 placeholder 가 "비우면 perplexity.ai" 로 바뀌는 것이
 * 그것이고, 거절 문구는 서버가 준 것을 그대로 토스트에 넣는다(화면이 한 벌 더 적으면 조용히 갈라진다).
 * 프로토타입은 자기 정규식으로 "https:// 로 시작하는 주소를 넣어주세요" 를 직접 띄웠지만,
 * 이제 판정하는 곳이 서버라 그 문장은 서버 것을 쓴다. 자동 이름도 프로토타입은 `host.split('.')[0]`
 * (= `perplexity`)이었으나 서버 규칙인 `hostOf`(= `perplexity.ai`)를 따른다.
 *
 * ## 상자를 이 컴포넌트가 갖는다 (I4·I5 와의 계약)
 *
 * 프로토타입에서 흰 상자 하나가 **추가 줄 + 필터 줄 + 링크 표**를 함께 담는다(359–412행). 그래서
 * 상자는 여기 있고, 필터 줄(I5)·표(I4)는 `children` 으로 들어와 추가 줄 **아래**에 붙는다
 * (`components/admin/CategoryHeader.tsx` 가 I2 에 대해 하는 것과 같은 모양). 추가 줄의 아래
 * 구분선은 그 아래에 무언가 붙을 때만 그린다.
 *
 * 카테고리가 하나도 없으면 **아무것도 그리지 않는다** — 등록할 곳이 없고, 무엇을 하면 되는지는
 * 바로 위 헤더 패널이 이미 알린다. 카테고리가 없으면 링크도 없으므로 children 도 그릴 것이 없다.
 */
export function LinkAddRow({ children }: { children?: ReactNode }) {
  const { selected } = useSelectedCategory();
  const labelId = useId();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  /**
   * 등록 요청이 나가 있음을 **화면에 알리는** 값 — 버튼을 흐리고 `aria-busy` 를 켠다.
   *
   * 두 번 들어가는 것을 막는 일은 이 값이 하지 않는다. 상태는 다음 렌더에야 새 값이 되는데,
   * 두 제출이 **같은 커밋 안에서** 처리되면 두 번째 핸들러가 읽는 것은 여전히 첫 렌더의
   * `false` 다(J3 실측 — 그 틈으로 요청이 두 번 나갔다). 실제 빗장은 아래 `sending` 이다.
   */
  const [busy, setBusy] = useState(false);
  /**
   * 진짜 빗장 — 값이 그 자리에서 바뀌므로 렌더를 기다리지 않는다.
   *
   * 등록은 **되돌릴 수 없는 쓰기**라(같은 링크가 두 줄이 된다) 한 프레임의 틈도 열어 두지
   * 않는다. 표시(`busy`)와 빗장(`sending`)을 나눈 것은 둘이 요구하는 것이 다르기 때문이다 —
   * 앞엣것은 다시 그려져야 하고, 뒤엣것은 지금 즉시 잠겨야 한다.
   */
  const sending = useRef(false);

  if (selected === null) return null;

  /**
   * 위 관문을 지난 뒤의 선택. 이름을 새로 잡는 이유는 타입 때문이다 — 아래 `submit` 은 함수
   * 선언이라 TypeScript 가 "그 전에 불릴 수도 있다"고 보아 좁혀진 타입을 물려주지 않는다.
   */
  const category = selected;

  /** 이름 칸을 비웠을 때 서버가 채울 이름. 주소가 아직 주소 꼴이 아니면 `null`. */
  const autoTitle = autoTitleOf(url);

  /**
   * 아래에 줄이 붙는가 — 추가 줄에 구분선을 그릴지 정한다. 혼자 있을 때 그으면 상자 테두리
   * 바로 안쪽에 아무것도 나누지 않는 선이 하나 더 생긴다.
   *
   * 기준은 **React 가 실제로 무언가를 그리는가**이고, 그 판정과 근거는 `lib/slots.ts` 한곳에
   * 있다(LinkCard 의 `editSlot`·CategoryHeader 의 구분선도 같은 것을 쓴다).
   */
  const hasRowsBelow = rendersSomething(children);

  async function submit(): Promise<void> {
    // 상태가 아닌 ref 를 본다 — 같은 커밋 안의 두 번째 제출은 아직 `busy=false` 를 읽는다.
    if (sending.current) return;

    // 빈 주소는 서버까지 가지 않는다(프로토타입 `if (!url) return` 과 같은 자리) — 아무것도 적지
    // 않고 누른 사람에게는 오류가 아니라 "아직 아무 일도 없음"이 맞다. 형식이 틀린 주소는
    // 여기서 막지 않는다: 그 판정과 문구는 서버 하나가 갖는다.
    const cleanUrl = url.trim();
    if (cleanUrl === '') return;

    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    const shownTitle = cleanTitle === '' ? hostOf(cleanUrl) : cleanTitle;

    // 빗장부터 건다 — 아래 `await` 로 넘어가기 전에, 그리고 다시 그려지기 전에.
    sending.current = true;
    setBusy(true);

    const favicon = await collect(cleanUrl);

    let result: ActionResult;
    try {
      result = await createBookmark({
        url: cleanUrl,
        title: cleanTitle === '' ? undefined : cleanTitle,
        description: cleanDescription === '' ? undefined : cleanDescription,
        categoryId: category.id,
        faviconUrl: favicon.ok ? favicon.faviconUrl : undefined,
      });
    } catch (error) {
      // 액션이 **거부로 끝난** 경우다(네트워크 단절, 배포로 액션 id 가 바뀜 등). 잡지 않으면
      // 빗장이 선 채로 남아 이 줄이 통째로 잠긴다 — 나갈 길이 새로고침뿐인 화면이 된다.
      console.error('[LinkAddRow] 링크 추가 요청이 거부됐다', error);
      sending.current = false;
      setBusy(false);
      toast(REQUEST_FAILED);

      return;
    }

    sending.current = false;
    setBusy(false);

    if (!result.ok) {
      // 적은 것은 지우지 않는다 — 거절 사유를 보고 이어서 고칠 값이다.
      toast(result.error);

      return;
    }

    // TODO(I4): 표가 붙으면 성공 전환을 트랜지션으로 묶을지 재판정 — 새 행 없는 표와 빈 폼의
    // 한 프레임 공존.
    setUrl('');
    setTitle('');
    setDescription('');
    // 프로토타입 `say(title + ' 추가됨 · ' + g)`. 파비콘을 못 구했으면 그 한 마디를 덧붙인다 —
    // 토스트는 한 번에 하나뿐이라 두 번 띄우면 앞엣것이 지워진다(components/Toast.tsx).
    toast(
      favicon.ok
        ? `${shownTitle} 추가됨 · ${category.name}`
        : `${shownTitle} 추가됨 · ${category.name} — ${favicon.error}`,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); // 폼 제출로 페이지가 이동하는 것을 막는다.
    void submit();
  }

  return (
    <section
      aria-label="링크"
      className="overflow-hidden rounded-[9px] border border-border bg-card"
    >
      {/* 폼으로 낸다 — 어느 칸에서든 Enter 가 곧 추가다(프로토타입 `onNewLinkKey`). keydown 을
          직접 듣지 않는 이유는 조합 입력(IME)이다: 한글을 확정하는 Enter 로 등록이 일어나면
          안 되는데, 그 판정은 브라우저가 이미 한다(CategoryPanel·InlineEdit 과 같은 근거). */}
      <form
        aria-labelledby={labelId}
        onSubmit={handleSubmit}
        className={`${ROW} ${hasRowsBelow ? 'border-b border-border' : ''}`}
      >
        <span id={labelId} className="w-[56px] flex-none text-[11.5px] font-bold text-ink">
          링크 추가
        </span>

        {/* placeholder 는 값이 들어가면 사라져 이름 역할을 못 하므로 접근성 이름을 따로 준다
            (프로토타입에는 눈에 보이는 라벨 줄이 없다 — 맨 앞 '링크 추가'가 줄 전체의 이름이다).

            왕복 중(최대 8초) 세 칸을 잠그는 것은 `disabled` 가 아니라 `readOnly` 다. 브라우저는
            disabled 가 된 요소에서 **포커스를 떼어 `<body>` 로 보낸다** — 어느 칸에서 Enter 로
            등록한 사용자의 포커스가 그 순간 줄 밖으로 튀고, 서버가 거절해 값이 그대로 남아도
            (아래 `submit`) 이어 고칠 자리를 잃는다. readOnly 는 값만 잠그고 포커스·선택·복사는
            그대로 둔다(J2 InlineEdit 의 두 입력과 같은 근거). */}
        <input
          aria-label="주소"
          placeholder="https://"
          value={url}
          readOnly={busy}
          maxLength={2048}
          onChange={(event) => setUrl(event.target.value)}
          className={`${FIELD} min-w-[200px] flex-[1_1_220px]`}
        />
        <input
          aria-label="이름"
          /* 비워 두면 무엇이 들어갈지 이 자리에서 미리 보여 준다. 값을 적는 순간 사라지지만,
             그때는 미리보기가 필요 없다 — 사람이 이름을 정한 뒤다. */
          placeholder={autoTitle === null ? '이름 (비우면 주소에서)' : `이름 (비우면 ${autoTitle})`}
          value={title}
          readOnly={busy}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          className={`${FIELD} w-[180px] flex-none`}
        />
        <input
          aria-label="한 줄 설명"
          placeholder="한 줄 설명"
          value={description}
          readOnly={busy}
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
          className={`${FIELD} min-w-[180px] flex-[1_1_200px]`}
        />

        {/* 파비콘을 구하는 동안(최대 8초) 이 버튼이 유일한 신호다 — 눈에는 흐려진 모습으로,
            보조기기에는 `aria-busy` 로 알린다(InlineEdit 의 저장 버튼과 같은 계약).
            라벨은 바꾸지 않는다: 스펙이 정한 문장이고, 글자 길이가 바뀌면 flex-wrap 줄이 흔들린다. */}
        <button type="submit" disabled={busy} aria-busy={busy} className={BUTTON}>
          ‘{category.name}’에 추가
        </button>
      </form>
      {children}
    </section>
  );
}

/**
 * 파비콘을 구해 온다. **거부는 여기서 실패로 접는다** — 파비콘 한 장 때문에 등록 전체가
 * 멈추면 안 되고, 잡지 않으면 `submit` 이 거부로 끝나 빗장이 선 채 남는다.
 */
async function collect(url: string): Promise<FaviconResult> {
  try {
    return await collectFavicon(url);
  } catch (error) {
    console.error('[LinkAddRow] 파비콘 수집 요청이 거부됐다', error);

    return { ok: false, error: FAVICON_REQUEST_FAILED };
  }
}

/**
 * 이름 칸을 비웠을 때 서버가 채울 이름(`createBookmark` → `hostOf`). 주소가 http/https 로
 * 해석되지 않으면 `null` — 그때는 서버도 이 주소를 거절하므로 미리 보여 줄 이름이 없다.
 */
function autoTitleOf(url: string): string | null {
  const clean = url.trim();

  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    return hostOf(clean);
  } catch {
    return null;
  }
}
