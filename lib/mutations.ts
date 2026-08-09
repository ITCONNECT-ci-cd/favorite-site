'use server';

/**
 * H4. 쓰기 계층 — 관리 화면(I 트랙)과 현장 편집(J 트랙)이 쓰는 **모든 변경의 유일한 통로**.
 *
 * ## ⚠️ 이 파일의 export 는 전부 공개 HTTP 엔드포인트다
 *
 * `'use server'` 가 붙은 모듈의 export 는 Next 가 액션 id 를 붙여 **누구나 POST 할 수 있는
 * 엔드포인트로 배포한다.** 화면에서만 부른다는 사실은 아무 보호가 되지 않는다. 그래서
 * 여기 있는 모든 액션은 **첫 줄에서 `getAdminSession()` 을 확인**하고, 없으면 DB 에 붙지도
 * 않고 거부한다. 새 액션을 추가할 때 이 줄을 빠뜨리면 그 액션 하나가 공개 쓰기 구멍이 된다.
 *
 * `'use server'` 는 **파일의 첫 줄이어야 하고**, export 는 전부 async 함수여야 한다
 * (타입 export 는 컴파일 때 지워지므로 괜찮다). 상수를 내보내고 싶으면 `lib/constants.ts` 로 가라.
 *
 * ## 쓰기는 service role 이 아니라 인증 사용자의 클라이언트로 나간다
 *
 * `createServerSupabaseClient()` = anon 키 + 요청 쿠키다. RLS 의 `cat_write`·`bm_write`
 * (`to authenticated`) 정책을 **로그인한 사람 자격으로** 통과한다. `lib/supabase/admin.ts`
 * (service role)를 쓰면 RLS 가 통째로 우회되어, 위 세션 검사에 구멍이 생기는 순간 세션 없이도
 * 뚫리는 경로가 된다. 2차 방어를 스스로 없애는 셈이라 **여기서는 service role 을 쓰지 않는다.**
 * (익명 사용자를 대신해 서버가 써야 하는 `/api/click` 은 사정이 달라 service role 을 쓴다.)
 *
 * ## 반환 규약 — `{ ok: true } | { ok: false, error: string }`
 *
 * **던지지 않는다.** 화면은 `result.ok` 로 갈라 `error` 를 그대로 토스트에 넣으면 된다
 * (I·J 트랙의 소비 방식). `error` 에는 **내부 정보를 담지 않는다** — SQL·스택·테이블 이름·
 * PostgREST 진단은 `console.error` 로 서버 로그에만 남기고, 사용자에게는 다음에 무엇을 하면
 * 되는지만 알려 준다.
 *
 * 성공하면 `revalidatePath('/', 'layout')` 로 공개 화면 전체를 새로 그리게 한다. 사이드바 개수·
 * 홈 섹션·카테고리 페이지가 한 번에 맞아야 하므로 경로를 좁히지 않는다. **실패에는 부르지 않는다** —
 * 바뀐 게 없는데 전 페이지를 무효화할 이유가 없다.
 *
 * ## 카테고리는 2단계까지 (I2 시스템 제약)
 *
 * 공개 화면 전체가 2단 트리를 전제한다(Sidebar·`/category` 라우팅·HomeView·칩 개수).
 * 그래서 `createSubCategory` 는 부모가 이미 하위면 거부하고, 상위/하위 액션이 서로의 대상을
 * 건드리지 못하도록 각 쿼리에 `parent_id` 조건을 함께 건다.
 */

import { revalidatePath } from 'next/cache';

import { DAILY_PIN_MAX } from '@/lib/constants';
import { createServerSupabaseClient, getAdminSession } from '@/lib/supabase/server';
import { hostOf } from '@/lib/url';

