'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState } from 'react';
import type { Category } from '@/lib/types';

export type SidebarProps = {
  /**
   * 상위+하위 전체, sort_order 순. 하위는 parent_id 로 판별한다.
   * 2단 트리만 렌더한다 — 손자·고아(parent 가 목록에 없는 하위)·운영 중 카테고리의
   * 하위는 렌더되지 않는다.
   */
  categories: Category[];
  /** 카테고리 id → 링크 수. 상위는 하위 합산 롤업이며 계산은 D1 책임 — 여기선 표시만 한다. */
  counts: Readonly<Record<string, number>>;
  totalCount: number;
  dailyCount: number;
  /** E1 useFavorites 파생 — C1의 클라이언트 래퍼가 공급, SSR 초기값 0. */
  favCount: number;
  /** '현재 운영 중인 사이트' 카테고리 id. 빠른 접근으로 올리고 분류 목록에서는 뺀다. */
  operatingCategoryId: string | null;
};

/** 캡션 — DESIGN_SPEC 1장 "사이드바 캡션"(10.5px/700, 0.08em, mist) + 2장 여백. */
const CAPTION =
  'px-[12px] pt-[16px] pb-[6px] text-[10.5px] font-bold tracking-[0.08em] text-mist';

/** 행 — 높이 34px, 라운드 6px, 호버 배경 (DESIGN_SPEC 2장). 선택 배경은 호출부에서 더한다. */
const ROW =
  'flex h-[34px] items-center gap-[9px] rounded-[6px] pr-[11px] hover:bg-select-hover';

/** 글자 — 빠른 접근 14px/600, 상위 분류 13px/500, 하위 12.5px/400. */
const FONT_QUICK = 'text-[14px] font-semibold';
const FONT_TOP = 'text-[13px] font-medium';
const FONT_SUB = 'text-[12.5px] font-normal';

/** 좌측 들여쓰기 — 상위 11px, 하위 30px. */
const INDENT_TOP = 'pl-[11px]';
const INDENT_SUB = 'pl-[30px]';

/** 펼침 기호 자리 — 하위가 없는 행도 같은 폭을 비워 라벨 말줄임 기준을 맞춘다. */
const ARROW_SLOT = 'w-[10px] flex-none';

type RowProps = {
  href: string;
  name: string;
  count: number;
  active: boolean;
  indent: string;
  font: string;
  /** 하위를 가진 상위 분류에만 준다. */
  toggle?: { open: boolean; onToggle: () => void };
};

