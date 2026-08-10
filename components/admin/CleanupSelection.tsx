'use client';

import { startTransition, useEffect, useRef, useState } from 'react';

import { toast } from '@/components/Toast';
import { REQUEST_FAILED } from '@/lib/constants';
import { deleteBookmarks, type ActionResult } from '@/lib/mutations';

/**
 * M2b. 정리 도구에서 **고르고 지우는 부분** — `components/admin/CleanupView.tsx` 의 세 구역이 쓴다.
 *
 * ## 왜 여기만 클라이언트인가
 *
 * 정리 도구는 서버 컴포넌트다(CleanupView JSDoc — 기준 탭이 URL 이라 화면에 상태가 없었다).
 * 접힘·체크는 서버 왕복 없이 그 자리에서 일어나야 하는 상호작용이라 **그 부분만** 떼어 왔다.
 * 그래서 이 파일이 받는 것은 판정 결과 전체가 아니라 **줄에 그릴 세 칸(`CleanupItem`)뿐이다** —
 * 방치 판정이 들고 오던 `last_clicked_at` 과 `created_at`·`category_id` 는 서버에서 잘라 내고
 * 넘긴다. 비공개 자료(클릭 기록에서 나온 값)를 클라이언트 경계 밖으로 필요 이상 내보내지 않는다는
 * 원래 방침을, 화면이 상호작용을 갖게 된 뒤에도 지킬 수 있는 만큼 지키는 자리다.
 *
 * ## 구역마다 따로 산다
 *
 * 한 북마크가 ①(완전 동일 URL 중복)과 ②(같은 도메인)에 **동시에 등장할 수 있다**(lib/cleanup.ts
 * `findDomainGroups` 주석). 그래서 체크 상태를 위로 끌어올리지 않는다 — 구역마다 이 컴포넌트의
 * 인스턴스가 하나씩 서고, 각자 자기 Set 을 든다. ①에서 체크한 것이 ②에 번지지 않는 이유가 그것이다.
 *
 * ## 상태가 세 겹으로 나뉜 이유
 *
 * 선택(`useCleanupSelection`)과 확인·왕복(`BulkBar`)이 다른 자리에 산다. 선택은 줄마다 필요해
 * 목록이 들어야 하고, 확인의 포커스 처리는 **버튼이 있는 자리**에서만 할 수 있기 때문이다
 * (사라지는 버튼에서 포커스를 건져 내는 일이라 ref 가 그 컴포넌트 안에 있어야 한다).
 */

/** 줄 하나에 그릴 것 — 판정 결과에서 **이만큼만** 클라이언트로 넘어온다(위 JSDoc). */
export type CleanupItem = {
  id: string;
  title: string;
  /** 주소 표기. `hostOf` 규칙으로 서버에서 이미 뽑아 둔 값이다(카드 하단 줄과 같은 규칙). */
  host: string;
};

/** 접었다 펴는 그룹 하나 — ①은 url 로, ②는 host 로 묶인 것을 화면이 같은 모양으로 받는다. */
export type CleanupItemGroup = {
  /** 목록 안에서만 유일하면 되는 키(①은 url, ②는 host). */
  key: string;
  /** 머리 줄에 굵게 서는 이름(둘 다 host). */
  label: string;
  /** 접힌 채로도 무엇이 들었는지 보이도록 잇는 제목들. 낭독에는 싣지 않는다(아래 `aria-hidden`). */
  preview: string;
  items: readonly CleanupItem[];
};

/**
 * ① 완전 중복은 진한 활자, ② 도메인은 한 단계 옅은 활자다(CleanupView 의 원래 두 목록 그대로).
 * 색·크기를 두 곳에서 따로 정하면 구역끼리 조용히 갈라지므로 여기 한 표에 모은다.
 */
type Tone = 'strong' | 'soft';

/** 구분선 있는 행 공통 — `components/admin/CleanupView.tsx` 의 `ROW` 와 같은 값이다(프로토타입 원문). */
const ROW = 'flex items-center gap-[12px] border-b border-line px-[16px]';
/** 개수 배지 — 같은 이유로 CleanupView 와 같은 값을 한 벌 더 적는다(서버·클라이언트 경계를 넘지 않으려고). */
const COUNT = 'flex-none rounded-[4px] border border-select-hover bg-side px-[7px] py-[2px] text-[11px]';

