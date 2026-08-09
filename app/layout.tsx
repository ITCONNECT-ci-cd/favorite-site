import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { MobileChips } from "@/components/MobileChips";
import { SidebarContainer } from "@/components/SidebarContainer";
import { Toaster } from "@/components/Toast";
import {
  faviconCount,
  findOperatingCategoryId,
  getAllData,
  rollupCounts,
} from "@/lib/queries";
import "./globals.css";

/** Pretendard 웹폰트 (DESIGN_SPEC 1장 타이포그래피). */
const PRETENDARD_CSS_URL =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css";

export const metadata: Metadata = {
  title: "내 링크",
  description: "사내 구성원이 자주 쓰는 링크를 한곳에서 찾는 대시보드",
};

/**
 * 공통 셸 — DESIGN_SPEC 2장.
 *
 * 뷰포트 높이를 꽉 채운 좌우 분할이다. 사이드바(240px)와 헤더(60px)는 자리에 고정되고
 * 콘텐츠 영역만 세로로 스크롤한다. 프로토타입 상단의 회색 주소창(38px)은 프로토타입 전용이라
 * 제품에는 만들지 않는다.
 *
 * <820px(DESIGN_SPEC 1장 브레이크포인트)에서는 사이드바가 숨고 헤더 아래에 칩 줄이 들어오며
 * 헤더·본문 패딩이 줄어든다. 세 규칙 모두 이 파일 안의 클래스 한 줄씩이다(D5).
 *
 * 사이드바·헤더가 쓰는 숫자는 여기서 읽는다. layout 은 받은 데이터를 children 에 넘길 수 없어
 * 본문(page)도 같은 요청에서 getAllData 를 다시 부르지만, 그 함수가 React `cache()` 로
 * 감싸여 있어 요청 단위로 중복 제거된다 (근거: lib/queries.ts 의 getAllData JSDoc
 * "cache() 로 감싼 이유 — 요청 단위 중복 제거"). 덕분에 셸과 화면이 같은 스냅샷을 보므로
 * 사이드바 숫자와 본문이 어긋나지 않는다.
 * 개수 계산은 D1의 순수 함수(rollupCounts·faviconCount·findOperatingCategoryId)에 맡긴다.
 *
 * `export const revalidate` 를 넣지 마라 — 이 셸은 매 요청 렌더되는 것이 의도다.
 * 근거는 같은 JSDoc 에 있다.
 *
 * 여기서 던진 오류를 받는 곳은 app/global-error.tsx 하나뿐이다 — 루트 레이아웃이 죽으면
 * 그 아래 error.tsx 들은 셸 안에 있어 그릴 자리가 없기 때문이다.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { categories, bookmarks } = await getAllData();

  /**
   * 셸이 내려보내는 값 넷. 지금은 수가 적어 여기 두지만, 3단계 J1 이 관리자 세션까지
   * 함께 읽어야 하므로 그 직전에 `getShellData()` 같은 함수로 한 번에 뽑아낸다.
   */
  const totalCount = bookmarks.length;
  const dailyCount = bookmarks.filter((bookmark) => bookmark.is_pinned).length;
  const counts = rollupCounts(categories, bookmarks);
  const operatingCategoryId = findOperatingCategoryId(categories);

  return (
    <html lang="ko" className="h-full">
      <head>
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href={PRETENDARD_CSS_URL} />
      </head>
      <body className="h-full">
        {/* 셸 전체가 뷰포트 높이를 넘지 않는다 — 스크롤은 아래 콘텐츠 영역에서만 일어난다.
            bg-page 는 지금 사이드바·헤더·콘텐츠에 완전히 덮여 보이지 않는다. 그래도 칠해 두는
            것은 셸이 뷰포트를 다 채우지 못하는 경우(D5 가 사이드바를 숨기는 중간 상태 등)에
            body 의 surface 가 아니라 스펙의 페이지 배경이 드러나게 하기 위한 대비다. */}
        <div className="flex h-full overflow-hidden bg-page">
          {/* 사이드바 (240px, bg-side, 우측 1px 테두리) — 내용물은 C3 Sidebar.
              '내 즐겨찾기' 개수만 localStorage 소관이라 클라이언트 래퍼를 한 겹 거친다.
              <820px 에서는 통째로 숨고 그 자리를 아래 MobileChips 가 대신한다(D5). */}
          <aside className="hidden w-[240px] flex-none flex-col overflow-hidden border-r border-border bg-side min-[820px]:flex">
            <SidebarContainer
              categories={categories}
              counts={counts}
              totalCount={totalCount}
              dailyCount={dailyCount}
              operatingCategoryId={operatingCategoryId}
            />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 헤더 (60px, 흰 배경, 하단 1px 테두리, 좌우 패딩 28px) — 내용물은 C4 Header.
                검색·AI 버튼 콜백 연결은 2단계 G5, isAdmin 은 3단계 J1 몫이라 지금은 생략한다. */}
            <header className="flex h-[60px] flex-none items-center border-b border-border bg-card px-[12px] min-[820px]:px-[28px]">
              <Header totalCount={totalCount} faviconCount={faviconCount(bookmarks)} />
            </header>

            {/* 좁은 화면의 내비게이션 (D5) — 숨은 사이드바 대신 헤더 바로 아래 한 줄로 깐다.
                자신이 `min-[820px]:hidden` 을 들고 있어 데스크톱에서는 아무것도 그리지 않는다. */}
            <MobileChips categories={categories} />

            {/* 콘텐츠 — 셸에서 유일하게 스크롤되는 영역.
                본문 패딩(DESIGN_SPEC 1장, 데스크톱 20px 28px 36px)은 화면이 아니라 셸이 갖는다.
                모바일 축소(12px 12px 26px)를 D5가 이 한 줄에서 처리하기 위해서다 — 실제로 그렇게 됐다.

                화면과의 계약: 이 컨테이너는 `flex flex-col` 이다. 화면 루트에 `flex-1` 을 주면
                내용이 짧아도 세로를 꽉 채우고(빈 상태 안내를 가운데 두는 화면이 이걸 쓴다),
                주지 않으면 내용 높이만큼만 차지한다. 이 두 클래스를 빼면 화면들의
                세로 정렬이 조용히 무너지므로 함부로 바꾸지 않는다. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface px-[12px] pt-[12px] pb-[26px] min-[820px]:px-[28px] min-[820px]:pt-[20px] min-[820px]:pb-[36px]">
              {children}
            </div>
          </div>
        </div>

        {/* 토스트는 앱에 한 번만 마운트한다. 화면 하단 중앙에 고정되는 오버레이라
            셸의 레이아웃 흐름에 속하지 않으므로 셸의 형제로 둔다. */}
        <Toaster />
      </body>
    </html>
  );
}
