import { MobileChips } from "@/components/MobileChips";
import { PaletteHost } from "@/components/PaletteHost";
import { SidebarContainer } from "@/components/SidebarContainer";
import {
  faviconCount,
  findOperatingCategoryId,
  getAllData,
  rollupCounts,
} from "@/lib/queries";
import { getAdminSession } from "@/lib/supabase/server";

/**
 * 셸을 그릴 데이터가 없을 때의 화면 — 사이드바·헤더 없이 이것만 렌더한다.
 *
 * **왜 global-error.tsx 가 아니라 여기서 잡나** (O1 게이트 F-1 에서 격리 재현):
 * 레이아웃의 SSR 실패는 global-error 가 잡지 못한다. 서버 렌더가 던지면 Next 는
 * 빈 500 셸(`__next_error__`)만 내보내고 우리 클라이언트 청크는 로드조차 되지 않아,
 * 클라이언트 경계인 global-error 가 마운트될 기회 자체가 없다. 그래서 셸이 직접 잡아
 * 서버에서 완성된 HTML 을 내보낸다.
 *
 * 문구·스타일은 app/global-error.tsx 와 같게 유지한다 — 한쪽만 고치지 마라.
 * 다른 점은 되돌리는 방법 하나다. 여기는 서버 렌더라 reset() 이 없고, 대신 링크로 새 요청을
 * 보내 서버 리렌더를 유도한다(클라이언트 내비게이션이 아니라 문서 요청이어야 셸이 다시 선다).
 *
 * `<html>`·`<body>` 를 직접 렌더하지 않는다 — 이 레이아웃은 더 이상 루트가 아니고
 * 문서 뼈대는 app/layout.tsx 가 세운다(H2 라우트 그룹 분리). 그래서 `margin: 0` 처럼
 * body 가 가진 값은 여기서 손댈 수 없다. 여기서 자족할 수 있는 것은 **색·타이포·중앙 정렬**
 * 뿐이라 그 셋만 inline style 로 적는다 — Tailwind 유틸이 실리지 않은 상태에서도 이 화면의
 * 글자는 읽히고 가운데에 선다. 값은 DESIGN_SPEC 1장 무채색 토큰과 같다.
 *
 * 높이는 `100vh` 다(global-error 와 같은 값). `100%` 는 조상이 높이를 줘야 성립하는데,
 * 루트 레이아웃의 `h-full` 은 전역 CSS 가 실려야 붙는 클래스다 — 그게 없을 때를 대비하는
 * 화면이 그것에 기대면 안 된다. 뷰포트 기준이라면 혼자서도 세로를 채운다.
 */
