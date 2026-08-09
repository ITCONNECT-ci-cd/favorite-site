'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ADMIN_CLEANUP_PATH, ADMIN_PATH, ADMIN_STATS_PATH } from '@/lib/routes';

/**
 * 셸이 받는 것은 이 둘뿐이다 — **세션은 여기 없고, 앞으로도 더하지 마라.** 미인증 판정은
 * `app/admin/layout.tsx` 와 각 page 의 첫 줄이 나눠 진다(아래 AdminShell JSDoc "화면과의 계약").
 * 세션이 흘러들 통로를 타입에 여는 순간 판정 지점이 셋이 되고, 셋은 서로 어긋난다.
 */
export type AdminShellProps = {
  /**
   * 로그아웃 서버 액션(`app/admin/actions.ts` 의 signOutAction). form 에 그대로 걸린다.
   *
   * 컴포넌트가 직접 import 하지 않고 prop 으로 받는 이유는 LoginForm 과 같다 — 클라이언트
   * 컴포넌트가 서버 모듈을 끌어오면 경계가 흐려지고 테스트에서 갈아 끼울 수도 없다.
   */
  signOutAction: () => Promise<void>;
  children: ReactNode;
};

/**
 * 탭 3개 — DESIGN_SPEC 6장 "탭: `카테고리 · 링크` / `통계` / `정리 도구`". 순서도 스펙이다.
 * 이름의 가운뎃점 좌우 공백은 프로토타입 원문(`카테고리 · 링크`) 그대로다.
 *
 * 주소는 `lib/routes.ts` 에서 가져온다 — 로그인·로그아웃이 돌아갈 자리와 같은 문자열이라
 * 여기에 다시 적으면 갈라진다.
 */
const TABS: ReadonlyArray<{ href: string; name: string }> = [
  { href: ADMIN_PATH, name: '카테고리 · 링크' },
  { href: ADMIN_STATS_PATH, name: '통계' },
  { href: ADMIN_CLEANUP_PATH, name: '정리 도구' },
];

/**
 * 탭 하나 — 프로토타입 원문 `height:32px; padding:0 13px; border-radius:7px;
 * font:600 12.5px; white-space:nowrap; border:1px solid #ddd8d1`.
 *
 * 테두리는 선택 여부와 무관하게 `#ddd8d1` 고정이다(프로토타입 `adminTabs` 는 `bg`·`fg` 만
 * 넘기고 `bd` 는 넘기지 않는다 — 하위 탭 칩이 선택 시 테두리까지 검게 바꾸는 것과 다르다).
 */
const TAB =
  'flex h-[32px] items-center rounded-[7px] border border-border-strong px-[13px] text-[12.5px] font-semibold whitespace-nowrap';
const TAB_ON = 'bg-ink text-white';
/** 비선택 탭의 글자색은 스펙 색상표에 없는 프로토타입 고유값이라 임의 값으로 옮긴다(칩 줄과 같은 처리). */
const TAB_OFF = 'bg-card text-[#3a3833]';

/**
 * 어느 탭을 켤지 — `/admin` 만 정확히 일치, 나머지는 하위 경로까지 포함한다.
 *
 * `/admin` 을 접두어 일치로 다루면 `/admin/stats` 에서 탭 두 개가 동시에 켜진다. 반대로
 * 나머지를 정확히 일치로만 다루면 나중에 `/admin/stats/2026` 같은 하위 경로가 생겼을 때
 * 그 화면에서 탭이 전부 꺼진 채로 보인다. 두 경우 모두 테스트로 잠가 뒀다.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === ADMIN_PATH) return pathname === href;

  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 관리자 셸 — DESIGN_SPEC 6장 "상단 탭 (60px)".
 *
 * 상단 60px 줄(워드마크 + 탭 3개 + 사이트 보기 + 로그아웃)과 그 아래 스크롤 영역이 전부다.
 * 공개 셸(사이드바·헤더)은 여기 없다 — 관리 라우트가 `(public)` 라우트 그룹 밖이라
 * 상속되지 않는다.
 *
 * ## 왜 클라이언트 컴포넌트인가
 *
 * 활성 탭은 현재 주소가 정하는데, 서버 컴포넌트에는 그 주소가 오지 않는다(레이아웃은
 * pathname 을 받지 못한다). 그래서 `usePathname()` 을 쓰는 클라이언트 경계가 필요하다 —
 * 사이드바·칩 줄이 같은 이유로 클라이언트인 것과 같다. children 은 prop 으로 흘러들어오므로
 * **관리 화면들은 서버 컴포넌트 그대로 남는다.**
 *
 * ## 화면(page)과의 계약
 *
 * - 본문 패딩(18px 28px 32px)과 스크롤은 **셸이 갖는다.** 화면에서 다시 주면 이중으로 먹는다.
 * - 랜드마크 `<main>` 은 **화면이 갖는다**(공개 화면의 HomeView·ListView 와 같은 분담).
 *   셸이 만들면 화면의 `<main>` 과 겹쳐 랜드마크가 둘이 된다.
 * - 셸은 세션을 보지 않는다. 미인증 판정은 `app/admin/layout.tsx`(셸을 아예 렌더하지 않음)와
 *   각 page 의 첫 줄(RSC 페이로드 누출 방지)이 나눠 진다 — 여기서 또 보면 판정 지점이 셋이 된다.
 *
 * ## 좁은 화면 (알려진 한계)
 *
 * 상단 바에는 **반응형 규칙이 없다.** 프로토타입도 이 줄만 `padding:0 28px` 를 박아 두고
 * (공개 헤더는 `headPad` 로 좁히는데도) 좁은 화면 규칙을 두지 않았고, DESIGN_SPEC 1장
 * 브레이크포인트 표가 관리자에 대해 말하는 것은 "2단 → 1단"(I 시리즈 몫) 하나뿐이다.
 * 그래서 대략 520px 아래에서는 바의 내용이 가로로 넘친다 — 이때 페이지가 가로로 스크롤되어
 * 우측 '로그아웃'에는 여전히 닿을 수 있다(그래서 뿌리에 `overflow-hidden` 을 걸지 않았다.
 * 걸면 버튼이 잘려 아예 못 누른다). 좁은 화면을 정식으로 다루기로 하면 그때 스펙과 함께 정한다.
 */
