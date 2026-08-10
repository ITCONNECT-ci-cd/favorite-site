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
 * 같은 이유로 **모든 인자를 런타임에 다시 검사한다** — 남이 보내는 페이로드에 TypeScript 시그니처는
 * 아무 보장이 아니다(숫자·객체·배열이 문자열 자리에 온다).
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
 * 이 금지는 주석만이 아니라 두 겹으로 잠겨 있다 — `eslint.config.mjs` 의 `no-restricted-imports`
 * 가 `supabase/admin` import 를 **전역으로** 막고(정당한 자리만 그 config 가 이름으로 되돌리는데
 * 이 파일은 그 목록에 없다), `lib/mutations.test.ts` 가 소스 전체를 훑어 우회 import·service role
 * 키 접근이 없는지 확인한다.
 *
 * ## 반환 규약 — `{ ok: true } | { ok: false, error: string }`
 *
 * **예상되는 실패는 던지지 않는다**(인프라 오류 — env 누락, fetch 거부 이전의 세션 계층 등 — 는
 * Next 오류 경계로 갈 수 있다). 화면은 `result.ok` 로 갈라 `error` 를 그대로 토스트에 넣으면 된다
 * (I·J 트랙의 소비 방식). `error` 에는 **내부 정보를 담지 않는다** — SQL·스택·테이블 이름·
 * PostgREST 진단은 `console.error` 로 서버 로그에만 남기고, 사용자에게는 다음에 무엇을 하면
 * 되는지만 알려 준다.
 *
 * 성공하면 `revalidatePath('/', 'layout')` 로 공개 화면 전체를 새로 그리게 한다. 사이드바 개수·
 * 홈 섹션·카테고리 페이지가 한 번에 맞아야 하므로 경로를 좁히지 않는다. **아무것도 바뀌지 않은
 * 실패에는 부르지 않는다** — 바뀐 게 없는데 전 페이지를 무효화할 이유가 없다. 반대로 **일부만
 * 반영된 채 실패**하면(두 문장짜리 액션·목록 순서 저장) 실패를 돌려주기 전에 부른다: 화면이
 * DB 와 어긋난 채로 남는 편이 더 나쁘다.
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
 * - `faviconUrl` 은 http(s) 주소 또는 `data:image/...` 만 받는다(`isIconUrl`).
 * - `tags` 는 편집 화면이 없어 일부러 빼 두었다. 필요해지면 여기에 추가하고 테스트를 함께 늘려라.
 */
export type BookmarkPatch = {
  title?: string;
  url?: string;
  description?: string | null;
  categoryId?: string;
  faviconUrl?: string | null;
};

/**
 * `createBookmark` 입력. `title` 을 비우면 주소의 host 로 채운다.
 *
 * `faviconUrl` 은 I3(파비콘 수집)이 **행을 만들면서 함께 채우는** 자리다. 주지 않으면 `null` 이
 * 저장된다(키는 언제나 실린다 — 아래 `createBookmark` 주석).
 */
export type NewBookmark = {
  url: string;
  title?: string;
  description?: string | null;
  categoryId: string;
  faviconUrl?: string | null;
};

/**
 * PostgREST 오류의 우리가 보는 부분. `code` 가 있어야 사용자 문구로 갈라 줄 수 있다.
 * 테스트가 같은 모양을 다시 적지 않도록 타입으로 내보낸다(`'use server'` 에서 타입 export 는 지워진다).
 */
export type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };

type WriteClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** 카테고리 행에서 우리가 보는 부분 — 상위/하위 판정은 `parent_id` 하나로 끝난다. */
type CategoryRow = { id: string; parent_id: string | null };

/** 링크 행에서 `togglePin` 이 보는 부분. */
type PinRow = { id: string; is_pinned: boolean };

// ───────────────────────────────────────────────────────── 사용자 문구
//
// 화면에 나가는 문장을 **한 블록에 모아 둔다.** 같은 상황을 여러 액션이 서로 다르게 말하면
// (`카테고리를 찾을 수 없습니다.` 를 액션마다 따로 적으면) 문구가 조용히 갈라진다. 여기서만
// 고치면 13개 액션이 함께 바뀐다. 문구를 바꿀 때 테스트도 함께 바뀌는 것은 의도다 —
// 사용자에게 보이는 문장은 계약이다.

/**
 * 미인증 거부 문구. **13개 액션이 모두 같은 문구를 쓴다** — 어떤 액션이 왜 막혔는지 나눠 말하면
 * 그 자체가 서버 구조를 알려 주는 단서가 된다(H2 의 "사유 비구분" 방침과 같은 결).
 */