const TONES: Record<Tone, { pad: string; label: string; preview: string; count: string }> = {
  strong: {
    pad: 'py-[11px]',
    label: 'w-[150px] flex-none truncate text-[12.5px] font-semibold text-ink',
    preview: 'min-w-0 flex-1 truncate text-[11.5px] text-desc',
    count: 'font-semibold text-ink',
  },
  soft: {
    pad: 'py-[10px]',
    label: 'w-[150px] flex-none truncate text-[12px] font-semibold text-ink',
    preview: 'min-w-0 flex-1 truncate text-[11px] text-fainter',
    count: 'text-desc',
  },
};

/**
 * 체크 상자 13px — 프로토타입 587행이 장식으로 두었던 자리의 크기 그대로다. 색은 `accent-ink`
 * 하나로만 준다(무채색 제약 — 브라우저 기본 파랑을 그대로 두면 "색은 파비콘에서만"이 깨진다).
 * `disabled:cursor-default` 는 Tailwind v4 preflight 에 커서 규칙이 없어 짝으로 적는다.
 */
const CHECKBOX = 'h-[13px] w-[13px] flex-none cursor-pointer accent-ink disabled:cursor-default';

/** 일괄 삭제 줄 — 구역 아래에 붙는 보조 툴바(도메인 구역 머리와 같은 배경). */
const BAR = 'flex flex-wrap items-center gap-x-[10px] gap-y-[6px] bg-toolbar px-[16px] py-[10px]';
/** 몇 개 골랐는지. **포커스를 받을 수 있는 것은 의도다** — 아래 `BulkBar` 의 포커스 주석 참조. */
const STATUS = 'min-w-0 flex-1 text-[11.5px] text-desc outline-none';

/** 버튼 몸통 — 삭제 확인(components/card/DeleteConfirm.tsx)의 26px 알약과 같은 치수다. */
const BUTTON =
  'flex h-[26px] cursor-pointer items-center rounded-[6px] px-[11px] text-[11.5px] disabled:cursor-default disabled:opacity-60';
/** 되돌릴 수 없는 쪽만 위험색을 쓴다 — 확인창의 `삭제` 와 같은 배경(`--color-danger`). */
const DANGER = `${BUTTON} bg-danger font-semibold text-white`;
const PLAIN = `${BUTTON} border border-border-strong bg-card`;

/** 매 렌더 새 Set 을 만들지 않기 위한 빈 선택. */
const NOTHING: ReadonlySet<string> = new Set();

/**
 * ①② — 그룹 목록. **모든 그룹이 접힌 채로 시작한다.**
 *
 * 원래 이 자리는 그룹마다 항목을 전부 펼쳐 두었는데, 도메인이 열 개를 넘으면 화면을 통째로
 * 잡아먹어 "무엇을 지울지 고르는" 일이 되지 않았다(사용자 보고). 그래서 머리 줄만 남기고 항목은
 * 편 그룹에서만 그린다 — 접힌 채로도 이름·미리보기·건수는 보이므로 어느 그룹을 열지 고를 수 있다.
 *
 * 한 번에 하나만 열리게 하지 않는다. 두 도메인을 견줘 가며 고르는 일이 흔한데 아코디언이면
 * 다른 쪽이 닫히면서 그쪽 체크가 눈앞에서 사라진다(체크는 남지만 보이지 않는 것이 더 나쁘다).
 */
