// @vitest-environment node
// 프록시는 요청/응답만 다룬다 — jsdom 을 띄우지 않는다.
import { createServerClient } from '@supabase/ssr';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateSession } from '@/lib/supabase/proxy';
import { config, proxy } from '@/proxy';

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

/**
 * createServerClient 를 갈아 끼우고, 넘겨받은 쿠키 어댑터를 꺼내 준다.
 *
 * `emit` 을 주면 supabase-js 가 토큰을 갱신해 쿠키를 써 내려가는 상황을 흉내 낸다 —
 * 실제 구현도 `getUser()` 안에서 `setAll` 을 부른다.
 */
function stubClient(emit: CookieToSet[] = [], headers: Record<string, string> = {}) {
  let adapter:
    | { getAll: () => unknown; setAll: (c: CookieToSet[], h: Record<string, string>) => void }
    | undefined;

  const getUser = vi.fn(async () => {
    if (emit.length > 0) adapter?.setAll(emit, headers);
    return { data: { user: null }, error: null };
  });

  vi.mocked(createServerClient).mockImplementation((_url, _key, options) => {
    adapter = (options as { cookies: typeof adapter }).cookies;
    return { auth: { getUser } } as never;
  });

  return { getUser, getAdapter: () => adapter };
}

function request(cookies: Record<string, string> = {}) {
  const req = new NextRequest('https://example.com/admin');
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon-key';
});

describe('updateSession', () => {
  it('요청을 통과시킨다 — 리다이렉트하지 않는다', async () => {
    // 가드는 관리 레이아웃(H2/H3)의 몫이다. 프록시가 튕기면 공개 화면까지 로그인으로 간다.
    stubClient();

    const response = await updateSession(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('갱신을 일으키는 getUser 를 부른다', async () => {
    // 이 호출이 빠지면 토큰이 절대 갱신되지 않아 관리자가 한 시간마다 로그아웃된다.
    const { getUser } = stubClient();

    await updateSession(request());

    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('요청 쿠키를 Supabase 로 넘긴다', async () => {
    const { getAdapter } = stubClient();

    await updateSession(request({ 'sb-access-token': 'abc' }));

    expect(getAdapter()?.getAll()).toContainEqual(expect.objectContaining({ name: 'sb-access-token', value: 'abc' }));
  });

  it('갱신된 쿠키가 응답에 실린다', async () => {
    // 응답에 안 실리면 브라우저는 옛 토큰을 계속 보내고, 갱신은 매 요청 헛돈다.
    stubClient([{ name: 'sb-access-token', value: 'refreshed', options: { path: '/' } }]);

    const response = await updateSession(request({ 'sb-access-token': 'stale' }));

    expect(response.cookies.get('sb-access-token')?.value).toBe('refreshed');
  });

  it('갱신된 쿠키가 요청에도 반영된다 — 이어지는 서버 컴포넌트가 새 토큰을 읽는다', async () => {
    const req = request({ 'sb-access-token': 'stale' });
    stubClient([{ name: 'sb-access-token', value: 'refreshed' }]);

    await updateSession(req);

    expect(req.cookies.get('sb-access-token')?.value).toBe('refreshed');
  });

  it('세션 쿠키와 함께 온 캐시 방지 헤더를 응답에 붙인다', async () => {
    // 이걸 버리면 CDN·리버스 프록시가 Set-Cookie 로 세션 토큰이 실린 응답을 캐시해
    // 다른 사용자에게 그대로 내줄 수 있다. supabase-js 가 넘겨 주는 값을 그대로 반영한다.
    stubClient([{ name: 'sb-access-token', value: 'refreshed' }], {
      'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
      Expires: '0',
      Pragma: 'no-cache',
    });

    const response = await updateSession(request());

    expect(response.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, must-revalidate, max-age=0',
    );
    expect(response.headers.get('expires')).toBe('0');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('anon 키로 붙는다 — service role 키가 프록시로 새면 안 된다', async () => {
    stubClient();

    await updateSession(request());

    expect(createServerClient).toHaveBeenCalledWith('https://stub.supabase.co', 'stub-anon-key', expect.anything());
  });
});

describe('루트 proxy.ts (Next 16 파일 컨벤션)', () => {
  it('proxy 함수를 내보낸다', () => {
    // Next 16 은 `middleware` 가 아니라 `proxy` 라는 이름의 export 를 찾는다.
    expect(typeof proxy).toBe('function');
  });

  it('요청을 넘기면 응답이 나온다', async () => {
    stubClient();

    await expect(proxy(request())).resolves.toMatchObject({ status: 200 });
  });

  it('matcher 가 정적 자산을 제외한다', () => {
    // 빠지면 파비콘·이미지 한 장마다 Supabase Auth 왕복이 붙는다.
    const [matcher] = config.matcher;

    expect(matcher).toContain('_next/static');
    expect(matcher).toContain('_next/image');
  });

  it('Discord ingest 경로는 matcher 단계에서 완전히 제외해 getUser 를 호출하지 않는다', async () => {
    // Next 16.3 bundled 문서는 `unstable_doesProxyMatch`라고 쓰지만 실제 package export는 여전히
    // `unstable_doesMiddlewareMatch`다. 프레임워크의 matcher compiler로 실제 배포 판정을 검증한다.
    const { getUser } = stubClient();
    const url = 'https://example.com/api/discord-ingest';
    const matched = unstable_doesMiddlewareMatch({ config, url });

    // 실제 Next dispatcher처럼 match일 때만 proxy를 부른다. HMAC가 틀린 요청도 이 단계에서는 body를
    // 읽지 않으므로, false이면 Supabase Auth outbound가 서명 검사 앞에 끼어들 수 없다.
    if (matched) await proxy(new NextRequest(url));

    expect(matched).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('Discord ingest 하위 path/trailing slash도 제외하지만 다른 API는 그대로 session 갱신 대상이다', () => {
    expect(
      unstable_doesMiddlewareMatch({ config, url: 'https://example.com/api/discord-ingest/' }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: 'https://example.com/api/discord-ingest/extra' }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({ config, url: 'https://example.com/api/ai-search' }),
    ).toBe(true);
  });

  it('matcher 가 일반 경로에는 걸리고 정적 자산은 거른다', () => {
    // Next 는 matcher 를 경로 **전체**에 맞춘다. 문자열 자체에는 앵커가 없으므로
    // 여기서 붙여 줘야 실제 동작과 같아진다(안 붙이면 부분 일치라 전부 통과한다).
    const pattern = new RegExp(`^${config.matcher[0]}$`);

    expect(pattern.test('/admin')).toBe(true);
    expect(pattern.test('/')).toBe(true);
    expect(pattern.test('/category/abc')).toBe(true);
    expect(pattern.test('/api/ai-search')).toBe(true);

    expect(pattern.test('/api/discord-ingest')).toBe(false);
    expect(pattern.test('/api/discord-ingest/')).toBe(false);
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
    expect(pattern.test('/_next/image')).toBe(false);
    expect(pattern.test('/logo.png')).toBe(false);
    expect(pattern.test('/favicon.ico')).toBe(false);
  });
});
