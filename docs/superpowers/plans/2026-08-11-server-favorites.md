# 즐겨찾기 서버 이전 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 즐겨찾기를 브라우저 localStorage에서 DB로 옮겨, 관리자가 담은 한 벌이 어느 컴퓨터·어느 방문자에게나 똑같이 보이게 한다.

**Architecture:** `bookmarks` 테이블에 `is_favorite`·`fav_order` 두 컬럼을 더한다. `getAllData`가 이미 전 행을 읽으므로 쿼리 수는 그대로고, 쓰기는 기존 `bm_write` RLS(관리자 한 명)가 덮어 새 정책이 없다. 화면은 서버가 준 값을 그대로 그리고, 핀은 관리자 전용 편집 도구가 된다. localStorage 저장소와 그것을 감싸던 우회 장치들은 전부 사라진다.

**Tech Stack:** Next.js 16 App Router(서버 컴포넌트 + 서버 액션) · React 19 · TypeScript · Supabase(Postgres/RLS) · Vitest + React Testing Library.

**설계 문서:** `docs/superpowers/specs/2026-08-11-server-favorites-design.md`

---

## ⚠️ 실행 환경 주의 (모든 태스크에 해당)

- **테스트·빌드는 반드시 PowerShell에서, 대문자 드라이브 경로로 실행한다.** Git Bash의 소문자 경로(`/e/favorite_site`)에서는 vitest가 오작동한다.
- 테스트 명령: `npm test` (전체) · `npx vitest run <경로>` (한 파일)
- 타입 검사: `npm run typecheck` · 린트: `npm run lint`

---

## 파일 구조

**생성**

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0008_server_favorites.sql` | 컬럼 두 개 추가 |
| `scripts/import-favorites.ts` | 브라우저에서 뽑은 id 배열을 DB로 주입 |

**수정**

| 파일 | 무엇이 바뀌나 |
|---|---|
| `lib/types.ts` | `Bookmark`에 두 필드 |
| `lib/queries.ts` | `BOOKMARK_COLUMNS`에 두 칸 |
| `scripts/seed-mapper.ts` | 시드 행에 두 필드 기본값 |
| `lib/favorites.ts` | 훅 삭제 → 순수 모듈. `pickFavorites` 계약 변경 |
| `lib/mutations.ts` | `setFavorite`·`reorderFavorites` 추가, `writeOrder` 컬럼 일반화 |
| `lib/constants.ts` | `FAVS_KEY` 삭제 |
| `components/LinkCard.tsx` | 핀을 관리자 전용으로, `isFaved` prop 제거 |
| `components/useCardHandlers.ts` | 핀 토글이 서버 액션 호출 |
| `components/useCardReorder.ts` | `onCommit` → `commit: () => Promise<ActionResult>` |
| `components/ListView.tsx` | `reorderStore='favorites'`가 서버 액션을 넘김 |
| `components/HomeView.tsx` | `favs` 대신 서버 데이터 |
| `app/(public)/layout.tsx` | 사이드바 개수를 서버에서 계산 |
| `app/(public)/favorites/page.tsx` | `FavoritesView` 흡수 + 문구 |

**삭제**

| 파일 | 이유 |
|---|---|
| `components/SidebarContainer.tsx` (+ `.test.tsx`) | 개수를 브라우저에서 채우던 클라이언트 경계 |
| `components/FavoritesView.tsx` | 서버가 목록을 알므로 page가 직접 그린다 |
| `test/favs.ts` | localStorage 저장소가 없어진다 |

---

## Task 1: 마이그레이션 0006

**Files:**
- Create: `supabase/migrations/0008_server_favorites.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

기존 마이그레이션 규약(상단에 적용 방법·재실행 안전성·근거 주석)을 따른다.

```sql
-- 0008_server_favorites.sql — 즐겨찾기를 브라우저에서 DB 로 옮긴다
--
-- 적용 방법: Supabase SQL Editor 에 전체 붙여넣기 실행(1회). 재실행 안전(`if not exists`).
--
-- ## 왜 옮기나
-- 1단계는 방문자 계정이 없어 즐겨찾기를 브라우저 localStorage 에만 두었다(docs/PRD.md 148-151).
-- 그 결과 담은 브라우저를 벗어나면 홈이 거의 빈 화면이 된다 — 홈의 본문 세 묶음이 전부
-- 즐겨찾기이기 때문이다(components/HomeView.tsx). 2026-08-11 사용자 결정으로 **관리자가 담은
-- 한 벌을 모두의 홈**으로 삼는다.
--
-- ## 왜 새 테이블이 아니라 컬럼인가
-- 공용 한 벌이면 즐겨찾기는 사실상 북마크의 상태다. 컬럼으로 두면 getAllData 가 이미 읽는 행에
-- 실려 와 **쿼리가 늘지 않고**, 쓰기 권한도 기존 bm_write(관리자 한 명)가 그대로 덮어
-- **새 RLS 정책이 필요 없다**. 훗날 방문자 계정이 생기면 favorites(user_id, bookmark_id) 로
-- 옮기고 이 두 컬럼을 버린다.
--
-- ## fav_order 를 따로 두는 이유
-- sort_order 는 **분류 안에서의** 차례다. 재활용하면 홈에서 카드를 끈 것이 카테고리 화면의
-- 순서까지 바꾼다. 두 축은 갈라 두어야 한다.
--
-- ## is_pinned 를 재활용하지 않는 이유
-- '매일 사용하는 사이트'가 걷히며 놀게 된 컬럼이지만(lib/constants.ts) 이미 true 로 남아 있는
-- 행들이 있어, 재활용하면 담은 적 없는 링크가 홈에 뜬다.

alter table bookmarks
  add column if not exists is_favorite boolean not null default false,
  add column if not exists fav_order   int     not null default 0;

-- 인덱스를 만들지 않는다 — 290행이고 getAllData 가 전 행을 읽어 JS 에서 거른다.
-- RLS 정책도 새로 쓰지 않는다 — bm_read(공개 select)·bm_write(관리자 전용)는 컬럼이 아니라
-- 행에 걸리므로 새 컬럼에 자동으로 적용된다.

-- 적용 확인용 조회 (SQL Editor 에서 눈으로 볼 때):
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_name = 'bookmarks' and column_name in ('is_favorite', 'fav_order');
--   → 두 행이 나와야 한다.
```

- [ ] **Step 2: Supabase SQL Editor에서 실행**

Supabase 대시보드 → SQL Editor → 파일 전체 붙여넣기 → Run.
Expected: `Success. No rows returned`