const DENIED: ActionResult = { ok: false, error: '로그인이 필요합니다.' };

/**
 * 고정 상한 초과 문구. 숫자는 `DAILY_PIN_MAX` 에서 온다 — DB 트리거(`enforce_pin_limit`, 12)와
 * 화면 문구가 따로 놀지 않게 하기 위해서다.
 *
 * DB 예외 원문은 `PIN_LIMIT: 매일 고정은 최대 12개입니다`(마침표 없음)지만, 이 파일의 다른 문구가
 * 모두 마침표로 끝나므로 토스트 문장으로 다듬어 마침표를 붙였다. 문장 자체는 원문 그대로다.
 */
const PIN_LIMIT_MESSAGE = `매일 고정은 최대 ${DAILY_PIN_MAX}개입니다.`;

const INVALID_REQUEST = '요청이 올바르지 않습니다.';
const NAME_REQUIRED = '이름을 입력하세요.';
const NAME_TAKEN = '같은 이름의 카테고리가 이미 있습니다.';
const URL_REQUIRED = '주소 형식이 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소를 입력하세요.';
const ICON_URL_INVALID = '파비콘 주소가 올바르지 않습니다. http(s) 주소이거나 data:image URI 여야 합니다.';
const CATEGORY_REQUIRED = '카테고리를 선택하세요.';
const CATEGORY_NOT_FOUND = '카테고리를 찾을 수 없습니다.';
const PARENT_NOT_FOUND = '상위 카테고리를 찾을 수 없습니다.';
const SUB_NOT_FOUND = '하위 카테고리를 찾을 수 없습니다.';
const BOOKMARK_NOT_FOUND = '링크를 찾을 수 없습니다.';
const DEPTH_LIMIT = '하위 카테고리 아래에는 다시 하위를 만들 수 없습니다.';
const NOT_A_TOP_LEVEL = '하위 카테고리는 하위 목록에서 삭제하세요.';
const NOT_A_SUB = '상위 카테고리는 하위 삭제로 지울 수 없습니다.';
const CHILDREN_FIRST = '하위 카테고리를 먼저 삭제하세요.';
const LINKS_FIRST = '이 카테고리에 링크가 남아 있습니다. 링크를 옮기거나 삭제한 뒤 다시 시도하세요.';
const NOTHING_TO_UPDATE = '수정할 내용이 없습니다.';
/** 순서 저장 실패 — 화면은 이미 새 순서를 그려 놓았으므로 "다시 불러와라"까지 말해 준다. */
const ORDER_FAILED = '순서를 저장하지 못했습니다. 새로고침 후 다시 시도해 주세요.';
const SIGN_IN_AGAIN = '권한이 없습니다. 다시 로그인해 주세요.';
/**
 * 분류되지 않은 DB 실패의 기본 문구(`describeFailure` 의 default).
 *
 * **동작을 가리키지 않는 낱말('처리')인 것은 의도다.** 이 한 문장을 13개 액션이 나눠 쓰는데,
 * '저장'이라고 말하면 삭제·고정 해제가 실패한 자리에서 하지도 않은 일을 말하게 된다(바로 위
 * `ORDER_FAILED` 는 반대다 — 순서 저장 한 곳만 쓰므로 그 동작을 이름으로 부른다).
 *
 * `lib/constants.ts` 의 `REQUEST_FAILED` 와 **같은 문장**이어야 한다 — 화면이 응답을 아예 받지
 * 못했을 때 대신 내는 문장이라, 갈라지면 같은 상황이 두 가지로 불린다.
 */
const RETRY_LATER = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/**
 * 일괄 삭제 한 문장에 실을 수 있는 id 수 (`deleteBookmarks`). PostgREST 의 `in` 필터가 id 를 전부
 * URL 에 싣기 때문에 생기는 **전송 계층의 한계**이지 도메인 규칙이 아니다 — 화면은 이 값을 몰라도
 * 되고 알 필요도 없다(더 많이 골라도 액션이 알아서 나눠 보낸다).
 */
const DELETE_BATCH_SIZE = 100;

// ───────────────────────────────────────────────────────── 상위 카테고리

/**
 * 상위 카테고리를 만든다. 순서는 기존 상위들 **맨 뒤**에 붙는다.
 *
 * @param name 카테고리 이름 (앞뒤 공백은 다듬는다. 비면 거부)
 * @returns 이름이 비었을 때 · 같은 이름이 이미 있을 때(DB unique) 실패
 */
