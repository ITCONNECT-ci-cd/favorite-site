/**
 * 관리 주소 잠금 — 값 셋과 **모듈의 중립성**을 함께 지킨다.
 *
 * 값은 서버 액션의 redirect·로그인 화면 표기·상단 탭이 함께 쓰므로 바꾸면 그 셋이 같이 움직여야
 * 한다. 중립성은 그보다 조용히 깨진다: 이 모듈은 **클라이언트 컴포넌트**(AdminShell)가 import
 * 하는데, 여기에 `server-only` 나 env 를 읽는 코드가 한 줄만 들어와도 그 셸의 빌드가 무너진다.
 * 소스에 import 문이 하나도 없다는 사실이 그 사고를 애초에 불가능하게 만든다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ADMIN_CLEANUP_PATH, ADMIN_PATH, ADMIN_STATS_PATH } from '@/lib/routes';

/** 주석은 걷어낸다 — 규칙을 설명하는 주석 속 `import` 글자가 위반으로 잡히면 안 된다. */
const source = readFileSync(join(process.cwd(), 'lib/routes.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('lib/routes.ts — 관리 주소', () => {
  it('탭 3개가 가리키는 주소가 계약대로다', () => {
    expect(ADMIN_PATH).toBe('/admin');
    expect(ADMIN_STATS_PATH).toBe('/admin/stats');
    expect(ADMIN_CLEANUP_PATH).toBe('/admin/cleanup');
  });

  it('아무것도 import 하지 않고 환경변수도 읽지 않는다 — 클라이언트가 끌어가는 모듈이다', () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/process\.env/);
  });
});