/**
 * 모든 서버 액션의 반환 타입. **이 모양은 I·J 트랙이 의존하는 계약이므로 함부로 바꾸지 마라.**
 *
 * - `{ ok: true }` — 성공. 바뀐 데이터는 `revalidatePath` 로 다시 렌더된 화면이 들고 온다
 *   (그래서 생성된 행의 id 를 돌려주지 않는다).
 * - `{ ok: false, error }` — 실패. `error` 는 **사용자에게 그대로 보여도 되는 한국어 한 문장**이다.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * `updateBookmark` 의 부분 수정 묶음. **준 키만 바뀐다** (없는 키는 건드리지 않는다).
 *
 * - `description` · `faviconUrl` 은 `null`(또는 빈 문자열)을 주면 비운다.
 * - `title` 은 비울 수 없다(DB `not null`). 빈 값을 주면 거부한다 — 생성 때의 host 자동 채움은
 *   주소를 함께 아는 `createBookmark` 만 한다.
 * - `tags` 는 편집 화면이 없어 일부러 빼 두었다. 필요해지면 여기에 추가하고 테스트를 함께 늘려라.
 */
export type BookmarkPatch = {
  title?: string;
  url?: string;
  description?: string | null;
  categoryId?: string;
  faviconUrl?: string | null;
};

/** `createBookmark` 입력. `title` 을 비우면 주소의 host 로 채운다. */
export type NewBookmark = {
  url: string;
  title?: string;
  description?: string | null;
  categoryId: string;
};

/** PostgREST 오류의 우리가 보는 부분. `code` 가 있어야 사용자 문구로 갈라 줄 수 있다. */
type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };

type WriteClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * 고정 상한 초과 문구. 숫자는 `DAILY_PIN_MAX` 에서 온다 — DB 트리거(`enforce_pin_limit`, 12)와
 * 화면 문구가 따로 놀지 않게 하기 위해서다.
 *
 * DB 예외 원문은 `PIN_LIMIT: 매일 고정은 최대 12개입니다`(마침표 없음)지만, 이 파일의 다른 문구가
 * 모두 마침표로 끝나므로 토스트 문장으로 다듬어 마침표를 붙였다. 문장 자체는 원문 그대로다.
 */
const PIN_LIMIT_MESSAGE = `매일 고정은 최대 ${DAILY_PIN_MAX}개입니다.`;

/**
 * 미인증 거부 문구. **12개 액션이 모두 같은 문구를 쓴다** — 어떤 액션이 왜 막혔는지 나눠 말하면
 * 그 자체가 서버 구조를 알려 주는 단서가 된다(H2 의 "사유 비구분" 방침과 같은 결).
 */
const DENIED: ActionResult = { ok: false, error: '로그인이 필요합니다.' };

const INVALID_REQUEST = '요청이 올바르지 않습니다.';
const URL_REQUIRED = '주소 형식이 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.';

// ───────────────────────────────────────────────────────── 상위 카테고리

/**
 * 상위 카테고리를 만든다. 순서는 기존 상위들 **맨 뒤**에 붙는다.
 *
 * @param name 카테고리 이름 (앞뒤 공백은 다듬는다. 비면 거부)
 * @returns 이름이 비었을 때 · 같은 이름이 이미 있을 때(DB unique) 실패
 */
export async function createCategory(name: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const cleanName = asText(name);
  if (cleanName === null) return fail('이름을 입력하세요.');

  const sortOrder = await nextSortOrder(
    supabase
      .from('categories')
      .select('sort_order')
      .is('parent_id', null)
      .order('sort_order', { ascending: false })
      .limit(1),
  );
  if (typeof sortOrder !== 'number') return describeFailure('상위 카테고리 순서 조회', sortOrder);

  const { error } = await supabase
    .from('categories')
    .insert({ name: cleanName, parent_id: null, sort_order: sortOrder });
  if (error !== null) return describeFailure('상위 카테고리 추가', error);

  return succeed();
}

/**
 * 상위 카테고리의 이름을 바꾼다. **하위는 이 액션으로 바꿀 수 없다**(`renameSubCategory` 를 써라) —
 * 쿼리에 `parent_id is null` 을 함께 걸어 두었으므로 하위 id 를 주면 "찾을 수 없다"로 돌아온다.
 */