- [ ] **Step 3: 적용 확인**

SQL Editor에서:
```sql
select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'bookmarks' and column_name in ('is_favorite', 'fav_order');
```
Expected: 2행 (`is_favorite`/boolean/false, `fav_order`/integer/0)

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/0008_server_favorites.sql
git commit -m "feat(db): 즐겨찾기를 담을 컬럼 두 개를 bookmarks 에 더한다"
```

---

## Task 2: 타입과 조회 컬럼

새 컬럼을 서버가 읽어 화면까지 실어 나른다. 아직 아무도 쓰지 않지만 값이 흐르기 시작한다.

**Files:**
- Modify: `lib/types.ts:4-8`
- Modify: `lib/queries.ts:31-33`
- Modify: `scripts/seed-mapper.ts`
- Modify: 타입 오류가 나는 모든 테스트 fixture (아래 Step 4)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/queries.test.ts` 맨 아래에 추가한다. 조회가 새 컬럼을 실제로 요청하는지 본다 —
빠뜨리면 화면에는 `undefined`가 흘러 즐겨찾기가 전부 꺼진 것처럼 보인다.

```ts
describe('BOOKMARK_COLUMNS — 즐겨찾기 두 칸', () => {
  it('is_favorite 과 fav_order 를 조회에 포함한다', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./queries.ts', import.meta.url), 'utf8'),
    );

    expect(source).toContain('is_favorite');
    expect(source).toContain('fav_order');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run (PowerShell): `npx vitest run lib/queries.test.ts`
Expected: FAIL — `expected '...' to contain 'is_favorite'`

- [ ] **Step 3: 타입과 컬럼을 더한다**

`lib/types.ts`:
```ts
export type Bookmark = {
  id: string; category_id: string | null; title: string; url: string;
  description: string | null; tags: string[]; favicon_url: string | null;
  is_pinned: boolean; sort_order: number; created_at: string;
  /** 홈·`/favorites` 에 담긴 링크인가 (2026-08-11 — 관리자가 담는 공용 한 벌). */
  is_favorite: boolean;
  /** 즐겨찾기 안에서의 차례. `sort_order`(분류 안에서의 차례)와 **다른 축**이다. */
  fav_order: number;
};
```

`lib/queries.ts`의 `BOOKMARK_COLUMNS`:
```ts
const BOOKMARK_COLUMNS =
  'id, category_id, title, url, description, tags, favicon_url, is_pinned, sort_order, created_at, is_favorite, fav_order';
```

`scripts/seed-mapper.ts` — 시드가 만드는 행에 기본값을 넣는다. `buildSeed`가 북마크 행을
조립하는 자리에 두 필드를 더한다:
```ts
is_favorite: false,
fav_order: 0,
```

- [ ] **Step 4: 타입 검사로 나머지 fixture를 찾아 고친다**

Run (PowerShell): `npm run typecheck`

`Bookmark` 객체 리터럴을 만드는 테스트가 약 20곳 있다(`is_pinned:`를 적어 둔 자리들).
컴파일러가 하나씩 짚어 주므로, 각 리터럴에 다음 두 줄을 더한다:
```ts
is_favorite: false,
fav_order: 0,
```
Expected(고친 뒤): 오류 0건

- [ ] **Step 5: 전체 테스트**

Run (PowerShell): `npm test`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add lib/types.ts lib/queries.ts lib/queries.test.ts scripts/seed-mapper.ts
git add -u
git commit -m "feat(data): 즐겨찾기 두 칸을 타입과 조회에 싣는다"
```

---

## Task 3: `writeOrder` 컬럼 일반화 (리팩터)

순서 저장 헬퍼가 `sort_order`에 하드코딩돼 있다. `fav_order`에도 쓸 수 있게 컬럼을 인자로 받는다.
**동작은 바뀌지 않는다** — 기존 `reorderCategories`·`reorderBookmarks` 테스트가 회귀를 막는다.

**Files:**
- Modify: `lib/mutations.ts:862-896` (`writeOrder`), 호출부 3곳

- [ ] **Step 1: 시그니처와 본문을 고친다**

`lib/mutations.ts`의 `writeOrder`:
```ts
async function writeOrder(
  supabase: WriteClient,
  table: 'categories' | 'bookmarks',
  column: 'sort_order' | 'fav_order',
  entries: readonly OrderEntry[],
  scope: 'top-level-only' | 'any',
): Promise<ActionResult> {
  if (entries.length === 0) return { ok: true };

  const settled = await Promise.allSettled(
    entries.map(({ id, sortOrder }) => {
      const query = supabase.from(table).update({ [column]: sortOrder }).eq('id', id);

      return (scope === 'top-level-only' ? query.is('parent_id', null) : query).select('id');
    }),
  );
```
(나머지 본문은 그대로 두되, 오류 문구의 `${table}`은 `${table}.${column}`으로 바꿔 어느 축의
순서가 실패했는지 로그에서 갈리게 한다.)

- [ ] **Step 2: 호출부 3곳에 `'sort_order'`를 넘긴다**

`reorderCategories`·`reorderBookmarks` 안의 `writeOrder(...)` 호출에 세 번째 인자로
`'sort_order'`를 끼워 넣는다. 예:
```ts
return writeOrder(supabase, 'bookmarks', 'sort_order', changes, 'any');
```

- [ ] **Step 3: 기존 테스트가 그대로 통과하는지 본다**

Run (PowerShell): `npx vitest run lib/mutations.test.ts`
Expected: 전부 PASS (동작 불변 리팩터라 테스트를 고칠 일이 없어야 한다)

- [ ] **Step 4: 커밋**

```bash
git add lib/mutations.ts
git commit -m "refactor(mutations): 순서 저장 헬퍼가 컬럼을 인자로 받는다"
```

---

## Task 4: `setFavorite` 액션

**Files:**
- Modify: `lib/mutations.ts` (링크 섹션 끝, `reorderBookmarks` 앞)
- Test: `lib/mutations.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/mutations.test.ts`의 `ALL_ACTIONS`에 한 줄 더한다 (이 목록이 미인증 전수 검사를 겸한다 —
안 적으면 '모듈 계약' 테스트가 빨간불을 낸다):
```ts
  setFavorite: () => setFavorite('bm-1', true),
```
import에도 `setFavorite`을 더한다.

