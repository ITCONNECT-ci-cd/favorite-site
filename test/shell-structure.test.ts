import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 셸 뼈대(C1)의 회귀 방지 — DESIGN_SPEC 2장 + 1장(본문 패딩).
 *
 * 두 파일을 나눠 읽는다 (H2 라우트 그룹 분리): 공개 셸은 `app/(public)/layout.tsx` 로
 * 내려갔고, 문서 뼈대(html·body·폰트·Toaster)만 루트 `app/layout.tsx` 에 남았다.
 * `(public)` 은 라우트 그룹이라 URL 에는 나타나지 않는다 — 아래 셸 단언이 지키는 화면의
 * 주소는 예전 그대로다.
 *
 * 레이아웃은 async 서버 컴포넌트고 루트는 `<html>` 을 렌더하므로 RTL 로 마운트할 수 없다.
 * 그래서 design-tokens.test.ts 와 같은 방식으로 **소스 문자열을 검사**한다.
 * 이 방식은 "클래스가 적혀 있다"까지만 보증하고 화면에 실제로 그렇게 그려지는지는 못 본다 —
 * 시각 검증은 시드 투입(B5) 이후 O1 게이트에서 한다(계획서 기록).
 */
const layoutSource = readFileSync(join(process.cwd(), 'app/(public)/layout.tsx'), 'utf8');
const rootLayoutSource = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

/**
 * 주석을 걷어낸 코드만 남긴다.
 *
 * 셸의 주석에는 "주소창(38px)은 만들지 않는다", "revalidate 를 넣지 마라"처럼
 * **하지 않기로 한 것의 이름**이 그대로 적혀 있다. 원문을 그대로 검사하면 금지 항목을 설명한
 * 주석 자체가 위반으로 잡힌다. 블록 주석만 지우면 충분하다 — 줄 주석까지 지우면
 * Pretendard CDN 주소의 `//` 뒤가 함께 날아간다.
 */
const layoutCode = layoutSource.replace(/\/\*[\s\S]*?\*\//g, '');
const rootLayoutCode = rootLayoutSource.replace(/\/\*[\s\S]*?\*\//g, '');

/** JSX 속성 문자열에서 지정한 컴포넌트/태그의 className 을 뽑는다. */
function classNameOf(pattern: RegExp): string {
  const match = layoutCode.match(pattern);
  expect(match, `셸에서 ${pattern} 를 찾지 못했다`).not.toBeNull();

  return match![1];
}

describe('셸 레이아웃 뼈대 (app/(public)/layout.tsx)', () => {
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

  it('revalidate 를 내보내지 않는다 (매 요청 렌더가 의도 — getAllData JSDoc)', () => {
    expect(layoutCode).not.toMatch(/export\s+const\s+revalidate/);
  });
});

/**
 * 라우트 그룹 분리 (H2) — 루트 레이아웃은 **문서 뼈대만** 진다.
 *
 * 셸이 루트에 있으면 `/admin` 이 공개 사이드바 안에 갇힌다. 되돌아가기 쉬운 구조라
 * "루트에 무엇이 없어야 하는가"를 소스 수준에서 잠근다.
 */
describe('루트 레이아웃은 문서 뼈대만 진다 (app/layout.tsx)', () => {
  it('공개 셸을 렌더하지 않는다 — 사이드바·헤더·칩 줄이 없다', () => {
    expect(rootLayoutCode).not.toContain('<aside');
    expect(rootLayoutCode).not.toContain('<header');
    expect(rootLayoutCode).not.toContain('SidebarContainer');
    expect(rootLayoutCode).not.toContain('PaletteHost');
    expect(rootLayoutCode).not.toContain('MobileChips');
  });

  it('데이터를 조회하지 않는다 — 실패할 일이 없어야 문서 뼈대가 항상 선다', () => {
    expect(rootLayoutCode).not.toContain('getAllData');
    expect(rootLayoutCode).not.toContain('@/lib/queries');
  });

  /**
   * 지키는 것은 **h-full 계약**이지 속성을 적은 순서가 아니다. `<html lang="ko" className="h-full">`
   * 전체를 잠그면 `suppressHydrationWarning` 하나만 끼워 넣어도 깨진다 — 계약은 그대로인데
   * 서식 때문에 빨개지는 테스트는 고쳐야 할 곳을 잘못 가리킨다.
   */
  it('html·body 와 h-full 계약을 든다 (셸·로그인 화면이 함께 쓴다)', () => {
    expect(rootLayoutCode).toMatch(/<html[^>]*lang="ko"/);
    expect(rootLayoutCode).toMatch(/<html[^>]*className="[^"]*h-full/);
    expect(rootLayoutCode).toMatch(/<body[^>]*className="[^"]*h-full/);
  });

  it('토스터를 딱 한 번, 루트에서 마운트한다 (관리 화면에서도 토스트가 떠야 한다)', () => {
    expect(rootLayoutCode.match(/<Toaster\s*\/>/g)).toHaveLength(1);
    expect(layoutCode).not.toContain('<Toaster');
  });

  it('공개 셸은 자기 html·body 를 만들지 않는다 (중첩 문서 방지)', () => {
    expect(layoutCode).not.toContain('<html');
    expect(layoutCode).not.toContain('<body');
  });
});

