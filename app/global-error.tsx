'use client';

/**
 * **클라이언트 렌더·하이드레이션 오류 전용** 최상위 경계.
 *
 * 이름 때문에 "모든 오류의 마지막 그물"로 읽히지만 그렇지 않다. O1 게이트 F-1 에서 격리
 * 재현한 결과, **루트 레이아웃의 SSR 실패는 여기로 오지 않는다** — 서버 렌더가 던지면
 * Next 는 빈 500 셸(`__next_error__`)만 내보내고 우리 클라이언트 청크는 로드조차 되지
 * 않는다. 클라이언트 경계인 이 파일이 마운트될 기회 자체가 없다.
 * 그래서 셸 데이터 조회 실패는 app/(public)/layout.tsx 가 try/catch 로 직접 잡아 서버에서
 * 오류 화면을 완성해 내보낸다(그쪽 ShellUnavailable). 셸은 H2 에서 `(public)` 라우트 그룹으로
 * 내려갔다 — 루트 `app/layout.tsx` 는 이제 문서 뼈대만 지므로 조회 자체가 없다.
 *
 * 이 파일이 실제로 그려지는 경우는 브라우저에서 React 트리가 깨진 상황이다 —
 * 하이드레이션 불일치, 클라이언트 컴포넌트의 렌더 오류 등.
 *
 * 제약 두 가지가 여기서 나온다.
 * 1. 루트 레이아웃을 대체하므로 `<html>`·`<body>` 를 직접 렌더해야 한다.
 * 2. 사이드바·헤더를 쓸 수 없다 — 둘 다 대체된 셸 안에 있고, 그릴 데이터도 여기엔 없다.
 *
 * globals.css 가 실려 있다는 보장이 없어 색·타이포를 inline style 로 직접 적는다.
 * 값은 DESIGN_SPEC 1장 무채색 토큰과 같은 값이다(페이지 배경 #f7f5f2, 본문 #141516,
 * 설명 #6d6a65).
 *
 * 오류 원문은 화면에 내지 않는다 — 내부 사정이 담긴 문구가 섞일 수 있고 이 화면은 사내라도
 * 로그인 없이 열리는 공개 화면이다. 원문은 브라우저 콘솔·서버 로그에 남는다.
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
