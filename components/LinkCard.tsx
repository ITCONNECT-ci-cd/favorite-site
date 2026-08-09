'use client';

import type { MouseEvent, ReactNode } from 'react';
import { CheckIcon, EyeIcon, PencilIcon, PinIcon, TrashIcon } from '@/components/icons';
import { faviconSrc } from '@/lib/favicon';
import type { BookmarkWithCount } from '@/lib/types';
import { hostOf } from '@/lib/url';

export type LinkCardProps = {
  bookmark: BookmarkWithCount;
  /** 핀 노출 — 홈의 '매일'·'운영 중' 섹션만 false */
  showPin?: boolean;
  /** 체크 노출 — 목록 화면(카테고리·매일·즐겨찾기)만 true */
  showCheck?: boolean;
  checked?: boolean;
  onToggleCheck?: (id: string) => void;
  isFaved?: boolean;
  onToggleFav?: (id: string) => void;
  /**
   * **서버가** 관리자 세션을 확인했을 때만 true (J1).
   *
   * 이 값이 참일 때에만 연필·휴지통이 **렌더된다** — 늘 그려 두고 CSS 로 감추는 방식은 금지다
   * (README 주의사항 7). 비관리자 응답에는 두 버튼의 마크업이 아예 실리지 않아야 한다.
   *
   * 판정은 이 카드가 하지 않는다. 공개 화면의 서버 컴포넌트가 `getAdminSession()`(H1)으로
   * 정해 내려보내는 값이고, 카드는 받은 대로 그린다.
   */
  isAdmin?: boolean;
  /**
   * 연필 클릭 — 그 카드의 id 를 돌려준다. **J1 시점에는 어느 화면도 넘기지 않는다**(no-op).
   *
   * J2(`components/card/InlineEdit.tsx`)가 배선할 자리다. 그때 이 카드가 할 일은 콜백을 부르는
   * 것까지이고, '한 번에 한 장만 편집' 같은 규칙은 여러 카드를 아는 화면 쪽이 든다.
   *
   * 폼이 **그려질** 자리는 따로 있다 — 아래 `isEditing`·`editSlot`.
   */
  onEdit?: (id: string) => void;
  /**
   * 휴지통 클릭 — 그 카드의 id 를 돌려준다. **J1 시점에는 어느 화면도 넘기지 않는다**(no-op).
   *
   * J3(`components/card/DeleteConfirm.tsx`)가 배선할 자리다. **누르는 즉시 지우지 않는다** —
   * 확인 오버레이를 거치는 것이 이 제품의 규칙이라(DESIGN_SPEC 2-1) 이 콜백은 '삭제'가 아니라
   * '삭제를 묻기'다.
   *
   * 그 오버레이가 **그려질** 자리는 따로 있다 — 아래 `deleteSlot`.
   */
  onDelete?: (id: string) => void;
  /**
   * 이 카드가 지금 편집 중인가 — **소유자 J2**(`components/card/InlineEdit.tsx`).
   *
   * `editSlot` 과 **둘 다** 갖춰졌을 때에만 본문 블록 + 하단 줄이 슬롯으로 **교체**된다.
   * 하나만 준 경우(플래그만 · 노드만)는 무시하고 평소대로 그린다 — 편집 폼 없이 본문만 사라지는
   * 반쪽 상태를 만들지 않기 위해서다. 두 값을 한 곳에서 같이 내려보내라.
   *
   * '노드가 있다'의 기준은 **React 가 무언가를 그리는가**다: `null`·`undefined` 는 물론
   * boolean(`false`·`true` 둘 다)·빈 문자열도 '슬롯 없음'이라 교체하지 않는다.
   * `editSlot={cond && <Form/>}`·`editSlot={cond || <Form/>}` 로 넘기는 관용구가 흔해서,
   * 이 검사를 느슨하게 두면 그 한 줄이 곧바로 빈 카드를 만든다.
   *
   * 판정도 상태도 이 카드가 갖지 않는다. '한 번에 한 장만 편집' 같은 규칙은 여러 카드를 아는
   * 화면(HomeView·ListView)이 들고, 카드는 받은 값대로 자리만 바꾼다.
   */
  isEditing?: boolean;
  /**
   * 편집 폼이 들어갈 자리 — **소유자 J2**(`components/card/InlineEdit.tsx`).
   *
   * 교체 범위는 DESIGN_SPEC 2-1 "인라인 편집"이 정한 그대로 **본문 블록 + 하단 줄**이다.
   * 상단 줄(파비콘 타일 · 체크 · 핀 · 연필 · 휴지통)은 **편집 중에도 그대로 남는다** — 스펙이
   * 교체 대상으로 적은 것이 그 둘뿐이고, 카드 밖 모달을 쓰지 않는 이상 나가는 길(취소)은
   * 폼 자신이 들기 때문이다. 액션 줄을 `isEditing` 으로 감추는 변경은 스펙 2-1장을 먼저 고쳐라.
   *
   * **교체 자리는 flex-col 의 중간 항목이다** — 카드 높이는 `min-h-[126px]`(모바일 104px)로
   * 정해져 있고, 지금 본문 앵커가 `mt-auto` 로 아래에 붙어 그 높이를 메운다. 폼이 `mt-auto`
   * 나 `flex-1` 을 갖지 않으면 폼은 위에 붙고 그 아래로 빈 공간이 남는다. 카드는 그 여백을
   * 대신 메워 주지 않는다(자리만 준다는 계약이라 그렇다) — 세로 배치는 폼의 몫이다 (J2 참고).
   *
   * **병렬 안전 계약**: J2 는 자기 컴포넌트 파일(`components/card/InlineEdit.tsx`)을 만들고
   * 화면에서 `editSlot={<InlineEdit …/>}` 로 주입하기만 한다. 이 파일(LinkCard.tsx)을 다시
   * 열 필요가 없다 — 그래야 J3 과 파일이 겹치지 않는다(계획서 5장 3단계 주의 칸).
   */
  editSlot?: ReactNode;
  /**
   * 삭제 확인 오버레이가 들어갈 자리 — **소유자 J3**(`components/card/DeleteConfirm.tsx`).
   *
   * 주면 **카드 컨테이너의 마지막 자식**으로 그대로 렌더한다. 카드는 위치도 크기도 강제하지
   * 않는다 — 자리만 준다. `position:absolute; inset:0; z-index:6` 은 스펙 2-1 "삭제 확인"이
   * 오버레이 자신의 것으로 적어 둔 값이라 J3 의 컴포넌트가 갖는다.
   *
   * 자식이어야 하는 이유는 컨테이너가 `relative overflow-hidden` 이기 때문이다. 카드 밖에서
   * 띄우면 기준 상자가 달라져 `inset-0` 이 이 카드를 덮지 않는다.
   *
   * 본문을 지우지 않는 것도 스펙대로다 — 오버레이가 배경 `rgba(251,250,248,.97)` 로 덮는다.
   * 그래서 `editSlot` 과 달리 교체가 아니라 **덧대기**이고, 편집 슬롯과 동시에 열려도 서로를
   * 밀어내지 않는다.
   *
   * ⚠️ **덮는 것은 포인터까지다.** 오버레이가 위에 깔려도 그 아래 본문 앵커·핀·연필은 여전히
   * DOM 에 있고 **키보드 포커스를 받는다** — 카드는 형제들에게 `inert` 를 걸지 않는다(그러면
   * 카드가 오버레이의 내부 구조를 알아야 하고, 자리만 준다는 이 계약이 깨진다). 그래서
   * 마운트 시 포커스 이동과 Tab 트랩(+Esc 로 닫기)은 **오버레이 자신의 몫**이다. 그것이 없으면
   * 삭제 확인이 떠 있는데 Tab 이 뒤의 링크로 새어 나가 확인 없이 다른 곳으로 갈 수 있다.
   * J3 착수 전에 반드시 읽어라.
   *
   * **병렬 안전 계약**: J3 도 자기 컴포넌트 파일 + 화면 배선만 한다. LinkCard.tsx 재수정 없음.
   */
  deleteSlot?: ReactNode;
  /** 링크를 여는 순간 호출 — F3이 클릭 기록에 배선한다 */
  onOpen?: (id: string) => void;
};

