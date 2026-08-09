import Link from 'next/link';

/**
 * 어느 라우트에도 걸리지 않은 URL 의 404 — **`notFound()` 호출은 여기로 오지 않는다.**
 *
 * 역할 구분(짝은 `app/(public)/not-found.tsx` 다).
 * - **여기(루트)**: 미매칭 URL 전용이다. 오타·죽은 북마크·크롤러가 닿는 자리라 사이드바를
 *   세워 줄 이유가 없고, 세우려면 셸이 카테고리·링크를 통째로 조회해야 한다. 그래서 이 화면은
 *   **조회를 하지 않는다** — 없는 주소 하나가 DB 왕복을 만들지 않는다는 뜻이다.
 *   여기에 `getAllData()` 나 세션 조회를 들이지 마라.
 * - **`app/(public)/not-found.tsx`**: 공개 그룹 안의 화면이 스스로 부른 `notFound()`(지금은
 *   없는 분류 id 하나)를 받는다. 그쪽은 셸 안에 남아 다른 분류로 바로 갈 수 있다.
 *
 * 루트 레이아웃(`<html>`·`<body>`·전역 CSS)은 이 화면에도 적용된다 — 그래서 여기서는
 * inline style 이 아니라 평소 쓰는 토큰 클래스를 쓴다. 전역 CSS 조차 못 믿는 자리는
 * `app/global-error.tsx` 와 공개 셸의 ShellUnavailable 이고, 여기는 그 경우가 아니다.
 *
 * 탭 제목은 일부러 내보내지 않는다 — 루트 metadata 의 default(`내 링크`)를 그대로 쓴다
 * (app/layout.tsx 의 title 주석). Next 가 404 응답에는 `noindex` 를 알아서 붙인다.
 */
export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[12px] bg-page px-[24px] text-center">
      <h1 className="text-[20px] font-bold tracking-[-0.02em] text-ink">
        페이지를 찾을 수 없습니다
      </h1>

      <p className="text-[12.5px] text-desc">
        주소가 잘못되었거나 지워진 페이지입니다.
      </p>

      <Link
        href="/"
        className="mt-[4px] flex h-[38px] items-center rounded-[7px] bg-ink px-[18px] text-[13px] font-semibold text-white hover:bg-ink-hover"
      >
        홈으로
      </Link>
    </div>
  );
}
