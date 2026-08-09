'use client';

export type HeaderProps = {
  /** 전체 링크 수. */
  totalCount: number;
  /** favicon_url을 가진 링크 수. */
  faviconCount: number;
  /** 관리자 로그인 여부 — 세션 확인·배선은 3단계 J1. */
  isAdmin?: boolean;
  /** 검색 트리거 클릭 — ⌘K 팔레트 열기 연결은 2단계 G5. */
  onSearchClick?: () => void;
  /** "AI 검색" 클릭 — 2단계 G5 → 5단계 N3. */
  onAiClick?: () => void;
};

/**
 * 헤더 내용물 — DESIGN_SPEC 2장 "헤더(60px)".
 *
 * 헤더 자리(높이 60px · 흰 배경 · 하단 1px 테두리 · 좌우 28px)는 C1 셸이 이미 잡아 뒀다.
 * 여기서는 그 안에 들어갈 가로 배치(gap 12px)만 만든다 — 배경·높이·좌우 패딩을 다시 칠하면
 * 패딩이 이중으로 먹는다.
 *
 * 검색창은 겉모습만 입력처럼 보이는 **버튼**이다. 실제 입력은 ⌘K 팔레트가 받으므로
 * 여기에 <input>을 두면 포커스가 두 군데로 갈라진다. 커서를 `cursor-text`로 두는 것도
 * 같은 이유다 — "여기서 타이핑이 시작된다"는 신호는 남기되 입력은 팔레트가 받는다.
 *
 * 375px에서 placeholder 여유 ~26px — 프로토타입 동일, 수용(D5 판정).
 * 좁은 화면에서도 헤더는 이 세 가지를 다 들고 있고(검색창·AI 검색·우측 개수), 줄어드는 것은
 * 검색창의 안내 문구뿐이다(`min-w-0 flex-1 truncate`). 프로토타입의 narrow 헤더 규칙도
 * `headPad`(좌우 12px) 하나뿐이라 같은 모습이므로 그대로 둔다. 잘림은 없다 —
 * 헤더 min-content 합이 325px로 375px 화면의 가용 351px보다 작다.
 *
 * G5 배선 시 할 일:
 * - 팔레트 열림 상태를 `aria-expanded`로 스레딩한다 (선택적 `isSearchOpen?: boolean` prop 추가).
 *   지금은 열림 상태를 알 수 없어 `aria-haspopup="dialog"`까지만 걸어 뒀다.
 * - `onSearchClick`·`onAiClick`을 required로 승격한다. 콜백 없는 헤더는 C4 단독 렌더용
 *   임시 상태이지 제품 상태가 아니다.
 */
export function Header({
  totalCount,
  faviconCount,
  isAdmin = false,
  onSearchClick,
  onAiClick,
}: HeaderProps) {
  return (
    <div className="flex w-full items-center gap-[12px]">
      <button
        type="button"
        onClick={onSearchClick}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K"
        // 호버 두 색은 프로토타입 값 그대로다. #efede8은 DESIGN_SPEC 2-1장(카드 액션 버튼
        // 호버 배경)에도 나오는 정식 스펙 값이고, #b8b2a8은 1장 색상표에 없어 토큰이 없다.
        // 둘 다 arbitrary value로 적는다 — 팔레트 제거는 "토큰 클래스만 존재"라는 뜻이지
        // 스펙 고유 색을 값으로 쓰지 말라는 뜻이 아니다.
        className="flex h-[38px] min-w-0 max-w-[620px] flex-1 cursor-text items-center gap-[10px] rounded-[7px] border border-border-strong bg-side px-[13px] hover:border-[#b8b2a8] hover:bg-[#efede8]"
      >
        {/* 원형 아웃라인 아이콘 — 아이콘 라이브러리를 들이지 않고 circle 하나로 그린다.
            r은 (12 - strokeWidth) / 2 로, 1.5px 선이 12px 상자 안에 정확히 들어간다. */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="flex-none text-fainter"
        >
          <circle
            cx="6"
            cy="6"
            r="5.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>

        <span className="min-w-0 flex-1 truncate text-left text-[13.5px] text-fainter">
          이름·설명·태그·주소로 바로 찾기
        </span>

        {/* 단축키는 aria-keyshortcuts로 이미 알렸다. U+2318(⌘)은 Windows 스크린리더가
            읽지 않아 접근 이름만 어지럽히므로 시각 표시 전용으로 숨긴다. */}
        <kbd
          aria-hidden="true"
          className="flex-none rounded-[4px] border border-border-strong bg-card px-[6px] py-[2px] font-sans text-[10.5px] font-semibold text-faint"
        >
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={onAiClick}
        className="flex h-[38px] flex-none cursor-pointer items-center rounded-[7px] border border-ink bg-ink px-[14px] text-[13px] font-semibold whitespace-nowrap text-white hover:bg-ink-hover"
      >
        AI 검색
      </button>

      <span className="ml-auto flex-none text-[11.5px] whitespace-nowrap text-fainter">
        {`${totalCount}개 · 파비콘 ${faviconCount}개 내장`}
      </span>

      {isAdmin ? (
        <span className="flex h-[26px] flex-none items-center rounded-[7px] bg-ink px-[10px] text-[11px] font-semibold whitespace-nowrap text-white">
          관리자 편집 모드
        </span>
      ) : null}
    </div>
  );
}