파일 끝에 동작 테스트를 더한다:
```ts
describe('setFavorite — 방향을 받는다(토글이 아니다)', () => {
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

  it('뺄 때는 자리를 묻지 않는다 — 왕복 한 번이다', async () => {
    const { ops } = signedIn([OK]);

    await expect(setFavorite('bm-1', false)).resolves.toEqual({ ok: true });

    expect(ops).toHaveLength(1);
    expect(argsOf(ops[0], 'update')).toEqual([{ is_favorite: false }]);
  });

  it('없는 링크면 실패한다', async () => {
    signedIn([NO_ROWS, NO_ROWS]);

    await expect(setFavorite('bm-없음', true)).resolves.toEqual({
      ok: false,
      error: '링크를 찾을 수 없습니다.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('빈 id 는 요청 자체를 거부한다', async () => {
    const { ops } = signedIn([]);

    await expect(setFavorite('  ', true)).resolves.toEqual({
      ok: false,
      error: '요청이 올바르지 않습니다.',
    });
    expect(ops).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run (PowerShell): `npx vitest run lib/mutations.test.ts`
Expected: FAIL — `setFavorite is not exported` / `does not provide an export named 'setFavorite'`

- [ ] **Step 3: 액션을 구현한다**

`lib/mutations.ts`에 추가한다:
```ts
/**
 * 링크를 즐겨찾기에 담거나 뺀다 (2026-08-11 — 공용 한 벌).
 *
 * **토글이 아니라 방향을 받는다.** 화면은 서버가 내려준 `is_favorite` 을 이미 알고 있으므로,
 * 서버에서 읽고-뒤집고-쓰는 경합 구간을 만들지 않는다. 같은 요청이 두 번 와도 결과가 같다.
 *
 * 담을 때만 자리를 한 번 묻는다 — 새로 담긴 것은 **맨 뒤**여야 이미 세워 둔 차례가 흔들리지
 * 않는다. 뺄 때는 `fav_order` 를 건드리지 않는다: 남은 것들끼리의 상대 순서는 값이 비어도
 * 그대로이고, 다시 담기면 어차피 맨 뒤로 간다.
 *
 * @param id 링크 id
 * @param next 담긴 상태로 만들 것인가
 */
export async function setFavorite(id: string, next: boolean): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const target = id.trim();
  if (target === '') return fail(INVALID_REQUEST);

  const patch: { is_favorite: boolean; fav_order?: number } = { is_favorite: next };

  if (next) {
    // 지금 담긴 것 중 맨 뒤 자리. 한 행만 있으면 되므로 내림차순 1건만 받는다.
    const last = await supabase
      .from('bookmarks')
      .select('fav_order')
      .eq('is_favorite', true)
      .order('fav_order', { ascending: false })
      .limit(1);

    if (last.error !== null) return describeFailure('즐겨찾기 자리 조회', last.error);

    const rows = (last.data ?? []) as { fav_order: number }[];
    patch.fav_order = rows.length === 0 ? 0 : rows[0].fav_order + 1;
  }

  const written = await supabase.from('bookmarks').update(patch).eq('id', target).select('id');
  if (written.error !== null) return describeFailure('즐겨찾기 저장', written.error);
  if (countRows(written.data) === 0) return fail(BOOKMARK_NOT_FOUND);

  return succeed();
}
```

- [ ] **Step 4: 통과를 확인한다**

Run (PowerShell): `npx vitest run lib/mutations.test.ts`
Expected: PASS (미인증 전수 검사 포함)

- [ ] **Step 5: 커밋**

```bash
git add lib/mutations.ts lib/mutations.test.ts
git commit -m "feat(mutations): 즐겨찾기를 담고 빼는 서버 액션"
```

---

## Task 5: `reorderFavorites` 액션

**Files:**
- Modify: `lib/mutations.ts` (`reorderBookmarks` 바로 뒤)
- Test: `lib/mutations.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`ALL_ACTIONS`에 더한다:
```ts
  reorderFavorites: () => reorderFavorites(['bm-1', 'bm-2']),
```
import에도 `reorderFavorites`를 더한다.

`slots` 헬퍼는 `sort_order`용이므로 즐겨찾기용 헬퍼를 파일 하단에 하나 더 둔다:
```ts
function favSlots(rows: { id: string; fav_order: number }[]) {
  return { data: rows, error: null };
}
```

테스트:
```ts
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

  it('그 사이 지워진 id 는 조용히 빠진다', async () => {
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
});
```

- [ ] **Step 2: 실패를 확인한다**

Run (PowerShell): `npx vitest run lib/mutations.test.ts`
Expected: FAIL — `does not provide an export named 'reorderFavorites'`

- [ ] **Step 3: 액션을 구현한다**

`reorderBookmarks`와 같은 '자리 맞바꾸기' 알고리즘이다. 조회 컬럼과 쓰기 컬럼만 다르다.

```ts
/**
 * 즐겨찾기의 차례를 다시 쓴다 (J5 드래그 정렬).
 *
 * `reorderBookmarks` 와 **같은 방식**이다 — 0..n 으로 다시 매기지 않고, 받은 id 들이 지금 쥐고
 * 있는 `fav_order` 값들만 모아 새 차례대로 나눠 준다. 그래서 홈의 세 묶음처럼 **한 묶음의 id 만
 * 와도** 다른 묶음이 쓰는 사잇값을 건드리지 않아 상대 순서가 흔들리지 않는다.
 *
 * 없는 id 는 조용히 빠진다(그 사이 다른 창에서 지워졌거나 즐겨찾기에서 빠진 링크).
 */
export async function reorderFavorites(orderedIds: string[]): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const ids = asIdList(orderedIds);
  if (ids === null) return fail(INVALID_REQUEST);
  if (ids.length === 0) return { ok: true };

  const found = await supabase.from('bookmarks').select('id, fav_order').in('id', ids);
  if (found.error !== null) return describeFailure('즐겨찾기 순서 조회', found.error);

  const current = new Map(
    ((found.data ?? []) as FavOrderRow[]).map((row) => [row.id, row.fav_order] as const),
  );
  const targets = ids.filter((id) => current.has(id));
  if (targets.length === 0) return fail(BOOKMARK_NOT_FOUND);

  const slots = targets.map((id) => current.get(id) ?? 0).sort((left, right) => left - right);

  const changes = targets.flatMap((id, index) =>
    current.get(id) === slots[index] ? [] : [{ id, sortOrder: slots[index] }],
  );
  if (changes.length === 0) return { ok: true };

  return writeOrder(supabase, 'bookmarks', 'fav_order', changes, 'any');
}
```

`OrderRow` 옆에 타입을 하나 더 둔다:
```ts
type FavOrderRow = { id: string; fav_order: number };
```

