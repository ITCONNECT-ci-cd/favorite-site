// @vitest-environment node
// 서버 액션만 다루므로 DOM 이 필요 없다 — jsdom 을 띄우지 않는다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DAILY_PIN_MAX } from '@/lib/constants';
import {
  createBookmark,
  createCategory,
  createSubCategory,
  deleteBookmark,
  deleteCategory,
  deleteSubCategory,
  renameCategory,
  renameSubCategory,
  reorderBookmarks,
  reorderCategories,
  togglePin,
  updateBookmark,
  type ActionResult,
} from '@/lib/mutations';
import { createServerSupabaseClient, getAdminSession } from '@/lib/supabase/server';

// 실제 DB 왕복은 하지 않는다 — "무엇을 물어보고 어떤 순서로 쓰는지"와 "무엇을 돌려주는지"만 본다.
// 인증 세션 쿠키가 필요한 실 통합은 H3·I1 의 화면 경유 검증 몫이다(파일 상단 주석 참조).
vi.mock('@/lib/supabase/server', () => ({
  getAdminSession: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const source = readFileSync(join(process.cwd(), 'lib/mutations.ts'), 'utf8');

type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };
type QueryResult = { data: unknown; error: DbError | null };

/** `supabase.from(t)` 한 번 = 연산 하나. 어떤 체인이 걸렸는지 그대로 기록한다. */
type Op = { table: string; calls: { method: string; args: unknown[] }[] };

const BUILDER_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'eq',
  'is',
  'not',
  'order',
  'limit',
  'maybeSingle',
] as const;

/**
 * PostgREST 빌더 흉내. 모든 체인 메서드는 자기 자신을 돌려주고, await 되는 순간
 * `results` 에서 **`from()` 호출 순서대로** 미리 정한 결과를 낸다.
 */
function fakeSupabase(results: QueryResult[]) {
  const ops: Op[] = [];
  let cursor = 0;

  const client = {
    from(table: string) {
      const op: Op = { table, calls: [] };
      ops.push(op);
      const result = results[cursor] ?? { data: [], error: null };
      cursor += 1;

      const builder: Record<string, unknown> = {
        then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(onFulfilled, onRejected),
      };
      for (const method of BUILDER_METHODS) {
        builder[method] = (...args: unknown[]) => {
          op.calls.push({ method, args });

          return builder;
        };
      }

      return builder;
    },
  };

  return { client, ops };
}

/** 로그인 상태 + 미리 정한 DB 응답으로 액션을 돌릴 준비를 한다. */
function signedIn(results: QueryResult[] = []) {
  vi.mocked(getAdminSession).mockResolvedValue({ userId: 'admin-1', email: 'contact@itconnect.dev' });
  const fake = fakeSupabase(results);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fake.client as never);

  return fake;
}

function signedOut() {
  vi.mocked(getAdminSession).mockResolvedValue(null);
}

const OK: QueryResult = { data: [{ id: 'row-1' }], error: null };
const NO_ROWS: QueryResult = { data: [], error: null };

/** 어떤 체인 메서드에 넘긴 인자를 꺼낸다(첫 호출). 없으면 undefined. */
function argsOf(op: Op, method: string): unknown[] | undefined {
  return op.calls.find((call) => call.method === method)?.args;
}