export function CleanupGroupList({
  label,
  groups,
  tone,
}: {
  /** 이 구역의 이름 — 전체 선택 상자의 낭독 이름에 쓴다. */
  label: string;
  groups: readonly CleanupItemGroup[];
  tone: Tone;
}) {
  const bulk = useCleanupSelection(groups.flatMap((group) => group.items.map((item) => item.id)));
  /** 펼친 그룹의 키. 기본은 빈 집합 = 전부 접힘. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(NOTHING);
  const style = TONES[tone];

  function toggleOpen(key: string, force?: boolean): void {
    setOpened((current) => {
      const next = new Set(current);
      if (force ?? !next.has(key)) next.add(key);
      else next.delete(key);

      return next;
    });
  }

  if (groups.length === 0) return null;

  return (
    <>
      <ul>
        {groups.map((group) => {
          const ids = group.items.map((item) => item.id);
          const picked = ids.filter((id) => bulk.has(id)).length;
          const expanded = opened.has(group.key);

          return (
            <li key={group.key}>
              <div className={`${ROW} ${style.pad}`}>
                <PickBox
                  label={`${group.label} 전체 선택`}
                  checked={picked === ids.length}
                  indeterminate={picked > 0 && picked < ids.length}
                  disabled={bulk.locked}
                  onChange={(on) => {
                    bulk.setMany(ids, on);
                    /* 고른 것이 보이지 않는 채로 남지 않게 함께 편다. 접힌 그룹을 통째로 고르고
                       바로 지우면 무엇을 지웠는지 화면에서 확인할 기회가 없다. */
                    if (on) toggleOpen(group.key, true);
                  }}
                />
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleOpen(group.key)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-[12px] text-left"
                >
                  <span className={style.label}>{group.label}</span>
                  {/* 미리보기는 **눈으로만** 본다 — 펼치면 같은 제목들이 줄마다 제대로 낭독되므로
                      머리 줄 이름에까지 실으면 같은 것을 두 번 읽게 된다. */}
                  <span aria-hidden="true" className={style.preview}>
                    {group.preview}
                  </span>
                  <span className={`${COUNT} ${style.count}`}>{group.items.length}개</span>
                  <span aria-hidden="true" className="flex-none text-[9px] text-fainter">
                    {expanded ? '▾' : '▸'}
                  </span>
                </button>
              </div>

              {expanded && (
                <ul>
                  {group.items.map((item) => (
                    <LinkRow key={item.id} item={item} bulk={bulk} indented />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <BulkBar label={label} bulk={bulk} />
    </>
  );
}

/**
 * ③ — 평면 목록(오래 손대지 않은 링크). 그룹이 없으므로 접을 것도 없고, 대신 **구역 전체 선택**을
 * 둔다: 여기 있는 줄은 전부 화면에 보이므로 한 번에 골라도 무엇을 고르는지 보인다.
 *
 * ①②에는 구역 전체 선택을 두지 않는다 — 접힌 그룹까지 통째로 고르게 되고, 특히 ①에서는
 * "남길 하나"까지 함께 골라 같은 주소를 한 건도 남기지 않는 길이 열린다.
 */
export function CleanupLinkList({ label, items }: { label: string; items: readonly CleanupItem[] }) {
  const bulk = useCleanupSelection(items.map((item) => item.id));

  if (items.length === 0) return null;

  return (
    <>
      <ul>
        {items.map((item) => (
          <LinkRow key={item.id} item={item} bulk={bulk} />
        ))}
      </ul>

      <BulkBar label={label} bulk={bulk} selectAll={items.map((item) => item.id)} />
    </>
  );
}

// ───────────────────────────────────────────────────────── 내부

type CleanupSelection = ReturnType<typeof useCleanupSelection>;

/** 링크 한 줄 — 그룹을 편 자리(들여쓴다)와 방치 목록(들여쓰지 않는다)이 함께 쓴다. */
function LinkRow({
  item,
  bulk,
  indented = false,
}: {
  item: CleanupItem;
  bulk: CleanupSelection;
  indented?: boolean;
}) {
  return (
    <li className={`${ROW} py-[10px] ${indented ? 'bg-toolbar pl-[40px]' : ''}`}>
      <PickBox
        label={`${item.title} 선택`}
        checked={bulk.has(item.id)}
        disabled={bulk.locked}
        onChange={() => bulk.toggle(item.id)}
      />
      <span className="w-[170px] flex-none truncate text-[12.5px] font-medium text-ink">
        {item.title}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-fainter">{item.host}</span>
    </li>
  );
}

/**
 * 체크 상자 하나. **중간 상태(`indeterminate`)는 속성이 아니라 DOM 프로퍼티**라 JSX 로 줄 수 없어
 * ref 로 얹는다 — 그룹의 일부만 골랐을 때 이것이 없으면 "안 고름"과 구분되지 않는다.
 */
function PickBox({
  label,
  checked,
  indeterminate = false,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={box}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className={CHECKBOX}
    />
  );
}

/**
 * 한 구역의 **선택**. 구역마다 하나씩 살아 서로를 모른다(파일 상단 "구역마다 따로 산다").
 *
 * ## 고른 것은 지금 화면에 있는 것뿐이다
 *
 * 체크 집합은 id 를 들고 있을 뿐이라, 다른 창이 링크를 지우면 이미 없는 id 가 집합에 남는다.
 * 그래서 세는 것도 보내는 것도 언제나 **`visibleIds` 로 거른 결과**다 — 화면에 없는 것이 개수에
 * 끼거나 삭제 요청에 실리지 않는다(LinkTable 의 "그리는 목록과 보내는 목록" 과 같은 위생).
 *
 * `confirming` 이 여기 있는 것은 **줄의 체크박스를 잠그기 위해서**다. 확인하는 동안 선택이 바뀌면
 * 화면이 물은 개수("선택한 3개를 삭제할까요")와 실제로 지우는 개수가 갈린다.
 */
function useCleanupSelection(visibleIds: readonly string[]) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(NOTHING);
  const [confirming, setConfirming] = useState(false);

  const selected = visibleIds.filter((id) => checked.has(id));

  function has(id: string): boolean {
    return checked.has(id);
  }

  function toggle(id: string): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  }

  function setMany(ids: readonly string[], on: boolean): void {
    setChecked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }

      return next;
    });
  }

  return {
    selected,
    has,
    toggle,
    setMany,
    confirming,
    /** 확인하는 동안에는 선택을 잠근다(위 JSDoc). */
    locked: confirming,
    ask: () => setConfirming(true),
    /** 취소 — 고른 것은 그대로 두고 확인만 닫는다. */
    close: () => setConfirming(false),
    /** 삭제 성공 — 확인을 닫으면서 선택도 비운다. 부르는 쪽이 트랜지션으로 묶는다. */
    done: () => {
      setConfirming(false);
      setChecked(NOTHING);
    },
  };
}