/**
 * DESIGN_SPEC 2-1 컨테이너.
 * transition은 속성마다 easing이 달라 Tailwind의 transition-* 유틸로는 표현되지 않으므로
 * 스펙 문자열을 임의 속성으로 그대로 옮겼다.
 */
const CARD = [
  'relative overflow-hidden flex flex-col gap-[6px] bg-card border rounded-[10px]',
  'p-[10px] min-[820px]:p-[12px] min-h-[104px] min-[820px]:min-h-[126px]',
  'shadow-[0_1px_2px_rgba(20,21,22,.04)]',
  '[transition:transform_.22s_cubic-bezier(.22,.9,.28,1),box-shadow_.22s_ease,border-color_.22s_ease]',
  // 확대만 motion-safe 로 감싼다 (D5, prefers-reduced-motion 가드). 같은 규칙을 reduce 쪽에서
  // 되돌리지 않고 아예 걸지 않는 이유는 우선순위 다툼을 만들지 않기 위해서다 — 두 규칙의
  // 특정도가 같아 CSS 출력 순서에 결과가 좌우된다. 색·그림자 전환은 움직임이 아니라 남긴다.
  'hover:border-ink motion-safe:hover:[transform:scale(1.05)]',
  'hover:shadow-[0_10px_26px_rgba(20,21,22,.14)] hover:z-[5]',
].join(' ');

