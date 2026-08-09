'use client';

/**
 * 루트 레이아웃(app/layout.tsx)이 던진 오류를 받는 유일한 자리.
 *
 * 셸이 getAllData 로 DB 를 읽으므로 조회 실패·환경변수 누락이 곧바로 여기로 온다.
 * 아래 계층의 error.tsx 들은 셸 **안**에 그려지는데, 셸 자체가 죽은 상황에서는 그릴 자리가
 * 없다. 그래서 Next 는 이 파일만 루트 레이아웃을 통째로 대체해 렌더한다.
 *
 * 제약 두 가지가 여기서 나온다.
 * 1. 루트 레이아웃을 대체하므로 `<html>`·`<body>` 를 직접 렌더해야 한다.
 * 2. 사이드바·헤더를 쓸 수 없다 — 둘 다 셸 안에 있고, 그 셸이 실패해서 여기로 온 것이다.
 *    데이터도 없다(그 조회가 실패한 경우가 대부분이다).
 *
 * globals.css 가 실려 있다는 보장이 없어 색·타이포를 inline style 로 직접 적는다.
 * 값은 DESIGN_SPEC 1장 무채색 토큰과 같은 값이다(페이지 배경 #f7f5f2, 본문 #141516,
 * 설명 #6d6a65, 테두리 #e3dfd9).
 *
 * 오류 원문은 화면에 내지 않는다 — getAllData 는 `Supabase bookmarks 조회 실패: ...` 처럼
 * 내부 사정이 담긴 문구를 던지고, 이 화면은 사내라도 로그인 없이 열리는 공개 화면이다.
 * 원문은 서버 로그에 남는다.
 *
 * 확인 방법: 개발 서버에서는 Next 의 오류 오버레이가 이 화면을 가로챈다.
 * 눈으로 보려면 프로덕션 빌드로 띄워야 한다 (`npm run build && npm start`).
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '14px',
          padding: '0 24px',
          textAlign: 'center',
          background: '#f7f5f2',
          color: '#141516',
          fontFamily: "'Pretendard', system-ui, sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
          일시적인 오류가 발생했습니다
        </h1>

        <p style={{ margin: 0, fontSize: '13px', color: '#6d6a65' }}>
          잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려 주세요.
        </p>

        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '4px',
            height: '38px',
            padding: '0 18px',
            border: '1px solid #141516',
            borderRadius: '7px',
            background: '#141516',
            color: '#ffffff',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  );
}