function ShellUnavailable() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "14px",
        padding: "0 24px",
        textAlign: "center",
        background: "#f7f5f2",
        color: "#141516",
        fontFamily: "'Pretendard', system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        일시적인 오류가 발생했습니다
      </h1>

      <p style={{ margin: 0, fontSize: "13px", color: "#6d6a65" }}>
        잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려 주세요.
      </p>

      {/* next/link 의 클라이언트 내비게이션이 아니라 문서 요청이어야 한다 — 셸이 서버에서
          처음부터 다시 서야 복구되기 때문이다. 규칙이 권하는 <Link> 로 바꾸면 안 된다. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        style={{
          marginTop: "4px",
          display: "flex",
          alignItems: "center",
          height: "38px",
          padding: "0 18px",
          border: "1px solid #141516",
          borderRadius: "7px",
          background: "#141516",
          color: "#ffffff",
          fontSize: "13px",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        다시 시도
      </a>
    </div>
  );
}

/**
 * 공개 화면의 공통 셸 — DESIGN_SPEC 2장.
 *
 * **`(public)` 은 라우트 그룹이라 URL 에 나타나지 않는다** — 이 레이아웃이 감싸는 화면의
 * 주소는 `/`·`/favorites`·`/daily`·`/category/[id]` 그대로다. 셸이 여기 있는 이유는
 * 관리 라우트(`app/admin/*`)를 이 그룹 **밖**에 두기 위해서다. 루트 레이아웃이 셸을 들고
 * 있던 시절에는 로그인 화면까지 공개 사이드바 안에 갇혔다(H2 라우트 그룹 분리).
 * 그러니 이 파일을 다시 `app/layout.tsx` 로 올리지 마라.
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
 * 조회가 실패하면 셸을 그릴 수 없으므로 아래 ShellUnavailable 을 대신 렌더한다.
 * 이 실패를 여기서 직접 잡는 이유는 ShellUnavailable 의 주석에 적어 뒀다.
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  let data;
  try {
    data = await getAllData();
  } catch (error) {
    // 삼키면 원인을 볼 곳이 사라진다 — 원문은 서버 로그에만 남기고 화면에는 내지 않는다.
    console.error("셸 데이터 조회 실패 — 오류 화면으로 대체한다", error);

    return <ShellUnavailable />;
  }

  const { categories, bookmarks } = data;

  /**
   * 헤더의 '관리자 편집 모드' 칩 조건 (J1). 판정은 통째로 `getAdminSession()`(H1)에 맡긴다 —
   * non-null 이면 요청자가 그 관리자다. 이메일 같은 안쪽 값은 보지 않는다.
   *
   * 조회 실패로 셸이 서지 않는 경우에는 애초에 헤더가 없으므로 위 try 뒤에서 읽는다.
   * 이 왕복은 화면당 한 번뿐이다: 같은 렌더 패스의 page 도 같은 함수를 부르지만 React
   * `cache()` 가 묶어 준다(그 함수의 JSDoc "cache() 로 감싼 이유").
   *
   * C1 이 남긴 `getShellData()` 추출은 하지 않았다 — 아래 값 넷은 셸만 쓰고 세션은 화면들이
   * 각자 `getAdminSession()` 을 불러 받으므로, 묶어 봐야 호출자가 하나뿐인 함수가 된다.
   */
  const isAdmin = (await getAdminSession()) !== null;

  /** 셸이 내려보내는 값 넷 — 사이드바·헤더가 쓰는 숫자다. */
  const totalCount = bookmarks.length;
  const dailyCount = bookmarks.filter((bookmark) => bookmark.is_pinned).length;
  const counts = rollupCounts(categories, bookmarks);
  const operatingCategoryId = findOperatingCategoryId(categories);

  return (
    /* 셸 전체가 뷰포트 높이를 넘지 않는다 — 스크롤은 아래 콘텐츠 영역에서만 일어난다.
       (`h-full` 이 먹히려면 html·body 도 `h-full` 이어야 한다 — 루트 레이아웃이 준다.)
       bg-page 는 지금 사이드바·헤더·콘텐츠에 완전히 덮여 보이지 않는다. 그래도 칠해 두는
       것은 셸이 뷰포트를 다 채우지 못하는 경우(D5 가 사이드바를 숨기는 중간 상태 등)에
       body 의 surface 가 아니라 스펙의 페이지 배경이 드러나게 하기 위한 대비다. */
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
        {/* 헤더 (60px, 흰 배경, 하단 1px 테두리, 좌우 패딩 28px) — 내용물은 C4 Header 지만,
            셸이 직접 렌더하지 않고 G5 의 PaletteHost 를 거친다. 검색창·AI 버튼·전역 ⌘K 가
            여는 팔레트의 열림 상태를 누군가는 들고 있어야 하는데, 서버 컴포넌트인 셸은
            그럴 수 없어서다. 호스트가 헤더와 팔레트를 함께 렌더한다(팔레트는 fixed 라
            이 자리에 있어도 헤더 줄을 밀지 않는다).
            isAdmin 은 호스트가 헤더로 그대로 흘려보낸다 — 칩을 그리는 것은 C4 Header 다. */}
        <header className="flex h-[60px] flex-none items-center border-b border-border bg-card px-[12px] min-[820px]:px-[28px]">
          <PaletteHost
            data={data}
            totalCount={totalCount}
            faviconCount={faviconCount(bookmarks)}
            isAdmin={isAdmin}
          />
        </header>

        {/* 좁은 화면의 내비게이션 (D5) — 숨은 사이드바 대신 헤더 바로 아래 한 줄로 깐다.
            자신이 `min-[820px]:hidden` 을 들고 있어 데스크톱에서는 아무것도 그리지 않는다. */}
        <MobileChips categories={categories} operatingCategoryId={operatingCategoryId} />

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
  );
}
