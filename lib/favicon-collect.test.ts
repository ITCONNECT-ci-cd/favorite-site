// @vitest-environment node
// 서버 액션만 다룬다 — DOM 이 필요 없다(lib/mutations.test.ts 와 같은 이유).
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectFavicon } from '@/lib/favicon-collect';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getAdminSession } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ getAdminSession: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }));

/** 소스는 이 파일 기준으로 읽는다 — Windows 에서 cwd 드라이브 문자가 흔들린 이력(lib/mutations.test.ts). */
const source = readFileSync(new URL('./favicon-collect.ts', import.meta.url), 'utf8');
/** 주석은 걷어낸다 — 규칙을 설명하는 주석 자체가 통과 근거가 되면 안 된다. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const seedSource = readFileSync(new URL('../scripts/collect-favicons.ts', import.meta.url), 'utf8');

/** 진짜 PNG 앞 8바이트 + 아무 내용. 매직 넘버 판정이 이 바이트를 본다. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = new Uint8Array([0x00, 0x00, 0x01, 0x00, 1, 0, 0, 0]);
const HTML = new TextEncoder().encode('<!doctype html><html><body>not an icon</body></html>');

const PUBLIC_BASE = 'https://proj.supabase.co/storage/v1/object/public/favicons';

type Reply = { status: number; body?: Uint8Array } | Error;

/** 바깥으로 나간 주소를 순서대로 기록하는 fetch 대역. */
function stubFetch(handler: (url: string) => Reply): string[] {
  const calls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);

      const reply = handler(url);
      if (reply instanceof Error) throw reply;

      // `.buffer` 로 넘긴다 — Uint8Array 도 런타임상 유효한 본문이지만 TS 의 `BodyInit` 은
      // ArrayBufferLike 를 가진 뷰를 받지 않는다.
      return new Response(reply.body === undefined ? null : (reply.body.buffer as ArrayBuffer), {
        status: reply.status,
      });
    }),
  );

  return calls;
}

/** 무엇을 물어보든 PNG 하나를 주는 대역(첫 시도에서 끝난다). */
function alwaysPng(): string[] {
  return stubFetch(() => ({ status: 200, body: PNG }));
}

type Upload = { path: string; body: unknown; options: unknown };

/**
 * service role 클라이언트 대역. **`from` 은 테이블 접근 감시자다** — 이 모듈은 Storage 만
 * 만져야 하므로, 이 스파이가 불렸다면 그 자체가 계약 위반이다.
 */