export async function createCategory(name: string): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const cleanName = asText(name);
  if (cleanName === null) return fail(NAME_REQUIRED);

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
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const cleanName = asText(name);
  if (cleanName === null) return fail(NAME_REQUIRED);

  const { data, error } = await supabase
    .from('categories')
    .update({ name: cleanName })
    .eq('id', targetId)
    .is('parent_id', null)
    .select('id');
  if (error !== null) return describeFailure('상위 카테고리 이름 수정', error);
  if (isEmpty(data)) return fail(CATEGORY_NOT_FOUND);

  return succeed();
}

/**
 * 상위 카테고리를 지운다. **비어 있어야 지운다** — 하위가 남아 있어도, 직속 링크가 남아 있어도 거부한다.
 *
 * 규칙은 하나다: **"지우려면 먼저 비워라."** 둘 다 DB 의 `on delete set null` 이 조용히 데이터를
 * 망가뜨리는 경로이기 때문이다.
 *
 * - 하위(`categories.parent_id ... on delete set null`): 하위가 `parent_id = null` 이 되어 **상위로
 *   승격**된다 — 사이드바에 낯선 상위가 우수수 생기고 2단 트리 전제도 깨진다.
 * - 직속 링크(`bookmarks.category_id ... on delete set null`): 링크가 `category_id = null` 인
 *   **미분류**가 된다 — 목록 화면에서 사라지는 데서 끝나지 않고 **관리 화면(I4 링크 표)에도 뜨지
 *   않아 되돌릴 화면이 아예 없다.** 검색·즐겨찾기·매일에만 남는 유령 행이 된다.
 *
 * 그래서 두 경로 모두 여기서 막는다 — 이제 이 액션으로 `set null` 에 도달하는 정상 경로는 없다.
 * DB 제약을 `on delete restrict` 로 승격하면 경합까지 막히지만 스키마 변경이라 **백로그**로 둔다.
 *
 * ⚠️ 검사와 삭제는 한 트랜잭션이 아니다(TOCTOU). 검사 직후 다른 창이 하위나 링크를 만들면 그것들이
 * 승격·미분류가 될 수 있다.
 *
 * **승격된 하위의 복구 절차** — 관리 화면만으로 가능한 순서다. I4 링크 표의 분류 select 는
 * **지금 고른 상위의 하위만** 나열하므로, "다른 상위 아래의 하위로 옮기기" 는 애초에 못 고른다.
 * 그래서 옮기는 대신 **승격본을 원래 상위 자리에 앉힌다**:
 *
 * ① 승격본의 이름을 지워진 상위의 이름으로 바꾼다(`renameCategory` — 이제 상위다). 링크는
 *    그대로 딸려 오고, 상위 직속이 된다.
 * ② 그 아래에 원래 하위 이름으로 하위를 다시 만든다(`createSubCategory`).
 * ③ I4 링크 표에서 그 상위를 고르면 각 행의 select 에 ②의 하위가 뜬다 — 링크를 거기로 옮긴다.
 *
 * **미분류가 된 직속 링크는 화면으로 되돌릴 수 없다.** `category_id = null` 인 행은 I4 표에도
 * 뜨지 않아 고를 화면 자체가 없다(위 "직속 링크" 문단). DB 에서 직접 되돌려야 한다.
 */
export async function deleteCategory(id: string): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const found = await supabase.from('categories').select('id, parent_id').eq('id', targetId).maybeSingle();
  if (found.error !== null) return describeFailure('카테고리 조회', found.error);

  const category = found.data as CategoryRow | null;
  if (category === null) return fail(CATEGORY_NOT_FOUND);
  if (category.parent_id !== null) return fail(NOT_A_TOP_LEVEL);

  const children = await supabase.from('categories').select('id').eq('parent_id', targetId).limit(1);
  if (children.error !== null) return describeFailure('하위 카테고리 조회', children.error);
  if (!isEmpty(children.data)) return fail(CHILDREN_FIRST);

  const links = await supabase.from('bookmarks').select('id').eq('category_id', targetId).limit(1);
  if (links.error !== null) return describeFailure('직속 링크 조회', links.error);
  if (!isEmpty(links.data)) return fail(LINKS_FIRST);

  const { data, error } = await supabase.from('categories').delete().eq('id', targetId).select('id');
  if (error !== null) return describeFailure('상위 카테고리 삭제', error);
  if (isEmpty(data)) return fail(CATEGORY_NOT_FOUND);

  return succeed();
}