/**
 * 구역 아래에 붙는 일괄 삭제 줄. **누르는 즉시 지우지 않는다**(DESIGN_SPEC 7장) — 버튼은 확인을
 * 띄우기만 하고, 실제 삭제는 확인의 `삭제` 를 눌렀을 때 한 번 일어난다.
 *
 * 확인은 모달이 아니라 **제자리 교체**다(모달 금지 — DESIGN_SPEC). 버튼이 있던 자리에 문구와 두
 * 버튼이 대신 선다.
 *
 * ## 이중 제출은 ref 빗장이 막는다
 *
 * `deleting` 상태만으로는 **같은 틱의 두 번째 클릭**을 못 막는다 — 둘 다 같은 렌더의 클로저를 보고
 * `disabled` 도 아직 걸리지 않았다. ref 는 그 자리에서 바뀌므로 두 번째 호출이 곧바로 막힌다
 * (DeleteConfirm·InlineEdit 과 같은 장치).
 *
 * ## 포커스 — 세 번 옮긴다
 *
 * 확인이 뜨면 `취소` 가 받는다: 되돌릴 수 없는 동작을 묻는 자리의 기본 포커스는 덜 위험한 쪽이고
 * (WAI-ARIA APG alertdialog), 무엇보다 방금 누른 버튼이 사라졌으므로 그냥 두면 포커스가 문서
 * 뿌리로 떨어진다. 보내는 동안에는 두 버튼이 잠기면서 브라우저가 또 한 번 포커스를 떼는데, 그때는
 * 안내 줄(`statusRef`)이 받아 둔다. 닫힐 때 되돌리는 것은 **취소뿐이다** — 성공하면 포커스는
 * 이미 안내 줄에 있고(위 두 번째 이동) 그 줄은 확인이 닫혀도 그대로 있으므로 옮길 일이 없다
 * (선택이 0이 된 삭제 버튼은 잠겨 있어 돌려줘도 받지 못한다).
 *
 * 세 ref 가 이 컴포넌트 안에 사는 이유가 그것이다. 선택 상태처럼 위로 끌어올리면 ref 를 렌더에
 * 실어 나르게 되는데, 포커스를 건져 낼 노드는 **버튼이 있는 여기**에서만 알 수 있다.
 */