export async function renameCategory(id: string, name: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const cleanName = asText(name);
  if (cleanName === null) return fail('이름을 입력하세요.');

  const { data, error } = await supabase
    .from('categories')
    .update({ name: cleanName })
    .eq('id', targetId)
    .is('parent_id', null)
    .select('id');
  if (error !== null) return describeFailure('상위 카테고리 이름 수정', error);
  if (isEmpty(data)) return fail('카테고리를 찾을 수 없습니다.');

  return succeed();
}

/**
 * 상위 카테고리를 지운다. **하위가 하나라도 남아 있으면 거부한다.**
 *
 * DB 의 `parent_id ... on delete set null` 때문에 그냥 지우면 하위들이 `parent_id = null` 이 되어
 * **상위로 승격**된다 — 사이드바에 낯선 상위가 우수수 생기고 2단 트리 전제도 깨진다. 그래서 순서를
 * 사용자에게 넘긴다("하위부터 지우세요").
 *
 * ⚠️ 소속 링크는 DB 가 `category_id = null` 로 만든다(분류 없는 링크). 목록 화면에서는 사라지고
 * 검색·즐겨찾기·매일에는 남는다. **되돌릴 수 없으므로 부르는 화면(I1)이 확인 절차를 붙여야 한다.**
 */
export async function deleteCategory(id: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const found = await supabase.from('categories').select('id, parent_id').eq('id', targetId).maybeSingle();
  if (found.error !== null) return describeFailure('카테고리 조회', found.error);

  const category = found.data as { parent_id: string | null } | null;
  if (category === null) return fail('카테고리를 찾을 수 없습니다.');
  if (category.parent_id !== null) return fail('하위 카테고리는 하위 목록에서 삭제하세요.');

  const children = await supabase.from('categories').select('id').eq('parent_id', targetId).limit(1);
  if (children.error !== null) return describeFailure('하위 카테고리 조회', children.error);
  if (!isEmpty(children.data)) return fail('하위 카테고리를 먼저 삭제하세요.');

  const { data, error } = await supabase.from('categories').delete().eq('id', targetId).select('id');
  if (error !== null) return describeFailure('상위 카테고리 삭제', error);
  if (isEmpty(data)) return fail('카테고리를 찾을 수 없습니다.');

  return succeed();
}

/**
 * 상위 카테고리 순서를 통째로 다시 매긴다 — `orderedIds[i]` 의 `sort_order` 가 `i` 가 된다.
 * 공개 사이드바의 순서가 이 값이다.
 *
 * @param orderedIds 화면에 보이는 순서 그대로의 id 목록. 빈 목록은 아무것도 하지 않고 성공이다.
 */
export async function reorderCategories(orderedIds: string[]): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  return applyOrder(supabase, 'categories', orderedIds);
}

// ───────────────────────────────────────────────────────── 하위 카테고리

/**
 * 상위 아래에 하위 카테고리를 만든다. 순서는 같은 부모의 형제들 맨 뒤다.
 *
 * **`parentId` 가 이미 하위면 거부한다** — 카테고리는 2단계까지다(I2 시스템 제약). 이 방어는 UI 와
 * 서버 양쪽에 있어야 한다: 액션은 공개 엔드포인트라 화면의 select 상자만으로는 막히지 않는다.
 */
export async function createSubCategory(parentId: string, name: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetParentId = asText(parentId);
  if (targetParentId === null) return fail(INVALID_REQUEST);

  const cleanName = asText(name);
  if (cleanName === null) return fail('이름을 입력하세요.');

  const found = await supabase
    .from('categories')
    .select('id, parent_id')
    .eq('id', targetParentId)
    .maybeSingle();
  if (found.error !== null) return describeFailure('상위 카테고리 조회', found.error);

  const parent = found.data as { parent_id: string | null } | null;
  if (parent === null) return fail('상위 카테고리를 찾을 수 없습니다.');
  if (parent.parent_id !== null) return fail('하위 카테고리 아래에는 다시 하위를 만들 수 없습니다.');

  const sortOrder = await nextSortOrder(
    supabase
      .from('categories')
      .select('sort_order')
      .eq('parent_id', targetParentId)
      .order('sort_order', { ascending: false })
      .limit(1),
  );
  if (typeof sortOrder !== 'number') return describeFailure('하위 카테고리 순서 조회', sortOrder);

  const { error } = await supabase
    .from('categories')
    .insert({ name: cleanName, parent_id: targetParentId, sort_order: sortOrder });
  if (error !== null) return describeFailure('하위 카테고리 추가', error);

  return succeed();
}

