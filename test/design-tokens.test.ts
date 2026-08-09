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

describe('디자인 토큰 (app/globals.css)', () => {
  it.each(Object.entries(COLOR_TOKENS))('%s 토큰이 %s 로 정의된다', (token, value) => {
    expect(globalsCss).toMatch(new RegExp(`${token}:\\s*${value};`));
  });

  it('Tailwind v4 @theme 블록으로 토큰을 노출한다', () => {
    expect(globalsCss).toContain('@import "tailwindcss";');
    expect(globalsCss).toMatch(/@theme\s*\{/);
  });

  it('본문 타이포그래피가 DESIGN_SPEC 1장과 같다', () => {
    expect(globalsCss).toMatch(/--font-sans:\s*"Pretendard", system-ui, sans-serif;/);
    expect(globalsCss).toContain('font-variant-numeric: tabular-nums;');
    expect(globalsCss).toContain('-webkit-font-smoothing: antialiased;');
    expect(globalsCss).toMatch(/background:\s*var\(--color-surface\);/);
  });

  it('라이트 모드 전용이므로 다크 모드 블록이 없다', () => {
    expect(globalsCss).not.toContain('prefers-color-scheme');
  });
});

describe('루트 레이아웃 (app/layout.tsx)', () => {
  it('metadata가 실제 제품 값이다', () => {
    expect(metadata.title).toBe('내 링크');
    expect(metadata.description).toBe('사내 구성원이 자주 쓰는 링크를 한곳에서 찾는 대시보드');
  });

  it('한국어 문서로 선언하고 Pretendard CDN을 불러온다', () => {
    expect(layoutSource).toContain('lang="ko"');
    expect(layoutSource).toContain(
      'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css',
    );
  });

  it('스캐폴드 잔재(Geist 폰트)를 쓰지 않는다', () => {
    expect(layoutSource).not.toContain('Geist');
  });
});