/**
 * 상단 우측 액션 버튼 21×21px, radius 6px (DESIGN_SPEC 2-1 아이콘 표).
 *
 * 보이는 크기는 스펙대로 두고 **손가락이 닿는 자리만** `::before`로 넓힌다(C3 사이드바의
 * 펼침 버튼과 같은 방식). 세로는 ±11.5px, 가로는 ±0.5px에서 멈춘다 — 버튼 사이 간격이
 * 1px뿐이라(스펙의 `gap 1px`) 그 이상 넓히면 옆 버튼의 **보이는 영역** 위로 히트 영역이 겹쳐
 * 눌린 버튼이 뒤바뀐다. 나란한 21px 버튼 둘이 22px 간격으로 서 있는 한 44×44를 둘 다 갖는
 * 배치는 존재하지 않으므로, 겹침 없이 얻을 수 있는 최대치(22×44)를 취한다.
 *
 * **실제로 눌리는 크기는 22×42.5px다.** 위로 넓힌 11.5px 중 카드 안쪽은 패딩 10px까지고
 * 나머지 1.5px는 카드의 `overflow-hidden`이 잘라 낸다(잘린 영역은 그리기뿐 아니라 히트
 * 테스트에서도 빠진다). 즉 44px는 선언값이고 실측 상한은 42.5px다.
 *
 * 그래서 이 카드는 WCAG 2.5.5(AAA, 44×44)를 **구조적으로 만족시킬 수 없다** — 스펙이 21×21과
 * gap 1px을 고정한 이상 배치를 바꾸지 않고는 도달할 수 없는 값이다. 2.5.8(AA, 24×24)도
 * 가로 22px이라 2px 모자란다. 프로토타입 충실도를 우선한 결과이며, 넓히려면 스펙의
 * 아이콘 크기나 간격을 먼저 바꿔야 한다.
 *
 * J1에서 연필·휴지통이 붙어 관리자 화면의 버튼은 최대 넷이 됐지만 **기하는 그대로다** —
 * 늘어난 것은 같은 규격 버튼의 개수뿐이라(21px + gap 1px) 위 계산과 결론이 바뀌지 않는다.
 * 재검토하려면 스펙 2-1장의 아이콘 크기·간격부터 손대야 한다.
 *
 * 호버 배경은 이 상수에 없다 — 휴지통만 다른 색을 쓰기 때문이다(아래 ACTION·ACTION_DANGER).
 * 두 `hover:bg-*`를 한 버튼에 같이 달면 특정도가 같아 승자를 CSS 출력 순서가 정하게 된다.
 */