function stubAdminClient(uploadError: { message: string } | null = null) {
  const uploads: Upload[] = [];
  const buckets: string[] = [];
  const table = vi.fn();

  vi.mocked(createAdminSupabaseClient).mockReturnValue({
    from: table,
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);

        return {
          upload: async (path: string, body: unknown, options: unknown) => {
            uploads.push({ path, body, options });

            return { data: uploadError === null ? { path } : null, error: uploadError };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `${PUBLIC_BASE}/${path}` } }),
        };
      },
    },
  } as unknown as ReturnType<typeof createAdminSupabaseClient>);

  return { uploads, buckets, table };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'user-1', email: 'admin@example.test' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('collectFavicon — 관문', () => {
  it('로그인하지 않았으면 바깥으로 아무 요청도 내보내지 않는다', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
    const calls = alwaysPng();
    stubAdminClient();

    expect(await collectFavicon('https://perplexity.ai/')).toEqual({
      ok: false,
      error: '로그인이 필요합니다.',
    });
    expect(calls).toEqual([]);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it.each([
    ['javascript 스킴', 'javascript:alert(1)'],
    ['메일 주소', 'mailto:a@b.c'],
    ['주소가 아닌 글자', '그냥 글자'],
    ['빈 문자열', ''],
  ])('%s 는 네트워크에 나가기 전에 걸러낸다', async (_label, value) => {
    const calls = alwaysPng();
    stubAdminClient();

    expect(await collectFavicon(value)).toEqual({
      ok: false,
      error: '주소를 해석할 수 없어 파비콘을 건너뜁니다.',
    });
    expect(calls).toEqual([]);
  });

  it('문자열이 아닌 인자도 그 자리에서 거절한다 (서버 액션은 공개 엔드포인트다)', async () => {
    alwaysPng();
    stubAdminClient();

    expect(await collectFavicon(42 as unknown as string)).toEqual({
      ok: false,
      error: '주소를 해석할 수 없어 파비콘을 건너뜁니다.',
    });
  });
});

describe('collectFavicon — 수집 사슬 (B4 scripts/collect-favicons.ts 에서 옮겨 왔다)', () => {
  it('구글 s2 에서 받으면 거기서 끝낸다', async () => {
    const calls = alwaysPng();
    stubAdminClient();

    const result = await collectFavicon('https://www.perplexity.ai/search');

    expect(result).toEqual({ ok: true, faviconUrl: `${PUBLIC_BASE}/perplexity.ai.png` });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('https://www.google.com/s2/favicons?domain=perplexity.ai&sz=64');
  });

  it('s2 가 404 면 상위 도메인 → faviconV2 → 사이트 직접 순으로 내려간다', async () => {
    const calls = stubFetch((url) => (url.endsWith('/favicon.ico') ? { status: 200, body: PNG } : { status: 404 }));
    stubAdminClient();

    const result = await collectFavicon('https://jules.google.com/task/1');

    expect(result).toEqual({ ok: true, faviconUrl: `${PUBLIC_BASE}/jules.google.com.png` });
    expect(calls).toEqual([
      'https://www.google.com/s2/favicons?domain=jules.google.com&sz=64',
      'https://www.google.com/s2/favicons?domain=google.com&sz=64',
      'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=64&url=https%3A%2F%2Fjules.google.com',
      'https://jules.google.com/favicon.ico',
    ]);
  });

  it('상위 도메인에서 찾으면 브랜드 아이콘으로 근사한다', async () => {
    const calls = stubFetch((url) => (url.includes('domain=google.com') ? { status: 200, body: PNG } : { status: 404 }));
    stubAdminClient();

    expect(await collectFavicon('https://a.b.google.com/')).toEqual({
      ok: true,
      faviconUrl: `${PUBLIC_BASE}/a.b.google.com.png`,
    });
    // `a.b.google.com` → `b.google.com` → `google.com` 순으로 한 겹씩 벗긴다.
    expect(calls[1]).toContain('domain=b.google.com');
    expect(calls[2]).toContain('domain=google.com');
  });

  it('404 는 다시 묻지 않는다 — "없다"는 확정 답이다', async () => {
    const calls = stubFetch(() => ({ status: 404 }));
    stubAdminClient();

    await collectFavicon('https://nowhere.example/');

    // s2 · v2 · 사이트 각 1회씩(상위 도메인은 라벨이 둘뿐이라 없다).
    expect(calls).toHaveLength(3);
  });

  it('일시적 오류(500)는 한 번 더 물어본다', async () => {
    let asked = 0;
    const calls = stubFetch(() => {
      asked += 1;

      return asked === 1 ? { status: 500 } : { status: 200, body: PNG };
    });
    stubAdminClient();

    expect(await collectFavicon('https://flaky.example/')).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('사설망·로컬 주소에는 직접 붙지 않는다', async () => {
    const calls = stubFetch(() => ({ status: 404 }));
    stubAdminClient();

    await collectFavicon('http://192.168.0.10:3000/admin');

    // 구글에 물어보는 것은 우리 서버가 아니라 구글이 붙는 일이라 그대로 둔다.
    expect(calls.some((url) => url.startsWith('http://192.168.0.10'))).toBe(false);
  });

  it('전부 실패하면 사용자 문구를 돌려주고 업로드는 시도하지 않는다', async () => {
    stubFetch(() => new Error('getaddrinfo ENOTFOUND'));
    const { uploads } = stubAdminClient();

    expect(await collectFavicon('https://nowhere.example/')).toEqual({
      ok: false,
      error: '파비콘을 찾지 못했습니다.',
    });
    expect(uploads).toEqual([]);
  });

  it('실패 사유는 서버 로그에만 남는다 (사용자 문구에 섞지 않는다)', async () => {
    stubFetch(() => ({ status: 404 }));
    stubAdminClient();

    const result = await collectFavicon('https://nowhere.example/');

    expect(result).toEqual({ ok: false, error: '파비콘을 찾지 못했습니다.' });
    expect(console.warn).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain('404');
  });
});

describe('collectFavicon — 받은 바이트 검사 (B4 와 같은 규칙)', () => {
  it('이미지가 아닌 응답은 파비콘으로 치지 않는다', async () => {
    const { uploads } = stubAdminClient();
    stubFetch(() => ({ status: 200, body: HTML }));

    expect(await collectFavicon('https://spa.example/')).toEqual({
      ok: false,
      error: '파비콘을 찾지 못했습니다.',
    });
    expect(uploads).toEqual([]);
  });

  it('빈 응답도 버린다', async () => {
    stubAdminClient();
    stubFetch(() => ({ status: 200, body: new Uint8Array(0) }));

    expect(await collectFavicon('https://empty.example/')).toMatchObject({ ok: false });
  });

  it('파비콘이라기엔 말이 안 되는 크기는 버린다 (1MB 초과)', async () => {
    stubAdminClient();
    const huge = new Uint8Array(1_000_001);
    huge.set(PNG.subarray(0, 8));
    stubFetch(() => ({ status: 200, body: huge }));

    expect(await collectFavicon('https://huge.example/')).toMatchObject({ ok: false });
  });

  it('확장자와 Content-Type 은 실제 바이트가 정한다', async () => {
    const { uploads } = stubAdminClient();
    stubFetch(() => ({ status: 200, body: ICO }));

    expect(await collectFavicon('https://icons.example/')).toEqual({
      ok: true,
      faviconUrl: `${PUBLIC_BASE}/icons.example.ico`,
    });
    expect(uploads[0].options).toMatchObject({ contentType: 'image/x-icon' });
  });
});

describe('collectFavicon — Storage 업로드', () => {
  it('키는 host 기반이고 upsert 로 덮어쓴다 (같은 사이트는 파일 하나)', async () => {
    const { uploads, buckets } = stubAdminClient();
    alwaysPng();

    await collectFavicon('https://www.notion.so/team/abc');

    expect(buckets).toEqual(['favicons']);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe('notion.so.png');
    expect(uploads[0].options).toMatchObject({ upsert: true, contentType: 'image/png' });
  });

  it('키에 쓸 수 없는 글자는 바꿔 둔다 (IPv6 리터럴 등)', async () => {
    const { uploads } = stubAdminClient();
    stubFetch((url) => (url.includes('google') || url.includes('gstatic') ? { status: 200, body: PNG } : { status: 404 }));

    await collectFavicon('http://[2001:db8::1]/');

    expect(uploads[0].path).toMatch(/^[a-z0-9.-]+\.png$/);
  });

  it('업로드가 실패하면 저장 실패로 알린다', async () => {
    const { uploads } = stubAdminClient({ message: 'Bucket not found' });
    alwaysPng();

    expect(await collectFavicon('https://perplexity.ai/')).toEqual({
      ok: false,
      error: '파비콘을 저장하지 못했습니다.',
    });
    expect(uploads).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('버킷 이름은 시드(B4)가 쓰는 것과 같다', () => {
    // 이름이 갈라지면 관리자가 올린 파비콘만 아무도 읽지 않는 버킷에 쌓인다.
    expect(seedSource).toMatch(/FAVICON_BUCKET\s*=\s*'favicons'/);
    expect(code).toMatch(/'favicons'/);
  });
});

/**
 * **이중 방어 계약** — service role 은 RLS 를 통째로 우회한다. 이 모듈이 그 키로 할 수 있는 일을
 * Storage 업로드 하나로 묶어 두는 것이, 관문(`getAdminSession`)에 구멍이 생겼을 때 남는 마지막 벽이다.
 * 테이블 쓰기는 로그인 사용자 자격으로 나가는 `lib/mutations.ts` 의 몫이다.
 */
describe('service role 의 사용 범위 — Storage 뿐 (테이블 금지)', () => {
  it('성공 경로에서도 테이블에는 손대지 않는다', async () => {
    const { table } = stubAdminClient();
    alwaysPng();

    await collectFavicon('https://perplexity.ai/');

    expect(table).not.toHaveBeenCalled();
  });

  it('`.from(` 은 전부 `.storage` 를 거친다 (소스)', () => {
    const callers = [...code.matchAll(/([\w.)\]]*)\.from\s*\(/g)].map((match) => match[1]);

    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) expect(caller).toMatch(/storage$/);
  });

  it('행을 쓰는 호출이 소스에 없다', () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    // 쓰기 액션을 끌어와 우회하는 길도 막는다 — 그건 화면이 따로 부른다.
    //
    // 형태는 H4(`lib/mutations.test.ts` 의 service role 스캔)와 같다. `from '…'` 하나만 보면
    // 동적 `import('@/lib/mutations')` 와 `require('…')` 가 통째로 빠져나가는데, ESLint 의
    // no-restricted-imports 는 **정적 import 만** 본다(H4 교훈). 그 구멍은 이 정규식 몫이다.
    // 경로 앞을 `[^'"]*` 로 연 것은 `@/lib/mutations` 든 `../lib/mutations` 든 같은 모듈이기 때문.
    expect(code).not.toMatch(/(?:from|import\s*\(|require\s*\()\s*['"][^'"]*lib\/mutations['"]/);
  });

  it("첫 줄이 'use server' 다 — 이게 빠지면 화면에서 부를 수 없는 그냥 서버 함수가 된다", () => {
    // H4 가 `lib/mutations.ts` 에 세운 것과 같은 단언. 지시문은 파일 맨 위여야 하고,
    // 위쪽에 JSDoc 블록을 얹다가 한 줄 밀리면 조용히 서버 액션이 아니게 된다.
    expect(source.split('\n')[0]).toBe("'use server';");
  });

  it('관문이 함수의 첫 줄이다 (소스)', () => {
    expect(code).toMatch(
      /export async function collectFavicon\([^)]*\)[^{]*\{\s*if \(\(await getAdminSession\(\)\) === null\)/,
    );
  });
});
