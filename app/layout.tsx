import type { Metadata } from "next";
import { Header } from "@/components/Header";
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
 * 제품에는 만들지 않는다. 반응형(<820px에서 사이드바 숨김)은 D5 몫이다.
 *
 * 사이드바·헤더가 쓰는 숫자는 전부 여기서 한 번 읽어 내려보낸다. 화면마다 따로 읽으면
 * 같은 요청 안에서 조회가 중복되고, 사이드바 숫자가 화면별로 어긋날 수 있다.
 * 개수 계산은 D1의 순수 함수(rollupCounts·faviconCount·findOperatingCategoryId)에 맡긴다.
 *
 * `export const revalidate` 를 넣지 마라 — 이 셸은 매 요청 렌더되는 것이 의도다.
 * 근거는 lib/queries.ts 의 getAllData JSDoc 에 있다.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { categories, bookmarks } = await getAllData();
  const totalCount = bookmarks.length;

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
        {/* 셸 전체가 뷰포트 높이를 넘지 않는다 — 스크롤은 아래 콘텐츠 영역에서만 일어난다. */}
        <div className="flex h-full overflow-hidden bg-page">
          {/* 사이드바 (240px, bg-side, 우측 1px 테두리) — 내용물은 C3 Sidebar.
              '내 즐겨찾기' 개수만 localStorage 소관이라 클라이언트 래퍼를 한 겹 거친다. */}
          <aside className="flex w-[240px] flex-none flex-col overflow-hidden border-r border-border bg-side">
            <SidebarContainer
              categories={categories}
              counts={rollupCounts(categories, bookmarks)}
              totalCount={totalCount}
              dailyCount={bookmarks.filter((bookmark) => bookmark.is_pinned).length}
              operatingCategoryId={findOperatingCategoryId(categories)}
            />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 헤더 (60px, 흰 배경, 하단 1px 테두리, 좌우 패딩 28px) — 내용물은 C4 Header.
                검색·AI 버튼 콜백 연결은 2단계 G5, isAdmin 은 3단계 J1 몫이라 지금은 생략한다. */}
            <header className="flex h-[60px] flex-none items-center border-b border-border bg-card px-[28px]">
              <Header totalCount={totalCount} faviconCount={faviconCount(bookmarks)} />
            </header>

            {/* 콘텐츠 — 셸에서 유일하게 스크롤되는 영역.
                본문 패딩(DESIGN_SPEC 1장, 데스크톱 20px 28px 36px)은 화면이 아니라 셸이 갖는다.
                모바일 축소(12px 12px 26px)를 D5가 이 한 줄에서 처리하기 위해서다. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface px-[28px] pt-[20px] pb-[36px]">
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
