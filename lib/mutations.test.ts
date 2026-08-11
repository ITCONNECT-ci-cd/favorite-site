// @vitest-environment node
// 서버 액션만 다루므로 DOM 이 필요 없다 — jsdom 을 띄우지 않는다.
import { readFileSync } from 'node:fs';

import { revalidatePath } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBookmark,
  createCategory,
  createSubCategory,
  deleteBookmark,
  deleteBookmarks,
  deleteCategory,
  deleteSubCategory,
  renameCategory,
  renameSubCategory,
  reorderBookmarks,
  reorderCategories,
  reorderFavorites,
  setFavorite,
  updateBookmark,
  type ActionResult,
  type DbError,
} from '@/lib/mutations';
import { createServerSupabaseClient, getAdminSession } from '@/lib/supabase/server';

// 실제 DB 왕복은 하지 않는다 — "무엇을 물어보고 어떤 순서로 쓰는지"와 "무엇을 돌려주는지"만 본다.
// 인증 세션 쿠키가 필요한 실 통합은 H3·I1 의 화면 경유 검증 몫이다(파일 상단 주석 참조).
vi.mock('@/lib/supabase/server', () => ({
  getAdminSession: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// `process.cwd()` 가 아니라 이 파일 기준으로 읽는다 — Windows 에서 cwd 의 드라이브 문자 대소문자가
// 실행 방식마다 달라져(`e:\` vs `E:\`) 경로 조립이 어긋난 이력이 있다. import.meta.url 은 흔들리지 않는다.
const source = readFileSync(new URL('./mutations.ts', import.meta.url), 'utf8');

type QueryResult = { data: unknown; error: DbError | null };
/** fetch 자체가 거부되는 상황(네트워크 단절 등) — 결과가 아니라 예외로 돌아온다. */
type Rejection = { rejectWith: unknown };
type Planned = QueryResult | Rejection;

function isRejection(planned: Planned): planned is Rejection {
  return 'rejectWith' in planned;
}

/** `supabase.from(t)` 한 번 = 연산 하나. 어떤 체인이 걸렸는지 그대로 기록한다. */
type Op = { table: string; calls: { method: string; args: unknown[] }[] };

const BUILDER_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'eq',
  'in',
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
function fakeSupabase(results: Planned[]) {
  const ops: Op[] = [];
  let cursor = 0;

  const client = {
    from(table: string) {
      const op: Op = { table, calls: [] };
      ops.push(op);
      const planned: Planned = results[cursor] ?? { data: [], error: null };
      cursor += 1;

      const builder: Record<string, unknown> = {
        then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
          (isRejection(planned) ? Promise.reject(planned.rejectWith) : Promise.resolve(planned)).then(
            onFulfilled,
            onRejected,
          ),
      };
      for (const method of BUILDER_METHODS) {
        builder[method] = (...args: unknown[]) => {
          op.calls.push({ method, args });

          return builder;
        };
      }

      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      const op: Op = { table: `rpc:${name}`, calls: [{ method: 'rpc', args: [args] }] };
      ops.push(op);
      const planned: Planned = results[cursor] ?? { data: null, error: null };
      cursor += 1;

      return isRejection(planned) ? Promise.reject(planned.rejectWith) : Promise.resolve(planned);
    },
  };

  return { client, ops };
}

/** 로그인 상태 + 미리 정한 DB 응답으로 액션을 돌릴 준비를 한다. */
function signedIn(results: Planned[] = []) {
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

/** insert 페이로드 한 덩어리. */
function insertPayload(op: Op): Record<string, unknown> {
  return (argsOf(op, 'insert') as [Record<string, unknown>])[0];
}

/**
 * **모든 액션 하나씩** — 이름은 I·J 트랙이 부르는 계약이고, 호출식은 미인증 전수 검사에 쓴다.
 *
 * 이 한 덩어리가 "export 이름 목록"과 "전수 테스트 목록"을 겸한다. 따로 두면 14번째 액션을
 * 추가하면서 이름만 적고 호출식을 안 적어도 초록불이 나는데, 그러면 그 액션의 인증 관문은
 * 아무도 확인하지 않은 채 배포된다. 아래 '모듈 계약' 이 `Object.keys(모듈)` 과 이 키를 대조하므로,
 * 액션을 늘리면서 여기에 호출식을 적지 않으면 반드시 빨간불이 난다.
 */
const ALL_ACTIONS: Record<string, () => Promise<ActionResult>> = {
  createCategory: () => createCategory('새 분류'),
  renameCategory: () => renameCategory('cat-1', '새 이름'),
  deleteCategory: () => deleteCategory('cat-1'),
  reorderCategories: () => reorderCategories(['cat-1', 'cat-2']),
  createSubCategory: () => createSubCategory('cat-1', '하위'),
  renameSubCategory: () => renameSubCategory('sub-1', '새 이름'),
  deleteSubCategory: () => deleteSubCategory('sub-1'),
  createBookmark: () => createBookmark({ url: 'https://example.com', categoryId: 'cat-1' }),
  updateBookmark: () => updateBookmark('bm-1', { title: '새 이름' }),
  deleteBookmark: () => deleteBookmark('bm-1'),
  deleteBookmarks: () => deleteBookmarks(['bm-1', 'bm-2']),
  reorderBookmarks: () => reorderBookmarks(['bm-1', 'bm-2']),
  setFavorite: () => setFavorite('bm-1', true),
  reorderFavorites: () => reorderFavorites(['bm-1', 'bm-2']),
};

const ACTION_ENTRIES = Object.entries(ALL_ACTIONS);

beforeEach(() => {
  vi.clearAllMocks();
  // describeFailure 가 서버 로그에 남기는 진단을 테스트 출력에서 지운다.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ───────────────────────────────────────────────────────────── 계약 · 구조

describe('모듈 계약', () => {
  it('내보내는 액션 이름은 전수 테스트 목록과 정확히 같다 (15번째를 추가하면 여기서 걸린다)', async () => {
    const actions = await import('@/lib/mutations');

    expect(Object.keys(actions).sort()).toEqual(Object.keys(ALL_ACTIONS).sort());
    expect(ACTION_ENTRIES).toHaveLength(14);
  });

  it("첫 줄이 'use server' 다 — 이게 빠지면 그냥 서버 함수가 되어 화면에서 부를 수 없다", () => {
    // `\r` 을 함께 버린다 — Windows 의 `core.autocrlf=true` 체크아웃은 작업 트리를 CRLF 로 만든다
    // (커밋된 blob 은 LF). 검사 대상은 지시문의 **위치**이지 줄바꿈이 아니다.
    expect(source.split(/\r?\n/)[0]).toBe("'use server';");
  });

  it('service role 클라이언트를 어떤 형태로도 끌어오지 않는다', () => {
    // 쓰기는 인증 사용자의 anon+쿠키 클라이언트로만 나간다(RLS authenticated 정책 통과).
    // 줄 단위(`^import .*$`)로 뜯으면 여러 줄 import·동적 `import()`·`require()` 가 통째로 빠져나가므로
    // 소스 **전체**를 하나의 정규식으로 훑는다. 주석에 적힌 경로 이름은 인용부호 앞의
    // from/import(/require( 가 없어 걸리지 않는다.
    expect(source).not.toMatch(/(?:from|import\s*\(|require\s*\()\s*['"][^'"]*supabase\/admin['"]/);
    expect(source).toMatch(/from\s*['"]@\/lib\/supabase\/server['"]/);
    expect(source).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    // 보조 — 위 세 줄이 본 방어다. 이름만으로 거르는 이 줄은 우회하기 쉬우니 믿지 마라.
    expect(source).not.toMatch(/createAdminSupabaseClient\s*\(/);
  });

});

// ───────────────────────────────────────────────────────────── 인증 관문

describe('인증 관문 — getAdminSession 이 null 이면 아무것도 하지 않는다', () => {
  it.each(ACTION_ENTRIES)('%s 는 미인증 호출을 거부한다', async (_name, run) => {
    signedOut();

    await expect(run()).resolves.toEqual({ ok: false, error: '로그인이 필요합니다.' });
  });

  it.each(ACTION_ENTRIES)('%s 는 미인증이면 DB 에 붙지도 않는다', async (_name, run) => {
    signedOut();
    await run();

    // RLS 는 2차 방어다. 1차 방어가 뚫려도 DB 가 막아 주지만, 애초에 붙지 않는 편이 맞다.
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('거부 사유를 세분화하지 않는다 — 12개 액션이 모두 같은 문구다', async () => {
    signedOut();
    const messages = new Set<string>();
    for (const [, run] of ACTION_ENTRIES) {
      const result = await run();
      if (!result.ok) messages.add(result.error);
    }

    expect([...messages]).toEqual(['로그인이 필요합니다.']);
  });
});

// ───────────────────────────────────────────────────────────── 적대적 페이로드

/**
 * 이 파일의 export 는 전부 공개 HTTP 엔드포인트다 — 로그인만 하면(또는 세션 쿠키를 훔치면) 누구나
 * **타입 시그니처를 무시한 페이로드**를 POST 할 수 있다. TypeScript 는 런타임 보장이 아니므로
 * 숫자·객체·배열·null 이 문자열 자리에 오는 경우를 하나씩 확인한다.
 *
 * 기대치는 두 가지다: ① 던지지 않고 `{ ok:false }` 로 돌아온다(던지면 Next 오류 경계가 뜬다)
 * ② **DB 를 치기 전에** 걸린다(잘못된 페이로드로 왕복하지 않는다).
 */
const HOSTILE: [string, () => Promise<ActionResult>][] = [
  ['createCategory(7)', () => createCategory(7 as never)],
  ['createCategory({})', () => createCategory({} as never)],
  ['renameCategory({}, 이름)', () => renameCategory({} as never, '이름')],
  ['renameCategory(id, [])', () => renameCategory('cat-1', [] as never)],
  ['deleteCategory(null)', () => deleteCategory(null as never)],
  ['createSubCategory(7, 이름)', () => createSubCategory(7 as never, '이름')],
  ['renameSubCategory(undefined, 이름)', () => renameSubCategory(undefined as never, '이름')],
  ['deleteSubCategory({id})', () => deleteSubCategory({ id: 'sub-1' } as never)],
  ['createBookmark(null)', () => createBookmark(null as never)],
  ['createBookmark("https://…")', () => createBookmark('https://example.com' as never)],
  ['createBookmark({ url: 7 })', () => createBookmark({ url: 7, categoryId: 'cat-1' } as never)],
  ['createBookmark({ categoryId: 7 })', () => createBookmark({ url: 'https://a.b', categoryId: 7 } as never)],
  ['updateBookmark("bm-1", null)', () => updateBookmark('bm-1', null as never)],
  ['updateBookmark("bm-1", [])', () => updateBookmark('bm-1', [] as never)],
  ['updateBookmark("bm-1", { description: 7 })', () => updateBookmark('bm-1', { description: 7 } as never)],
  ['updateBookmark(7, { title })', () => updateBookmark(7 as never, { title: '이름' })],
  ['deleteBookmark(7)', () => deleteBookmark(7 as never)],
  ['deleteBookmarks("bm-1")', () => deleteBookmarks('bm-1' as never)],
  ['deleteBookmarks([7])', () => deleteBookmarks([7] as never)],
  ['deleteBookmarks([""])', () => deleteBookmarks([''] as never)],
  // 빈 선택은 화면에서 버튼이 잠겨 나올 수 없는 요청이다 — "아무것도 안 지웠는데 성공"으로 접지 않는다.
  ['deleteBookmarks([])', () => deleteBookmarks([])],
  // 같은 id 가 두 번 오면 지운 건수와 요청 건수가 영영 어긋난다 — 정렬과 같은 규칙으로 통째로 거부한다.
  ['deleteBookmarks(["a","a"])', () => deleteBookmarks(['a', 'a'])],
  ['reorderCategories("bm-1")', () => reorderCategories('bm-1' as never)],
  ['reorderCategories([7])', () => reorderCategories([7] as never)],
  ['reorderBookmarks({ 0: "a" })', () => reorderBookmarks({ 0: 'a' } as never)],
];

describe('적대적 페이로드 — 타입을 무시한 입력이 DB 에 닿지 않는다', () => {
  it.each(HOSTILE)('%s 는 DB 를 치기 전에 거부된다', async (_name, run) => {
    const { ops } = signedIn([OK, OK, OK]);

    const result = await run();

    expect(result.ok).toBe(false);
    expect(ops).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
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
  /** 개명 대상 조회(1번째 왕복)가 돌려줄 행. */
  const named = (name: string) => ({ data: { id: 'cat-1', name }, error: null });

  it('상위 카테고리의 이름만 바꾼다', async () => {
    const { ops } = signedIn([named('옛 이름'), OK]);

    await expect(renameCategory('cat-1', '  바뀐 이름 ')).resolves.toEqual({ ok: true });

    expect(ops[1].table).toBe('categories');
    expect(argsOf(ops[1], 'update')).toEqual([{ name: '바뀐 이름' }]);
    expect(argsOf(ops[1], 'eq')).toEqual(['id', 'cat-1']);
    expect(argsOf(ops[1], 'is')).toEqual(['parent_id', null]); // 하위를 이 액션으로 고치지 못한다
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('없는 id(또는 하위 id)면 조회에서 걸러 거부한다', async () => {
    const { ops } = signedIn([{ data: null, error: null }]);

    await expect(renameCategory('없음', '이름')).resolves.toEqual({
      ok: false,
      error: '카테고리를 찾을 수 없습니다.',
    });
    expect(ops).toHaveLength(1); // 조회에서 끝났다 — update 는 나가지 않는다
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * 세 분류는 화면이 **id 가 아니라 이름**으로 찾는다(그 액션의 JSDoc). 이름이 어긋나면 오류 없이
   * 홈 섹션이 사라지거나 즐겨찾기가 엉뚱한 묶음으로 밀리므로, 조용한 고장을 여기서 막는다.
   */
  it.each(['현재 운영 중인 사이트', '뉴스·인사이트', 'AI 도구 모음'])(
    "화면이 이름으로 찾는 '%s' 는 개명을 거부한다",
    async (protectedName) => {
      const { ops } = signedIn([named(protectedName), OK]);

      await expect(renameCategory('cat-1', '새 이름')).resolves.toEqual({
        ok: false,
        error:
          '홈 화면이 이 분류를 이름으로 찾습니다. 이름을 바꾸면 홈에서 사라지므로 개발자와 함께 바꿔야 합니다.',
      });
      expect(ops).toHaveLength(1); // 조회만 하고 쓰지 않았다
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it('같은 이름으로 다시 저장하는 것은 막지 않는다 — 바뀌는 것이 없다', async () => {
    const { ops } = signedIn([named('AI 도구 모음'), OK]);

    await expect(renameCategory('cat-1', 'AI 도구 모음')).resolves.toEqual({ ok: true });
    expect(ops).toHaveLength(2);
  });

  it('보호 대상이 아닌 분류는 그대로 바뀐다', async () => {
    signedIn([named('마케팅'), OK]);

    await expect(renameCategory('cat-1', '마케팅·광고')).resolves.toEqual({ ok: true });
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
  it('하위도 직속 링크도 없으면 삭제한다', async () => {
    const { ops } = signedIn([
      { data: { id: 'cat-1', parent_id: null }, error: null },
      NO_ROWS, // 하위 조회 — 없음
      NO_ROWS, // 직속 링크 조회 — 없음
      OK,
    ]);

    await expect(deleteCategory('cat-1')).resolves.toEqual({ ok: true });

    expect(argsOf(ops[1], 'eq')).toEqual(['parent_id', 'cat-1']);
    expect(ops[2].table).toBe('bookmarks');
    expect(argsOf(ops[2], 'eq')).toEqual(['category_id', 'cat-1']);
    expect(ops[3].calls.some((call) => call.method === 'delete')).toBe(true);
    expect(argsOf(ops[3], 'eq')).toEqual(['id', 'cat-1']);
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

  it('직속 링크가 남아 있으면 삭제하지 않는다 — 미분류가 되면 관리 화면에서도 사라진다', async () => {
    // bookmarks.category_id 도 on delete set null 이다. 미분류 링크는 I4 링크 표에도 안 떠서
    // 되돌릴 화면이 아예 없다 — 그래서 하위와 같은 규칙으로 막는다("지우려면 먼저 비워라").
    const { ops } = signedIn([
      { data: { id: 'cat-1', parent_id: null }, error: null },
      NO_ROWS, // 하위 없음
      { data: [{ id: 'bm-1' }], error: null }, // 직속 링크 있음
    ]);

    await expect(deleteCategory('cat-1')).resolves.toEqual({
      ok: false,
      error: '이 카테고리에 링크가 남아 있습니다. 링크를 옮기거나 삭제한 뒤 다시 시도하세요.',
    });
    expect(ops).toHaveLength(3); // delete 까지 가지 않았다
    expect(revalidatePath).not.toHaveBeenCalled();
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

  it('하위 조회가 실패하면 "하위 없음"으로 넘겨짚지 않는다', async () => {
    const { ops } = signedIn([
      { data: { id: 'cat-1', parent_id: null }, error: null },
      { data: null, error: { message: 'boom', code: '08006' } },
    ]);

    const result = await deleteCategory('cat-1');

    expect(result.ok).toBe(false);
    expect(ops).toHaveLength(2); // 삭제로 넘어가지 않았다
  });

  it('경합으로 delete 가 0행이면 지웠다고 하지 않는다', async () => {
    signedIn([
      { data: { id: 'cat-1', parent_id: null }, error: null },
      NO_ROWS,
      NO_ROWS,
      NO_ROWS, // 검사 뒤 다른 창이 먼저 지웠다
    ]);

    await expect(deleteCategory('cat-1')).resolves.toEqual({
      ok: false,
      error: '카테고리를 찾을 수 없습니다.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
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

  it('각 update 에 parent_id is null 을 함께 건다 — 상위 재정렬이 하위를 건드리지 못한다', async () => {
    const { ops } = signedIn([OK, OK]);

    await reorderCategories(['a', 'b']);

    expect(ops.map((op) => argsOf(op, 'is'))).toEqual([
      ['parent_id', null],
      ['parent_id', null],
    ]);
  });

  it('하위 id 만 넘기면 한 행도 안 바뀌어 거부된다 (스코프가 서버에서 강제된다)', async () => {
    // parent_id is null 조건 때문에 하위 id 는 어떤 행에도 맞지 않는다 → 0건.
    signedIn([NO_ROWS, NO_ROWS]);

    await expect(reorderCategories(['sub-1', 'sub-2'])).resolves.toEqual({
      ok: false,
      error: '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
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
    signedIn([NO_ROWS, { data: null, error: { message: 'boom', code: '08006' } }]);

    const result = await reorderCategories(['a', 'b']);

    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled(); // 바뀐 행이 하나도 없었다
  });

  it('한 행도 바뀌지 않으면(전부 없는 id) 성공이라고 하지 않는다', async () => {
    signedIn([NO_ROWS, NO_ROWS]);

    await expect(reorderCategories(['a', 'b'])).resolves.toEqual({
      ok: false,
      error: '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    });
  });
});

describe('링크 순서 저장은 DB RPC 한 트랜잭션이다', () => {
  it('DB 오류에는 실패를 알리고 부분 성공 revalidate를 하지 않는다', async () => {
    signedIn([{ data: null, error: { message: 'boom', code: '08006' } }]);

    await expect(reorderBookmarks(['b', 'a'])).resolves.toEqual({
      ok: false,
      error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('fetch 자체가 거부돼도 오류 경계로 던지지 않는다', async () => {
    signedIn([{ rejectWith: new TypeError('fetch failed') }]);

    await expect(reorderBookmarks(['b', 'a'])).resolves.toEqual({
      ok: false,
      error: '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[mutations]'),
      expect.any(TypeError),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
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
    expect(argsOf(ops[1], 'select')).toEqual(['id']); // 몇 건이 옮겨졌는지 알아야 한다

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
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('링크는 옮겨졌는데 삭제가 실패하면, 실패를 알리면서도 화면은 다시 그리게 한다', async () => {
    signedIn([
      { data: { id: 'sub-1', parent_id: 'cat-1' }, error: null },
      { data: [{ id: 'bm-1' }, { id: 'bm-2' }], error: null }, // 2건 이동 완료
      { data: null, error: { message: 'boom', code: '08006' } },
    ]);

    const result = await deleteSubCategory('sub-1');

    expect(result.ok).toBe(false);
    // 링크는 이미 상위로 갔다. 화면이 옛 자리를 그대로 두면 사용자는 이동을 되돌리려 들 것이다.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('경합으로 삭제가 0행이면 지웠다고 하지 않는다 — 옮긴 링크가 있으면 화면은 맞춰 준다', async () => {
    signedIn([
      { data: { id: 'sub-1', parent_id: 'cat-1' }, error: null },
      { data: [{ id: 'bm-1' }], error: null },
      NO_ROWS, // 검사 뒤 다른 창이 먼저 지웠다
    ]);

    await expect(deleteSubCategory('sub-1')).resolves.toEqual({
      ok: false,
      error: '하위 카테고리를 찾을 수 없습니다.',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('옮긴 링크가 하나도 없는 실패에는 화면을 다시 그리지 않는다', async () => {
    signedIn([
      { data: { id: 'sub-1', parent_id: 'cat-1' }, error: null },
      NO_ROWS, // 옮길 링크가 없었다
      NO_ROWS,
    ]);

    const result = await deleteSubCategory('sub-1');

    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
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
        favicon_url: null,
        sort_order: 0,
        // '매일 고정'은 없어졌지만 컬럼은 남아 있어 늘 false 를 실어 보낸다(NewBookmark 주석).
        is_pinned: false,
      },
    ]);
  });

  it('공백만 있는 이름도 host 로 대체한다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await createBookmark({ url: 'https://chat.openai.com/c/1', title: '   ', categoryId: 'cat-1' });

    expect(insertPayload(ops[1]).title).toBe('chat.openai.com');
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
        favicon_url: null,
        sort_order: 8, // 같은 카테고리 안에서 맨 뒤
        is_pinned: false,
      },
    ]);
    expect(argsOf(ops[0], 'eq')).toEqual(['category_id', 'cat-1']);
  });

  it('빈 설명은 null 로 넣는다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await createBookmark({ url: 'https://example.com', description: '  ', categoryId: 'cat-1' });

    expect(insertPayload(ops[1]).description).toBeNull();
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

  it.each([
    'https://user:pass@example.com/path',
    'https://[2001:db8::1]/',
    'https://예시.한국/',
    'https://example.com./',
    'https://exa_mple.com/',
    'https://example.com\\admin',
  ])('DB v1 parser가 허용하지 않는 URL 문법은 사전에 거부한다: %s', async (url) => {
    const { ops } = signedIn([]);

    await expect(createBookmark({ url, categoryId: 'cat-1' })).resolves.toEqual({
      ok: false,
      error: '주소 형식이 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.',
    });
    expect(ops).toHaveLength(0);
  });

  it('URL 2048자, 제목 120 code point, 설명 200 code point 제한을 DB 전에 적용한다', async () => {
    const overUrl = `https://example.com/${'a'.repeat(2049)}`;
    const overTitle = '가'.repeat(121);
    const overDescription = '나'.repeat(201);

    await expect(createBookmark({ url: overUrl, categoryId: 'cat-1' })).resolves.toEqual({
      ok: false,
      error: '주소는 2048자 이하로 입력하세요.',
    });
    await expect(
      createBookmark({ url: 'https://example.com', title: overTitle, categoryId: 'cat-1' }),
    ).resolves.toEqual({ ok: false, error: '이름은 120자 이하로 입력하세요.' });
    await expect(
      createBookmark({
        url: 'https://example.com',
        description: overDescription,
        categoryId: 'cat-1',
      }),
    ).resolves.toEqual({ ok: false, error: '한 줄 설명은 200자 이하로 입력하세요.' });
  });

  it('제목·설명의 런타임 타입이 틀리면 host/null로 조용히 바꾸지 않는다', async () => {
    await expect(
      createBookmark({ url: 'https://example.com', title: 7, categoryId: 'cat-1' } as never),
    ).resolves.toEqual({ ok: false, error: '요청이 올바르지 않습니다.' });
    await expect(
      createBookmark({ url: 'https://example.com', description: {}, categoryId: 'cat-1' } as never),
    ).resolves.toEqual({ ok: false, error: '요청이 올바르지 않습니다.' });
  });

  it('normalized URL unique 위반을 카테고리 이름 중복과 구분한다', async () => {
    signedIn([
      NO_ROWS,
      {
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "bookmarks_normalized_url_key"',
          code: '23505',
        },
      },
    ]);

    await expect(
      createBookmark({ url: 'https://example.com', categoryId: 'cat-1' }),
    ).resolves.toEqual({ ok: false, error: '같은 주소의 링크가 이미 있습니다.' });
  });

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

// ───────────────────────────────────────────────────────────── favicon_url 계약 (I3 인계)

describe('favicon_url — 생성 때부터 채울 수 있고, 키는 언제나 실린다', () => {
  it('주면 그대로 insert 에 실린다 (I3 은 행을 만들면서 파비콘을 함께 넣는다)', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await expect(
      createBookmark({
        url: 'https://example.com',
        categoryId: 'cat-1',
        faviconUrl: '  https://cdn.example.com/icons/example.com.png  ',
      }),
    ).resolves.toEqual({ ok: true });

    expect(insertPayload(ops[1]).favicon_url).toBe('https://cdn.example.com/icons/example.com.png');
  });

  it('안 주면 favicon_url 키가 없는 게 아니라 null 이 실린다 — DB 기본값에 기대지 않는다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await createBookmark({ url: 'https://example.com', categoryId: 'cat-1' });

    const payload = insertPayload(ops[1]);

    expect(Object.keys(payload)).toContain('favicon_url');
    expect(payload.favicon_url).toBeNull();
  });

  it('공백·null 은 null 로 접는다', async () => {
    const blank = signedIn([NO_ROWS, OK]);
    await createBookmark({ url: 'https://example.com', categoryId: 'cat-1', faviconUrl: '   ' });
    expect(insertPayload(blank.ops[1]).favicon_url).toBeNull();

    const explicit = signedIn([NO_ROWS, OK]);
    await createBookmark({ url: 'https://example.com', categoryId: 'cat-1', faviconUrl: null });
    expect(insertPayload(explicit.ops[1]).favicon_url).toBeNull();
  });

  it('data:image URI 는 정당한 저장값이라 통과시킨다 (lib/favicon.ts 가 그대로 그린다)', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const { ops } = signedIn([NO_ROWS, OK]);

    await createBookmark({ url: 'https://example.com', categoryId: 'cat-1', faviconUrl: dataUri });
    expect(insertPayload(ops[1]).favicon_url).toBe(dataUri);

    const patched = signedIn([OK]);
    await updateBookmark('bm-1', { faviconUrl: dataUri });
    expect(argsOf(patched.ops[0], 'update')).toEqual([{ favicon_url: dataUri }]);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:a@b.c',
    '그냥 글자',
  ])('형식이 아닌 값(%s)은 조용히 null 로 접지 않고 거부한다', async (faviconUrl) => {
    const created = signedIn([NO_ROWS, OK]);

    await expect(
      createBookmark({ url: 'https://example.com', categoryId: 'cat-1', faviconUrl }),
    ).resolves.toEqual({
      ok: false,
      error: '파비콘 주소가 올바르지 않습니다. http(s) 주소이거나 data:image URI 여야 합니다.',
    });
    expect(created.ops).toHaveLength(0);

    const patched = signedIn([OK]);

    await expect(updateBookmark('bm-1', { faviconUrl })).resolves.toEqual({
      ok: false,
      error: '파비콘 주소가 올바르지 않습니다. http(s) 주소이거나 data:image URI 여야 합니다.',
    });
    expect(patched.ops).toHaveLength(0);
  });

  it('문자열도 null 도 아닌 값은 거부한다 (조용히 비우면 아이콘이 사라진 이유를 못 찾는다)', async () => {
    const { ops } = signedIn([OK]);

    const result = await updateBookmark('bm-1', { faviconUrl: 7 as never });

    expect(result.ok).toBe(false);
    expect(ops).toHaveLength(0);
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

    await updateBookmark('bm-1', { categoryId: 'sub-2', faviconUrl: 'https://cdn.example.com/a.png' });

    expect(argsOf(ops[0], 'update')).toEqual([
      { category_id: 'sub-2', favicon_url: 'https://cdn.example.com/a.png' },
    ]);
  });

  it('설명·파비콘은 null 로 비울 수 있다', async () => {
    const { ops } = signedIn([OK]);

    await updateBookmark('bm-1', { description: null, faviconUrl: '' });

    expect(argsOf(ops[0], 'update')).toEqual([{ description: null, favicon_url: null }]);
  });

  it('설명이 문자열도 null 도 아니면 거부한다 — title 과 대칭이다', async () => {
    // patch 의 키는 "이 값으로 정해라"라는 뜻이다. 조용히 null 로 접으면 사용자는 설명이
    // 지워진 것을 저장이 잘된 결과로 본다.
    const { ops } = signedIn([OK]);

    await expect(updateBookmark('bm-1', { description: 7 as never })).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
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

  it('수정도 URL·제목·설명 길이와 DB check constraint 문구를 구분한다', async () => {
    await expect(updateBookmark('bm-1', { url: `https://example.com/${'a'.repeat(2049)}` })).resolves.toEqual({
      ok: false,
      error: '주소는 2048자 이하로 입력하세요.',
    });
    await expect(updateBookmark('bm-1', { title: '가'.repeat(121) })).resolves.toEqual({
      ok: false,
      error: '이름은 120자 이하로 입력하세요.',
    });
    await expect(updateBookmark('bm-1', { description: '나'.repeat(201) })).resolves.toEqual({
      ok: false,
      error: '한 줄 설명은 200자 이하로 입력하세요.',
    });

    signedIn([
      {
        data: null,
        error: {
          message: 'new row violates check constraint "bookmarks_description_length_check"',
          code: '23514',
        },
      },
    ]);
    await expect(updateBookmark('bm-1', { description: '설명' })).resolves.toEqual({
      ok: false,
      error: '한 줄 설명은 200자 이하로 입력하세요.',
    });
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

/**
 * M2 정리 도구의 일괄 삭제. 한 건짜리 `deleteBookmark` 를 여러 번 부르는 대신 `in` 한 문장으로
 * 지운다 — 여기서 못박는 것은 **무엇을 한 문장에 묶는가**(in · 배치 크기)와 **몇 건이 지워졌을 때
 * 성공이라 부르는가**다.
 */
describe('deleteBookmarks', () => {
  it('받은 id 를 in 한 문장으로 지운다 (건수만큼 왕복하지 않는다)', async () => {
    const { ops } = signedIn([{ data: [{ id: 'a' }, { id: 'b' }], error: null }]);

    await expect(deleteBookmarks([' a ', 'b'])).resolves.toEqual({ ok: true });

    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe('bookmarks');
    expect(ops[0].calls.some((call) => call.method === 'delete')).toBe(true);
    // 앞뒤 공백은 다듬어 보낸다(다른 액션과 같은 `asText`).
    expect(argsOf(ops[0], 'in')).toEqual(['id', ['a', 'b']]);
    // 지운 건수를 알아야 "한 건도 못 지웠다"를 가릴 수 있다.
    expect(argsOf(ops[0], 'select')).toEqual(['id']);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('빈 선택은 "요청이 올바르지 않다"로 거부한다 — 0건 삭제를 성공이라 부르지 않는다', async () => {
    // `reorderBookmarks([])` 는 성공이지만(빈 목록을 정렬한 결과는 빈 목록이다) 삭제는 다르다.
    // "링크를 찾을 수 없습니다."(0건 삭제)와도 구분한다 — 이건 요청 자체가 잘못된 것이다.
    const { ops } = signedIn([OK]);

    await expect(deleteBookmarks([])).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
    // 같은 describe 의 다른 실패 경로와 같은 짝 — 아무것도 지우지 않았으면 화면도 다시 그리지 않는다.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('한 건도 지워지지 않으면 지웠다고 하지 않는다 (화면도 다시 그리지 않는다)', async () => {
    signedIn([NO_ROWS]);

    await expect(deleteBookmarks(['없음-1', '없음-2'])).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('일부가 이미 지워져 있어도 나머지를 지웠으면 성공이다 (요청한 끝 상태에 도달했다)', async () => {
    // 고른 뒤 다른 창이 한 건을 먼저 지운 경우. 사용자가 원한 끝 상태("이 둘은 없다")는 이뤄졌다.
    signedIn([{ data: [{ id: 'a' }], error: null }]);

    await expect(deleteBookmarks(['a', 'b'])).resolves.toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('100건을 넘으면 나눠 보낸다 — id 를 다 실은 URL 이 게이트웨이 한도를 넘는다', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `bm-${index}`);
    const { ops } = signedIn([
      { data: ids.slice(0, 100).map((id) => ({ id })), error: null },
      { data: ids.slice(100).map((id) => ({ id })), error: null },
    ]);

    await expect(deleteBookmarks(ids)).resolves.toEqual({ ok: true });

    expect(ops).toHaveLength(2);
    expect(argsOf(ops[0], 'in')).toEqual(['id', ids.slice(0, 100)]);
    expect(argsOf(ops[1], 'in')).toEqual(['id', ids.slice(100)]);
  });

  it('앞 묶음이 지워진 뒤 뒤 묶음이 실패하면, 실패를 알리면서도 화면은 다시 그린다', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `bm-${index}`);
    signedIn([
      { data: ids.slice(0, 100).map((id) => ({ id })), error: null },
      { data: null, error: { message: 'boom', code: '08006' } },
    ]);

    const result = await deleteBookmarks(ids);

    expect(result.ok).toBe(false);
    // 100건은 이미 없어졌다 — 화면이 옛 목록을 들고 있으면 지워진 링크를 다시 고르게 된다.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('fetch 가 거부돼도 던지지 않고 실패를 돌려준다 (Promise.allSettled)', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `bm-${index}`);
    signedIn([
      { data: ids.slice(0, 100).map((id) => ({ id })), error: null },
      { rejectWith: new TypeError('fetch failed') },
    ]);

    await expect(deleteBookmarks(ids)).resolves.toEqual({
      ok: false,
      error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[mutations]'),
      expect.any(TypeError),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout'); // 앞 묶음은 이미 지워졌다
  });

  it('아무것도 지워지지 않은 채 거부되면 화면을 다시 그리지 않는다', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `bm-${index}`);
    signedIn([NO_ROWS, { rejectWith: new TypeError('fetch failed') }]);

    const result = await deleteBookmarks(ids);

    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('DB 오류는 사용자 문구로 바꾸고 원문은 서버 로그에만 남긴다', async () => {
    signedIn([{ data: null, error: { message: 'JWT expired', code: 'PGRST301' } }]);

    await expect(deleteBookmarks(['a'])).resolves.toEqual({
      ok: false,
      error: '권한이 없습니다. 다시 로그인해 주세요.',
    });
  });
});

describe('reorderBookmarks — atomic admin RPC', () => {
  it('화면의 ID 순서만 단일 RPC로 보내고 성공 후 전체 화면을 갱신한다', async () => {
    const { ops } = signedIn([{ data: 2, error: null }]);

    await expect(reorderBookmarks(['b', 'a'])).resolves.toEqual({ ok: true });

    expect(ops).toEqual([
      {
        table: 'rpc:admin_reorder_bookmarks',
        calls: [{ method: 'rpc', args: [{ ordered_ids: ['b', 'a'] }] }],
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('같은 sort_order 두 행도 RPC가 고유 번호로 재배치하는 계약이다', async () => {
    const { ops } = signedIn([{ data: 2, error: null }]);

    await expect(reorderBookmarks(['same-slot-b', 'same-slot-a'])).resolves.toEqual({ ok: true });

    expect(argsOf(ops[0], 'rpc')).toEqual([
      { ordered_ids: ['same-slot-b', 'same-slot-a'] },
    ]);
  });

  it('그 사이 모든 ID가 삭제됐다는 P0002는 찾을 수 없음으로 바꾼다', async () => {
    signedIn([{ data: null, error: { message: 'not found', code: 'P0002' } }]);

    await expect(reorderBookmarks(['a', 'b'])).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
  });

  it('DB가 잘못된 배열로 거부한 22023은 요청 오류로 바꾼다', async () => {
    signedIn([{ data: null, error: { message: 'invalid array', code: '22023' } }]);

    await expect(reorderBookmarks(['a'])).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
  });

  it('비정상 성공 응답은 저장 성공으로 오보하지 않는다', async () => {
    signedIn([{ data: 0, error: null }]);

    await expect(reorderBookmarks(['a'])).resolves.toEqual({
      ok: false,
      error: '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('id가 아닌 값이 섞이면 RPC 전에 거부한다', async () => {
    const { ops } = signedIn([OK]);

    await expect(reorderBookmarks(['a', '  '])).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
  });
});

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
      error: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  });

  it('진단은 서버 로그에만 남긴다', async () => {
    signedIn([NO_ROWS, { data: null, error: LEAKY }]);

    await createCategory('새 분류');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[mutations]'), LEAKY);
  });

  it.each([
    ['42501', 'new row violates row-level security policy'],
    ['PGRST301', 'JWT expired'],
  ])('권한·만료(%s)는 다시 로그인하라고 안내한다', async (code, message) => {
    // PGRST301 은 PostgREST 가 DB 에 닿기도 전에 막은 것이라 코드가 다르지만, 사용자가 할 일은
    // 42501 과 똑같다 — 다시 로그인. 문구를 나누면 "왜 다르지"만 남는다.
    signedIn([NO_ROWS, { data: null, error: { message, code } }]);

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

describe('setFavorite — 토글이 아니라 방향을 받는다', () => {
  it('담을 때는 맨 뒤에 붙인다 — 지금 최대 fav_order + 1', async () => {
    const { ops } = signedIn([{ data: [{ fav_order: 7 }], error: null }, OK]);

    await expect(setFavorite('bm-1', true)).resolves.toEqual({ ok: true });

    expect(ops).toHaveLength(2);
    expect(argsOf(ops[1], 'update')).toEqual([{ is_favorite: true, fav_order: 8 }]);
    expect(argsOf(ops[1], 'eq')).toEqual(['id', 'bm-1']);
  });

  it('아무것도 담겨 있지 않으면 첫 자리는 0 이다', async () => {
    const { ops } = signedIn([NO_ROWS, OK]);

    await expect(setFavorite('bm-1', true)).resolves.toEqual({ ok: true });

    expect(argsOf(ops[1], 'update')).toEqual([{ is_favorite: true, fav_order: 0 }]);
  });

  it('뺄 때는 자리를 묻지 않는다 — 왕복 한 번이고 fav_order 를 건드리지 않는다', async () => {
    const { ops } = signedIn([OK]);

    await expect(setFavorite('bm-1', false)).resolves.toEqual({ ok: true });

    expect(ops).toHaveLength(1);
    expect(argsOf(ops[0], 'update')).toEqual([{ is_favorite: false }]);
  });

  it('같은 방향으로 두 번 불러도 결과가 같다 (멱등 — 화면이 낡아도 안전하다)', async () => {
    signedIn([NO_ROWS, OK]);
    await expect(setFavorite('bm-1', true)).resolves.toEqual({ ok: true });

    signedIn([{ data: [{ fav_order: 0 }], error: null }, OK]);
    await expect(setFavorite('bm-1', true)).resolves.toEqual({ ok: true });
  });

  it('없는 링크면 실패하고 화면을 다시 그리지 않는다', async () => {
    signedIn([NO_ROWS, NO_ROWS]);

    await expect(setFavorite('bm-없음', true)).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('빈 id 는 DB 에 묻지도 않고 거부한다', async () => {
    const { ops } = signedIn([]);

    await expect(setFavorite('  ', true)).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
  });

  it('자리 조회가 실패하면 그 실패를 돌려주고 쓰지 않는다', async () => {
    const { ops } = signedIn([{ data: null, error: { message: 'boom', code: '42501' } }]);

    await expect(setFavorite('bm-1', true)).resolves.toEqual({
      ok: false,
      error: '권한이 없습니다. 다시 로그인해 주세요.',
    });
    expect(ops).toHaveLength(1);
  });
});

/** 즐겨찾기 자리 조회 응답. `slots` 의 `fav_order` 판이다. */
function favSlots(rows: { id: string; fav_order: number }[]) {
  return { data: rows, error: null };
}

describe('reorderFavorites — 즐겨찾기 자리만 맞바꾼다', () => {
  it('fav_order 를 쓴다 — sort_order 는 건드리지 않는다', async () => {
    const { ops } = signedIn([
      favSlots([
        { id: 'a', fav_order: 3 },
        { id: 'b', fav_order: 4 },
      ]),
      OK,
      OK,
    ]);

    await expect(reorderFavorites(['b', 'a'])).resolves.toEqual({ ok: true });

    expect(argsOf(ops[0], 'select')).toEqual(['id, fav_order']);
    expect(ops.slice(1).map((op) => [argsOf(op, 'eq'), argsOf(op, 'update')])).toEqual([
      [['id', 'b'], [{ fav_order: 3 }]],
      [['id', 'a'], [{ fav_order: 4 }]],
    ]);
  });

  it('한 묶음의 id 만 와도 그 묶음이 쥔 자리 안에서만 바뀐다', async () => {
    // 홈은 즐겨찾기를 세 묶음으로 나눠 각각 따로 끈다 — 'AI 소식' 두 장만 보내는 상황이다.
    const { ops } = signedIn([
      favSlots([
        { id: 'news-1', fav_order: 10 },
        { id: 'news-2', fav_order: 40 },
      ]),
      OK,
      OK,
    ]);

    await expect(reorderFavorites(['news-2', 'news-1'])).resolves.toEqual({ ok: true });

    // 10 과 40 이라는 원래 자리가 유지된다 — 다른 묶음이 쓰는 사잇값(20·30)은 손대지 않는다.
    expect(ops.slice(1).map((op) => argsOf(op, 'update'))).toEqual([
      [{ fav_order: 10 }],
      [{ fav_order: 40 }],
    ]);
  });

  it('제자리에 놓으면 아무것도 쓰지 않고 화면도 다시 그리지 않는다', async () => {
    const { ops } = signedIn([favSlots([{ id: 'a', fav_order: 2 }])]);

    await expect(reorderFavorites(['a'])).resolves.toEqual({ ok: true });

    expect(ops).toHaveLength(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('그 사이 지워진 id 는 조용히 빠지고 남은 것들끼리 자리를 맞바꾼다', async () => {
    const { ops } = signedIn([
      favSlots([
        { id: 'a', fav_order: 1 },
        { id: 'c', fav_order: 5 },
      ]),
      OK,
      OK,
    ]);

    await expect(reorderFavorites(['c', 'b-지워짐', 'a'])).resolves.toEqual({ ok: true });

    expect(ops.slice(1).map((op) => [argsOf(op, 'eq'), argsOf(op, 'update')])).toEqual([
      [['id', 'c'], [{ fav_order: 1 }]],
      [['id', 'a'], [{ fav_order: 5 }]],
    ]);
  });

  it('하나도 못 찾으면 실패다', async () => {
    signedIn([favSlots([])]);

    await expect(reorderFavorites(['없음'])).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
  });

  it('빈 목록은 아무 일도 하지 않고 성공이다', async () => {
    const { ops } = signedIn([]);

    await expect(reorderFavorites([])).resolves.toEqual({ ok: true });
    expect(ops).toHaveLength(0);
  });
});
