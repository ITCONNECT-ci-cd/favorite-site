import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 셸 뼈대(C1)의 회귀 방지 — DESIGN_SPEC 2장 + 1장(본문 패딩).
 *
 * RootLayout 은 `<html>` 을 렌더하므로 RTL 로 마운트할 수 없다(jsdom 문서에 html 이 중첩된다).
 * 그래서 design-tokens.test.ts 와 같은 방식으로 **소스 문자열을 검사**한다.
 * 이 방식은 "클래스가 적혀 있다"까지만 보증하고 화면에 실제로 그렇게 그려지는지는 못 본다 —
 * 시각 검증은 시드 투입(B5) 이후 O1 게이트에서 한다(계획서 기록).
 */
const layoutSource = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

/**
 * 주석을 걷어낸 코드만 남긴다.
 *
 * 셸의 주석에는 "주소창(38px)은 만들지 않는다", "revalidate 를 넣지 마라"처럼
 * **하지 않기로 한 것의 이름**이 그대로 적혀 있다. 원문을 그대로 검사하면 금지 항목을 설명한
 * 주석 자체가 위반으로 잡힌다. 블록 주석만 지우면 충분하다 — 줄 주석까지 지우면
 * Pretendard CDN 주소의 `//` 뒤가 함께 날아간다.
 */
const layoutCode = layoutSource.replace(/\/\*[\s\S]*?\*\//g, '');

/** JSX 속성 문자열에서 지정한 컴포넌트/태그의 className 을 뽑는다. */
function classNameOf(pattern: RegExp): string {
  const match = layoutCode.match(pattern);
  expect(match, `셸에서 ${pattern} 를 찾지 못했다`).not.toBeNull();

  return match![1];
}

describe('셸 레이아웃 뼈대 (app/layout.tsx)', () => {
  it('사이드바 자리가 240px 고정폭 + 우측 1px 테두리 + 사이드바 배경이다', () => {
    const className = classNameOf(/<aside className="([^"]*)"/);

    expect(className).toContain('w-[240px]');
    // flex-none 이 빠지면 콘텐츠가 넓어질 때 사이드바가 눌려 240px 이 깨진다.
    expect(className).toContain('flex-none');
    expect(className).toContain('border-r');
    expect(className).toContain('border-border');
    expect(className).toContain('bg-side');
  });

  it('헤더 자리가 60px 고정높이 + 하단 1px 테두리 + 흰 배경 + 좌우 28px 이다', () => {
    const className = classNameOf(/<header className="([^"]*)"/);

    expect(className).toContain('h-[60px]');
    expect(className).toContain('flex-none');
    expect(className).toContain('border-b');
    expect(className).toContain('border-border');
    expect(className).toContain('bg-card');
    expect(className).toContain('px-[28px]');
  });

  it('콘텐츠 영역이 본문 패딩 3값을 갖고 혼자 스크롤한다', () => {
    const className = classNameOf(/<div className="(flex min-h-0 flex-1[^"]*)"/);

    // DESIGN_SPEC 1장 본문 패딩 데스크톱 `20px 28px 36px`.
    expect(className).toContain('pt-[20px]');
    expect(className).toContain('px-[28px]');
    expect(className).toContain('pb-[36px]');
    expect(className).toContain('overflow-y-auto');
    expect(className).toContain('bg-surface');
    // 화면 루트가 flex-1 로 세로를 채울 수 있게 하는 계약.
    expect(className).toContain('flex-col');
  });

  it('프로토타입 전용 주소창(38px)을 만들지 않는다', () => {
    // 클래스 형태로만 본다. 38이라는 숫자 자체는 금지 대상이 아니다 — 스펙의 검색창·버튼
    // 높이도 38px 이고, 실제로 오류 화면의 '다시 시도' 링크가 그 높이를 inline 으로 쓴다.
    // 주소창을 만든다면 셸의 다른 치수처럼 h-[38px] 로 적힐 것이므로 그 형태를 잠근다.
    expect(layoutCode).not.toContain('h-[38px]');
  });

  it('토스터를 딱 한 번 마운트한다', () => {
    expect(layoutCode.match(/<Toaster\s*\/>/g)).toHaveLength(1);
  });

  it('revalidate 를 내보내지 않는다 (매 요청 렌더가 의도 — getAllData JSDoc)', () => {
    expect(layoutCode).not.toMatch(/export\s+const\s+revalidate/);
  });
});