/** 하위 카테고리의 이름을 바꾼다. 상위 id 를 주면 "찾을 수 없다"로 돌아온다(`renameCategory` 를 써라). */
export async function renameSubCategory(id: string, name: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const cleanName = asText(name);
  if (cleanName === null) return fail('이름을 입력하세요.');

  const { data, error } = await supabase
    .from('categories')
    .update({ name: cleanName })
    .eq('id', targetId)
    .not('parent_id', 'is', null)
    .select('id');
  if (error !== null) return describeFailure('하위 카테고리 이름 수정', error);
  if (isEmpty(data)) return fail('하위 카테고리를 찾을 수 없습니다.');

  return succeed();
}

/**
 * 하위 카테고리를 지우고 **소속 링크는 상위로 올린다**(I2 완료 기준).
 *
 * 순서가 핵심이다 — 카테고리를 먼저 지우면 DB 의 `on delete set null` 이 링크를 `category_id = null`
 * 로 만들어 어느 목록에도 안 나오는 링크가 된다. 그래서 재배속 → 삭제 순서이고, 재배속이 실패하면
 * 삭제로 넘어가지 않는다.
 *
 * 두 문장이 한 트랜잭션은 아니다(PostgREST 는 문장 단위다). 재배속만 되고 삭제가 실패하면 링크는
 * 이미 상위에 있고 카테고리만 남는다 — 다시 부르면 정리된다. 반대 방향의 사고(링크 분실)만 막으면 된다.
 */
export async function deleteSubCategory(id: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const found = await supabase.from('categories').select('id, parent_id').eq('id', targetId).maybeSingle();
  if (found.error !== null) return describeFailure('하위 카테고리 조회', found.error);

  const category = found.data as { parent_id: string | null } | null;
  if (category === null) return fail('하위 카테고리를 찾을 수 없습니다.');
  if (category.parent_id === null) return fail('상위 카테고리는 하위 삭제로 지울 수 없습니다.');

  const moved = await supabase
    .from('bookmarks')
    .update({ category_id: category.parent_id })
    .eq('category_id', targetId);
  if (moved.error !== null) return describeFailure('링크 상위 재배속', moved.error);

  const { data, error } = await supabase.from('categories').delete().eq('id', targetId).select('id');
  if (error !== null) return describeFailure('하위 카테고리 삭제', error);
  if (isEmpty(data)) return fail('하위 카테고리를 찾을 수 없습니다.');

  return succeed();
}

// ───────────────────────────────────────────────────────── 링크

/**
 * 링크를 만든다. 순서는 같은 카테고리의 맨 뒤다.
 *
 * - `title` 을 비우면 **주소의 host** 로 채운다(`hostOf` — 카드 하단 줄과 같은 규칙, `www.` 제거).
 * - `url` 은 **http/https 만** 받는다. 이 값은 카드의 `href` 로 그대로 나가므로 `javascript:` 같은
 *   스킴을 통과시키면 저장형 XSS 가 된다.
 * - 주소는 다듬기만 하고 정규화하지 않는다 — `new URL().toString()` 은 끝에 `/` 를 붙이는 등
 *   관리자가 입력한 주소를 바꿔 버린다.
 * - `favicon_url` 은 건드리지 않는다(DB 기본값 null). 파비콘 수집·업로드는 I3 이 맡고, 결과는
 *   `updateBookmark(id, { faviconUrl })` 로 들어온다.
 */