/**
 * 상위 카테고리 순서를 통째로 다시 매긴다 — `orderedIds[i]` 의 `sort_order` 가 `i` 가 된다.
 * 공개 사이드바의 순서가 이 값이다.
 *
 * **상위만 건드린다** — 각 update 에 `parent_id is null` 이 함께 걸린다. 하위 id 가 섞여 오면 그
 * 행은 0건이 되고, 전부 하위였다면 "한 행도 안 바뀜"으로 거부된다. 다른 액션들과 같은 방침이다
 * (상위/하위 액션은 서로의 대상을 건드리지 못한다).
 *
 * @param orderedIds 화면에 보이는 순서 그대로의 id 목록. 빈 목록은 아무것도 하지 않고 성공이다.
 */
export async function reorderCategories(orderedIds: string[]): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  return applyOrder(supabase, 'categories', orderedIds, 'top-level-only');
}

// ───────────────────────────────────────────────────────── 하위 카테고리

/**
 * 상위 아래에 하위 카테고리를 만든다. 순서는 같은 부모의 형제들 맨 뒤다.
 *
 * **`parentId` 가 이미 하위면 거부한다** — 카테고리는 2단계까지다(I2 시스템 제약). 이 방어는 UI 와
 * 서버 양쪽에 있어야 한다: 액션은 공개 엔드포인트라 화면의 select 상자만으로는 막히지 않는다.
 */
export async function createSubCategory(parentId: string, name: string): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetParentId = asText(parentId);
  if (targetParentId === null) return fail(INVALID_REQUEST);

  const cleanName = asText(name);
  if (cleanName === null) return fail(NAME_REQUIRED);

  const found = await supabase
    .from('categories')
    .select('id, parent_id')
    .eq('id', targetParentId)
    .maybeSingle();
  if (found.error !== null) return describeFailure('상위 카테고리 조회', found.error);

  const parent = found.data as CategoryRow | null;
  if (parent === null) return fail(PARENT_NOT_FOUND);
  if (parent.parent_id !== null) return fail(DEPTH_LIMIT);

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
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const cleanName = asText(name);
  if (cleanName === null) return fail(NAME_REQUIRED);

  const { data, error } = await supabase
    .from('categories')
    .update({ name: cleanName })
    .eq('id', targetId)
    .not('parent_id', 'is', null)
    .select('id');
  if (error !== null) return describeFailure('하위 카테고리 이름 수정', error);
  if (isEmpty(data)) return fail(SUB_NOT_FOUND);

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
 * 이때도 **실패를 돌려주기 전에 화면은 다시 그리게 한다**(`failAfterPartialChange`) — 옮겨진 링크가
 * 화면에는 아직 옛 자리에 있는 상태로 남으면 안 된다.
 */
export async function deleteSubCategory(id: string): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const found = await supabase.from('categories').select('id, parent_id').eq('id', targetId).maybeSingle();
  if (found.error !== null) return describeFailure('하위 카테고리 조회', found.error);

  const category = found.data as CategoryRow | null;
  if (category === null) return fail(SUB_NOT_FOUND);
  if (category.parent_id === null) return fail(NOT_A_SUB);

  // `select('id')` 는 **몇 건이 옮겨졌는지 알기 위해서**다 — 뒤이은 삭제가 실패했을 때
  // 화면을 다시 그려야 하는지가 이 숫자로 갈린다.
  const moved = await supabase
    .from('bookmarks')
    .update({ category_id: category.parent_id })
    .eq('category_id', targetId)
    .select('id');
  if (moved.error !== null) return describeFailure('링크 상위 재배속', moved.error);

  const movedCount = countRows(moved.data);

  const { data, error } = await supabase.from('categories').delete().eq('id', targetId).select('id');
  if (error !== null) {
    return failAfterPartialChange(movedCount, describeFailure('하위 카테고리 삭제', error));
  }
  if (isEmpty(data)) return failAfterPartialChange(movedCount, fail(SUB_NOT_FOUND));

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
 *
 * ## `favicon_url` 계약 (I3 파비콘 수집이 쓰는 자리)
 *
 * insert 페이로드에 **`favicon_url` 키는 언제나 실린다** — 미지정·공백·`null` 이면 `null` 이다.
 * DB 기본값에 기대지 않는 이유: 기본값이 바뀌면 이 액션이 만든 행의 의미가 조용히 따라 바뀐다.
 * 값의 형식은 `isIconUrl` 이 본다(http · https · `data:image/...`). 형식이 틀리면 **거부**한다 —
 * 조용히 `null` 로 접으면 "저장됐는데 아이콘만 없는" 상태가 되어 원인을 못 찾는다.
 *
 * ⚠️ Storage 키 규약이 둘이다. I3 은 **insert 전에** 파비콘을 올리므로 그 시점에 북마크 uuid 가
 * 아직 없다 — 그래서 I3 은 `hostOf(url)` 기반 키(예: `<host>.<확장자>`)에 `upsert: true` 를 권한다
 * (같은 사이트를 여러 번 담아도 파일 하나로 모이고, 실패해도 덮어쓰기로 복구된다). 반면 시드 경로
 * `scripts/collect-favicons.ts` 는 이미 만들어진 북마크의 **uuid 를 키**로 쓴다. 버킷 안에 두 체계가
 * 공존하지만 저장되는 값은 어느 쪽이든 public URL 이라 읽는 쪽(`lib/favicon.ts`)은 구분하지 않는다.
 */