- [ ] **Step 4: 통과를 확인한다**

Run (PowerShell): `npx vitest run lib/mutations.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/mutations.ts lib/mutations.test.ts
git commit -m "feat(mutations): 즐겨찾기 순서를 서버에 저장하는 액션"
```

---

## Task 6: `pickFavorites`를 서버 데이터 기준으로

**이 태스크가 끝나면 홈이 서버 데이터만으로 그려진다** — 신고된 증상이 여기서 사라진다.
`useFavorites` 훅은 아직 남아 있지만(Task 9에서 정리) `pickFavorites`에는 넘기지 않는다.

**Files:**
- Modify: `lib/favorites.ts:222-241`
- Modify: `components/HomeView.tsx:167`
- Modify: `components/FavoritesView.tsx:49`
- Test: `lib/favorites.test.ts:429-469`

- [ ] **Step 1: `pickFavorites` 테스트를 새 계약으로 갈아 쓴다**

`lib/favorites.test.ts`의 `describe('pickFavorites')` 블록을 통째로 아래로 교체한다.
(같은 파일의 `describe('useFavorites')` 블록은 Task 9까지 그대로 둔다.)

```ts
describe('pickFavorites', () => {
  const bm = (id: string, is_favorite: boolean, fav_order: number) =>
    ({ ...BOOKMARKS[0], id, is_favorite, fav_order }) as BookmarkWithCount;

  it('담긴 것만 남긴다', () => {
    const items = pickFavorites([bm('a', true, 0), bm('b', false, 0), bm('c', true, 1)]);

    expect(items.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('fav_order 순으로 세운다 — 배열이 온 차례가 아니다', () => {
    const items = pickFavorites([bm('a', true, 5), bm('b', true, 1), bm('c', true, 3)]);

    expect(items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('fav_order 가 같으면 id 로 가른다 — 순서가 요청마다 흔들리지 않게', () => {
    const items = pickFavorites([bm('b', true, 0), bm('a', true, 0)]);

    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('담긴 것이 없으면 빈 배열이다', () => {
    expect(pickFavorites([bm('a', false, 0)])).toEqual([]);
  });

  it('원본 배열을 건드리지 않는다', () => {
    const input = [bm('a', true, 2), bm('b', true, 1)];
    const before = input.map((item) => item.id);

    pickFavorites(input);

    expect(input.map((item) => item.id)).toEqual(before);
  });

  it('같은 북마크 객체를 그대로 돌려준다 (복사하지 않는다)', () => {
    const first = bm('a', true, 0);

    expect(pickFavorites([first])[0]).toBe(first);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run (PowerShell): `npx vitest run lib/favorites.test.ts`
Expected: FAIL — `pickFavorites` 가 인자 두 개를 요구해 타입/런타임 오류

- [ ] **Step 3: 함수를 갈아 쓴다**

`lib/favorites.ts`의 `pickFavorites`를 교체한다:
```ts
/**
 * 담긴 링크만 **담긴 차례대로** 골라낸다. 홈의 즐겨찾기 섹션과 `/favorites` 가 공유하는 규칙이라
 * 한곳에 둔다 — 두 화면이 같은 목록을 같은 순서로 보여야 한다.
 *
 * 차례는 `fav_order` 가 정한다(2026-08-11 서버 이전). 동점이면 `id` 로 가른다 — 타이브레이커가
 * 없으면 같은 값끼리의 순서가 요청마다 달라져 진단이 어려워진다(lib/queries.ts 의 정렬과 같은 이유).
 *
 * 순수 함수다 — 인자를 건드리지 않고 북마크 객체도 복사하지 않는다.
 */
export function pickFavorites(bookmarks: readonly BookmarkWithCount[]): BookmarkWithCount[] {
  return bookmarks
    .filter((bookmark) => bookmark.is_favorite)
    .sort((left, right) =>
      left.fav_order !== right.fav_order
        ? left.fav_order - right.fav_order
        : left.id.localeCompare(right.id),
    );
}
```
`.filter`가 이미 새 배열을 만들므로 `.sort`가 원본을 건드리지 않는다.

- [ ] **Step 4: 호출부 두 곳을 고친다**

`components/HomeView.tsx:167`:
```tsx
  const favItems = pickFavorites(bookmarks);
```

`components/FavoritesView.tsx:49`:
```tsx
  const items = pickFavorites(bookmarks);