function BulkBar({
  label,
  bulk,
  selectAll,
}: {
  label: string;
  bulk: CleanupSelection;
  /** 주면 '전체 선택' 상자를 함께 둔다(평면 목록 전용 — `CleanupLinkList` 주석). */
  selectAll?: readonly string[];
}) {
  /** 서버 왕복 중 — 두 버튼을 잠그는 **보이는** 상태다. 빗장은 아래 ref 가 따로 진다. */
  const [deleting, setDeleting] = useState(false);
  const sending = useRef(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  /**
   * 확인이 닫힐 때 **누른 버튼으로 돌려줄지**. 취소에서만 선다.
   *
   * 성공 경로에는 짝이 없는 것이 맞다 — 보내는 동안 이미 안내 줄이 포커스를 받아 두었고
   * (아래 effect), 안내 줄은 확인이 닫혀도 그대로 있으므로 포커스는 저절로 거기 남는다.
   * 여기서 한 번 더 옮기면 같은 일을 두 벌로 적어 두는 셈이라, 한쪽을 지워도 아무도 모른다.
   */
  const restoreTrigger = useRef(false);

  const count = bulk.selected.length;
  const chosen = selectAll?.filter((id) => bulk.has(id)).length ?? 0;
  const confirming = bulk.confirming;

  useEffect(() => {
    if (confirming) {
      // 잠기는 버튼에서 포커스가 새지 않도록, 보내는 동안에는 안내 줄이 받아 둔다.
      focusBack(deleting ? statusRef.current : cancelRef.current);

      return;
    }

    // 처음 렌더에서는 서지 않는다 — 아무도 열지 않았으므로 포커스를 건드리지 않는다.
    if (!restoreTrigger.current) return;
    restoreTrigger.current = false;
    focusBack(triggerRef.current);
  }, [confirming, deleting]);

  function cancel(): void {
    restoreTrigger.current = true;
    bulk.close();
  }

  async function confirm(): Promise<void> {
    if (sending.current) return;

    // 확인하는 동안 선택은 잠겨 있으므로, 이 목록은 확인 문구가 말한 개수와 정확히 같다.
    const ids = [...bulk.selected];
    if (ids.length === 0) return;

    sending.current = true;
    setDeleting(true);

    let result: ActionResult;
    try {
      result = await deleteBookmarks(ids);
    } catch (error) {
      // 액션이 **거부로 끝난** 경우다 — 네트워크 단절이나 배포로 액션 id 가 바뀐 상황. 잡지 않으면
      // 빗장도 잠긴 모습도 선 채로 남아 확인 줄에서 나갈 길이 없어진다(확립된 규약: 500 을 내지
      // 않고 REQUEST_FAILED 로 접는다).
      console.error('[CleanupSelection] 링크 일괄 삭제 요청이 거부됐다', error);
      sending.current = false;
      setDeleting(false);
      toast(REQUEST_FAILED);

      return;
    }

    sending.current = false;

    if (!result.ok) {
      // 확인 줄은 남긴다 — 사유를 보고 다시 누르거나 취소로 나간다. 고른 것도 그대로 둔다.
      setDeleting(false);
      // 무엇이 잘못됐는지 말하는 것은 한곳(lib/mutations.ts)의 일이다 — 화면은 그대로 옮긴다.
      toast(result.error);

      return;
    }

    /* 확인이 닫히는 것과 목록이 줄어드는 것을 **한 커밋으로 묶는다.** `await` 뒤의 상태 갱신은
       저절로 트랜지션에 들어가지 않아, 그냥 부르면 액션의 revalidate 가 도착하기 전 한 프레임
       동안 이미 지운 줄이 체크만 풀린 채 남는다. */
    startTransition(() => {
      setDeleting(false);
      bulk.done();
    });
    toast(`${ids.length}개를 삭제했습니다`);
  }

  return (
    <div className={BAR}>
      {selectAll !== undefined && (
        <PickBox
          label={`${label} 전체 선택`}
          checked={selectAll.length > 0 && chosen === selectAll.length}
          indeterminate={chosen > 0 && chosen < selectAll.length}
          disabled={bulk.locked}
          onChange={(on) => bulk.setMany(selectAll, on)}
        />
      )}

      {/* 포커스를 받을 수 있는 한 줄 — 잠기는 버튼에서 포커스가 떨어질 때 여기가 받는다. */}
      <p ref={statusRef} tabIndex={-1} className={STATUS}>
        {count === 0 ? '선택한 링크가 없습니다' : `${count}개 선택됨`}
      </p>

      {confirming ? (
        <span className="flex items-center gap-[6px]">
          <span className="text-[11.5px] font-semibold text-ink">선택한 {count}개를 삭제할까요</span>
          {/* `aria-busy` 는 '눌렀고 지금 처리 중'을 보조 기술에도 알린다(확인창과 같은 짝). */}
          <button
            type="button"
            disabled={deleting}
            aria-busy={deleting}
            onClick={() => void confirm()}
            className={DANGER}
          >
            삭제
          </button>
          <button ref={cancelRef} type="button" disabled={deleting} onClick={cancel} className={PLAIN}>
            취소
          </button>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          disabled={count === 0}
          onClick={bulk.ask}
          className={PLAIN}
        >
          선택한 {count}개 삭제
        </button>
      )}
    </div>
  );
}

/**
 * 포커스를 돌려준다 — **문서에 붙어 있을 때만.** 떨어져 나간 노드에 `focus()` 를 불러 봐야
 * 포커스는 문서 뿌리로 가므로, 그럴 바에는 있던 자리에 두는 편이 낫다(확립된 포커스 규약).
 */
function focusBack(node: HTMLElement | null): void {
  if (node !== null && node.isConnected) node.focus({ preventScroll: true });
}