beforeEach(() => {
  vi.clearAllMocks();
  // describeFailure 가 서버 로그에 남기는 진단을 테스트 출력에서 지운다.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ───────────────────────────────────────────────────────────── 계약 · 구조

describe('모듈 계약', () => {
  it('내보내는 액션은 12개이며 이름이 고정돼 있다 (I·J 트랙이 이 이름으로 부른다)', async () => {
    const actions = await import('@/lib/mutations');

    expect(Object.keys(actions).sort()).toEqual(
      [
        'createBookmark',
        'createCategory',
        'createSubCategory',
        'deleteBookmark',
        'deleteCategory',
        'deleteSubCategory',
        'renameCategory',
        'renameSubCategory',
        'reorderBookmarks',
        'reorderCategories',
        'togglePin',
        'updateBookmark',
      ].sort(),
    );
  });

  it("첫 줄이 'use server' 다 — 이게 빠지면 그냥 서버 함수가 되어 화면에서 부를 수 없다", () => {
    expect(source.split('\n')[0]).toBe("'use server';");
  });

  it('service role 클라이언트를 쓰지 않는다 — 세션 없이도 뚫리는 경로를 만들지 않는다', () => {
    // 쓰기는 인증 사용자의 anon+쿠키 클라이언트로만 나간다(RLS authenticated 정책 통과).
    // 주석에는 "왜 안 쓰는지"가 적혀 있으므로 import 줄과 실제 호출·env 접근만 본다.
    const imports = (source.match(/^import .*$/gm) ?? []).join('\n');

    expect(imports).toMatch(/@\/lib\/supabase\/server/);
    expect(imports).not.toMatch(/supabase\/admin/);
    expect(source).not.toMatch(/createAdminSupabaseClient\s*\(/);
    expect(source).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  });
});

// ───────────────────────────────────────────────────────────── 인증 관문

/** 모든 액션 — 미인증 거부를 하나도 빠짐없이 확인하기 위한 목록. */
const ALL_ACTIONS: [string, () => Promise<ActionResult>][] = [
  ['createCategory', () => createCategory('새 분류')],
  ['renameCategory', () => renameCategory('cat-1', '새 이름')],
  ['deleteCategory', () => deleteCategory('cat-1')],
  ['reorderCategories', () => reorderCategories(['cat-1', 'cat-2'])],
  ['createSubCategory', () => createSubCategory('cat-1', '하위')],
  ['renameSubCategory', () => renameSubCategory('sub-1', '새 이름')],
  ['deleteSubCategory', () => deleteSubCategory('sub-1')],
  ['createBookmark', () => createBookmark({ url: 'https://example.com', categoryId: 'cat-1' })],
  ['updateBookmark', () => updateBookmark('bm-1', { title: '새 이름' })],
  ['deleteBookmark', () => deleteBookmark('bm-1')],
  ['reorderBookmarks', () => reorderBookmarks(['bm-1', 'bm-2'])],
  ['togglePin', () => togglePin('bm-1')],
];

describe('인증 관문 — getAdminSession 이 null 이면 아무것도 하지 않는다', () => {
  it.each(ALL_ACTIONS)('%s 는 미인증 호출을 거부한다', async (_name, run) => {
    signedOut();

    await expect(run()).resolves.toEqual({ ok: false, error: '로그인이 필요합니다.' });
  });

  it.each(ALL_ACTIONS)('%s 는 미인증이면 DB 에 붙지도 않는다', async (_name, run) => {
    signedOut();
    await run();

    // RLS 는 2차 방어다. 1차 방어가 뚫려도 DB 가 막아 주지만, 애초에 붙지 않는 편이 맞다.
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('거부 사유를 세분화하지 않는다 — 12개 액션이 모두 같은 문구다', async () => {
    signedOut();
    const messages = new Set<string>();
    for (const [, run] of ALL_ACTIONS) {
      const result = await run();
      if (!result.ok) messages.add(result.error);
    }

    expect([...messages]).toEqual(['로그인이 필요합니다.']);
  });
});

// ───────────────────────────────────────────────────────────── 상위 카테고리

describe('createCategory', () => {
  it('이름을 다듬어 상위(parent_id null)로 넣고, 순서는 맨 뒤에 붙인다', async () => {
    const { ops } = signedIn([{ data: [{ sort_order: 4 }], error: null }, OK]);

    await expect(createCategory('  새 분류  ')).resolves.toEqual({ ok: true });

    expect(ops[0].table).toBe('categories');
    expect(argsOf(ops[0], 'is')).toEqual(['parent_id', null]); // 상위끼리만 보고 max 를 구한다
    expect(argsOf(ops[1], 'insert')).toEqual([{ name: '새 분류', parent_id: null, sort_order: 5 }]);
  });

  it('첫 카테고리는 sort_order 0 이다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await createCategory('처음');

    expect(argsOf(ops[1], 'insert')).toEqual([{ name: '처음', parent_id: null, sort_order: 0 }]);
  });

  it('성공하면 공개 화면을 통째로 갱신한다', async () => {
    signedIn([NO_ROWS, OK]);

    await createCategory('새 분류');

    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('빈 이름·공백만 있는 이름은 DB 를 치기 전에 거부한다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await expect(createCategory('   ')).resolves.toEqual({ ok: false, error: '이름을 입력하세요.' });
    expect(ops).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('이름이 중복되면(23505) 사용자 문구로 바꾼다', async () => {
    signedIn([
      NO_ROWS,
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    ]);

    await expect(createCategory('마케팅')).resolves.toEqual({
      ok: false,
      error: '같은 이름의 카테고리가 이미 있습니다.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('순서 조회가 실패하면 insert 로 넘어가지 않는다', async () => {
    const { ops } = signedIn([{ data: null, error: { message: 'boom', code: '08006' } }]);

    const result = await createCategory('새 분류');

    expect(result.ok).toBe(false);
    expect(ops).toHaveLength(1);
  });
});

describe('renameCategory', () => {
  it('상위 카테고리의 이름만 바꾼다', async () => {
    const { ops } = signedIn([OK]);

    await expect(renameCategory('cat-1', '  바뀐 이름 ')).resolves.toEqual({ ok: true });

    expect(ops[0].table).toBe('categories');
    expect(argsOf(ops[0], 'update')).toEqual([{ name: '바뀐 이름' }]);
    expect(argsOf(ops[0], 'eq')).toEqual(['id', 'cat-1']);
    expect(argsOf(ops[0], 'is')).toEqual(['parent_id', null]); // 하위를 이 액션으로 고치지 못한다
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('없는 id(또는 하위 id)면 바뀐 행이 없으므로 거부한다', async () => {
    signedIn([NO_ROWS]);

    await expect(renameCategory('없음', '이름')).resolves.toEqual({
      ok: false,
      error: '카테고리를 찾을 수 없습니다.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('빈 이름은 거부한다', async () => {
    const { ops } = signedIn([OK]);

    await expect(renameCategory('cat-1', '')).resolves.toEqual({ ok: false, error: '이름을 입력하세요.' });
    expect(ops).toHaveLength(0);
  });

  it('id 가 비면 거부한다', async () => {
    const { ops } = signedIn([OK]);

    await expect(renameCategory('  ', '이름')).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
  });
});

describe('deleteCategory', () => {
  it('하위가 없으면 삭제한다', async () => {
    const { ops } = signedIn([
      { data: { id: 'cat-1', parent_id: null }, error: null },
      NO_ROWS, // 하위 조회 — 없음
      OK,
    ]);

    await expect(deleteCategory('cat-1')).resolves.toEqual({ ok: true });

    expect(argsOf(ops[1], 'eq')).toEqual(['parent_id', 'cat-1']);
    expect(ops[2].calls.some((call) => call.method === 'delete')).toBe(true);
    expect(argsOf(ops[2], 'eq')).toEqual(['id', 'cat-1']);
  });

  it('하위가 남아 있으면 삭제하지 않고 이유를 알려 준다', async () => {
    // on delete set null 이라 그냥 지우면 하위가 상위로 승격돼 사이드바에 새 상위가 생긴다.
    const { ops } = signedIn([
      { data: { id: 'cat-1', parent_id: null }, error: null },
      { data: [{ id: 'sub-1' }], error: null },
    ]);

    await expect(deleteCategory('cat-1')).resolves.toEqual({
      ok: false,
      error: '하위 카테고리를 먼저 삭제하세요.',
    });
    expect(ops).toHaveLength(2); // delete 까지 가지 않았다
  });

  it('하위 카테고리 id 로 부르면 거부한다', async () => {
    const { ops } = signedIn([{ data: { id: 'sub-1', parent_id: 'cat-1' }, error: null }]);

    await expect(deleteCategory('sub-1')).resolves.toEqual({
      ok: false,
      error: '하위 카테고리는 하위 목록에서 삭제하세요.',
    });
    expect(ops).toHaveLength(1);
  });

  it('없는 id 면 거부한다', async () => {
    signedIn([{ data: null, error: null }]);

    await expect(deleteCategory('없음')).resolves.toEqual({
      ok: false,
      error: '카테고리를 찾을 수 없습니다.',
    });
  });
});

describe('reorderCategories', () => {
  it('받은 순서대로 sort_order 를 0..n 으로 다시 매긴다', async () => {
    const { ops } = signedIn([OK, OK, OK]);

    await expect(reorderCategories(['c', 'a', 'b'])).resolves.toEqual({ ok: true });

    expect(ops.map((op) => [argsOf(op, 'eq'), argsOf(op, 'update')])).toEqual([
      [['id', 'c'], [{ sort_order: 0 }]],
      [['id', 'a'], [{ sort_order: 1 }]],
      [['id', 'b'], [{ sort_order: 2 }]],
    ]);
    expect(ops.every((op) => op.table === 'categories')).toBe(true);
  });

  it('빈 목록은 DB 를 치지 않고 성공으로 넘어간다', async () => {
    const { ops } = signedIn([]);

    await expect(reorderCategories([])).resolves.toEqual({ ok: true });
    expect(ops).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('같은 id 가 두 번 오면 거부한다 — 어느 순서가 이길지 정해지지 않는다', async () => {
    const { ops } = signedIn([OK, OK]);

    await expect(reorderCategories(['a', 'a'])).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
  });

  it('한 건이라도 실패하면 실패를 알린다', async () => {
    signedIn([OK, { data: null, error: { message: 'boom', code: '08006' } }]);

    const result = await reorderCategories(['a', 'b']);

    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('한 행도 바뀌지 않으면(전부 없는 id) 성공이라고 하지 않는다', async () => {
    signedIn([NO_ROWS, NO_ROWS]);

    await expect(reorderCategories(['a', 'b'])).resolves.toEqual({
      ok: false,
      error: '순서를 저장하지 못했습니다.',
    });
  });
});

// ───────────────────────────────────────────────────────────── 하위 카테고리

describe('createSubCategory', () => {
  it('상위 아래에 하위를 만들고 순서는 형제들 뒤에 붙인다', async () => {
    const { ops } = signedIn([
      { data: { id: 'cat-1', parent_id: null }, error: null },
      { data: [{ sort_order: 2 }], error: null },
      OK,
    ]);

    await expect(createSubCategory('cat-1', ' 하위 ')).resolves.toEqual({ ok: true });

    expect(argsOf(ops[1], 'eq')).toEqual(['parent_id', 'cat-1']); // 형제(같은 부모) 안에서만 max
    expect(argsOf(ops[2], 'insert')).toEqual([{ name: '하위', parent_id: 'cat-1', sort_order: 3 }]);
  });

  it('하위의 하위는 만들 수 없다 — 카테고리는 2단계까지다 (I2 시스템 제약)', async () => {
    const { ops } = signedIn([{ data: { id: 'sub-1', parent_id: 'cat-1' }, error: null }]);

    await expect(createSubCategory('sub-1', '더 깊은 하위')).resolves.toEqual({
      ok: false,
      error: '하위 카테고리 아래에는 다시 하위를 만들 수 없습니다.',
    });
    expect(ops).toHaveLength(1); // 조회 한 번에서 멈춘다
  });

  it('없는 상위면 거부한다', async () => {
    signedIn([{ data: null, error: null }]);

    await expect(createSubCategory('없음', '하위')).resolves.toEqual({
      ok: false,
      error: '상위 카테고리를 찾을 수 없습니다.',
    });
  });

  it('빈 이름은 조회 전에 거부한다', async () => {
    const { ops } = signedIn([]);

    await expect(createSubCategory('cat-1', ' ')).resolves.toEqual({
      ok: false,
      error: '이름을 입력하세요.',
    });
    expect(ops).toHaveLength(0);
  });
});

describe('renameSubCategory', () => {
  it('하위 카테고리의 이름만 바꾼다', async () => {
    const { ops } = signedIn([OK]);

    await expect(renameSubCategory('sub-1', '새 하위')).resolves.toEqual({ ok: true });

    expect(argsOf(ops[0], 'update')).toEqual([{ name: '새 하위' }]);
    expect(argsOf(ops[0], 'not')).toEqual(['parent_id', 'is', null]); // 상위를 이 액션으로 고치지 못한다
  });

  it('상위 id(또는 없는 id)면 거부한다', async () => {
    signedIn([NO_ROWS]);

    await expect(renameSubCategory('cat-1', '이름')).resolves.toEqual({
      ok: false,
      error: '하위 카테고리를 찾을 수 없습니다.',
    });
  });
});

describe('deleteSubCategory', () => {
  it('소속 링크를 상위로 옮긴 뒤에 지운다 — 순서가 반대면 링크가 미분류가 된다', async () => {
    const { ops } = signedIn([
      { data: { id: 'sub-1', parent_id: 'cat-1' }, error: null },
      OK, // bookmarks 재배속
      OK, // categories 삭제
    ]);

    await expect(deleteSubCategory('sub-1')).resolves.toEqual({ ok: true });

    expect(ops[1].table).toBe('bookmarks');
    expect(argsOf(ops[1], 'update')).toEqual([{ category_id: 'cat-1' }]);
    expect(argsOf(ops[1], 'eq')).toEqual(['category_id', 'sub-1']);

    expect(ops[2].table).toBe('categories');
    expect(ops[2].calls.some((call) => call.method === 'delete')).toBe(true);
    expect(argsOf(ops[2], 'eq')).toEqual(['id', 'sub-1']);
  });

  it('링크 재배속이 실패하면 카테고리를 지우지 않는다', async () => {
    const { ops } = signedIn([
      { data: { id: 'sub-1', parent_id: 'cat-1' }, error: null },
      { data: null, error: { message: 'boom', code: '08006' } },
    ]);

    const result = await deleteSubCategory('sub-1');

    expect(result.ok).toBe(false);
    expect(ops).toHaveLength(2);
  });

  it('상위 카테고리 id 로 부르면 거부한다', async () => {
    const { ops } = signedIn([{ data: { id: 'cat-1', parent_id: null }, error: null }]);

    await expect(deleteSubCategory('cat-1')).resolves.toEqual({
      ok: false,
      error: '상위 카테고리는 하위 삭제로 지울 수 없습니다.',
    });
    expect(ops).toHaveLength(1);
  });

  it('없는 id 면 거부한다', async () => {
    signedIn([{ data: null, error: null }]);

    await expect(deleteSubCategory('없음')).resolves.toEqual({
      ok: false,
      error: '하위 카테고리를 찾을 수 없습니다.',
    });
  });
});

// ───────────────────────────────────────────────────────────── 링크

describe('createBookmark', () => {
  it('이름을 비우면 주소의 host 에서 뽑는다 (www 는 뗀다)', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await expect(
      createBookmark({ url: 'https://www.perplexity.ai/', categoryId: 'cat-1' }),
    ).resolves.toEqual({ ok: true });

    expect(argsOf(ops[1], 'insert')).toEqual([
      {
        category_id: 'cat-1',
        title: 'perplexity.ai',
        url: 'https://www.perplexity.ai/',
        description: null,
        sort_order: 0,
      },
    ]);
  });

  it('공백만 있는 이름도 host 로 대체한다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await createBookmark({ url: 'https://chat.openai.com/c/1', title: '   ', categoryId: 'cat-1' });

    expect((argsOf(ops[1], 'insert') as [{ title: string }])[0].title).toBe('chat.openai.com');
  });

  it('이름을 주면 그대로 쓰고, 설명도 다듬어 넣는다', async () => {
    const { ops } = signedIn([{ data: [{ sort_order: 7 }], error: null }, OK]);

    await createBookmark({
      url: '  https://example.com/a  ',
      title: '  예시  ',
      description: '  설명  ',
      categoryId: 'cat-1',
    });

    expect(argsOf(ops[1], 'insert')).toEqual([
      {
        category_id: 'cat-1',
        title: '예시',
        url: 'https://example.com/a', // 입력 그대로 — URL 정규화로 주소를 바꾸지 않는다
        description: '설명',
        sort_order: 8, // 같은 카테고리 안에서 맨 뒤
      },
    ]);
    expect(argsOf(ops[0], 'eq')).toEqual(['category_id', 'cat-1']);
  });

  it('빈 설명은 null 로 넣는다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await createBookmark({ url: 'https://example.com', description: '  ', categoryId: 'cat-1' });

    expect((argsOf(ops[1], 'insert') as [{ description: unknown }])[0].description).toBeNull();
  });

  it('주소가 아니면 거부한다', async () => {
    const { ops } = signedIn([]);

    await expect(createBookmark({ url: '그냥 글자', categoryId: 'cat-1' })).resolves.toEqual({
      ok: false,
      error: '주소 형식이 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.',
    });
    expect(ops).toHaveLength(0);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'mailto:a@b.c', 'file:///etc/passwd'])(
    'http(s) 가 아닌 스킴(%s)은 거부한다 — 카드의 href 로 그대로 나가는 값이다',
    async (url) => {
      signedIn([]);

      const result = await createBookmark({ url, categoryId: 'cat-1' });

      expect(result.ok).toBe(false);
    },
  );

  it('카테고리를 비우면 거부한다', async () => {
    const { ops } = signedIn([]);

    await expect(createBookmark({ url: 'https://example.com', categoryId: '  ' })).resolves.toEqual({
      ok: false,
      error: '카테고리를 선택하세요.',
    });
    expect(ops).toHaveLength(0);
  });

  it('없는 카테고리면(23503) 사용자 문구로 바꾼다', async () => {
    signedIn([
      NO_ROWS,
      { data: null, error: { message: 'insert or update violates foreign key', code: '23503' } },
    ]);

    await expect(
      createBookmark({ url: 'https://example.com', categoryId: '00000000-0000-0000-0000-000000000000' }),
    ).resolves.toEqual({ ok: false, error: '카테고리를 찾을 수 없습니다.' });
  });
});

describe('updateBookmark', () => {
  it('준 필드만 고친다', async () => {
    const { ops } = signedIn([OK]);

    await expect(updateBookmark('bm-1', { description: '  새 설명  ' })).resolves.toEqual({ ok: true });

    expect(argsOf(ops[0], 'update')).toEqual([{ description: '새 설명' }]);
    expect(argsOf(ops[0], 'eq')).toEqual(['id', 'bm-1']);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('카멜케이스 키를 DB 컬럼으로 옮긴다', async () => {
    const { ops } = signedIn([OK]);

    await updateBookmark('bm-1', { categoryId: 'sub-2', faviconUrl: 'https://cdn/a.png' });

    expect(argsOf(ops[0], 'update')).toEqual([
      { category_id: 'sub-2', favicon_url: 'https://cdn/a.png' },
    ]);
  });

  it('설명·파비콘은 null 로 비울 수 있다', async () => {
    const { ops } = signedIn([OK]);

    await updateBookmark('bm-1', { description: null, faviconUrl: '' });

    expect(argsOf(ops[0], 'update')).toEqual([{ description: null, favicon_url: null }]);
  });

  it('이름을 빈 값으로는 못 바꾼다 — 링크 제목은 비울 수 없다', async () => {
    const { ops } = signedIn([OK]);

    await expect(updateBookmark('bm-1', { title: '   ' })).resolves.toEqual({
      ok: false,
      error: '이름을 입력하세요.',
    });
    expect(ops).toHaveLength(0);
  });

  it('주소를 고칠 때도 http(s) 만 받는다', async () => {
    const { ops } = signedIn([OK]);

    const result = await updateBookmark('bm-1', { url: 'javascript:alert(1)' });

    expect(result.ok).toBe(false);
    expect(ops).toHaveLength(0);
  });

  it('고칠 내용이 없으면 거부한다', async () => {
    const { ops } = signedIn([OK]);

    await expect(updateBookmark('bm-1', {})).resolves.toEqual({
      ok: false,
      error: '수정할 내용이 없습니다.',
    });
    expect(ops).toHaveLength(0);
  });

  it('없는 id 면 거부한다', async () => {
    signedIn([NO_ROWS]);

    await expect(updateBookmark('없음', { title: '이름' })).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('deleteBookmark', () => {
  it('링크를 지운다', async () => {
    const { ops } = signedIn([OK]);

    await expect(deleteBookmark('bm-1')).resolves.toEqual({ ok: true });

    expect(ops[0].table).toBe('bookmarks');
    expect(ops[0].calls.some((call) => call.method === 'delete')).toBe(true);
    expect(argsOf(ops[0], 'eq')).toEqual(['id', 'bm-1']);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('이미 없는 링크면 지웠다고 하지 않는다', async () => {
    signedIn([NO_ROWS]);

    await expect(deleteBookmark('없음')).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
  });
});

describe('reorderBookmarks', () => {
  it('받은 순서대로 sort_order 를 다시 매긴다', async () => {
    const { ops } = signedIn([OK, OK]);

    await expect(reorderBookmarks(['b', 'a'])).resolves.toEqual({ ok: true });

    expect(ops.every((op) => op.table === 'bookmarks')).toBe(true);
    expect(ops.map((op) => [argsOf(op, 'eq'), argsOf(op, 'update')])).toEqual([
      [['id', 'b'], [{ sort_order: 0 }]],
      [['id', 'a'], [{ sort_order: 1 }]],
    ]);
  });

  it('id 가 아닌 값이 섞이면 거부한다', async () => {
    const { ops } = signedIn([OK]);

    await expect(reorderBookmarks(['a', '  '])).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
  });
});

describe('togglePin', () => {
  it('고정되지 않은 링크는 고정한다', async () => {
    const { ops } = signedIn([{ data: { id: 'bm-1', is_pinned: false }, error: null }, OK]);

    await expect(togglePin('bm-1')).resolves.toEqual({ ok: true });

    expect(argsOf(ops[1], 'update')).toEqual([{ is_pinned: true }]);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('고정된 링크는 푼다', async () => {
    const { ops } = signedIn([{ data: { id: 'bm-1', is_pinned: true }, error: null }, OK]);

    await expect(togglePin('bm-1')).resolves.toEqual({ ok: true });

    expect(argsOf(ops[1], 'update')).toEqual([{ is_pinned: false }]);
  });

  it(`13번째 고정은 DB 트리거가 막고, 그 예외를 사용자 문구로 바꾼다`, async () => {
    // 0001_init.sql 의 enforce_pin_limit(): raise exception 'PIN_LIMIT: …'
    signedIn([
      { data: { id: 'bm-1', is_pinned: false }, error: null },
      {
        data: null,
        error: { message: 'PIN_LIMIT: 매일 고정은 최대 12개입니다', code: 'P0001' },
      },
    ]);

    await expect(togglePin('bm-1')).resolves.toEqual({
      ok: false,
      error: `매일 고정은 최대 ${DAILY_PIN_MAX}개입니다.`,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('고정 상한 문구의 숫자는 DB 트리거(12)와 같다', () => {
    expect(DAILY_PIN_MAX).toBe(12);
  });

  it('없는 링크면 거부한다', async () => {
    const { ops } = signedIn([{ data: null, error: null }]);

    await expect(togglePin('없음')).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
    expect(ops).toHaveLength(1);
  });

  it('토글 도중 링크가 사라지면 성공이라고 하지 않는다', async () => {
    signedIn([{ data: { id: 'bm-1', is_pinned: false }, error: null }, NO_ROWS]);

    await expect(togglePin('bm-1')).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
  });
});

// ───────────────────────────────────────────────────────────── 오류 노출

describe('오류 문구 — 내부 정보를 화면으로 흘리지 않는다', () => {
  const LEAKY: DbError = {
    message: 'insert into "categories" failed at /var/task/.next/server/chunks/1.js:42',
    code: '42P01',
    details: 'relation "categories" does not exist',
    hint: 'perhaps you meant "category"',
  };

  it('SQL·경로·details·hint 가 반환 문구에 섞이지 않는다', async () => {
    signedIn([NO_ROWS, { data: null, error: LEAKY }]);

    const result = await createCategory('새 분류');

    expect(result).toEqual({
      ok: false,
      error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  });

  it('진단은 서버 로그에만 남긴다', async () => {
    signedIn([NO_ROWS, { data: null, error: LEAKY }]);

    await createCategory('새 분류');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[mutations]'), LEAKY);
  });

  it('RLS 거부(42501)는 다시 로그인하라고 안내한다', async () => {
    signedIn([
      NO_ROWS,
      { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } },
    ]);

    await expect(createCategory('새 분류')).resolves.toEqual({
      ok: false,
      error: '권한이 없습니다. 다시 로그인해 주세요.',
    });
  });

  it('uuid 가 아닌 id(22P02)는 잘못된 요청으로 접는다', async () => {
    signedIn([{ data: null, error: { message: 'invalid input syntax for type uuid', code: '22P02' } }]);

    await expect(renameCategory('not-a-uuid', '이름')).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
  });
});