export function AdminShell({ signOutAction, children }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* 상단 60px — 흰 배경, 하단 1px 테두리, 좌우 28px, gap 12px (프로토타입 원문).
          공개 셸의 헤더와 같은 자리·같은 치수지만 다른 줄이다: 이쪽에는 검색창이 없다. */}
      <header className="flex h-[60px] flex-none items-center gap-[12px] border-b border-border bg-card px-[28px]">
        {/* 워드마크. 제목 계층(h1 이하)은 화면이 소유하므로 여기서는 heading 을 만들지 않는다 —
            셸이 h1 을 들면 화면마다 제목이 둘이 된다. */}
        <span className="flex-none text-[15px] font-bold tracking-[-0.02em] text-ink">관리자</span>

        {/* 나란한 항목 묶음이라 목록으로 낸다 — 사이드바·칩 줄과 같은 관례다. 스크린 리더가
            "목록, 항목 3개" 를 먼저 알려 주므로 탭이 몇 개인지 훑기 전에 알 수 있다.
            가로 배치(flex)와 6px 간격은 ul 이 갖는다: nav 는 헤더 flex 의 한 칸으로 남고
            ul 이 그 칸을 꽉 채우므로 상자 크기는 그대로다(preflight 가 ul 의 기본
            margin·padding·list-style 을 이미 지운다). */}
        <nav aria-label="관리 메뉴" className="ml-[8px]">
          <ul className="flex gap-[6px]">
            {TABS.map((tab) => {
              const active = isActive(pathname, tab.href);

              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    /* 색만으로는 선택을 알릴 수 없다 — 스크린 리더는 배경색을 읽지 않는다. */
                    aria-current={active ? 'page' : undefined}
                    className={`${TAB} ${active ? TAB_ON : TAB_OFF}`}
                  >
                    {tab.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 여기서부터 우측 — `ml-auto` 가 프로토타입의 `margin-left:auto` 다.
            공개 홈으로 돌아가는 길이라 새 탭을 열지 않는다(프로토타입 viewSite 도 같은 창). */}
        <Link
          href="/"
          className="ml-auto flex-none text-[12px] font-semibold text-ink underline underline-offset-[3px]"
        >
          사이트 보기
        </Link>

        {/* 로그아웃 — H2 의 임시 화면에서 자리만 옮겨 왔다(액션은 그대로).
            서버 액션을 form 에 직접 건다: 로그아웃은 상태가 없어 useActionState 가 필요 없다.
            GET 링크가 아니라 POST 여야 한다 — 브라우저·프록시가 미리 훑는 링크로 로그아웃이
            일어나면 안 된다. */}
        <form action={signOutAction} className="flex-none">
          <button type="submit" className="text-[12px] text-desc hover:text-ink">
            로그아웃
          </button>
        </form>
      </header>

      {/* 셸에서 유일하게 스크롤되는 영역. 패딩은 프로토타입 원문 `18px 28px 32px` 로,
          공개 화면의 본문 패딩(20px 28px 36px)과 다르다 — 관리 화면은 상단 탭 줄이
          이미 한 겹 있어 위아래가 조금 좁다. */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-[28px] pt-[18px] pb-[32px]">
        {children}
      </div>
    </div>
  );
}
