// @vitest-environment node
// 서버 전용 헬퍼라 DOM 이 필요 없다 — jsdom 을 띄우지 않는다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServerClient } from '@supabase/ssr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_EMAIL } from '@/lib/admin-config';
import { getAdminSession } from '@/lib/supabase/server';

// 실제 Supabase 왕복은 scripts/create-admin.ts 의 로그인 실검증이 맡는다.
// 여기서는 "무엇을 물어보고 무엇을 돌려주는지"만 본다 — 특히 getUser 인지 getSession 인지.
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));

/** getUser 가 줄 응답을 정해 두고 클라이언트를 갈아 끼운다. getSession 은 호출 여부를 감시만 한다. */
function stubAuth(getUserResult: unknown) {
  const getUser = vi.fn(async () => getUserResult);
  const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));

  vi.mocked(createServerClient).mockReturnValue({ auth: { getUser, getSession } } as never);

  return { getUser, getSession };
}

const AUTH_ERROR = { message: 'Auth session missing!', code: 'session_not_found' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon-key';
});

describe('getAdminSession', () => {
  it('로그인한 사용자면 id·이메일 요약을 준다', async () => {
    stubAuth({ data: { user: { id: 'user-1', email: 'contact@itconnect.dev' } }, error: null });

    await expect(getAdminSession()).resolves.toEqual({
      userId: 'user-1',
      email: 'contact@itconnect.dev',
    });
  });

  it('토큰·리프레시 토큰은 요약에 담기지 않는다', async () => {
    // 요약이 아니라 Session 을 그대로 흘리면 서버 컴포넌트가 클라이언트로 넘길 때
    // 토큰이 HTML 에 박힌다. 키 집합을 고정해 그 회귀를 막는다.
    stubAuth({
      data: {
        user: {
          id: 'user-1',
          email: 'contact@itconnect.dev',
          // 실제 응답에는 이런 필드가 잔뜩 붙어 온다 — 통째로 새어 나가면 안 된다.
          role: 'authenticated',
          app_metadata: { provider: 'email' },
        },
      },
      error: null,
    });

    const session = await getAdminSession();

    expect(Object.keys(session ?? {}).sort()).toEqual(['email', 'userId']);
  });

  it('세션이 없으면 null 이다', async () => {
    stubAuth({ data: { user: null }, error: AUTH_ERROR });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('사용자가 없는데 오류도 없는 응답도 null 로 접는다', async () => {
    // 방어적 분기다. user 가 null 이면 error 유무와 무관하게 로그인이 아니다.
    stubAuth({ data: { user: null }, error: null });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('토큰이 위조·만료라 검증에 실패하면 null 이다 (fail-closed)', async () => {
    stubAuth({ data: { user: null }, error: { message: 'invalid JWT', code: 'bad_jwt' } });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('email 필드가 아예 없는 계정이면 관리자가 아니다', async () => {
    // 전화번호·OAuth 로만 만든 계정은 email 이 없다. 신원을 확인할 수 없으면 통과시키지 않는다.
    stubAuth({ data: { user: { id: 'user-1' } }, error: null });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('email 이 null 로 오는 계정도 관리자가 아니다', async () => {
    // 타입상으로는 `string | undefined` 지만 실제 응답에는 null 이 온다. 타입만 믿지 않는다.
    stubAuth({ data: { user: { id: 'user-1', email: null } }, error: null });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('getSession 이 아니라 getUser 로 판정한다', async () => {
    // 이 프로젝트에서 가장 중요한 인증 회귀 방지선이다. getSession 은 쿠키 속 JWT 를
    // 서명 검증 없이 파싱만 하므로, 그걸로 권한을 정하면 쿠키를 위조한 누구나 관리자가 된다.
    const { getUser, getSession } = stubAuth({
      data: { user: { id: 'user-1', email: 'contact@itconnect.dev' } },
      error: null,
    });

    await getAdminSession();

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('세션은 유효하지만 다른 계정이면 null 이다 (인증됨 ≠ 관리자)', async () => {
    // 이 프로젝트에서 가장 얇은 얼음이었던 자리다. Supabase 프로젝트에 public signup 이
    // 열려 있으면 누구나 스스로 "인증 사용자"가 될 수 있고, 게이트가 getUser() 성공만
    // 보면 그렇게 만든 계정이 그대로 관리자가 된다. 신원까지 봐야 한다.
    stubAuth({ data: { user: { id: 'attacker-1', email: 'someone-else@example.com' } }, error: null });

    await expect(getAdminSession()).resolves.toBeNull();
  });

  it('관리자 이메일의 대소문자가 달라도 통과한다', async () => {
    // 이메일 로컬파트는 대소문자를 구분할 수 있지만 Supabase 는 소문자로 저장한다.
    // 저장 정책이 바뀌어도 관리자가 잠기지 않도록 접어서 비교한다.
    stubAuth({ data: { user: { id: 'user-1', email: 'Contact@ITConnect.DEV' } }, error: null });

    await expect(getAdminSession()).resolves.toEqual({
      userId: 'user-1',
      // 판정만 대소문자를 무시하고, 돌려주는 값은 계정에 저장된 그대로다.
      email: 'Contact@ITConnect.DEV',
    });
  });

  it('관리자 이메일을 흉내 낸 유사 주소는 통과하지 못한다', async () => {
    // 부분일치·접미사 비교로 느슨해지는 회귀를 막는다.
    for (const email of [
      `x${ADMIN_EMAIL}`,
      `${ADMIN_EMAIL}.attacker.com`,
      `${ADMIN_EMAIL} `,
      'contact@itconnect.dev.evil.example',
    ]) {
      stubAuth({ data: { user: { id: 'attacker-1', email } }, error: null });

      await expect(getAdminSession(), `${email} 가 통과했다`).resolves.toBeNull();
    }
  });

  it('anon 키로 붙는다 — service role 키를 쓰지 않는다', async () => {
    // service role 로 붙으면 RLS 가 통째로 무력화된다. 관문이 쓰는 키는 anon 이어야 한다.
    stubAuth({ data: { user: null }, error: AUTH_ERROR });

    await getAdminSession();

    expect(createServerClient).toHaveBeenCalledWith(
      'https://stub.supabase.co',
      'stub-anon-key',
      expect.anything(),
    );
  });
});

/**
 * 세션 조회의 **캐시 구조**를 소스에서 잠근다 (test/shell-structure.test.ts 와 같은 방식).
 *
 * 왜 동작 테스트가 아니라 소스 단언인가: React 의 `cache()` 는 React 가 깔아 두는
 * requestStorage 안에서만 산다. Vitest 에는 그 스토리지가 없어 `cache()` 가 **그냥
 * 통과시키는 함수**가 된다(위 테스트들이 한 파일 안에서 매번 다른 스텁 결과를 받는 것이
 * 그 증거다). 그래서 "요청 단위 메모이제이션이 살아 있는가"는 여기서 실행으로 확인할 수
 * 없고, 확인하려 들면 통과하는 가짜 테스트가 된다. 대신 구조가 사라지지 않는지만 지킨다.
 *
 * 특히 마지막 단언(모듈 스코프 메모 금지)은 성능이 아니라 **보안** 잠금이다 —
 * 모듈 레벨 캐시는 요청과 서버 액션을 가로질러 살아남아, 로그아웃 뒤 재렌더에 낡은
 * 세션이 보이게 만들 수 있다. 근거는 `lib/supabase/server.ts` 의 `cache()` 절에 있다.
 */
describe('세션 조회 캐시 구조 (소스 가드)', () => {
  const source = readFileSync(join(process.cwd(), 'lib/supabase/server.ts'), 'utf8');
  // 주석에는 금지 항목의 이름("모듈 레벨 메모")이 그대로 적혀 있어 원문을 검사하면
  // 설명이 위반으로 잡힌다. 블록·줄 주석을 모두 걷어낸 코드만 본다(이 파일에는
  // `//` 를 포함한 URL 문자열이 없어 줄 주석까지 지워도 안전하다).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('react 의 cache 를 import 한다', () => {
    expect(code).toMatch(/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*'react'/);
  });

  it('getAdminSession export 를 cache() 로 감싼다', () => {
    expect(code).toMatch(/export\s+const\s+getAdminSession\s*=\s*cache\(/);
    // 감싸지 않은 형태로 되돌아가는 회귀를 명시적으로 막는다.
    expect(code).not.toMatch(/export\s+(async\s+)?function\s+getAdminSession\b/);
  });

  it('모듈 스코프 메모를 두지 않는다 — 요청·액션을 가로질러 사는 캐시 금지', () => {
    // 들여쓰기 없는 `let`/`var` = 모듈 최상위 가변 상태. 함수 안의 지역 변수는 걸리지 않는다.
    expect(code).not.toMatch(/^(let|var)\s/m);
    // 손으로 만든 메모 저장소. `cache()` 가 있는데 이게 함께 있으면 둘 중 하나는 거짓이다.
    expect(code).not.toMatch(/new\s+(Map|WeakMap|Set|WeakSet)\s*\(/);
    expect(code).not.toMatch(/globalThis\s*\./);
  });

  it("첫 줄이 `import 'server-only'` 다 — 클라이언트 번들 혼입을 빌드가 막는다", () => {
    // 이 모듈은 요청 쿠키를 읽고 인증을 판정한다. 클라이언트 컴포넌트가 실수로 import 하면
    // 런타임에 이상하게 도는 게 아니라 **빌드가 실패**해야 한다 (lib/supabase/admin.ts 와 같은 장치).
    expect(source.trimStart().startsWith("import 'server-only';")).toBe(true);
  });
});