export async function createBookmark(input: NewBookmark): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  if (input === null || typeof input !== 'object') return fail(INVALID_REQUEST);

  const url = asHttpUrl(input.url);
  if (url === null) return fail(URL_REQUIRED);

  const categoryId = asText(input.categoryId);
  if (categoryId === null) return fail(CATEGORY_REQUIRED);

  const faviconUrl = readIconUrl(input.faviconUrl);
  if (faviconUrl === false) return fail(ICON_URL_INVALID);

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
    favicon_url: faviconUrl,
    sort_order: sortOrder,
  });
  if (error !== null) return describeFailure('링크 추가', error);

  return succeed();
}

/**
 * 링크를 부분 수정한다 — `patch` 에 **준 키만** 바뀐다(`BookmarkPatch` 참조).
 * I4 의 표 인라인 편집과 J2 의 카드 인라인 편집이 함께 쓴다.
 *
 * 값 검사는 **생성보다 엄하다**. `createBookmark` 는 "안 준 값"을 기본값으로 채우는 자리라 이상한
 * 값을 못 준 것으로 볼 여지가 있지만, patch 의 키는 "이 값으로 정해라"라는 뜻이다 — 문자열도
 * `null` 도 아닌 값이 오면 조용히 비우지 않고 `INVALID_REQUEST` 로 거부한다(`title` 과 대칭).
 */
export async function updateBookmark(id: string, patch: BookmarkPatch): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);
  if (patch === null || typeof patch !== 'object') return fail(INVALID_REQUEST);

  const row: Record<string, string | null> = {};

  if (patch.title !== undefined) {
    const title = asText(patch.title);
    if (title === null) return fail(NAME_REQUIRED);
    row.title = title;
  }
  if (patch.url !== undefined) {
    const url = asHttpUrl(patch.url);
    if (url === null) return fail(URL_REQUIRED);
    row.url = url;
  }
  if (patch.categoryId !== undefined) {
    const categoryId = asText(patch.categoryId);
    if (categoryId === null) return fail(CATEGORY_REQUIRED);
    row.category_id = categoryId;
  }
  if (patch.description !== undefined) {
    if (patch.description !== null && typeof patch.description !== 'string') return fail(INVALID_REQUEST);
    row.description = asText(patch.description);
  }
  if (patch.faviconUrl !== undefined) {
    const faviconUrl = readIconUrl(patch.faviconUrl);
    if (faviconUrl === false) return fail(ICON_URL_INVALID);
    row.favicon_url = faviconUrl;
  }

  if (Object.keys(row).length === 0) return fail(NOTHING_TO_UPDATE);

  const { data, error } = await supabase.from('bookmarks').update(row).eq('id', targetId).select('id');
  if (error !== null) return describeFailure('링크 수정', error);
  if (isEmpty(data)) return fail(BOOKMARK_NOT_FOUND);

  return succeed();
}

/**
 * 링크를 지운다. 클릭 기록은 DB 가 함께 지운다(`clicks ... on delete cascade`).
 * 이미 없는 링크에는 성공이라고 하지 않는다 — J3 의 확인 오버레이가 "지웠다"고 말하려면
 * 정말 한 행이 지워졌는지 알아야 한다.
 */
export async function deleteBookmark(id: string): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const { data, error } = await supabase.from('bookmarks').delete().eq('id', targetId).select('id');
  if (error !== null) return describeFailure('링크 삭제', error);
  if (isEmpty(data)) return fail(BOOKMARK_NOT_FOUND);

  return succeed();
}