```

- [ ] **Step 5: 통과를 확인한다**

Run (PowerShell): `npx vitest run lib/favorites.test.ts` → PASS
Run (PowerShell): `npm run typecheck` → 오류 0건

- [ ] **Step 6: 커밋**

```bash
git add lib/favorites.ts lib/favorites.test.ts components/HomeView.tsx components/FavoritesView.tsx
git commit -m "feat(favorites): 담긴 목록을 서버 데이터에서 고른다"
```

---

## Task 7: 핀을 관리자 전용 편집 도구로

**Files:**
- Modify: `components/LinkCard.tsx:19-26, 241, 279, 332-342`
- Modify: `components/useCardHandlers.ts`
- Modify: `components/HomeView.tsx`, `components/ListView.tsx` (넘기던 `isFaved` 제거)
- Test: `components/LinkCard.test.tsx`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`components/LinkCard.test.tsx`에 더한다:
```tsx
describe('핀 — 관리자 전용 (2026-08-11 공용 즐겨찾기)', () => {
  it('비관리자 응답에는 핀 마크업이 실리지 않는다 (감추는 것이 아니다)', () => {
    render(<LinkCard bookmark={{ ...BOOKMARKS[0], is_favorite: true }} showPin />);

    expect(screen.queryByRole('button', { name: /즐겨찾기/ })).toBeNull();
  });

  it('관리자에게는 보인다', () => {
    render(<LinkCard bookmark={{ ...BOOKMARKS[0], is_favorite: true }} showPin isAdmin />);

    expect(screen.getByRole('button', { name: /즐겨찾기/ })).toBeInTheDocument();
  });

  it('담긴 상태는 북마크가 들고 온다 — 별도 prop 이 없다', () => {
    render(<LinkCard bookmark={{ ...BOOKMARKS[0], is_favorite: true }} showPin isAdmin />);

    expect(screen.getByRole('button', { name: /즐겨찾기/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('담기지 않았으면 aria-pressed 가 false 다', () => {
    render(<LinkCard bookmark={{ ...BOOKMARKS[0], is_favorite: false }} showPin isAdmin />);

    expect(screen.getByRole('button', { name: /즐겨찾기/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run (PowerShell): `npx vitest run components/LinkCard.test.tsx`
Expected: FAIL — 비관리자에게도 핀이 보인다

- [ ] **Step 3: 카드를 고친다**

`components/LinkCard.tsx` — `isFaved` prop 선언(25행)과 기본값(241행)을 지우고, 대신 본문 위쪽에서
북마크에서 뽑는다:
```tsx
  // 담긴 상태는 서버가 준 행에 실려 온다 — 화면이 따로 들고 다니지 않는다(2026-08-11).
  const isFaved = bookmark.is_favorite;
```

`showPin`의 JSDoc을 고친다:
```tsx
  /**
   * 핀 노출 — 홈의 '운영 중' 섹션만 false.
   *
   * **`isAdmin` 과 함께여야 실제로 그려진다.** 즐겨찾기가 공용이 된 뒤(2026-08-11) 핀은
   * 개인 도구가 아니라 연필·휴지통과 같은 편집 도구다.
   */
  showPin?: boolean;
```

핀 버튼의 조건(332행)에 게이트를 더한다:
```tsx
          {showPin && isAdmin && (
```

- [ ] **Step 4: 핀 클릭이 서버로 가게 한다**

`components/useCardHandlers.ts` — `useFavorites` import를 `favToastText`만 남기고,
`setFavorite`을 부른다. `CardHandlers`에서 `favs`를 지운다:

```ts
import { favToastText } from '@/lib/favorites';
import { setFavorite } from '@/lib/mutations';
import { REQUEST_FAILED } from '@/lib/constants';
```

```ts
export type CardHandlers = {
  /** 카드 핀 클릭 (D6) — 관리자만 닿는 경로다(LinkCard 가 비관리자에게는 그리지 않는다). */
  handleToggleFav: (id: string) => void;
  handleOpen: (id: string) => void;
  openMany: (items: readonly BookmarkWithCount[], groupLabel: string) => void;
};
```

```ts
  /**
   * 핀 토글 — 담고/빼고 토스트로 알린다(DESIGN_SPEC 7장).
   *
   * 방향은 **서버가 준 지금 값**에서 뒤집어 정한다(`setFavorite` 이 토글이 아니라 방향을 받는
   * 이유). 낙관적 갱신은 두지 않는다 — 연필·휴지통과 같이 왕복을 기다린 뒤 `revalidatePath` 로
   * 반영된다.
   *
   * **반드시 try/catch 로 감싼다.** 트랜지션 밖이어도 거부된 요청이 그대로 올라가면 공개 화면 위
   * 유일한 경계인 `app/global-error.tsx` 가 화면 전체를 오류 화면으로 바꾼다.
   */
  const handleToggleFav = useCallback(
    (id: string) => {
      const bookmark = bookmarks.find((item) => item.id === id);
      if (bookmark === undefined) return;

      const next = !bookmark.is_favorite;

      void (async () => {
        try {
          const result = await setFavorite(id, next);
          toast(result.ok ? favToastText(bookmark.title, next) : result.error);
        } catch (error) {
          console.error('[useCardHandlers] 즐겨찾기 저장 요청이 거부됐다', error);
          toast(REQUEST_FAILED);
        }
      })();
    },
    [bookmarks],
  );
```
반환에서 `favs`를 뺀다:
```ts
  return { handleToggleFav, handleOpen, openMany };
```
(`reorderFavs`는 Task 8에서 없앤다. 이 태스크에서는 `useFavorites().reorder`를 계속 흘려보내되
`favs`만 걷어낸다.)

- [ ] **Step 5: 두 화면에서 `isFaved` 전달을 걷어낸다**

`components/HomeView.tsx`·`components/ListView.tsx`에서 카드에 넘기던
`isFaved={favs.has(bookmark.id)}` 형태의 prop을 지우고, 구조분해에서 `favs`도 뺀다.

Run (PowerShell): `npm run typecheck` — 남은 자리를 컴파일러가 짚어 준다.

- [ ] **Step 6: 통과를 확인한다**

Run (PowerShell): `npm test`
Expected: 전부 PASS. 실패한다면 대개 "비관리자로 렌더하고 핀을 찾던" 옛 테스트다 —
`isAdmin`을 주도록 고친다.

- [ ] **Step 7: 커밋**

```bash
git add -u
git commit -m "feat(card): 핀을 관리자 전용 편집 도구로 바꾸고 서버에 저장한다"
```

---

## Task 8: 드래그 정렬을 서버로

**Files:**
- Modify: `components/useCardReorder.ts:51-121`
- Modify: `components/ListView.tsx:78-85, 142-155`
- Modify: `components/HomeView.tsx:194-198`
- Modify: `components/useCardHandlers.ts` (`reorderFavs` 제거)
- Test: `components/useCardReorder.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`components/useCardReorder.test.ts`에 더한다:
```ts
it('넘겨받은 저장 함수가 실패해도 던지지 않고 토스트로 접는다', async () => {
  const commit = vi.fn().mockResolvedValue({ ok: false, error: '순서를 저장하지 못했습니다.' });

  // (이 파일의 기존 드래그 헬퍼로 카드를 끌어 놓는다 — 기존 테스트와 같은 방식)
  await dropCardOnto(commit, 'b', 'a');

  expect(commit).toHaveBeenCalledWith(['b', 'a']);
  expect(toast).toHaveBeenCalledWith('순서를 저장하지 못했습니다.');
});

it('넘겨받은 저장 함수가 거부돼도(네트워크 단절) 오류 경계로 올라가지 않는다', async () => {
  const commit = vi.fn().mockRejectedValue(new Error('offline'));

  await dropCardOnto(commit, 'b', 'a');

  expect(toast).toHaveBeenCalledWith(REQUEST_FAILED);
});
```
(`dropCardOnto`는 이 파일에 이미 있는 드래그 시뮬레이션 헬퍼를 그대로 쓴다. 이름이 다르면
기존 테스트가 쓰는 것을 그대로 따른다.)

- [ ] **Step 2: 실패를 확인한다**

Run (PowerShell): `npx vitest run components/useCardReorder.test.ts`
Expected: FAIL — 지금은 `onCommit` 경로가 동기라 실패를 다루지 않는다

- [ ] **Step 3: 훅을 고친다**

`components/useCardReorder.ts` — `onCommit` 분기를 없애고 **저장 함수 자체를 갈아 끼우는**
모양으로 바꾼다. 두 경로가 같은 오류 처리를 타게 된다.

```ts
/**
 * @param commit 저장할 차례를 넘긴다. 주지 않으면 `reorderBookmarks`(분류 안의 `sort_order`)로
 *   보낸다. 즐겨찾기 화면은 `reorderFavorites`(`fav_order`)를 넘긴다 — 두 축은 다른 컬럼이다.
 */
export function useCardReorder<T extends { id: string }>(
  items: readonly T[],
  enabled: boolean,
  commit: (orderedIds: string[]) => Promise<ActionResult> = reorderBookmarks,
): CardReorder<T> {
```

`handleDrop`의 트랜지션 안을 아래로 교체한다(99-120행의 분기가 사라진다):
```ts
    reordering.current = true;
    startTransition(async () => {
      moveCard({ sourceId, targetId });

      // **트랜지션 안에서 던지면 가장 가까운 오류 경계로 올라간다** — 공개 화면 위의 경계는
      // `app/global-error.tsx` 하나뿐이라 순서 저장 한 번이 거부된 것으로 화면 전체가 오류
      // 화면이 된다. 잡아서 실패 결과로 접는다(관리 화면의 `run` 과 같은 계약).
      let failed: string | null = null;
      try {
        const result = await commit(orderedIds);
        if (!result.ok) failed = result.error;
      } catch (error) {
        console.error('[useCardReorder] 순서 저장 요청이 거부됐다', error);
        failed = REQUEST_FAILED;
      }

      reordering.current = false;
      if (failed !== null) toast(failed);
    });
```
import에 타입을 더한다:
```ts
import { reorderBookmarks, type ActionResult } from '@/lib/mutations';
```

- [ ] **Step 4: 호출부를 고친다**

`components/ListView.tsx` — `reorderStore`의 JSDoc을 고치고(78-85행):
```tsx
  /**
   * 드래그로 바꾼 순서를 **어느 축에 저장하는가** (J5).
   *
   * - `'server'`(기본) — `sort_order`. 분류 안에서의 차례다.
   * - `'favorites'` — `fav_order`. `/favorites` 전용이다. 즐겨찾기의 차례는 분류의 차례와
   *   다른 축이라, 이 화면의 드래그를 `sort_order` 로 보내면 엉뚱한 분류들의 순서가 흔들린다.
   */
  reorderStore?: 'server' | 'favorites';
```
훅 호출(142-155행)에서 `reorderFavs` 대신 서버 액션을 넘긴다:
```tsx
  const { handleToggleFav, handleOpen, openMany } = useCardHandlers(bookmarks);

  const reorder = useCardReorder(
    bookmarks,
    isAdmin,
    reorderStore === 'favorites' ? reorderFavorites : undefined,
  );
```
import에 `reorderFavorites`를 더한다.

`components/HomeView.tsx:194-198` — 세 묶음이 `reorderFavs` 대신 서버 액션을 쓴다:
```tsx
  const favOrders = {
    'AI 소식': useCardReorder(favGroups['AI 소식'], isAdmin, reorderFavorites),
    'AI 서비스': useCardReorder(favGroups['AI 서비스'], isAdmin, reorderFavorites),
    '업무용 서비스': useCardReorder(favGroups['업무용 서비스'], isAdmin, reorderFavorites),
  };
```
구조분해에서 `reorderFavs`를 빼고 import에 `reorderFavorites`를 더한다.

`components/useCardHandlers.ts` — `reorderFavs`를 `CardHandlers`와 반환에서 지우고,
남아 있던 `useFavorites` import를 삭제한다.

- [ ] **Step 5: 통과를 확인한다**

Run (PowerShell): `npm test`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add -u
git commit -m "feat(reorder): 즐겨찾기 차례도 서버에 저장한다"
```

---

## Task 9: localStorage 잔재 일소

여기서 훅과 우회 장치들이 사라진다. **순증 코드량이 음수가 되는 태스크다.**

**Files:**
- Modify: `lib/favorites.ts` (훅 전체 삭제 → 순수 모듈)
- Modify: `lib/favorites.test.ts` (`describe('useFavorites')` 블록 전체 삭제)
- Modify: `lib/constants.ts:32` (`FAVS_KEY` 삭제)
- Modify: `components/card/DeleteConfirm.tsx:155` 및 그 호출
- Modify: `app/(public)/layout.tsx:3, 194`
- Modify: `app/(public)/favorites/page.tsx`
- Delete: `components/SidebarContainer.tsx`, `components/SidebarContainer.test.tsx`
- Delete: `components/FavoritesView.tsx`
- Delete: `test/favs.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`app/(public)/favorites/page.test.tsx`에 더한다:
```tsx
it('방문자에게는 핀을 누르라고 말하지 않는다 — 누를 핀이 없다', async () => {
  render(await FavoritesPage());

  expect(screen.getByText(/아직 담긴 즐겨찾기가 없습니다/)).toBeInTheDocument();
  expect(screen.queryByText(/핀을 눌러/)).toBeNull();
});

it('설명에 브라우저 저장 문구가 없다 — 이제 서버에 있다', async () => {
  render(await FavoritesPage());

  expect(screen.queryByText(/이 브라우저에만/)).toBeNull();
});
```
(이 파일의 기존 테스트가 쓰는 모킹 방식을 그대로 따른다 — 관리자 세션과 `getAllData`를
어떻게 세우는지 파일 상단을 보고 맞춘다. 담긴 링크가 없는 상태로 렌더해야 한다.)

- [ ] **Step 2: 실패를 확인한다**

Run (PowerShell): `npx vitest run "app/(public)/favorites/page.test.tsx"`
Expected: FAIL — 지금 빈 문구가 `목록에서 카드의 핀을 눌러보세요` 다

- [ ] **Step 3: `lib/favorites.ts`를 순수 모듈로 줄인다**

파일에서 다음을 **전부** 지운다: `'use client'`, React import, `Favorites` 타입,
`SERVER_SNAPSHOT`, `memoryFavs`, `cachedRaw`/`cachedFavs`, `listeners`, `parseFavs`,
`safeRead`, `safeWrite`, `getSnapshot`, `getServerSnapshot`, `emit`, `handleStorage`,
`subscribe`, `commit`, `useFavorites`, `sameOrder`.

남는 것은 `pickFavorites`와 `favToastText` 둘뿐이다. 파일 상단 주석을 이렇게 둔다:
```ts
/**
 * 즐겨찾기 순수 헬퍼. **저장소는 DB 다** — 2026-08-11 에 브라우저 localStorage 에서 옮겼다
 * (설계: docs/superpowers/specs/2026-08-11-server-favorites-design.md).
 *
 * 담긴 목록은 `bookmarks.is_favorite`·`fav_order` 에 있고 서버가 화면까지 실어 나른다.
 * 이 파일에는 상태도 훅도 없다 — 고르는 규칙과 문구만 있다.
 */
```

- [ ] **Step 4: `describe('useFavorites')` 블록을 지운다**

`lib/favorites.test.ts`의 36-427행(`describe('useFavorites', …)` 전체)을 삭제한다.
파일 상단에서 쓰이지 않게 된 import(`renderHook`, `act`, `test/favs` 등)도 함께 지운다.
`describe('pickFavorites')`와 `describe('favToastText')`는 남긴다.

- [ ] **Step 5: `FAVS_KEY`를 지운다**

`lib/constants.ts:32`의 한 줄을 삭제한다. `VISITOR_KEY`는 클릭 집계가 계속 쓰므로 남긴다.

- [ ] **Step 6: `DeleteConfirm`의 즐겨찾기 청소를 걷어낸다**

`components/card/DeleteConfirm.tsx`에서 `useFavorites` import와 `const { remove } = useFavorites();`
(155행), 삭제 성공 뒤의 `remove(...)` 호출을 지운다. 그 근거를 적어 둔 JSDoc(143-154행)도
함께 지우고, 대신 한 줄을 남긴다:
```tsx
  // 즐겨찾기는 링크 행에 실려 있으므로(is_favorite) 행이 지워지면 함께 사라진다 —
  // 브라우저에 죽은 id 가 남던 문제 자체가 없다(2026-08-11 서버 이전).
```

- [ ] **Step 7: 사이드바 개수를 서버에서 센다**

`app/(public)/layout.tsx` — `SidebarContainer` import(3행)를 `Sidebar`로 바꾸고,
`const { categories, bookmarks } = data;` 아래에 한 줄을 더한다:
```tsx
  /**
   * '내 즐겨찾기' 개수 — 서버가 센다(2026-08-11 서버 이전). 예전에는 브라우저만 아는 값이라
   * 클라이언트 래퍼를 한 겹 거쳤고, 지워진 링크의 id 가 남아 숫자가 실제 목록보다 커지는
   * 어긋남이 있었다. 같은 행에서 세므로 그 어긋남이 원인째 사라졌다.
   */
  const favCount = bookmarks.filter((bookmark) => bookmark.is_favorite).length;
```
렌더(194행)를 바꾼다:
```tsx
        <Sidebar
          categories={categories}
          counts={counts}
          totalCount={totalCount}
          operatingCategoryId={operatingCategoryId}
          favCount={favCount}
        />
```
그 위 주석의 "'내 즐겨찾기' 개수만 localStorage 소관이라 클라이언트 래퍼를 한 겹 거친다"
문장을 지운다.

- [ ] **Step 8: `/favorites`가 `FavoritesView`를 흡수한다**

`app/(public)/favorites/page.tsx`를 아래로 교체한다:
```tsx
import type { Metadata } from 'next';
import { ListView } from '@/components/ListView';
import { FAVORITES_TITLE } from '@/lib/constants';
import { pickFavorites } from '@/lib/favorites';
import { getAllData } from '@/lib/queries';
import { getAdminSession } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: FAVORITES_TITLE,
};

const DESCRIPTION = '홈에 담아 둔 링크입니다';
/** 관리자에게만 핀이 있으므로(LinkCard) 방문자에게 행동을 지시하지 않는다. */
const EMPTY_ADMIN = '아직 담긴 즐겨찾기가 없습니다. 목록에서 카드의 핀을 눌러보세요.';
const EMPTY_VISITOR = '아직 담긴 즐겨찾기가 없습니다.';

/**
 * 내 즐겨찾기 목록 화면 — `/favorites` (DESIGN_SPEC 4장).
 *
 * 담긴 목록을 **서버가 안다**(2026-08-11 서버 이전) — 예전에는 브라우저에만 있어 클라이언트
 * 래퍼(`FavoritesView`)가 골라냈지만, 이제 여기서 고르고 `ListView` 에 그대로 넘긴다.
 *
 * `export const revalidate` 를 넣지 마라 — 매 요청 렌더가 의도다(근거는 lib/queries.ts).
 */
export default async function FavoritesPage() {
  const [{ bookmarks }, session] = await Promise.all([getAllData(), getAdminSession()]);
  const isAdmin = session !== null;

  return (
    <ListView
      title={FAVORITES_TITLE}
      description={DESCRIPTION}
      bookmarks={pickFavorites(bookmarks)}
      emptyMessage={isAdmin ? EMPTY_ADMIN : EMPTY_VISITOR}
      isAdmin={isAdmin}
      reorderStore="favorites"
    />
  );
}
```

- [ ] **Step 9: 파일 셋을 지운다**

```bash
git rm components/SidebarContainer.tsx components/SidebarContainer.test.tsx
git rm components/FavoritesView.tsx
git rm test/favs.ts
```

- [ ] **Step 10: 남은 참조를 훑는다**

Run (PowerShell): `npm run typecheck`
Expected: 오류 0건. 남아 있다면 `useFavorites`·`FAVS_KEY`·`setFavs`를 아직 부르는 테스트다 —
그 테스트가 확인하던 것이 무엇인지 보고, 서버 데이터로 세우도록 고친다
(예: `setFavs(['a'])` → `getAllData` 모킹의 북마크에 `is_favorite: true`).

- [ ] **Step 11: 전체 테스트**

Run (PowerShell): `npm test`
Expected: 전부 PASS

- [ ] **Step 12: 커밋**

```bash
git add -u
git commit -m "refactor: 즐겨찾기 localStorage 저장소와 그 우회 장치들을 걷어낸다"
```

---

## Task 10: 이관 스크립트

**Files:**
- Create: `scripts/import-favorites.ts`

- [ ] **Step 1: 스크립트를 쓴다**

`scripts/lib/service-client.ts`의 `createServiceRoleClient()`를 쓴다(기존 시드 스크립트 패턴).

```ts
/**
 * 브라우저에 담겨 있던 즐겨찾기를 DB 로 옮긴다 (2026-08-11 서버 이전, 1회성이지만 재실행 안전).
 *
 * ## 쓰는 법
 *
 * 1. 담긴 브라우저로 https://favorite.itconnect.dev 를 열고 개발자도구 콘솔에서:
 *
 *        copy(localStorage.getItem('linkdash:favs'))
 *
 * 2. 붙여넣은 JSON 배열을 파일로 저장한 뒤:
 *
 *        npx tsx scripts/import-favorites.ts <파일경로>
 *
 * ## 재실행 안전
 *
 * 먼저 **전 행을 is_favorite = false 로 되돌린 뒤** 목록대로 다시 세운다. 그래서 두 번 돌려도
 * 결과가 같고, 잘못 넣었을 때 올바른 목록으로 다시 돌리면 복구된다.
 *
 * 목록에 있으나 DB 에 없는 id(그 사이 지워진 링크)는 건너뛰고 **몇 건인지 보고한다** —
 * 조용히 삼키면 개수가 안 맞는 이유를 알 수 없다.
 */
import { readFileSync } from 'node:fs';

import { createServiceRoleClient } from './lib/service-client';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('사용법: npx tsx scripts/import-favorites.ts <즐겨찾기 JSON 파일>');
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error('JSON 최상위가 배열이 아니다 — localStorage 의 linkdash:favs 값 그대로여야 한다.');
    process.exit(1);
  }

  // 중복은 첫 자리만 남긴다 — 담긴 차례가 곧 순서다.
  const ids = [...new Set(parsed.filter((value): value is string => typeof value === 'string'))];
  console.log(`목록 ${ids.length}건을 읽었다.`);

  const supabase = createServiceRoleClient();

  const existing = await supabase.from('bookmarks').select('id').in('id', ids);
  if (existing.error !== null) throw new Error(`링크 조회 실패: ${existing.error.message}`);

  const alive = new Set((existing.data ?? []).map((row) => row.id));
  const targets = ids.filter((id) => alive.has(id));
  const missing = ids.length - targets.length;
  if (missing > 0) console.warn(`⚠ DB 에 없는 id ${missing}건은 건너뛴다(그 사이 지워진 링크).`);

  // 1) 전부 되돌린다 — 재실행해도 결과가 같게 한다.
  const cleared = await supabase
    .from('bookmarks')
    .update({ is_favorite: false, fav_order: 0 })
    .eq('is_favorite', true)
    .select('id');
  if (cleared.error !== null) throw new Error(`초기화 실패: ${cleared.error.message}`);
  console.log(`기존 담김 ${(cleared.data ?? []).length}건을 비웠다.`);

  // 2) 목록의 차례 그대로 다시 세운다.
  let written = 0;
  for (const [index, id] of targets.entries()) {
    const result = await supabase
      .from('bookmarks')
      .update({ is_favorite: true, fav_order: index })
      .eq('id', id)
      .select('id');

    if (result.error !== null) throw new Error(`${id} 저장 실패: ${result.error.message}`);
    written += 1;
  }

  console.log(`✓ 즐겨찾기 ${written}건을 담긴 차례 그대로 DB 에 넣었다.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 타입·린트 검사**

Run (PowerShell): `npm run typecheck` → 오류 0건
Run (PowerShell): `npm run lint` → 오류 0건

- [ ] **Step 3: 커밋**

```bash
git add scripts/import-favorites.ts
git commit -m "feat(scripts): 브라우저에 있던 즐겨찾기를 DB 로 옮기는 스크립트"
```

- [ ] **Step 4: 실제 이관 (사용자 협조 필요)**

사용자에게 다음을 요청한다:
1. 담긴 브라우저로 `https://favorite.itconnect.dev` 열기
2. 개발자도구(F12) → 콘솔 → `copy(localStorage.getItem('linkdash:favs'))` 실행
3. 붙여넣기 한 값을 전달

받은 값을 `scratchpad/favs.json`으로 저장한 뒤:
Run (PowerShell): `npx tsx scripts/import-favorites.ts <경로>`
Expected: `✓ 즐겨찾기 N건을 담긴 차례 그대로 DB 에 넣었다.`

---

## Task 11: 최종 검증과 배포

- [ ] **Step 1: 전체 검사 3종**

Run (PowerShell):
```
npm run typecheck
npm run lint
npm test
```
Expected: 셋 다 오류 0건

- [ ] **Step 2: 빌드**

Run (PowerShell): `npm run build`
Expected: 성공. 라우트 표에서 `/`·`/favorites`가 **ƒ(Dynamic)** 인지 확인한다 —
정적으로 잡히면 즐겨찾기가 빌드 시점에 굳어 다시 같은 증상이 난다.

- [ ] **Step 3: 로컬에서 눈으로 확인**

Run (PowerShell): `npm run dev` → `http://localhost:3000`
확인할 것:
1. 로그아웃 상태에서 홈에 즐겨찾기 세 묶음이 보인다
2. 로그아웃 상태에서 카드에 핀이 **없다**
3. 관리자로 로그인하면 핀이 보이고, 눌러 담고 빼면 새로고침 뒤에도 유지된다
4. 다른 브라우저(시크릿 창)로 열어도 같은 목록이 보인다 ← **신고된 증상의 직접 확인**

- [ ] **Step 4: 커밋 & 푸시**

```bash
git push -u origin feat/stage-1-public
```

- [ ] **Step 5: 배포 확인**

Run (PowerShell): `npm run verify:deploy`
Expected: 도메인이 방금 푸시한 커밋 SHA를 가리킨다

배포된 도메인을 **로그인하지 않은 브라우저**로 열어 홈에 즐겨찾기가 보이는지 확인한다.

---

## 자체 검토 기록

**스펙 커버리지** — 설계 문서의 각 절이 어느 태스크에 담겼는가:

| 스펙 절 | 태스크 |
|---|---|
| 4.1 데이터(마이그레이션) | Task 1 |
| 4.2 읽기 경로 | Task 2, Task 6 |
| 4.3 쓰기 경로 | Task 3(writeOrder), 4(setFavorite), 5(reorderFavorites) |
| 4.4 화면 배선 | Task 7(핀·토글), 8(드래그), 9(사이드바 개수) |
| 4.5 삭제되는 것들 | Task 9 |
| 4.6 문구 수정 | Task 9 Step 8 |
| 5 이관 | Task 10 |
| 6 오류 처리 | Task 4·5(액션 실패), 7·8(클라이언트 try/catch) |
| 7 테스트 전략 | 각 태스크의 Step 1 |
| 9 작업 순서 | 태스크 번호 순 = 스펙 9절의 의존성 순 |

**주의 — 배포 순서:** 새 컬럼 기본값이 `false`라 **이관(Task 10 Step 4) 전에 배포하면 홈이 한 번
완전히 빈다.** Task 11의 푸시는 반드시 이관 뒤에 한다.