export async function createBookmark(input: NewBookmark): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  if (input === null || typeof input !== 'object') return fail(INVALID_REQUEST);

  const url = asHttpUrl(input.url);
  if (url === null) return fail(URL_REQUIRED);

  const categoryId = asText(input.categoryId);
  if (categoryId === null) return fail('카테고리를 선택하세요.');

  const sortOrder = await nextSortOrder(
    supabase
      .from('bookmarks')
      .select('sort_order')
      .eq('category_id', categoryId)
      .order('sort_order', { ascending: false })
      .limit(1),
  );
  if (typeof sortOrder !== 'number') return describeFailure('링크 순서 조회', sortOrder);

  const { error } = await supabase.from('bookmarks').insert({
    category_id: categoryId,
    title: asText(input.title) ?? hostOf(url),
    url,
    description: asText(input.description),
    sort_order: sortOrder,
  });
  if (error !== null) return describeFailure('링크 추가', error);

  return succeed();
}

/**
 * 링크를 부분 수정한다 — `patch` 에 **준 키만** 바뀐다(`BookmarkPatch` 참조).
 * I4 의 표 인라인 편집과 J2 의 카드 인라인 편집이 함께 쓴다.
 */
export async function updateBookmark(id: string, patch: BookmarkPatch): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);
  if (patch === null || typeof patch !== 'object') return fail(INVALID_REQUEST);

  const row: Record<string, string | null> = {};

  if (patch.title !== undefined) {
    const title = asText(patch.title);
    if (title === null) return fail('이름을 입력하세요.');
    row.title = title;
  }
  if (patch.url !== undefined) {
    const url = asHttpUrl(patch.url);
    if (url === null) return fail(URL_REQUIRED);
    row.url = url;
  }
  if (patch.categoryId !== undefined) {
    const categoryId = asText(patch.categoryId);
    if (categoryId === null) return fail('카테고리를 선택하세요.');
    row.category_id = categoryId;
  }
  if (patch.description !== undefined) row.description = asText(patch.description);
  if (patch.faviconUrl !== undefined) row.favicon_url = asText(patch.faviconUrl);

  if (Object.keys(row).length === 0) return fail('수정할 내용이 없습니다.');

  const { data, error } = await supabase.from('bookmarks').update(row).eq('id', targetId).select('id');
  if (error !== null) return describeFailure('링크 수정', error);
  if (isEmpty(data)) return fail('링크를 찾을 수 없습니다.');

  return succeed();
}

/**
 * 링크를 지운다. 클릭 기록은 DB 가 함께 지운다(`clicks ... on delete cascade`).
 * 이미 없는 링크에는 성공이라고 하지 않는다 — J3 의 확인 오버레이가 "지웠다"고 말하려면
 * 정말 한 행이 지워졌는지 알아야 한다.
 */
export async function deleteBookmark(id: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const { data, error } = await supabase.from('bookmarks').delete().eq('id', targetId).select('id');
  if (error !== null) return describeFailure('링크 삭제', error);
  if (isEmpty(data)) return fail('링크를 찾을 수 없습니다.');

  return succeed();
}

/**
 * 링크 순서를 통째로 다시 매긴다 — `orderedIds[i]` 의 `sort_order` 가 `i` 가 된다.
 *
 * ⚠️ `sort_order` 는 테이블 전체가 공유하는 컬럼 하나다(카테고리별 컬럼이 아니다). 그래서 어느
 * 카테고리의 목록을 0..n 으로 다시 매기면 **`/daily`·`/favorites` 처럼 여러 카테고리를 섞어 보여
 * 주는 화면의 줄 순서도 함께 흔들린다.** 각 카테고리 안에서의 순서는 언제나 의도대로 유지되므로
 * 스키마를 바꾸지 않는 한 감수하는 부분이다 — 부르는 쪽은 **한 카테고리의 목록 전체**를 넘겨라
 * (일부만 넘기면 넘긴 것들이 0..k 로 앞당겨져 나머지와 뒤섞인다).
 */