/**
 * 고른 링크들을 **한 번에** 지운다 (M2 정리 도구의 일괄 삭제).
 *
 * `deleteBookmark` 를 건수만큼 부르지 않는 이유는 왕복 수가 아니라 **결과의 설명 가능성**이다:
 * n번 부르면 n개의 부분 결과가 생겨 "무엇이 지워졌는지"를 화면이 다시 조립해야 한다. `in` 한
 * 문장은 그 묶음 안에서는 전부 지워지거나 하나도 안 지워진다(Postgres 의 문장 단위 트랜잭션).
 *
 * ## 100건씩 나눠 보낸다
 *
 * PostgREST 의 `in` 필터는 **id 를 전부 URL 질의문자열에 싣는다.** uuid 하나가 인코딩 뒤 40바이트
 * 남짓이라 290건을 한 문장에 담으면 12KB 를 넘고, Supabase 앞단(요청 줄 8KB 기본)이 414 로 끊는다.
 * 시드 290행 전체를 고르는 '전체 선택'이 실제로 가능한 화면이라 가정이 아니라 도달하는 경로다.
 * 그래서 `DELETE_BATCH_SIZE` 로 잘라 `Promise.allSettled` 로 보낸다 — `applyOrder` 와 같은 이유로
 * `all` 이 아니다(fetch 거부가 그대로 액션 밖으로 나가면 화면은 `{ok:false}` 를 기다리는데 Next
 * 오류 경계가 뜬다).
 *
 * ## 몇 건이 지워져야 성공인가
 *
 * **한 건이라도 지워졌으면 성공이다** — `applyOrder`(0건이면 실패, 그 외 성공)와 같은 규칙이다.
 * 고른 뒤 다른 창이 그중 하나를 먼저 지웠다면 요청한 끝 상태("이 링크들은 없다")는 이미 이뤄진
 * 셈이라, 이룬 것을 실패라고 말하면 화면이 거짓 경보를 낸다. 반대로 **한 건도 못 지웠으면**
 * 성공이라 하지 않는다(`deleteBookmark` 와 같은 판단 — 화면이 "지웠다"고 말하려면 정말 지워져야
 * 한다). 몇 건이 지워졌는지는 응답이 아니라 **다시 그려진 목록**이 알려 준다: 반환 모양
 * `{ok:true}|{ok:false,error}` 은 12개 액션이 함께 쓰는 계약이라 이 액션 하나 때문에 넓히지 않는다.
 *
 * ## 빈 목록은 성공이 아니다
 *
 * `reorderBookmarks([])` 는 성공이지만(빈 목록을 정렬한 결과는 빈 목록이다) 여기서는 거부한다.
 * 화면은 0건일 때 버튼을 잠그므로 빈 배열은 화면을 거치지 않은 요청이고, `{ok:true}` 로 접으면
 * 아무것도 안 지운 채 "삭제했습니다" 토스트가 나간다.
 *
 * @param ids 지울 링크 id 들. 빈 배열·중복·문자열 아닌 값은 DB 에 붙기 전에 거부한다.
 */
export async function deleteBookmarks(ids: string[]): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetIds = asIdList(ids);
  if (targetIds === null || targetIds.length === 0) return fail(INVALID_REQUEST);

  const settled = await Promise.allSettled(
    batches(targetIds, DELETE_BATCH_SIZE).map((batch) =>
      supabase.from('bookmarks').delete().in('id', batch).select('id'),
    ),
  );

  const answered = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const deleted = answered.reduce((sum, result) => sum + countRows(result.data), 0);

  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected !== undefined) {
    console.error('[mutations] 링크 일괄 삭제 실패 — 요청이 거부됐다', rejected.reason);

    return failAfterPartialChange(deleted, fail(RETRY_LATER));
  }

  const broken = answered.find((result) => result.error !== null);
  if (broken !== undefined && broken.error !== null) {
    return failAfterPartialChange(deleted, describeFailure('링크 일괄 삭제', broken.error));
  }

  if (deleted === 0) return fail(BOOKMARK_NOT_FOUND);

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
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  return applyOrder(supabase, 'bookmarks', orderedIds, 'any');
}

