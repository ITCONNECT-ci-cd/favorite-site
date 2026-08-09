import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadata } from '@/app/layout';

// jsdom 환경에서는 import.meta.url이 file: URL이 아니므로 프로젝트 루트(vitest cwd) 기준으로 읽는다.
const globalsCss = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
const layoutSource = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

/**
 * DESIGN_SPEC 1장(색상)이 원본. 값이 어긋나면 프로토타입과 화면 색이 달라지므로
 * 토큰 값은 이 표를 통해서만 바꾼다.
 */
const COLOR_TOKENS: Record<string, string> = {
  '--color-page': '#f7f5f2',
  '--color-surface': '#fbfaf8',
  '--color-card': '#ffffff',
  '--color-side': '#f3f1ed',
  '--color-toolbar': '#faf9f7',
  '--color-ink': '#141516',
  '--color-ink-hover': '#33352f',
  '--color-sub': '#4a4844',
  '--color-desc': '#6d6a65',
  '--color-faint': '#8b877f',
  '--color-fainter': '#9a9791',
  '--color-muted': '#a5a29c',
  '--color-mist': '#a8a49d',
  '--color-ghost': '#b5b1aa',
  '--color-border': '#e3dfd9',
  '--color-border-strong': '#ddd8d1',
  '--color-card-border': '#dcd7cf',
  '--color-dash': '#d8d3cb',
  '--color-line': '#f2f0ec',
  '--color-select': '#e4e0d8',
  '--color-select-hover': '#e7e3dc',
  '--color-fav-border': '#cfc7b8',
  '--color-check-off': '#c9c5be',
  '--color-danger': '#a8443a',
};

/** 스펙 표에는 없지만 Tailwind 기본 팔레트에서 유일하게 되살려 둔 색 (다크 배경 위 흰 글자용). */
const KEPT_BASE_TOKENS: Record<string, string> = {
  '--color-white': '#ffffff',
};

/** @theme 블록에서 실제로 정의된 --color-* 키를 뽑는다 (`--color-*: initial` 리셋은 매칭되지 않는다). */
function themeColorKeys(css: string): string[] {
  const open = css.indexOf('{', css.indexOf('@theme'));
  const end = css.indexOf('\n}', open);
  const block = css.slice(open + 1, end);
  return [...block.matchAll(/^\s*(--color-[\w-]+)\s*:/gm)].map((match) => match[1]);
}

describe('디자인 토큰 (app/globals.css)', () => {
  it.each(Object.entries({ ...COLOR_TOKENS, ...KEPT_BASE_TOKENS }))(
    '%s 토큰이 %s 로 정의된다',
    (token, value) => {
      expect(globalsCss).toMatch(new RegExp(`${token}:\\s*${value};`));
    },
  );

  it('Tailwind v4 @theme 블록으로 토큰을 노출한다', () => {
    expect(globalsCss).toContain('@import "tailwindcss";');
    expect(globalsCss).toMatch(/@theme\s*\{/);
  });

  it('Tailwind 기본 팔레트를 제거해 스펙 밖 색이 컴파일되지 않게 한다', () => {
    expect(globalsCss).toMatch(/--color-\*:\s*initial;/);
  });

  it('@theme의 색 토큰 집합이 스펙 24종 + white와 정확히 일치한다', () => {
    const expected = [...Object.keys(COLOR_TOKENS), ...Object.keys(KEPT_BASE_TOKENS)];

    expect(themeColorKeys(globalsCss).sort()).toEqual(expected.sort());
  });

  it('본문 타이포그래피가 DESIGN_SPEC 1장과 같다', () => {
    expect(globalsCss).toMatch(/--font-sans:\s*"Pretendard", system-ui, sans-serif;/);
    expect(globalsCss).toContain('font-variant-numeric: tabular-nums;');
    expect(globalsCss).toContain('-webkit-font-smoothing: antialiased;');
    expect(globalsCss).toMatch(/background:\s*var\(--color-surface\);/);
  });

  it('라이트 모드 전용이므로 다크 모드 블록이 없고 color-scheme을 못박는다', () => {
    expect(globalsCss).not.toContain('prefers-color-scheme');
    expect(globalsCss).toMatch(/color-scheme:\s*light;/);
  });

  /**
   * D5 이월 — C4 품질 리뷰. 키보드 포커스 링을 브라우저 기본값(대개 파랑)에 맡기면
   * "색은 파비콘에서만 나온다"(DESIGN_SPEC 1장)는 무채색 제약이 깨진다.
   */
  it('키보드 포커스 링을 무채색 토큰으로 못박는다 (:focus-visible 1규칙)', () => {
    expect(globalsCss).toMatch(/:focus-visible\s*\{/);
    expect(globalsCss).toMatch(/outline:\s*2px solid var\(--color-ink\);/);
    expect(globalsCss).toMatch(/outline-offset:\s*2px;/);
    // :focus 가 아니라 :focus-visible 이어야 마우스 클릭에는 링이 뜨지 않는다.
    expect(globalsCss).not.toMatch(/(^|[^-\w:]):focus\s*\{/m);
  });
});

describe('루트 레이아웃 (app/layout.tsx)', () => {
  it('metadata가 실제 제품 값이다', () => {
    expect(metadata.title).toBe('내 링크');
    expect(metadata.description).toBe('사내 구성원이 자주 쓰는 링크를 한곳에서 찾는 대시보드');
  });

  it('한국어 문서로 선언하고 Pretendard CDN을 preconnect 후 불러온다', () => {
    expect(layoutSource).toContain('lang="ko"');
    expect(layoutSource).toContain(
      'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css',
    );
    expect(layoutSource).toMatch(/rel="preconnect"[\s\S]*?href="https:\/\/cdn\.jsdelivr\.net"/);
  });

  it('스캐폴드 잔재(Geist 폰트)를 쓰지 않는다', () => {
    expect(layoutSource).not.toContain('Geist');
  });
});