export async function reorderBookmarks(orderedIds: string[]): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  return applyOrder(supabase, 'bookmarks', orderedIds);
}

/**
 * '매일 사용하는 사이트' 고정을 켜고 끈다.
 *
 * **13번째 고정은 DB 트리거(`enforce_pin_limit`)가 막는다** — 액션이 미리 세지 않는 것은 의도다.
 * 세어 보고 쓰는 사이에 다른 요청이 끼어들 수 있어(TOCTOU) 상한이 조용히 13이 될 수 있고, 트리거는
 * `pg_advisory_xact_lock` 으로 그 경합까지 직렬화한다. 여기서는 그 예외를 사용자 문구로 바꾸는 일만 한다.
 *
 * 고정을 **푸는** 방향은 트리거가 아예 발동하지 않는다(`when (new.is_pinned)`).
 */
export async function togglePin(id: string): Promise<ActionResult> {
  const supabase = await adminClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const found = await supabase.from('bookmarks').select('id, is_pinned').eq('id', targetId).maybeSingle();
  if (found.error !== null) return describeFailure('링크 조회', found.error);

  const bookmark = found.data as { is_pinned: boolean } | null;
  if (bookmark === null) return fail('링크를 찾을 수 없습니다.');

  const { data, error } = await supabase
    .from('bookmarks')
    .update({ is_pinned: !bookmark.is_pinned })
    .eq('id', targetId)
    .select('id');
  if (error !== null) return describeFailure('고정 토글', error);
  if (isEmpty(data)) return fail('링크를 찾을 수 없습니다.');

  return succeed();
}

// ───────────────────────────────────────────────────────── 내부 helpers

/**
 * 인증 관문 + 쓰기 클라이언트. **모든 액션의 첫 줄이 이것이다.**
 * `null` 이면 비로그인이므로 호출부는 `DENIED` 를 그대로 돌려준다.
 */
async function adminClient(): Promise<WriteClient | null> {
  const session = await getAdminSession();
  if (session === null) return null;

  return createServerSupabaseClient();
}

