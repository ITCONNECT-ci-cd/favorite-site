import type { Metadata } from "next";
import { Toaster } from "@/components/Toast";
import "./globals.css";

/** Pretendard 웹폰트 (DESIGN_SPEC 1장 타이포그래피). */
const PRETENDARD_CSS_URL =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css";

/**
 * 탭 제목의 규칙은 셸이 한 번만 정한다 — 화면은 자기 이름만 대고 꼬리표(`— 내 링크`)는
 * template 이 붙인다. 화면마다 문자열을 이어 붙이면 꼬리표가 여러 파일에 흩어져,
 * 서비스 이름이 바뀔 때 한 곳이라도 빠지면 조용히 어긋난다.
 * 제목이 없는 화면(홈·404·metadata 를 내보내지 않는 라우트)은 default 를 그대로 쓴다.
 */
export const metadata: Metadata = {
  title: {
    default: "내 링크",
    template: "%s — 내 링크",
  },
  description: "사내 구성원이 자주 쓰는 링크를 한곳에서 찾는 대시보드",
};

/**
 * 문서 뼈대만 세우는 최상위 레이아웃 — 여기에는 **화면이 없다.**
 *
 * ## 왜 공개 셸(사이드바·헤더)이 여기 없나 (H2 라우트 그룹 분리)
 *
 * 원래는 이 파일이 공개 셸과 그 데이터 조회까지 들고 있었다. 그러면 `/admin` 도 루트
 * 레이아웃의 자식이라 **공개 사이드바 안에 로그인 화면이 갇힌다** — 로그인하지 않은 사람에게
 * 관리 화면이 공개 내비게이션에 감싸여 나오는 모양이라 스펙(DESIGN_SPEC 6장: 배경 `#f3f1ed`
 * 가 화면을 꽉 채운 중앙 정렬)과도 어긋난다.
 *
 * 그래서 공개 셸은 `app/(public)/layout.tsx` 로 내려갔다. `(public)` 은 **라우트 그룹**이라
 * URL 에 나타나지 않는다 — `/`·`/favorites`·`/category/[id]` 주소는 그대로다.
 * 관리 라우트(`app/admin/*`)는 그 그룹 밖에 있어 공개 셸을 상속하지 않는다.
 *
 * **여기에 데이터 조회를 다시 들이지 마라.** 조회가 없어야 이 레이아웃이 실패할 일이 없고,
 * 그래야 공개 셸의 조회 실패를 (public) 레이아웃이 자기 안에서 오류 화면으로 바꿔 낼 수 있다
 * (그쪽 ShellUnavailable 주석). 관리 화면이 공개 데이터를 읽는 비용을 무는 일도 없다.
 *
 * 이 파일이 지는 몫은 넷뿐이다: `<html>`·`<body>`, 폰트·전역 CSS, metadata, Toaster.
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
      {/* h-full 은 공개 셸과 로그인 화면이 함께 쓴다 — 둘 다 뷰포트 높이를 꽉 채운 뒤
          그 안에서만 스크롤한다. 여기서 빼면 두 화면의 세로가 동시에 무너진다. */}
      <body className="h-full">
        {children}

        {/* 토스트는 앱에 한 번만 마운트한다. 화면 하단 중앙에 고정되는 오버레이라
            어느 화면의 레이아웃 흐름에도 속하지 않으므로 문서 뼈대가 직접 든다.
            공개 셸에 두면 관리 화면에서는 토스트가 뜨지 않는다. */}
        <Toaster />
      </body>
    </html>
  );
}
