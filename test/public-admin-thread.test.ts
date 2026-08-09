import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 공개 화면은 **하나도 빠짐없이** 서버에서 관리자 세션을 읽어 화면에 내려보낸다 (J1).
 *
 * 연필·휴지통은 서버가 관리자로 확인했을 때만 **렌더된다**(README 주의사항 7). 그 판정은
 * `getAdminSession()`(H1) 한 곳에서만 하고, 결과는 `isAdmin` boolean 하나로 화면에 건너간다.
 * 화면마다 각자 배선하는 구조라, 새 화면을 추가하며 이 두 줄을 빠뜨리면 **아무것도 깨지지
 * 않은 채** 그 화면에서만 관리자가 편집 도구를 잃는다. 조용한 실패라서 소스에서 잠근다.
 *
 * 화면별 동작 테스트(`app/(public)/**‍/page.test.tsx`)는 각자 자기 화면만 본다 — 새로 생긴
 * 화면에 테스트가 없으면 그 누락도 함께 사라진다. 이 파일은 반대로 **디렉터리를 훑어**
 * page.tsx 를 찾아내므로, 테스트를 안 쓴 새 화면이 오히려 여기서 걸린다.
 *
 * ## 이 테스트가 못 잡는 것
 *
 * 소스 문자열 검사라 "부르고 넘겼다"까지만 본다. 받은 값을 화면이 실제로 쓰는지, 그 화면이
 * 카드를 그리기는 하는지는 보지 못한다 — 그건 화면별 테스트의 몫이다. 노리는 것은 우회가
 * 아니라 **깜빡 잊은 배선**이다.
 *
 * 편집 도구를 그릴 이유가 없는 공개 화면(카드가 없는 안내 페이지 등)이 생긴다면, 이 규칙을
 * 느슨하게 만들지 말고 아래 EXCLUDED 에 이름을 적고 왜인지를 함께 남겨라. 침묵이 아니라
 * 명시적 예외여야 다음 사람이 판단할 수 있다.
 */
const ROOT = process.cwd();

/** 공개 라우트 그룹. `(public)` 은 URL 에 나타나지 않는다(H2). */
const PUBLIC_ROOT = 'app/(public)';

/** 세션 배선이 면제된 화면 — 지금은 없다. 추가할 때는 반드시 이유를 옆에 적어라. */
const EXCLUDED: string[] = [];

/**
 * 반드시 이 목록에 있어야 할 화면 넷 (카나리).
 *
 * 라우트 그룹 이동처럼 경로가 통째로 바뀌면 재귀가 0건을 돌려주고, 그러면 아래 단언들은
 * 빈 배열 위에서 조용히 통과한다. 개수 임계값만으로는 그 사고를 못 잡으므로 이름을 못박는다.
 */
const KNOWN_PAGES = [
  `${PUBLIC_ROOT}/page.tsx`,
  `${PUBLIC_ROOT}/category/[id]/page.tsx`,
  `${PUBLIC_ROOT}/daily/page.tsx`,
  `${PUBLIC_ROOT}/favorites/page.tsx`,
];

function pageFiles(dir: string): string[] {
  const entries = readdirSync(join(ROOT, dir), { withFileTypes: true });

  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (EXCLUDED.includes(path)) return [];
    if (entry.isDirectory()) return pageFiles(path);

    return entry.name === 'page.tsx' ? [path] : [];
  });
}

/**
 * 주석은 걷어낸다 — 공개 화면의 JSDoc 에는 `getAdminSession` · `isAdmin` 이 **설명으로**
 * 여러 번 등장한다(홈 page.tsx 가 그 근거를 대표로 적어 두고 나머지가 그것을 가리킨다).
 * 원문을 그대로 보면 "설명만 적고 배선은 안 한" 화면이 통과해 버려 검사가 무의미해진다.
 */
function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** 게이트를 실제로 **부른다** — 이름만 import 한 것과 구별하려고 여는 괄호까지 본다. */
const CALLS_GATE = /\bgetAdminSession\s*\(/;

/** 그 게이트가 H1 의 것이어야 한다 — 같은 이름의 지역 함수를 만들어 통과하지 못하게. */
const IMPORTS_GATE =
  /import\s*\{[^}]*\bgetAdminSession\b[^}]*\}\s*from\s*['"]@\/lib\/supabase\/server['"]/;

/** 결과를 화면으로 넘긴다 — prop 이름은 `isAdmin` 하나로 고정한다(카드까지 그 이름으로 간다). */
const PASSES_IS_ADMIN = /\bisAdmin=\{/;

/**
 * 화면이 스스로 관리자 여부를 판정하면 안 된다 — 판정은 게이트 한 곳뿐이라는 계약
 * (lib/supabase/server.ts 의 getAdminSession JSDoc "모든 관리 진입점의 유일한 인증 관문").
 */
const SELF_JUDGES = /\bADMIN_EMAIL\b|\bauth\.getUser\s*\(|\bgetSession\s*\(/;

describe('공개 화면은 모두 관리자 세션을 배선한다 (J1)', () => {
  const pages = pageFiles(PUBLIC_ROOT);

  it('훑을 화면을 실제로 찾았다 (경로가 어긋나면 조용히 통과한다)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(KNOWN_PAGES.length);
    for (const known of KNOWN_PAGES) expect(pages).toContain(known);
  });

  it.each(KNOWN_PAGES)('%s 가 스캔 대상에 들어 있다', (path) => {
    expect(pages).toContain(path);
  });

  it.each(pages)('%s 가 getAdminSession() 을 부른다', (path) => {
    expect(CALLS_GATE.test(code(path))).toBe(true);
  });

  it.each(pages)('%s 의 getAdminSession 은 H1 의 그것이다', (path) => {
    expect(IMPORTS_GATE.test(code(path))).toBe(true);
  });

  it.each(pages)('%s 가 결과를 isAdmin 으로 화면에 넘긴다', (path) => {
    expect(PASSES_IS_ADMIN.test(code(path))).toBe(true);
  });

  it.each(pages)('%s 는 관리자 판정을 스스로 하지 않는다', (path) => {
    expect(SELF_JUDGES.test(code(path))).toBe(false);
  });

  /** 매처 자신의 회귀 방지 — 오탐·미탐 양쪽을 한 번에 잠근다. */
  it.each([
    ['const session = await getAdminSession();', true],
    ['await Promise.all([getAllData(), getAdminSession()])', true],
    ["import { getAdminSession } from '@/lib/supabase/server';", false],
  ] as const)('호출 판정: %s → %s', (source, expected) => {
    expect(CALLS_GATE.test(source)).toBe(expected);
  });

  it.each([
    ["import { getAdminSession } from '@/lib/supabase/server';", true],
    ["import { getAllData } from '@/lib/queries';\nimport { getAdminSession } from '@/lib/supabase/server';", true],
    ["import { getAdminSession } from './fake-gate';", false],
    ['async function getAdminSession() { return null; }', false],
  ] as const)('출처 판정: %s → %s', (source, expected) => {
    expect(IMPORTS_GATE.test(source)).toBe(expected);
  });

  it.each([
    ['<HomeView data={data} isAdmin={session !== null} />', true],
    ['isAdmin={false}', true],
    ['<HomeView data={data} />', false],
    ['const isAdmin = session !== null;', false],
  ] as const)('전달 판정: %s → %s', (source, expected) => {
    expect(PASSES_IS_ADMIN.test(source)).toBe(expected);
  });
});