/** 성공 — 공개 화면을 통째로 다시 그리게 한다. 성공 경로에서만 부른다. */
function succeed(): ActionResult {
  revalidatePath('/', 'layout');

  return { ok: true };
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * DB 오류를 **사용자에게 보여도 되는 한 문장**으로 바꾼다. 원본은 서버 로그로만 보낸다.
 *
 * `PIN_LIMIT` 을 코드(`P0001`)가 아니라 메시지로 알아보는 이유: `P0001` 은 `raise exception`
 * 전부가 쓰는 범용 코드라, 나중에 다른 트리거가 생기면 그 예외까지 고정 상한 문구로 둔갑한다.
 */
function describeFailure(context: string, error: DbError): ActionResult {
  console.error(`[mutations] ${context} 실패`, error);

  if (typeof error.message === 'string' && error.message.includes('PIN_LIMIT')) {
    return fail(PIN_LIMIT_MESSAGE);
  }

  switch (error.code) {
    case '23505': // unique_violation — categories(name, parent_id)
      return fail('같은 이름의 카테고리가 이미 있습니다.');
    case '23503': // foreign_key_violation — 가리키는 카테고리가 없다
      return fail('카테고리를 찾을 수 없습니다.');
    case '22P02': // invalid_text_representation — uuid 가 아닌 id
      return fail(INVALID_REQUEST);
    case '42501': // RLS·권한 거부. 세션은 있었는데 DB 가 막았다 = 토큰이 만료된 직후 등
      return fail('권한이 없습니다. 다시 로그인해 주세요.');
    default:
      return fail('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/**
 * `sort_order` 내림차순 1행 조회를 받아 **다음 순서 값**을 준다(맨 뒤에 붙이기).
 * 형제가 없으면 0. 조회가 실패하면 오류를 그대로 돌려주므로 호출부가 `typeof !== 'number'` 로 가른다.
 */
async function nextSortOrder(
  query: PromiseLike<{ data: unknown; error: DbError | null }>,
): Promise<number | DbError> {
  const { data, error } = await query;
  if (error !== null) return error;

  const [first] = (data ?? []) as { sort_order?: number }[];

  return (typeof first?.sort_order === 'number' ? first.sort_order : -1) + 1;
}

/**
 * 목록 순서를 인덱스로 다시 매긴다.
 *
 * **한 문장으로 못 한다** — PostgREST 에는 행마다 다른 값을 넣는 대량 update 가 없고, upsert 로
 * 흉내 내면 `name` 같은 not null 컬럼을 함께 실어야 해서 그 사이 다른 창에서 바뀐 이름을 덮어쓰거나
 * 방금 지워진 행을 되살린다. 그래서 `sort_order` 만 건드리는 update 를 id 수만큼 동시에 던진다.
 * 중간에 실패하면 순서가 일부만 반영되는데, 드래그를 다시 하면 그대로 복구된다(멱등).
 *
 * 동시 요청 수 = 목록 길이다. 부르는 쪽이 넘기는 것은 상위 카테고리 10여 개 또는 한 카테고리의
 * 링크 수십 개라 문제될 규모가 아니다 — 290건을 통째로 넘기는 호출부가 생기면 나눠 보내야 한다.
 *
 * 한 행도 바뀌지 않았으면 성공이라고 하지 않는다 — 정책이 통째로 막았거나 목록이 통째로 낡은
 * 경우를 "저장됨"으로 보고하면 화면이 거짓말을 하게 된다.
 */
async function applyOrder(
  supabase: WriteClient,
  table: 'categories' | 'bookmarks',
  orderedIds: string[],
): Promise<ActionResult> {
  const ids = asIdList(orderedIds);
  if (ids === null) return fail(INVALID_REQUEST);
  if (ids.length === 0) return { ok: true };

  const results = await Promise.all(
    ids.map((id, index) => supabase.from(table).update({ sort_order: index }).eq('id', id).select('id')),
  );

  const broken = results.find((result) => result.error !== null);
  if (broken !== undefined && broken.error !== null) return describeFailure(`${table} 순서 저장`, broken.error);

  const touched = results.reduce((sum, result) => sum + ((result.data as unknown[] | null)?.length ?? 0), 0);
  if (touched === 0) return fail('순서를 저장하지 못했습니다.');

  return succeed();
}

/**
 * 문자열을 다듬어 돌려준다. 문자열이 아니거나 공백뿐이면 `null`.
 *
 * 액션 인자에 `typeof` 검사가 붙는 이유: 서버 액션은 공개 엔드포인트라 TypeScript 의 시그니처가
 * 런타임 보장이 아니다. 남이 보낸 숫자·객체에 `.trim()` 을 부르면 그대로 예외가 된다.
 */
function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/** http/https 주소만 통과시킨다. 값은 **다듬기만 하고 그대로** 돌려준다(정규화하지 않는다). */
function asHttpUrl(value: unknown): string | null {
  const text = asText(value);
  if (text === null) return null;

  try {
    const { protocol } = new URL(text);

    return protocol === 'http:' || protocol === 'https:' ? text : null;
  } catch {
    return null;
  }
}

/**
 * 정렬용 id 목록 검증. 하나라도 비었거나 **중복이면 통째로 거부한다** — 같은 id 에 서로 다른
 * 순서를 매기는 요청은 어느 쪽이 이길지 정해지지 않아, 조용히 처리하면 결과를 설명할 수 없다.
 */
function asIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const ids: string[] = [];
  for (const item of value) {
    const id = asText(item);
    if (id === null || ids.includes(id)) return null;
    ids.push(id);
  }

  return ids;
}

/** PostgREST 가 돌려준 행 배열이 비었는지 — "대상이 없었다"의 판정이다. */
function isEmpty(data: unknown): boolean {
  return !Array.isArray(data) || data.length === 0;
}
