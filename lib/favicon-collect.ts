'use server';

/**
 * I3 — 링크를 등록할 때 그 사이트의 파비콘을 한 장 구해 Storage 에 올리는 서버 액션.
 *
 * 화면(`components/admin/LinkAddRow.tsx`)은 **등록 전에** 이것을 부르고, 돌려받은 public URL 을
 * `createBookmark({ ..., faviconUrl })` 에 실어 보낸다. 순서가 이렇게 된 이유는 저쪽 JSDoc 에
 * 있다 — insert 전에는 북마크 uuid 가 없으므로 키를 `hostOf(url)` 로 잡고 `upsert: true` 로 올린다.
 * 시드(B4)가 만든 `<uuid>.<확장자>` 객체와 한 버킷에 공존하지만, 저장되는 값은 어느 쪽이든
 * public URL 이라 읽는 쪽(`lib/favicon.ts`)은 둘을 구분하지 않는다.
 *
 * ## 실패는 등록을 막지 않는다
 *
 * 파비콘을 못 구하는 것은 **정상 경로**다(계획 §7 리스크 표). 카드는 `favicon_url = null` 을
 * 회색 타일로 그린다. 그래서 여기서는 던지지 않고 `{ ok:false, error }` 를 돌려주며, 화면은
 * 그 문구를 등록 성공 알림에 덧붙이기만 한다. `error` 는 **사용자에게 그대로 보여도 되는 한국어
 * 한 문장**이다(`lib/mutations.ts` 와 같은 규약) — 어느 경로가 왜 실패했는지 같은 진단은
 * `console.warn` 으로 서버 로그에만 남긴다.
 *
 * ## service role 은 Storage 업로드에만 쓴다 (이중 방어 계약)
 *
 * 이 버킷에는 storage 정책이 없어(supabase/migrations 에 storage 정책 없음) 업로드가 service role
 * 을 요구한다. 그 키는 RLS 를 통째로 우회하므로 **이 모듈은 테이블에 절대 손대지 않는다** —
 * 행을 만드는 일은 로그인 사용자 자격(anon 키 + 쿠키)으로 나가는 `lib/mutations.ts` 의 몫이고,
 * 그것이 첫 줄 관문(`getAdminSession`)에 구멍이 생겼을 때 남는 두 번째 벽이다.
 * 이 금지는 주석만이 아니라 세 겹으로 잠근다:
 *
 * - `lib/favicon-collect.test.ts` — 런타임(`from` 스파이가 한 번도 불리지 않는다)과 소스
 *   (`.from(` 은 전부 `.storage` 를 거치고, insert·update·delete·rpc 는 없으며, `@/lib/mutations`
 *   를 정적·동적 어느 형태로도 끌어오지 않는다) 양쪽.
 * - `eslint.config.mjs` — 이 파일에 한해 `@/lib/mutations` import 를 error 로 막는다.
 *   ESLint 는 정적 import 만 보므로 동적 `import()`·`require()` 는 위 정규식이 맡는다(H4 교훈).
 *
 * 뒤집어 말하면 **`@/lib/supabase/admin` import 는 기본이 금지다** — 같은 config 가 그것을
 * 전역으로 막고, 정당한 자리(이 파일 · `app/api/click/route.ts` · 그 모듈 자신)만 이름으로
 * 되돌린다. 여기서 허용되는 근거는 오직 위의 "Storage 정책이 없어 업로드가 service role 을
 * 요구한다" 하나이고, 그래서 그 키가 닿는 곳이 `.storage` 로 끝나는지를 테스트가 매번 다시 센다.
 *
 * ## 수집 사슬의 출처
 *
 * 폴백 순서·바이트 판정·사설망 회피는 **B4 `scripts/collect-favicons.ts` 에서 옮겨 적었다**
 * (그 파일은 `node:fs`·tsx 전제라 앱에서 import 할 수 없다).
 *
 * 옮기면서 달라진 것은 **네 가지**이고, 넷 다 이유가 하나다 — B4 는 290건을 밤새 훑는 배치지만
 * 여기서는 사람이 등록 버튼을 누른 채 기다린다. 그래서 전부 "덜 끈질기게, 더 빨리 포기하게" 다.
 *
 * 1. **사이트 HTML 의 `<link rel="icon">` 추적은 뺐다.** B4 는 `/favicon.ico` 가 없으면 홈
 *    HTML 을 받아 선언된 아이콘을 따라가지만(B4 `fetchDeclaredIcon`), 그 한 갈래가 왕복을
 *    둘 더 부른다.
 * 2. **재시도가 줄었다** — `MAX_ATTEMPTS` 3 → 2(최초 1회 + 재시도 1회).
 * 3. **한 요청의 상한이 줄었다** — `REQUEST_TIMEOUT_MS` 10초 → 4초.
 * 4. **요청 간격(throttle)을 없앴다.** B4 는 구글에 초당 몇 건씩 쏟아 내지 않으려 사이를
 *    띄우지만, 여기는 한 번에 한 사이트뿐이라 쏟아 낼 것이 없다.
 *
 * 대신 B4 에 없던 것을 하나 두었다: **총 예산 8초**(`TOTAL_BUDGET_MS`). 한 사이트가 응답하지
 * 않아도 그 안에서 끝나고, 못 구하면 회색 타일로 등록된다.
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getAdminSession } from '@/lib/supabase/server';
import { hostOf } from '@/lib/url';

/**
 * 수집 결과. 모양은 `ActionResult` 와 같되 성공에 값이 실린다 —
 * `faviconUrl` 을 그대로 `createBookmark` 에 넘기면 된다.
 */
