'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Category } from '@/lib/types';

export type MobileChipsProps = {
  /**
   * 사이드바와 같은 배열(상위+하위, sort_order 순). 칩은 **상위만** 쓴다 —
   * 프로토타입 `navChips` 도 `catNames`(그룹 이름)만 훑는다.
   */
  categories: Category[];
};

/**
 * 칩 줄 — 프로토타입 원문 `padding:10px 14px; gap:6px; background:#f7f5f2;
 * border-bottom:1px solid #e3dfd9; overflow-x:auto`.
 *
 * `min-[820px]:hidden` 이 프로토타입의 `showChips: narrow` 다. 데스크톱에서는 사이드바가
 * 같은 일을 하므로 두 줄이 겹쳐 보이지 않는다.
 */
const ROW =
  'flex flex-none overflow-x-auto border-b border-border bg-page px-[14px] py-[10px] min-[820px]:hidden';

/**
 * 칩 하나 — 프로토타입 원문 `height:30px; padding:0 12px; border-radius:8px;
 * font:600 12.5px; white-space:nowrap; border:1px solid #ddd8d1`.
 *
 * 테두리는 선택 여부와 무관하게 `#ddd8d1` 고정이다(ListView 의 하위 탭 칩은 선택 시 테두리까지
 * 검게 바꾸지만, 그건 프로토타입 `aiTabs` 가 `bd` 를 따로 넘기기 때문이다 — 이 줄은 넘기지 않는다).
 */
const CHIP =
  'flex h-[30px] items-center rounded-[8px] border border-border-strong px-[12px] text-[12.5px] font-semibold whitespace-nowrap';
const CHIP_ON = 'bg-ink text-white';
/** 비선택 칩의 글자색은 스펙 표에 없는 프로토타입 고유값이라 임의 값으로 옮긴다(ListView 와 같은 처리). */
const CHIP_OFF = 'bg-card text-[#3a3833]';

/**
 * 좁은 화면(<820px)의 내비게이션 — DESIGN_SPEC 1장 브레이크포인트 표
 * "상단 칩 줄(홈 · 내 즐겨찾기 · 매일 사용 + 카테고리 10개)".
 *
 * 사이드바가 숨는 자리를 대신하지만 **트리가 아니라 한 줄**이다. 그래서 하위 분류는 칩이 되지
 * 않고(상위 칩으로 들어가면 그 화면의 하위 탭이 있다), 개수도 적지 않는다.
 *
 * '현재 운영 중인 사이트'를 앞으로 끌어올리지 않는 것이 사이드바와 다른 점이다. 사이드바는
 * 그 분류를 빠른 접근으로 올리고 분류 목록에서 빼지만(C3), 프로토타입 `navChips` 는
 * `catNames` 를 거르지 않아 제자리(맨 뒤)에 남는다. 스펙 문면의 "카테고리 10개"도 이쪽이다 —
 * 상위 10개가 빠짐없이 칩이 된다.
 */
export function MobileChips({ categories }: MobileChipsProps) {
  const pathname = usePathname();

  const items = [
    { href: '/', name: '홈' },
    { href: '/favorites', name: '내 즐겨찾기' },
    // 프로토타입은 이 칩만 '매일 사용'으로 줄여 적는다(사이드바는 '매일 사용하는 사이트').
    { href: '/daily', name: '매일 사용' },
    ...categories
      .filter((category) => category.parent_id === null)
      .map((category) => ({ href: `/category/${category.id}`, name: category.name })),
  ];

  return (
    <nav aria-label="바로 가기" className={ROW}>
      <ul className="flex gap-[6px]">
        {items.map((item) => {
          const active = pathname === item.href;

          return (
            <li key={item.href} className="flex-none">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}
              >
                {item.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
