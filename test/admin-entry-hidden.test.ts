import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 공개 화면에는 `/admin` 으로 가는 길이 없다 (PRD·계획서 H2).
 *
 * 관리 화면은 주소를 아는 사람만 들어간다. 사이드바나 헤더에 '관리자' 링크가 하나 생기면
 * 사내 구성원 전원에게 "여기 관리 화면이 있다"고 알리는 셈이고, 그건 이 제품이 하지 않기로
 * 한 선택이다. 링크는 무심코 추가되기 쉬워서(푸터·설정 메뉴·빠른 이동) 소스에서 잠근다.
 *
 * 인증 자체는 이 테스트가 지키는 것이 아니다 — 링크가 없어도 `/admin` 은 열리고, 그 문을
 * 지키는 것은 `app/admin/layout.tsx` 의 `getAdminSession()` 이다. 여기서 막는 것은 **노출**이다.
 *
 * ## 이 테스트가 못 잡는 것
 *
 * 소스 문자열 검사라 한계가 분명하다. 외부 절대 URL(`https://…/admin`)도, 문자열을 쪼개
 * 만든 주소(`'/ad' + 'min'`)도, 변수로 조립한 경로도 잡지 못한다. 잡으려는 대상은 그런
 * 우회가 아니라 **무심코 추가되는 평범한 링크**다 — 그것만으로 충분한 이유는 이 규칙을
 * 어기는 쪽이 숨기려는 사람이 아니라 친절을 베풀려는 사람이기 때문이다.
 */
const ROOT = process.cwd();

/**
 * 관리 라우트 자신을 뺀 **앱 소스 전부**를 본다.
 *
 * 예전에는 `app/(public)` 만 봤다. 그러면 그룹 밖(루트 레이아웃·404·API 라우트)에 링크가
 * 생겨도 조용히 통과한다 — 실제로 H2 가 셸을 `(public)` 으로 내리면서 루트 레이아웃이
 * 스캔 범위 밖으로 빠졌다. 범위는 "공개 그룹"이 아니라 "관리 화면이 아닌 곳"이어야 한다.
 */
const SCAN_ROOTS = ['app', 'components'];

/** 관리 화면 자신 — 여기에는 당연히 `/admin` 이 적혀 있다. 디렉터리 재귀에서 통째로 뺀다. */
const EXCLUDED = ['app/admin', 'components/admin'];

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(join(ROOT, dir), { withFileTypes: true });

  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (EXCLUDED.includes(path)) return [];
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];

    return [path];
  });
}

/**
 * 링크로 쓰인 `/admin` 만 고른다 — **따옴표 바로 뒤**에서 시작하고 경로 경계로 끝나는 것.
 *
 * 단순히 `/admin` 이 들어 있는지 보면 `import … from '@/lib/supabase/admin'` 같은 모듈
 * 지정자가 걸린다(실제로 `app/api/click/route.ts` 가 그렇게 오탐됐다 — 스캔 범위를 app 전체로
 * 넓히자마자 드러났다). 모듈 지정자는 `/admin` 앞에 따옴표가 아니라 경로 조각이 붙어 있다.
 *
 * 잡는 것: `href="/admin"`, `'/admin/stats'`, `` `/admin?tab=1` ``, `'/admin#x'`.
 * 안 잡는 것: `'@/lib/supabase/admin'`, `'@/components/admin/LoginForm'`.
 */
const ADMIN_ROUTE = /["'`]\/admin(?=["'`/?#])/;

/** 주석은 걷어낸다 — "여기에는 /admin 링크를 두지 않는다"는 설명이 위반으로 잡히면 안 된다. */
function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('공개 화면에 /admin 진입점이 없다', () => {
  const files = SCAN_ROOTS.flatMap(sourceFiles);

  it('훑을 파일을 실제로 찾았다 (경로가 어긋나면 조용히 통과한다)', () => {
    // 라우트 그룹 이동처럼 경로가 바뀌는 일이 또 있을 수 있다. 0개면 이 테스트는 무의미하다.
    // 개수 임계값은 느슨하게 두고(파일은 늘고 줄어든다), 대신 **반드시 있어야 할 파일**을
    // 이름으로 못박는다 — 셸 둘 중 하나라도 목록에서 빠졌다면 스캔이 새고 있는 것이다.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('app/layout.tsx');
    expect(files).toContain('app/(public)/layout.tsx');
    expect(files).toContain('components/Sidebar.tsx');
  });

  it('관리 화면 자신은 훑지 않는다 (그쪽에는 당연히 /admin 이 있다)', () => {
    expect(files.filter((path) => path.startsWith('app/admin/'))).toEqual([]);
    expect(files.filter((path) => path.startsWith('components/admin/'))).toEqual([]);
  });

  it.each(SCAN_ROOTS)('%s 아래 어디에도 /admin 링크가 없다', (root) => {
    const offenders = files
      .filter((path) => path.startsWith(root))
      .filter((path) => ADMIN_ROUTE.test(code(path)));

    expect(offenders.map((path) => relative('.', path))).toEqual([]);
  });

  /**
   * 상수를 거친 우회도 막는다 — 관리 주소 상수는 관리 화면만 가져다 쓴다.
   *
   * 위 리터럴 검사는 `'/admin'` 이 소스에 적힌 것만 본다. `lib/routes.ts` 가 그 주소를
   * 상수로 내놓은 뒤로는 `href={ADMIN_PATH}` 한 줄이면 리터럴 없이 링크가 생긴다 — 검사는
   * 초록인데 공개 화면에 진입점이 선다. 3단계 J 계열이 공개 트리에 관리자용 UI 를 얹고 있는
   * 지금이 그 실수가 가장 나기 쉬운 시점이라, 위반이 0인 채로 미리 잠근다.
   *
   * 이름으로 보는 이유: 상수는 `import { ADMIN_PATH } from '@/lib/routes'` 로 들어오므로
   * 모듈 지정자가 아니라 식별자를 찾는 것이 정확하다. 관리 화면 자신은 애초에 SCAN 대상이
   * 아니라 이 규칙에 걸리지 않는다.
   */
  it('공개 소스가 lib/routes 의 관리 주소 상수를 쓰지 않는다', () => {
    const offenders = files.filter((path) =>
      /ADMIN_(PATH|STATS_PATH|CLEANUP_PATH)/.test(code(path)),
    );

    expect(offenders.map((path) => relative('.', path))).toEqual([]);
  });

  /** 매처 자신의 회귀 방지 — 오탐(모듈 지정자)과 미탐(링크) 양쪽을 한 번에 잠근다. */
  it.each([
    ['href="/admin"', true],
    ["'/admin/stats'", true],
    ['`/admin?tab=1`', true],
    ["'/admin#top'", true],
    ["'@/lib/supabase/admin'", false],
    ["'@/components/admin/LoginForm'", false],
  ] as const)('%s → 링크로 판정: %s', (source, expected) => {
    expect(ADMIN_ROUTE.test(source)).toBe(expected);
  });
});