export type FaviconResult = { ok: true; faviconUrl: string } | { ok: false; error: string };

/** 공개 버킷 — 시드(B4)의 `FAVICON_BUCKET` 과 같은 이름이어야 한다(테스트가 두 소스를 대조한다). */
const FAVICON_BUCKET = 'favicons';

/** 한 요청의 상한. 사람이 기다리고 있어 B4(10초)보다 짧다. */
const REQUEST_TIMEOUT_MS = 4_000;

/** 사슬 전체의 상한. 여기를 넘기면 남은 경로를 포기하고 회색 타일로 등록한다. */
const TOTAL_BUDGET_MS = 8_000;

/** 최초 1회 + 재시도 1회. 404 는 확정 답이라 재시도하지 않는다. */
const MAX_ATTEMPTS = 2;

/** 파비콘이라기엔 말이 안 되는 크기는 버린다(B4 실측 최대: brevo.com 285KB). */
const MAX_ICON_BYTES = 1_000_000;

/** 사이트에 직접 붙을 때만 쓴다. 평범한 브라우저가 아니면 막는 곳이 있다. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DENIED = '로그인이 필요합니다.';
const NOT_A_URL = '주소를 해석할 수 없어 파비콘을 건너뜁니다.';
const NOT_FOUND = '파비콘을 찾지 못했습니다.';
const UPLOAD_FAILED = '파비콘을 저장하지 못했습니다.';

/**
 * 주소의 파비콘을 구해 Storage 에 올리고 public URL 을 돌려준다.
 *
 * @param url 등록하려는 링크의 주소. http/https 가 아니면 네트워크에 나가기 전에 거절한다.
 */
export async function collectFavicon(url: string): Promise<FaviconResult> {
  if ((await getAdminSession()) === null) return { ok: false, error: DENIED };

  // 서버 액션은 공개 엔드포인트다 — 타입 시그니처는 런타임 보장이 아니라서 인자를 다시 본다.
  const target = readTarget(url);
  if (target === null) return { ok: false, error: NOT_A_URL };

  const icon = await fetchIcon(target);
  if ('reason' in icon) {
    console.warn('파비콘 수집 실패 — 회색 타일로 등록된다', { host: target.host, reason: icon.reason });

    return { ok: false, error: NOT_FOUND };
  }

  return await upload(target.host, icon);
}

/** 우리가 아는 주소의 세 조각. `host` 는 카드 하단 줄·시드와 같은 규칙(`www.` 제거)이다. */
type Target = { host: string; origin: string };

type IconKind = { contentType: string; extension: string };

type FetchedIcon = { body: Uint8Array; kind: IconKind };

/** 실패는 사유 문자열 하나로 돈다 — 사슬 끝에서 로그 한 줄로 합친다. */
type Failure = { reason: string };