/**
 * '매일 사용하는 사이트' 고정을 켜고 끈다.
 *
 * **13번째 고정은 DB 트리거(`enforce_pin_limit`)가 막는다** — 액션이 미리 세지 않는 것은 의도다.
 * 세어 보고 쓰는 사이에 다른 요청이 끼어들 수 있어(TOCTOU) 상한이 조용히 13이 될 수 있고, 트리거는
 * `pg_advisory_xact_lock` 으로 그 경합까지 직렬화한다. 여기서는 그 예외를 사용자 문구로 바꾸는 일만 한다.
 *
 * 읽고 나서 쓰는(read-then-write) 이유: PostgREST 의 update 값에는 **컬럼 식을 넣을 수 없다**
 * (`is_pinned = not is_pinned` 를 표현할 방법이 없고 리터럴만 받는다). 그래서 현재 값을 읽어 반대를
 * 쓴다 — 그 사이 다른 창이 토글하면 나중 요청이 이기지만, 다시 누르면 맞아 돌아온다.
 *
 * 고정을 **푸는** 방향은 트리거가 아예 발동하지 않는다(`when (new.is_pinned)`).
 */
export async function togglePin(id: string): Promise<ActionResult> {
  const supabase = await writeClient();
  if (supabase === null) return DENIED;

  const targetId = asText(id);
  if (targetId === null) return fail(INVALID_REQUEST);

  const found = await supabase.from('bookmarks').select('id, is_pinned').eq('id', targetId).maybeSingle();
  if (found.error !== null) return describeFailure('링크 조회', found.error);

  const bookmark = found.data as PinRow | null;
  if (bookmark === null) return fail(BOOKMARK_NOT_FOUND);

  const { data, error } = await supabase
    .from('bookmarks')
    .update({ is_pinned: !bookmark.is_pinned })
    .eq('id', targetId)
    .select('id');
  if (error !== null) return describeFailure('고정 토글', error);
  if (isEmpty(data)) return fail(BOOKMARK_NOT_FOUND);

  return succeed();
}

// ───────────────────────────────────────────────────────── 내부 helpers

/**
 * 인증 관문 + 쓰기 클라이언트. **모든 액션의 첫 줄이 이것이다.**
 * `null` 이면 비로그인이므로 호출부는 `DENIED` 를 그대로 돌려준다.
 *
 * 이름이 `writeClient` 인 것은 의도다 — "admin" 이라는 말이 붙으면 service role 을 떠올리게 되는데
 * 이 파일이 절대 쓰지 않는 것이 바로 그것이다(파일 상단 참조). 이건 **로그인한 관리자 자격의
 * 쓰기용 클라이언트**이고 RLS 를 그대로 통과한다.
 */