/**
 * 셸 데이터 조회가 실패해도 빈 500 이 아니라 안내 화면이 나가야 한다 (O1 게이트 F-1).
 *
 * 루트 레이아웃의 SSR 실패는 global-error.tsx 가 잡지 못한다 — Next 가 빈 500 셸
 * (`__next_error__`)을 내보내고 클라이언트 청크가 로드되지 않기 때문이다. 그래서 셸이
 * 직접 try/catch 로 잡는데, **이 구조는 지우기 쉬운 종류의 코드**라 소스 수준에서 잠가 둔다.
 *
 * async 서버 컴포넌트라 RTL 로 렌더해 확인할 수 없다. 실제 동작 검증(env 를 지우고
 * 프로덕션 빌드로 재현)은 O1 게이트 보고서에 기록돼 있고, 여기서는 그 구조가 사라지지
 * 않는지만 지킨다.
 */
describe('셸 데이터 조회 실패 대비 (O1 게이트 F-1)', () => {
  it('getAllData 를 try/catch 로 감싼다', () => {
    expect(layoutCode).toMatch(/try\s*\{[\s\S]*?getAllData\(\)[\s\S]*?\}\s*catch/);
  });

  it('실패해도 안내 문구를 내보낸다 (global-error 와 같은 문구)', () => {
    expect(layoutCode).toContain('일시적인 오류가 발생했습니다');
  });

  it('오류 화면도 자기 html·body 를 직접 렌더한다', () => {
    // 루트 레이아웃 자리를 대신 채우는 화면이라 문서 뼈대를 스스로 갖춰야 한다.
    expect(layoutCode.match(/<html lang="ko"/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('되돌리기는 reset() 이 아니라 문서 요청 링크다', () => {
    // 서버 렌더 경로라 reset() 이 없다. 셸을 다시 세우려면 새 요청이 필요하다.
    expect(layoutCode).toMatch(/<a\s+href="\/"/);
  });
});

/**
 * 반응형 (D5) — DESIGN_SPEC 1장 브레이크포인트 표의 narrow 규칙 중 셸이 지는 몫이다.
 * 위 describe 의 데스크톱 잠금은 그대로 살아 있다 — 이제 `min-[820px]:` 접두사가 붙은 채로
 * 같은 값을 지킨다(예: `min-[820px]:px-[28px]`).
 */
describe('셸 레이아웃 반응형 (<820px)', () => {
  it('사이드바를 <820px 에서 숨긴다', () => {
    const className = classNameOf(/<aside className="([^"]*)"/);

    expect(className).toContain('hidden');
    expect(className).toContain('min-[820px]:flex');
    // 무조건부 flex 가 남아 있으면 hidden 과 싸운다 — 모바일 우선으로 한쪽만 둔다.
    expect(className).not.toMatch(/(^|\s)flex(\s|$)/);
  });

  it('사이드바가 사라진 자리를 칩 줄이 대신한다 — 헤더 아래, 콘텐츠 위에 한 번', () => {
    expect(layoutCode.match(/<MobileChips\b/g)).toHaveLength(1);
    // 표시 조건(<820px)은 MobileChips 자신이 들고 있다(MobileChips.test.tsx).
    expect(layoutCode).toMatch(/<\/header>[\s\S]*<MobileChips[\s\S]*<div className="flex min-h-0/);
  });

  it('헤더 좌우 패딩이 모바일에서 12px 로 줄어든다 (프로토타입 headPad)', () => {
    const className = classNameOf(/<header className="([^"]*)"/);

    expect(className).toContain('px-[12px]');
    expect(className).toContain('min-[820px]:px-[28px]');
  });

  it('본문 패딩이 모바일에서 12px 12px 26px 이다 (프로토타입 mainPad)', () => {
    const className = classNameOf(/<div className="(flex min-h-0 flex-1[^"]*)"/);

    expect(className).toContain('px-[12px]');
    expect(className).toContain('pt-[12px]');
    expect(className).toContain('pb-[26px]');
    expect(className).toContain('min-[820px]:px-[28px]');
    expect(className).toContain('min-[820px]:pt-[20px]');
    expect(className).toContain('min-[820px]:pb-[36px]');
  });
});
