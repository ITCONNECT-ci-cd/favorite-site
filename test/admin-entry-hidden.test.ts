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
 */
const ROOT = process.cwd();

/** 공개 화면이 실제로 그리는 소스만 본다. 관리 화면 자신과 테스트는 당연히 제외한다. */
const SCAN_ROOTS = ['app/(public)', 'components'];
const EXCLUDED = ['components/admin'];

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
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('app/(public)/layout.tsx');
  });

  it.each(SCAN_ROOTS)('%s 아래 어디에도 /admin 이 적혀 있지 않다', (root) => {
    const offenders = files
      .filter((path) => path.startsWith(root))
      .filter((path) => code(path).includes('/admin'));

    expect(offenders.map((path) => relative('.', path))).toEqual([]);
  });
});
