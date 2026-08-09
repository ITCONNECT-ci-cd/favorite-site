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
    expect(layoutCode).not.toContain('38px');
  });

  it('토스터를 딱 한 번 마운트한다', () => {
    expect(layoutCode.match(/<Toaster\s*\/>/g)).toHaveLength(1);
  });

  it('revalidate 를 내보내지 않는다 (매 요청 렌더가 의도 — getAllData JSDoc)', () => {
    expect(layoutCode).not.toMatch(/export\s+const\s+revalidate/);
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