function readTarget(url: unknown): Target | null {
  if (typeof url !== 'string') return null;

  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    return { host: hostOf(parsed.href), origin: parsed.origin };
  } catch {
    return null;
  }
}

/**
 * 폴백 사슬 (B4 `fetchRemoteIcon` 에서 옮김 — 사이트 HTML 추적만 뺐다).
 *
 * 1. **구글 s2, 정확한 host** — 계획서가 지정한 기본 경로.
 * 2. **구글 s2, 상위 도메인** — s2 는 등록 사이트 단위로 색인해 서브도메인을 모르는 일이 잦다
 *    (B4 실측: `jules.google.com` 404 지만 `google.com` 은 있다).
 * 3. **구글 faviconV2** — s2 와 색인이 달라 최근 사이트를 아는 경우가 있다.
 * 4. **사이트 직접** `/favicon.ico`.
 *
 * ⚠️ 구글 서비스는 모르는 사이트에 **404 + 기본 지구본 이미지**를 준다. 2xx 만 성공으로 세야
 * 한다 — 404 본문을 받아 쓰면 서로 다른 사이트가 똑같은 지구본을 달게 되고, 그건 회색 타일보다 나쁘다.
 */
async function fetchIcon(target: Target): Promise<FetchedIcon | Failure> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const reasons: string[] = [];

  const s2 = await fetchImage(googleS2(target.host), deadline);
  if (!('reason' in s2)) return s2;
  reasons.push(`s2 ${s2.reason}`);

  for (const parent of parentDomains(target.host)) {
    const viaParent = await fetchImage(googleS2(parent), deadline);
    if (!('reason' in viaParent)) return viaParent;
    reasons.push(`s2(${parent}) ${viaParent.reason}`);
  }

  const v2 = await fetchImage(googleV2(target.origin), deadline);
  if (!('reason' in v2)) return v2;
  reasons.push(`v2 ${v2.reason}`);

  // 사설망·루프백은 건드리지 않는다 — 관리자만 부를 수 있는 액션이라도, 서버가 내부 주소를
  // 찔러 보는 경로를 열어 둘 이유가 없다(B4 와 같은 판단).
  if (isPublicHost(target.host)) {
    const direct = await fetchImage(`${target.origin}/favicon.ico`, deadline, BROWSER_UA);
    if (!('reason' in direct)) return direct;
    reasons.push(`사이트 ${direct.reason}`);
  }

  return { reason: reasons.join(' · ') };
}

function googleS2(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function googleV2(origin: string): string {
  return (
    'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL' +
    `&size=64&url=${encodeURIComponent(origin)}`
  );
}

/**
 * 이미지를 받아 온다. 재시도 1회, 남은 예산 안에서만.
 *
 * 응답이 정말 이미지인지 **바이트로** 확인한다: 파비콘 자리에 SPA 의 index.html 을 돌려주는
 * 사이트가 흔한데, Content-Type 만 믿으면 HTML 을 파비콘이라고 올리게 된다(B4 `fetchImage`).
 */
async function fetchImage(
  endpoint: string,
  deadline: number,
  userAgent?: string,
): Promise<FetchedIcon | Failure> {
  let reason = '알 수 없는 이유';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remaining = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
    if (remaining <= 0) return { reason: '시간 초과' };

    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(remaining),
        // 구글도 사이트도 아이콘을 리다이렉트로 넘기는 일이 흔해 따라간다. 대신 사설망 판정
        // (`isPublicHost`)은 **최초 URL 에만** 걸린다는 뜻이기도 하다 — 그 잔여 위험과 승격
        // 조건은 `isPublicHost` JSDoc 에 적어 두었다.
        redirect: 'follow',
        headers: userAgent === undefined ? undefined : { 'user-agent': userAgent },
      });

      if (!response.ok) {
        reason = `HTTP ${response.status}`;
        if (response.status === 404) break;
        continue;
      }

      const body = new Uint8Array(await response.arrayBuffer());

      if (body.byteLength === 0) {
        reason = '빈 응답';
        break;
      }
      if (body.byteLength > MAX_ICON_BYTES) {
        reason = `${body.byteLength}B — 너무 큼`;
        break;
      }

      const kind = sniff(body);
      if (kind === null) {
        reason = '이미지가 아님';
        break;
      }

      return { body, kind };
    } catch (error) {
      reason = messageOf(error);
    }
  }

  return { reason };
}