function Row({ href, name, count, active, indent, font, toggle }: RowProps) {
  return (
    <div className={`relative ${ROW} ${active ? 'bg-select' : ''}`}>
      {/* 링크가 ::after 로 행 전체를 덮어 개수·여백까지 클릭 영역이 된다. 토글 버튼만
          그 위(z-10)로 올려 두므로 버튼 클릭은 이동으로 새지 않는다. */}
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex h-full min-w-0 flex-1 items-center gap-[9px] after:absolute after:inset-0 ${indent}`}
      >
        {/* 좌측 3px 세로 마커 — 선택된 행에서만 보인다. */}
        <span
          aria-hidden="true"
          className={`h-[14px] w-[3px] flex-none rounded-[2px] ${
            active ? 'bg-ink' : 'bg-transparent'
          }`}
        />
        <span className={`min-w-0 flex-1 truncate ${font} ${active ? 'text-ink' : 'text-sub'}`}>
          {name}
        </span>
      </Link>

      {/* 펼침 기호는 아이콘 라이브러리 없이 텍스트 문자 그대로 쓴다 (+ / – U+2013).
          하위가 없는 행도 같은 10px 자리를 비워 둬야 라벨 말줄임 폭이 행마다 같아진다. */}
      {toggle ? (
        <button
          type="button"
          onClick={toggle.onToggle}
          aria-expanded={toggle.open}
          aria-label={`${name} 하위 분류 ${toggle.open ? '접기' : '펼치기'}`}
          className={`${ARROW_SLOT} relative z-10 h-full text-center text-[10px] text-ghost before:absolute before:inset-y-0 before:-inset-x-[7px]`}
        >
          {toggle.open ? '–' : '+'}
        </button>
      ) : (
        <span aria-hidden="true" className={ARROW_SLOT} />
      )}

      <span
        data-testid="count"
        className={`min-w-[22px] flex-none text-right text-[11px] ${
          active ? 'text-[#5a5651]' : 'text-mist'
        }`}
      >
        {count}
      </span>
    </div>
  );
}

/**
 * 사이드바 트리 — DESIGN_SPEC 2장.
 *
 * 폭 240px·배경(`bg-side`)·우측 테두리는 셸(app/layout.tsx)이 이미 칠했으므로 여기서는
 * 행·마커·글자 색만 그린다. 개수는 전부 props 로 받는다(롤업 계산은 D1 몫).
 */
export function Sidebar({
  categories,
  counts,
  totalCount,
  dailyCount,
  favCount,
  operatingCategoryId,
}: SidebarProps) {
  const pathname = usePathname();
  const quickCaptionId = useId();
  const catCaptionId = useId();
  /** 사용자가 직접 누른 상위만 담는다. 누르지 않은 상위는 아래 기본값을 따른다. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const categoryHref = (id: string) => `/category/${id}`;
  const isActive = (href: string) => pathname === href;
  const countOf = (id: string) => counts[id] ?? 0;
  const subsOf = (id: string) => categories.filter((c) => c.parent_id === id);

  /** 분류 목록 — 운영 중 카테고리는 빠른 접근으로 올렸으므로 여기서 뺀다(프로토타입과 동일). */
  const tops = categories.filter(
    (c) => c.parent_id === null && c.id !== operatingCategoryId,
  );

  const activeSub = categories.find(
    (c) => c.parent_id !== null && isActive(categoryHref(c.id)),
  );

  /**
   * 현재 위치 표시는 내비게이션 불변식이다 — 사용자가 접어 둔 상위라도 그 안의 하위로
   * 이동하면 활성 행이 가려지므로 그 가지의 접기만 버린다. 다른 가지의 접기 취향은
   * 건드리지 않는다. 경로가 바뀐 렌더에서 곧바로 조정한다(렌더 중 상태 조정 패턴).
   */
  const activeBranch = activeSub?.parent_id ?? null;
  const [seenBranch, setSeenBranch] = useState(activeBranch);
  if (seenBranch !== activeBranch) {
    setSeenBranch(activeBranch);
    if (activeBranch !== null) {
      setToggled((prev) => {
        const next = { ...prev };
        delete next[activeBranch];
        return next;
      });
    }
  }

  /**
   * 기본 펼침 — 프로토타입은 상위를 누르면 이동과 펼침을 함께 했다. URL이 상태를 쥐는
   * 구조에서는 "그 가지가 현재 경로에 걸려 있으면 펼친다"로 옮긴다. 상위 자신이 활성이거나
   * 선택된 하위를 품고 있으면 펼치고, 사용자가 직접 접은 상위는 그 선택을 우선한다.
   */
  const autoOpen = (id: string) =>
    activeSub?.parent_id === id || isActive(categoryHref(id));
  const isOpen = (id: string) => toggled[id] ?? autoOpen(id);
  // 이전 값은 반드시 업데이터의 prev 에서 읽는다 — 렌더 스코프의 toggled 를 읽으면 낡은 값이 잡힌다.
  const toggle = (id: string) =>
    setToggled((prev) => ({ ...prev, [id]: !(prev[id] ?? autoOpen(id)) }));

  const quick = [
    { href: '/', name: '홈', count: totalCount },
    { href: '/favorites', name: '내 즐겨찾기', count: favCount },
    { href: '/daily', name: '매일 사용하는 사이트', count: dailyCount },
    ...(operatingCategoryId
      ? [
          {
            href: categoryHref(operatingCategoryId),
            name: '현재 운영 중인 사이트',
            count: countOf(operatingCategoryId),
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 상단 60px — 제목 + 전체 개수. 블록 전체가 홈으로 가는 링크다. */}
      <Link
        href="/"
        className="flex h-[60px] flex-none items-center border-b border-border px-[20px]"
      >
        <span className="text-[15px] font-bold tracking-[-0.02em]">내 링크</span>
        <span className="ml-auto text-[11px] text-faint">{totalCount}</span>
      </Link>

      <nav
        aria-label="사이드바"
        className="min-h-0 flex-1 overflow-y-auto px-[10px] pt-[12px] pb-[20px]"
      >
        <h2 id={quickCaptionId} className={CAPTION}>
          빠른 접근
        </h2>
        <ul aria-labelledby={quickCaptionId}>
          {quick.map((item) => (
            <li key={item.href}>
              <Row
                href={item.href}
                name={item.name}
                count={item.count}
                active={isActive(item.href)}
                indent={INDENT_TOP}
                font={FONT_QUICK}
              />
            </li>
          ))}
        </ul>

        <h2 id={catCaptionId} className={CAPTION}>
          분류
        </h2>
        <ul aria-labelledby={catCaptionId}>
          {tops.map((top) => {
            const subs = subsOf(top.id);
            const open = isOpen(top.id);

            return (
              <li key={top.id}>
                <Row
                  href={categoryHref(top.id)}
                  name={top.name}
                  count={countOf(top.id)}
                  active={isActive(categoryHref(top.id))}
                  indent={INDENT_TOP}
                  font={FONT_TOP}
                  toggle={
                    subs.length > 0 ? { open, onToggle: () => toggle(top.id) } : undefined
                  }
                />
                {subs.length > 0 && open ? (
                  <ul>
                    {subs.map((sub) => (
                      <li key={sub.id}>
                        <Row
                          href={categoryHref(sub.id)}
                          name={sub.name}
                          count={countOf(sub.id)}
                          active={isActive(categoryHref(sub.id))}
                          indent={INDENT_SUB}
                          font={FONT_SUB}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
