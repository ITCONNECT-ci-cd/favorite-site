import type { Metadata } from "next";
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
 * 사이드바·헤더의 내용물은 C3·C4가 각각 별도 컴포넌트로 만든다. 여기서는 스펙이 정한
 * 치수·배경·테두리만 잡아 두고, 두 컴포넌트가 완성되면 이 자리에 끼운다.
 * 반응형(<820px에서 사이드바 숨김)은 D5 몫 — 지금은 데스크톱 배치만 있다.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
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
          {/* 사이드바 자리 (240px, bg-side, 우측 1px 테두리) — 내용물은 C3 Sidebar. */}
          <aside className="flex w-[240px] flex-none flex-col overflow-hidden border-r border-border bg-side" />

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 헤더 자리 (60px, 흰 배경, 하단 1px 테두리, 좌우 패딩 28px) — 내용물은 C4 Header. */}
            <header className="flex h-[60px] flex-none items-center border-b border-border bg-card px-[28px]" />

            {/* 콘텐츠 — 셸에서 유일하게 스크롤되는 영역.
                본문 패딩(DESIGN_SPEC 1장, 데스크톱 20px 28px 36px)은 화면이 아니라 셸이 갖는다.
                모바일 축소(12px 12px 26px)를 D5가 이 한 줄에서 처리하기 위해서다. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface px-[28px] pt-[20px] pb-[36px]">
              {children}
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