const PNG: IconKind = { contentType: 'image/png', extension: 'png' };

/**
 * 매직 넘버로 이미지 종류를 판정한다(B4 `sniff` 그대로 — Buffer 대신 Uint8Array).
 *
 * SVG 는 일부러 받지 않는다 — 스크립트를 품을 수 있는 형식이라 공개 버킷에 그대로 두고 싶지 않다.
 */
function sniff(body: Uint8Array): IconKind | null {
  if (startsWith(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (startsWith(body, [0x00, 0x00, 0x01, 0x00])) return { contentType: 'image/x-icon', extension: 'ico' };
  if (startsWith(body, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (startsWith(body, [0x47, 0x49, 0x46, 0x38])) return { contentType: 'image/gif', extension: 'gif' };
  if (startsWith(body, [0x52, 0x49, 0x46, 0x46]) && startsWith(body, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { contentType: 'image/webp', extension: 'webp' };
  }

  return null;
}

function startsWith(body: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (body.byteLength < offset + signature.length) return false;

  return signature.every((byte, index) => body[offset + index] === byte);
}

/**
 * `a.b.example.com` → `b.example.com`, `example.com`. 라벨이 2개 남으면 멈춘다.
 * IP 리터럴은 라벨을 벗기면 다른 주소가 되어 버리므로 건드리지 않는다(B4 `parentDomains`).
 */
function parentDomains(host: string): string[] {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || !host.includes('.')) return [];

  const parents: string[] = [];
  let labels = host.split('.');

  while (labels.length > 2) {
    labels = labels.slice(1);
    parents.push(labels.join('.'));
  }

  return parents;
}

/**
 * 루프백·사설망·내부 이름이면 false — 직접 접속 대상에서 뺀다(B4 `isPublicHost`).
 *
 * ## 남은 구멍 (알고 두는 것이다 — 백로그)
 *
 * 이 체는 **B4 의 것을 그대로** 옮겼고, 촘촘하지 않다. 지금 이대로 두는 근거는 **누가 부를 수
 * 있는가** 하나다: 이 액션의 첫 줄이 `getAdminSession()` 이라, 주소를 고를 수 있는 사람은 이미
 * 관리자 — 즉 서버에 들어와 있는 사람뿐이다. 그 사람이 내부 주소를 찔러 보고 싶다면 이 액션이
 * 아니어도 길은 많다. 그래서 지금은 Low 로 둔다.
 *
 * **승격 조건 — 로그인 없이(또는 관리자가 아닌 사람이) 이 수집을 걸 수 있게 되는 순간 즉시
 * Critical 이다.** 예: 공개 화면의 "링크 제보", 크론이 사용자 입력 URL 을 다시 훑는 배치.
 * 그때는 아래를 먼저 메워라:
 *
 * - **주소 대역이 빈다.** `169.254.0.0/16`(클라우드 메타데이터 `169.254.169.254` 가 여기다 —
 *   SSRF 로 자격 증명을 긁어 가는 고전 경로), `0.0.0.0`, `100.64.0.0/10`(CGNAT) 이 통과한다.
 *   (IPv6 리터럴은 대역과 무관하게 아래 `host.includes(':')` 가 이미 전부 막는다 — 유니크
 *   로컬 `fc00::/7`·링크 로컬 `fe80::/10` 도 그 한 줄에 함께 걸린다.)
 * - **이름은 주소가 아니다.** 여기서 보는 것은 host **문자열**이라, 사설 IP 로 해석되는 공개
 *   도메인(`*.nip.io` 류)이나 DNS 리바인딩은 걸러지지 않는다. 제대로 하려면 해석된 IP 를 보고
 *   연결해야 한다(Node fetch 로는 `lookup` 훅이 필요하다).
 * - **`redirect: 'follow'` 는 최초 URL 만 검사한다.** 공개 주소가 302 로 `127.0.0.1` 이나
 *   메타데이터 주소를 가리키면 그대로 따라간다 — 여기서 막을 방법은 `redirect: 'manual'` 로
 *   받아 `Location` 을 매 홉마다 다시 이 함수에 통과시키는 것뿐이다.
 *
 * 그때까지의 완충은 **하나뿐**이다: 응답은 바이트 매직 넘버로 이미지인지 확인해야만 쓰이고
 * (`sniff`), 사용자에게 돌아가는 문장에는 사유가 섞이지 않는다(`NOT_FOUND`).
 *
 * 완충이라고 부르되 무엇을 막지 **못하는지**를 함께 적어 둔다 — 위 승격이 필요해질 때 이 세
 * 줄이 판단 근거가 된다:
 *
 * - **본문이 밖으로 새지 않는다고 말할 수 없다.** `sniff` 를 통과한 바이트는 그대로 공개
 *   버킷에 올라가 public URL 로 다시 게시된다(`upload`). 체를 통과하는 대역(`169.254/16` ·
 *   `100.64/10` · `0.0.0.0` · `*.nip.io` 류 · 리다이렉트 홉)에서 이미지 형식으로 돌아온
 *   내부 응답은 그 경로로 밖에서 읽힌다. 새지 않는 것은 **이미지가 아닌** 본문뿐이다.
 * - **사설 주소 자체는 이미 밖으로 나간다.** 직접 접속만 막힐 뿐, 그 host·origin 은 s2 ·
 *   faviconV2 요청의 질의로 구글에 그대로 실려 간다(`fetchIcon` — 구글이 붙는 일이라 그대로
 *   두는 것이 의도이고, `lib/favicon-collect.test.ts` "사설망·로컬 주소에는 직접 붙지 않는다"
 *   가 우리 서버만 안 붙는다는 그 의도를 고정한다).
 * - "붙었는가/안 붙었는가"는 응답 시간으로 여전히 읽힌다.
 */
function isPublicHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  // IPv6 리터럴(`[::1]`)·호스트 이름 없는 주소는 판정할 수단이 없으니 붙지 않는다.
  if (host.includes(':') || !host.includes('.')) return false;

  return true;
}

/**
 * 받은 바이트를 `<host>.<확장자>` 로 올리고 public URL 을 돌려준다.
 *
 * 키가 host 라서 **같은 사이트의 링크를 여러 개 담아도 파일 하나로 모인다.** 그래서 `upsert` 다 —
 * 두 번째 등록이 409 로 실패하는 대신 최신 아이콘으로 덮인다(사이트가 아이콘을 바꾸면 따라간다).
 * 반대급부: 같은 host 의 옛 링크들도 새 그림을 함께 보게 된다. 파비콘은 사이트의 표식이지
 * 링크마다 다른 그림이 아니므로 이쪽이 맞다고 본다.
 *
 * 버킷은 만들지 않는다 — 시드(B4)가 만들어 둔 공개 버킷을 쓴다. 없으면 업로드가 실패하고
 * 회색 타일로 등록된다(사유는 서버 로그).
 */
async function upload(host: string, icon: FetchedIcon): Promise<FaviconResult> {
  const path = `${storageKey(host)}.${icon.kind.extension}`;
  const bucket = createAdminSupabaseClient().storage.from(FAVICON_BUCKET);

  const { error } = await bucket.upload(path, icon.body, {
    contentType: icon.kind.contentType,
    upsert: true,
  });

  if (error !== null) {
    console.error('파비콘 업로드 실패 — 회색 타일로 등록된다', { path, message: error.message });

    return { ok: false, error: UPLOAD_FAILED };
  }

  return { ok: true, faviconUrl: bucket.getPublicUrl(path).data.publicUrl };
}

/**
 * host 를 Storage 키로 쓸 수 있는 글자만 남긴다.
 *
 * 도메인 이름은 이미 이 범위지만(IDN 은 `URL` 이 punycode 로 준다), IPv6 리터럴 `[::1]` 처럼
 * 대괄호·콜론이 섞이는 host 가 있다. 경로에 그대로 쓰면 업로드가 거절되거나 다른 키가 된다.
 */
function storageKey(host: string): string {
  return host.replace(/[^a-zA-Z0-9.-]/g, '-');
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // Node 의 fetch 는 실제 사유를 cause 에 숨긴다 — 'fetch failed' 만 남기면 진단이 불가능하다.
    const cause = error.cause as { code?: string } | undefined;
    if (cause?.code !== undefined) return cause.code;

    return error.message;
  }

  return String(error);
}