const ACTION_BASE =
  'relative flex size-[21px] shrink-0 items-center justify-center rounded-[6px] cursor-pointer before:absolute before:-inset-y-[11.5px] before:-inset-x-[0.5px]';

/** 체크·핀·연필의 공통 호버 배경 (DESIGN_SPEC 2-1 아이콘 표). */
const ACTION = `${ACTION_BASE} hover:bg-[#efede8]`;

/**
 * 연필만의 호버 — 공통 배경 위에 글자만 #141516(= --color-ink)으로 진해진다(스펙 2-1 아이콘 표).
 *
 * 호출부에 `hover:text-ink` 를 직접 적지 않고 상수로 올린 이유는 **대칭** 하나다: 휴지통의
 * 호버 글자색은 아래 ACTION_DANGER 안에 있는데 연필 것만 JSX 에 남으면, 두 버튼의 같은
 * 성질(호버 시 글자색)을 읽으려고 서로 다른 곳을 봐야 한다. 한쪽을 고치며 다른 쪽을 놓치기
 * 딱 좋은 배치라 "버튼별 호버 색은 상수에 있다"로 통일했다.
 *
 * 배경을 공유하는 것은 스펙 그대로다 — 다른 것은 글자색뿐이라 ACTION 을 재료로 쓴다.
 */
const ACTION_EDIT = `${ACTION} hover:text-ink`;

/**
 * 휴지통만의 호버 — 배경 #f4e8e6 + 글자 #a8443a(= --color-danger).
 * 되돌릴 수 없는 동작이라는 신호를 스펙이 색으로 준다. 두 값 모두 스펙 2-1장 아이콘 표 원값이다.
 */
const ACTION_DANGER = `${ACTION_BASE} hover:bg-[#f4e8e6] hover:text-danger`;

/**
 * 파비콘 주소를 CSS url() 안에 안전하게 넣는다.
 * 따옴표가 든 주소를 그대로 이어 붙이면 url() 문자열이 중간에서 닫히고
 * background-image 선언 전체가 무효 처리되어 파비콘이 통째로 사라진다.
 */
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, '\\$&')}")`;
}

/**
 * 홈·카테고리·즐겨찾기·매일이 공유하는 단 하나의 링크 카드.
 *
 * 링크를 여는 영역은 **파비콘 타일과 본문 블록뿐**이다(DESIGN_SPEC 2-1).
 * 카드 전체를 클릭 영역으로 만들면 핀·체크를 누를 때마다 탭이 열려 버린다.
 *
 * 두 영역 모두 진짜 앵커라서 가운데 클릭·Ctrl+클릭·우클릭 메뉴·상태바 미리보기가
 * 브라우저 기본 동작 그대로 살아 있다. 우리는 기록만 남기고 이동을 가로채지 않는다.
 *
 * 즐겨찾기·선택 상태와 클릭 기록은 카드 밖(소비자)이 들고 있고, 카드는 콜백만 부른다.
 */