/**
 * 셸 데이터 조회가 실패해도 빈 500 이 아니라 안내 화면이 나가야 한다 (O1 게이트 F-1).
 *
 * 레이아웃의 SSR 실패는 global-error.tsx 가 잡지 못한다 — Next 가 빈 500 셸
 * (`__next_error__`)을 내보내고 클라이언트 청크가 로드되지 않기 때문이다. 그래서 셸이
 * 직접 try/catch 로 잡는데, **이 구조는 지우기 쉬운 종류의 코드**라 소스 수준에서 잠가 둔다.
 *
 * async 서버 컴포넌트라 RTL 로 렌더해 확인할 수 없다. 실제 동작 검증(env 를 지우고
 * 프로덕션 빌드로 재현)은 O1 게이트 보고서에 기록돼 있고, 여기서는 그 구조가 사라지지
 * 않는지만 지킨다.
 */
describe('셸 데이터 조회 실패 대비 (O1 게이트 F-1)', () => {
  it('데이터 조회의 await 를 try/catch 로 감싼다', () => {
    // 감싸는 대상은 **await** 다. 두 왕복을 나란히 띄우게 되면서 `getAllData()` 호출 자체는
    // try 밖으로 나갔고(폭포 제거), 거부가 실제로 터지는 자리는 await 쪽이다.
    expect(layoutCode).toMatch(/try\s*\{[\s\S]*?await\s+dataPromise[\s\S]*?\}\s*catch/);
  });

  it('세션 프라미스는 만드는 즉시 catch 를 단다', () => {
    // 위 오류 경로는 이 프라미스를 await 하지 않고 반환한다 — 핸들러가 없으면 그때
    // unhandled rejection 이 된다. 그래서 `.catch` 가 호출에 바로 붙어 있어야 한다
    // (동작 검증은 app/(public)/layout.test.tsx 의 '둘 다 실패해도 터지지 않는다').
    expect(layoutCode).toMatch(/getAdminSession\(\)\s*\.catch\(/);
  });

  it('세션 왕복을 try 앞에서 띄운다 (폭포 방지 — 본론이 잠겨야 되살아나지 않는다)', () => {
    // 위 두 단언은 **오류 경로의 안전장치**만 본다. 정작 그 구조를 만든 이유인 병렬화는
    // 잠겨 있지 않아, 세션 호출을 try 안으로 되돌려도 둘 다 통과한다 — 그러면 DB 왕복이
    // 끝나야 Auth 왕복이 시작되는 폭포가 조용히 부활하고, 공개 화면 전부가 그 지연을 진다
    // (layout.tsx "서로 무관한 두 왕복을 먼저 둘 다 띄운다").
    // 호출이 아예 사라지는 경우는 바로 위 '.catch' 단언이 잡는다.
    expect(layoutCode.indexOf('getAdminSession()')).toBeLessThan(layoutCode.indexOf('try {'));
  });

  it('실패해도 안내 문구를 내보낸다 (global-error 와 같은 문구)', () => {
    expect(layoutCode).toContain('일시적인 오류가 발생했습니다');
  });

  it('오류 화면이 뷰포트 높이를 혼자 채운다 — 100vh 이지 100% 가 아니다', () => {
    // `100%` 는 조상이 높이를 줘야 성립하는데, 루트의 `h-full` 은 전역 CSS 가 실려야 붙는
    // 클래스다. 그게 없을 때를 대비하는 화면이 그것에 기대면 안 된다(H2 픽스업에서 되돌린 값).
    expect(layoutCode).toMatch(/minHeight:\s*["']100vh["']/);
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