async function writeClient(): Promise<WriteClient | null> {
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
 * **부분 성공 뒤의 실패.** 한 액션이 문장을 여러 개 던지는 곳(하위 삭제·순서 저장)에서, 앞 문장이
 * 이미 행을 바꾼 뒤 뒤 문장이 실패하면 이 함수를 거쳐 실패를 돌려준다.
 */
function failAfterPartialChange(changed: number, result: ActionResult): ActionResult {
  if (changed > 0) revalidatePath('/', 'layout'); // 일부는 이미 반영됐다 — 화면을 DB 와 맞춘다.

  return result;
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
      return fail(NAME_TAKEN);
    case '23503': // foreign_key_violation — 가리키는 카테고리가 없다
      return fail(CATEGORY_NOT_FOUND);
    case '22P02': // invalid_text_representation — uuid 가 아닌 id
      return fail(INVALID_REQUEST);
    case '42501': // RLS·권한 거부. 세션은 있었는데 DB 가 막았다 = 토큰이 만료된 직후 등
    case 'PGRST301': // JWT expired — PostgREST 가 DB 에 닿기도 전에 막은 같은 상황이다
      return fail(SIGN_IN_AGAIN);
    default:
      return fail(RETRY_LATER);
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
 * `Promise.all` 이 아니라 **`Promise.allSettled`** 인 이유: `fetch` 자체가 거부되면(네트워크 단절 등)
 * `all` 은 그 거부를 그대로 던져 **액션이 예외로 끝난다** — 화면은 `{ ok:false }` 를 기다리는데
 * Next 오류 경계가 뜬다. 거부도 다른 실패와 똑같이 접어서 돌려주고 진단만 로그로 남긴다.
 *
 * 동시 요청 수 = 목록 길이다. 부르는 쪽이 넘기는 것은 상위 카테고리 10여 개 또는 한 카테고리의
 * 링크 수십 개라 문제될 규모가 아니다 — 290건을 통째로 넘기는 호출부가 생기면 나눠 보내야 한다.
 *
 * 한 행도 바뀌지 않았으면 성공이라고 하지 않는다 — 정책이 통째로 막았거나 목록이 통째로 낡은
 * 경우를 "저장됨"으로 보고하면 화면이 거짓말을 하게 된다.
 *
 * @param scope `'top-level-only'` 면 각 update 에 `parent_id is null` 을 함께 건다. 상위 목록
 *   재정렬에 하위 id 가 섞여 들어오는 것을 **서버에서** 막는 장치다(그 행은 0건이 된다).
 */
async function applyOrder(
  supabase: WriteClient,
  table: 'categories' | 'bookmarks',
  orderedIds: string[],
  scope: 'top-level-only' | 'any',
): Promise<ActionResult> {
  const ids = asIdList(orderedIds);
  if (ids === null) return fail(INVALID_REQUEST);
  if (ids.length === 0) return { ok: true };

  const settled = await Promise.allSettled(
    ids.map((id, index) => {
      const query = supabase.from(table).update({ sort_order: index }).eq('id', id);

      return (scope === 'top-level-only' ? query.is('parent_id', null) : query).select('id');
    }),
  );

  const answered = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const touched = answered.reduce((sum, result) => sum + countRows(result.data), 0);

  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected !== undefined) {
    console.error(`[mutations] ${table} 순서 저장 실패 — 요청이 거부됐다`, rejected.reason);

    return failAfterPartialChange(touched, fail(ORDER_FAILED));
  }

  const broken = answered.find((result) => result.error !== null);
  if (broken !== undefined && broken.error !== null) {
    return failAfterPartialChange(touched, describeFailure(`${table} 순서 저장`, broken.error));
  }

  if (touched === 0) return fail(ORDER_FAILED);

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
 * 파비콘 주소로 쓸 수 있는 값인지. **`asHttpUrl` 을 재사용하지 않는다** — `data:image/...` 는
 * 여기서 정당한 저장값이기 때문이다(작은 아이콘을 인라인으로 담는다. `lib/favicon.ts` 가 그대로
 * `<img src>` 로 그리고 `lib/favicon.test.ts` 가 그 동작을 고정해 두었다).
 *
 * 허용: `http:` · `https:` · `data:image/`. `javascript:` 는 물론 `data:text/html` 같은 다른
 * data URI 도 막는다 — 파비콘 자리로 들어와도 결국 문서로 해석될 수 있는 값이다.
 */
function isIconUrl(text: string): boolean {
  if (/^data:image\//i.test(text)) return true;

  try {
    const { protocol } = new URL(text);

    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 입력을 **저장할 `favicon_url` 값**으로 바꾼다.
 *
 * - `null`·`undefined`·공백 문자열 → `null` ("비워라" 또는 "안 줬다")
 * - 형식이 맞는 문자열 → 다듬은 문자열
 * - 그 밖(문자열이 아님 · 허용되지 않는 스킴) → `false` = **거부 신호**. 호출부가
 *   `ICON_URL_INVALID` 로 접는다. 조용히 `null` 로 접지 않는 이유는 `createBookmark` 주석 참조.
 */
function readIconUrl(value: unknown): string | null | false {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return false;

  const text = value.trim();
  if (text === '') return null;

  return isIconUrl(text) ? text : false;
}

/**
 * 정렬용 id 목록 검증. 하나라도 비었거나 **중복이면 통째로 거부한다** — 같은 id 에 서로 다른
 * 순서를 매기는 요청은 어느 쪽이 이길지 정해지지 않아, 조용히 처리하면 결과를 설명할 수 없다.
 */
function asIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const ids: string[] = [];
  // 중복 판정은 `ids.includes` 가 아니라 Set 이다 — 목록이 길어질 수 있는 호출부
  // (`deleteBookmarks` 의 '전체 선택')가 생겼고, 배열 스캔이면 길이의 제곱만큼 돌아
  // 남이 보낸 큰 배열 하나가 요청을 붙들고 있게 된다(공개 엔드포인트다).
  const seen = new Set<string>();
  for (const item of value) {
    const id = asText(item);
    if (id === null || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

/** 긴 목록을 `size` 씩 자른다 — `deleteBookmarks` 가 URL 길이 한계 때문에 나눠 보낼 때 쓴다. */
function batches<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/** PostgREST 가 돌려준 행 배열이 비었는지 — "대상이 없었다"의 판정이다. */
function isEmpty(data: unknown): boolean {
  return !Array.isArray(data) || data.length === 0;
}

/** 돌려받은 행 수 — "몇 건이 실제로 바뀌었나"의 판정이다. */
function countRows(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}