export function LinkCard({
  bookmark,
  showPin = true,
  showCheck = false,
  checked = false,
  onToggleCheck,
  isFaved = false,
  onToggleFav,
  isAdmin = false,
  onEdit,
  onDelete,
  isEditing = false,
  editSlot,
  deleteSlot,
  onOpen,
}: LinkCardProps) {
  const { id, title, url, description } = bookmark;
  const icon = faviconSrc(bookmark);

  /** 가운데 클릭(새 탭)도 여는 것이다. 우클릭(button 2)은 메뉴만 여니 세지 않는다. */
  function recordAuxOpen(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 1) onOpen?.(id);
  }

  /**
   * 두 열기 영역이 같은 계약을 쓰도록 한곳에 모은다.
   * preventDefault를 부르지 않는다 — 이동은 브라우저에 맡기고 우리는 기록만 얹는다.
   */
  const openLink = {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: () => onOpen?.(id),
    onAuxClick: recordAuxOpen,
  } as const;

  // 체크를 감춘 화면에서 넘어온 checked는 무시한다 — 보이지 않는 상태로 테두리만 바뀌면 안 된다.
  const isChecked = showCheck && checked;
  // 체크는 즐겨찾기보다 앞선다 — 선택한 카드를 한눈에 구분하는 쪽이 우선이다.
  const border = isChecked ? 'border-ink' : isFaved ? 'border-fav-border' : 'border-card-border';

  // 플래그와 노드가 **둘 다** 있을 때에만 교체한다 — 하나만 온 요청은 무시하고 평소대로 그린다
  // (isEditing·editSlot JSDoc). 편집 폼이 없는데 본문만 지워지는 빈 카드를 만들지 않기 위해서다.
  //
  // "노드가 있다"의 기준은 **React 가 실제로 무언가를 그리는가**다. null·undefined 뿐 아니라
  // boolean·'' 도 React 는 아무것도 그리지 않으므로 전부 '슬롯 없음'으로 친다. undefined·null 만
  // 걸러 내면 호출부의 관용구 `editSlot={cond && <Form/>}` 가 cond 거짓일 때 **false** 를
  // 넘겨 검사를 통과하고, 교체는 일어나는데 그려지는 것은 없는 — 위 JSDoc 이 금지한 바로 그
  // 빈 카드가 된다. 0 과 NaN 은 뺀다: React 는 그 둘을 "0"·"NaN" 으로 **그리므로** 슬롯이 맞다.
  //
  // `false` 한 값이 아니라 `typeof` 로 boolean 전체를 거르는 이유: **둘 다 아무것도 그리지
  // 않는다** — `&&` 가 만드는 false 도, `cond || <Form/>` 가 cond 참일 때 만드는 true 도.
  // 한쪽만 막으면 규칙("React 가 그리는가")과 구현이 true 한 값에서 어긋나 그 관용구가
  // 그대로 빈 카드를 만든다. `[]`·`<></>` 도 아무것도 그리지 않지만 prop 검사로는 판별할 수
  // 없어(자식이 있는 배열·프래그먼트와 구별되지 않는다) 쫓지 않는다.
  const hasEditSlot =
    editSlot !== undefined && editSlot !== null && typeof editSlot !== 'boolean' && editSlot !== '';
  const showEditSlot = isEditing && hasEditSlot;

  // 무시된 요청은 화면상 "편집을 눌렀는데 아무 일도 없다"로만 보인다 — 개발 중에만 이유를 준다.
  // 반대 방향(슬롯만 있고 isEditing=false)은 **경고하지 않는다**: 편집 중이 아닌 카드에도 폼
  // 노드를 미리 만들어 넘기는 것은 정상 사용법이라, 경고를 걸면 목록을 한 번 그릴 때마다
  // 카드 수만큼(카테고리 화면 기준 118줄) 콘솔이 쏟아진다.
  if (process.env.NODE_ENV !== 'production' && isEditing && !hasEditSlot) {
    console.warn(
      `LinkCard(${id}): isEditing=true 인데 editSlot 이 비어 있어 본문 교체를 건너뛴다. ` +
        '두 값은 한 곳에서 같이 내려보내라 — React 가 아무것도 그리지 않는 값(null·undefined·' +
        'boolean·빈 문자열)은 전부 슬롯 없음으로 친다.',
    );
  }

  return (
    <div className={`${CARD} ${border}`}>
      <div className="flex min-h-[32px] items-start gap-[4px]">
        {/* 파비콘 타일은 본문과 같은 곳으로 가는 마우스 전용 보조 영역이다.
            탭 순서에 290번 중복으로 끼어들지 않도록 접근성 트리에서는 감춘다.
            파비콘이 없으면 이미지 없이 회색(bg-side) 타일만 남는다. */}
        <a
          {...openLink}
          aria-hidden="true"
          tabIndex={-1}
          style={icon === null ? undefined : { backgroundImage: cssUrl(icon) }}
          className={`size-[32px] shrink-0 cursor-pointer rounded-[9px] border border-border bg-center bg-no-repeat bg-[length:19px_19px] ${
            icon === null ? 'bg-side' : 'bg-card'
          }`}
        />

        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-px">
          {showCheck && (
            <button
              type="button"
              aria-label={`${title} 선택`}
              aria-pressed={isChecked}
              onClick={() => onToggleCheck?.(id)}
              className={`${ACTION} ${isChecked ? 'bg-ink text-white' : 'text-check-off'}`}
            >
              <CheckIcon />
            </button>
          )}

          {showPin && (
            <button
              type="button"
              aria-label={`${title} 즐겨찾기`}
              aria-pressed={isFaved}
              onClick={() => onToggleFav?.(id)}
              className={`${ACTION} ${isFaved ? 'bg-select text-ink' : 'text-ghost'}`}
            >
              <PinIcon filled={isFaved} />
            </button>
          )}

          {/* 관리자 전용 둘 (J1). `isAdmin &&` 는 감추는 장치가 아니라 **그리지 않는** 장치다 —
              비관리자 응답에는 아래 마크업이 통째로 실리지 않는다(README 주의사항 7).
              조건을 `hidden` 클래스나 `display:none`으로 바꾸지 마라. */}
          {isAdmin && (
            <>
              {/* aria-expanded 가 보는 것은 `isEditing` 플래그가 아니라 **실제로 교체됐는지**다.
                  플래그만 오고 슬롯이 비어 교체를 건너뛴 경우에도 참이라고 알리면, 화면을 볼 수
                  없는 사용자에게만 있지도 않은 폼이 열렸다고 말하는 셈이 된다. */}
              <button
                type="button"
                aria-label={`${title} 수정`}
                aria-expanded={showEditSlot}
                onClick={() => onEdit?.(id)}
                className={`${ACTION_EDIT} text-faint`}
              >
                <PencilIcon />
              </button>

              <button
                type="button"
                aria-label={`${title} 삭제`}
                onClick={() => onDelete?.(id)}
                className={`${ACTION_DANGER} text-faint`}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </span>
      </div>

      {/* ↓ J2(인라인 편집)가 통째로 교체하는 범위: 본문 블록 + 하단 줄 ↓
          교체가 아닐 때 이 프래그먼트는 DOM 에 아무 노드도 만들지 않는다 — 슬롯을 쓰지 않는
          렌더 결과는 슬롯이 없던 때(b2957ad)와 마크업이 한 글자도 다르지 않아야 한다. */}
      {showEditSlot ? (
        editSlot
      ) : (
        <>
          <a {...openLink} className="mt-auto block w-full cursor-pointer">
            {/* button과 달리 a는 흐름 콘텐츠를 담을 수 있지만, 스펙의 2줄 말줄임
                (max-height + overflow)만 필요하므로 span + block으로 충분하다. */}
            <span className="block max-h-[2.6em] overflow-hidden text-[13px] leading-[1.3] font-semibold tracking-[-0.01em] min-[820px]:text-[13.5px]">
              {title}
            </span>
            {description !== null && description !== '' && (
              <span className="mt-[4px] block max-h-[2.8em] overflow-hidden text-[12px] leading-[1.4] text-desc">
                {description}
              </span>
            )}
          </a>

          <div className="mt-[5px] flex items-center gap-[8px]">
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{hostOf(url)}</span>
            <span className="flex shrink-0 items-center gap-[4px] text-[11px] font-semibold text-faint">
              <EyeIcon />
              {bookmark.click_count}
            </span>
          </div>
        </>
      )}
      {/* ↑ J2 교체 범위 끝 ↑ */}

      {/* J3(삭제 확인)의 자리 — 카드의 마지막 자식. 스타일도 위치도 얹지 않는다:
          `absolute inset-0 z-[6]` 은 오버레이 자신의 것이다(deleteSlot JSDoc). */}
      {deleteSlot}
    </div>
  );
}
