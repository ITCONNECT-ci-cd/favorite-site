import { access, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import type { SupabaseClient } from '@supabase/supabase-js';

import { hostOf } from '@/lib/url';
import type { BookmarkSeed } from '@/scripts/seed-mapper';

/**
 * B4 — 파비콘 수집·업로드. **단독 실행 진입점이 아니라 `scripts/seed.ts` 가 부르는 함수다.**
 *
 * ⚠️ 반드시 `buildSeed()` 가 만든 **그 북마크 배열**을 그대로 넘겨라. `buildSeed` 는 호출마다
 * uuid 를 새로 만들기 때문에(scripts/seed-mapper.ts 주석), 여기서 따로 시드를 만들면
 * 스토리지 경로(`<uuid>.<확장자>`)와 DB 의 북마크 id 가 통째로 어긋나 favicon_url 이 전부 빗나간다.
 *
 * 보유분(실측 72건)은 `docs/data/icons/<legacyId>.png` 를 그대로 올리고, 나머지(218건)는
 * 아래 `fetchRemoteIcon` 의 폴백 사슬로 받아 온다.
 *
 * 실패는 던지지 않고 모아서 돌려준다 — 파비콘 몇 개가 비는 것과 시드 전체가 엎어지는 것은
 * 심각도가 다르고, 카드는 `favicon_url = null` 을 회색 타일로 렌더한다(lib/favicon.ts).
 */

/** 공개 버킷 이름 — 관리자 재수집(I3)도 같은 버킷을 쓴다. */
export const FAVICON_BUCKET = 'favicons';

/** 바깥으로 나가는 아이콘 요청의 최소 간격(재시도 포함). */
const REQUEST_INTERVAL_MS = 150;

/** 최초 1회 + 재시도 2회. */
const MAX_ATTEMPTS = 3;

/** 한 요청이 이만큼 못 끝내면 실패로 넘긴다 — 한 호스트가 전체를 붙잡지 못하게. */
const REQUEST_TIMEOUT_MS = 10_000;

/** 업로드 동시 실행 수. 다운로드와 달리 상대가 우리 프로젝트라 직렬로 돌릴 이유가 없다. */
const UPLOAD_CONCURRENCY = 8;

/** 파비콘이라기엔 말이 안 되는 크기는 버린다(실측 최대: brevo.com 285KB). */
const MAX_ICON_BYTES = 1_000_000;

/** 사이트 HTML 에서 아이콘 링크를 찾을 때 훑는 앞부분 — <head> 는 여기 안에 있다. */
const HTML_SCAN_BYTES = 200_000;

/** 사이트에 직접 붙을 때만 쓴다. 평범한 브라우저가 아니면 막는 곳이 있다. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** A2 이월분 — 이 링크의 파비콘이 사이트 자체의 아이콘(`app/icon.png`)이 된다. */
const APP_ICON_LEGACY_ID = 275;

const ICONS_DIR = new URL('../docs/data/icons/', import.meta.url);
const APP_ICON_FILE = new URL('../app/icon.png', import.meta.url);

/**
 * 아이콘을 어디서 구했는지. 앞에 있을수록 정확도가 높아 먼저 시도한다.
 * - `local` docs/data/icons 보유분 (사람이 골라 둔 것 — 가장 믿을 만하다)
 * - `google-s2` 구글 s2, 정확한 host
 * - `google-s2-parent` 구글 s2, 상위 도메인 (브랜드 아이콘으로 근사)
 * - `google-v2` 구글 faviconV2, 정확한 host
 * - `site` 사이트가 직접 서빙하는 파비콘
 */
export type IconSource = 'local' | 'google-s2' | 'google-s2-parent' | 'google-v2' | 'site';

export type FaviconFailure = {
  /** bookmarks.id */
  id: string;
  legacyId: number;
  title: string;
  host: string;
  /** 시도한 경로들이 각각 왜 실패했는지 — `s2 404 · v2 404 · 사이트 ENOTFOUND` */
  reason: string;
};

/**
 * `app/icon.png` 처리 결과.
 * - `written` 새로 만들었다 · `kept` 이미 있어 건드리지 않았다
 * - `unavailable` 파비콘을 못 구했다 · `skipped` 입력에 해당 북마크가 없다
 */
export type AppIconOutcome = 'written' | 'kept' | 'unavailable' | 'skipped';

export type FaviconCollection = {
  /** bookmark uuid → Storage public URL. **실패한 북마크는 키가 아예 없다**(favicon_url 은 null). */
  urls: Map<string, string>;
  failures: FaviconFailure[];
  /** 소스별 업로드 성공 수 — 어디에 기대고 있는지 리포트에 남긴다. */
  uploaded: Record<IconSource, number>;
  appIcon: AppIconOutcome;
};

export type CollectOptions = {
  /**
   * 시작 전에 버킷을 비운다. **시드(B5) 전용** — 시드는 매번 새 uuid 를 뽑으므로
   * 비우지 않으면 재실행마다 고아 객체가 290개씩 쌓인다.
   * 관리자 재수집처럼 기존 파일을 살려야 하는 곳에서는 절대 켜지 마라.
   */
  purge?: boolean;
  /** 진행 로그 출력구. 테스트에서 조용히 돌리려면 `() => {}` 를 넘긴다. */
  log?: (message: string) => void;
};

export async function collectFavicons(
  supabase: SupabaseClient,
  bookmarks: readonly BookmarkSeed[],
  options: CollectOptions = {},
): Promise<FaviconCollection> {
  const log = options.log ?? ((message: string) => console.log(message));

  await ensureBucket(supabase, log);
  if (options.purge === true) await purgeBucket(supabase, log);

  const failures: FaviconFailure[] = [];
  const assets = await downloadAll(bookmarks, failures, log);
  const urls = await uploadAll(supabase, assets, failures, log);

  const uploaded = emptyTally();
  for (const asset of assets) {
    if (urls.has(asset.bookmark.id)) uploaded[asset.icon.source] += 1;
  }

  const appIcon = await saveAppIcon(assets, bookmarks, log);

  // 동시 업로드 때문에 실패 순서가 흔들린다 — 원본 id 순으로 고정해야 두 실행의 리포트를 비교할 수 있다.
  failures.sort((left, right) => left.legacyId - right.legacyId);

  return { urls, failures, uploaded, appIcon };
}

/** 소스별 성공 수를 `보유분 72 · s2 185 …` 처럼 한 줄로. */
export function formatTally(uploaded: Record<IconSource, number>): string {
  const labels: Record<IconSource, string> = {
    local: '보유분',
    'google-s2': '구글 s2',
    'google-s2-parent': '구글 s2(상위도메인)',
    'google-v2': '구글 v2',
    site: '사이트 직접',
  };

  return (Object.keys(labels) as IconSource[])
    .filter((source) => uploaded[source] > 0)
    .map((source) => `${labels[source]} ${uploaded[source]}`)
    .join(' · ');
}

/** 실패 목록을 사람이 읽는 형태로 찍는다(비어 있으면 한 줄로 끝낸다). */
export function reportFailures(
  failures: readonly FaviconFailure[],
  log = console.log,
  retainedState = 'favicon_url = null 로 남는다',
): void {
  if (failures.length === 0) {
    log('파비콘 실패: 없음');
    return;
  }

  log(`파비콘 실패 ${failures.length}건 (${retainedState}):`);
  for (const failure of failures) {
    log(`  - [${failure.legacyId}] ${failure.title} · ${failure.host} — ${failure.reason}`);
  }
}

/** 실제 바이트로 판정한 이미지 종류. 확장자·Content-Type 은 여기서만 정한다. */
type IconKind = { contentType: string; extension: string };

type FetchedIcon = { body: Buffer; kind: IconKind; source: IconSource };

type Asset = { bookmark: BookmarkSeed; icon: FetchedIcon };

function emptyTally(): Record<IconSource, number> {
  return { local: 0, 'google-s2': 0, 'google-s2-parent': 0, 'google-v2': 0, site: 0 };
}

/**
 * 버킷을 만든다. 이미 있으면 그대로 쓴다.
 *
 * 스토리지 API 는 중복 생성에 409 를 준다. 그 한 가지만 통과시키고 나머지 오류는 던진다 —
 * 버킷이 없는 채로 업로드를 290번 시도해 봐야 290번 같은 이유로 실패할 뿐이다.
 */
async function ensureBucket(supabase: SupabaseClient, log: (message: string) => void): Promise<void> {
  const { error } = await supabase.storage.createBucket(FAVICON_BUCKET, { public: true });

  if (error === null) {
    log(`버킷 '${FAVICON_BUCKET}' 생성(public)`);
    return;
  }

  if (!isAlreadyExists(error)) {
    throw new Error(`버킷 '${FAVICON_BUCKET}' 생성 실패: ${error.message}`, { cause: error });
  }

  log(`버킷 '${FAVICON_BUCKET}' 이미 존재 — 그대로 사용`);
}

function isAlreadyExists(error: { message: string }): boolean {
  const statusCode = (error as { statusCode?: string | number }).statusCode;

  return String(statusCode) === '409' || /already exists|duplicate/i.test(error.message);
}

/** 버킷의 객체를 전부 지운다. list 는 한 번에 최대 1000개라 빌 때까지 돈다. */
async function purgeBucket(supabase: SupabaseClient, log: (message: string) => void): Promise<void> {
  const bucket = supabase.storage.from(FAVICON_BUCKET);
  let removed = 0;

  // 남은 게 없으면 곧장 빠져나오므로 상한은 순전히 안전장치다(1000 × 100 = 10만 객체).
  for (let round = 0; round < 100; round += 1) {
    const { data, error } = await bucket.list('', { limit: 1000 });
    if (error !== null) throw new Error(`버킷 목록 조회 실패: ${error.message}`, { cause: error });

    // 폴더 항목은 id 가 null 이라 지울 대상이 아니다(시드는 폴더를 만들지 않지만 방어).
    const names = data.filter((object) => object.id !== null).map((object) => object.name);
    if (names.length === 0) break;

    const { error: removeError } = await bucket.remove(names);
    if (removeError !== null) {
      throw new Error(`버킷 비우기 실패: ${removeError.message}`, { cause: removeError });
    }
    removed += names.length;
  }

  log(`버킷 비움 — 기존 객체 ${removed}개 삭제`);
}

/**
 * 모든 북마크의 아이콘 바이트를 모은다. 바깥 요청은 이 단계에서만 나가고 업로드는 뒤로 미룬다 —
 * 그래야 요청 간격(150ms)을 지키면서도 업로드는 병렬로 돌릴 수 있다.
 * 290개 × 1~2KB 라 전부 메모리에 들고 있어도 부담이 없다.
 */
async function downloadAll(
  bookmarks: readonly BookmarkSeed[],
  failures: FaviconFailure[],
  log: (message: string) => void,
): Promise<Asset[]> {
  const assets: Asset[] = [];
  /** host → 받아둔 아이콘 또는 실패 사유. 같은 호스트를 두 번 부르지 않는다(실측 290건 = 264 호스트). */
  const byHost = new Map<string, FetchedIcon | { reason: string }>();
  const throttle = createThrottle(REQUEST_INTERVAL_MS);
  let done = 0;

  for (const bookmark of bookmarks) {
    const host = hostOf(bookmark.url);

    if (bookmark.iconFile !== null) {
      try {
        // 보유분은 형식을 확인하지 않는다 — 72개 전부 PNG 매직 넘버로 확인해 둔 고정 자산이다.
        const body = await readFile(new URL(bookmark.iconFile, ICONS_DIR));
        assets.push({ bookmark, icon: { body, kind: PNG, source: 'local' } });
      } catch (error) {
        failures.push({ ...identify(bookmark, host), reason: `보유 파일 읽기 실패: ${messageOf(error)}` });
      }
    } else {
      let cached = byHost.get(host);
      if (cached === undefined) {
        cached = await fetchRemoteIcon(bookmark.url, host, throttle);
        byHost.set(host, cached);
      }

      if ('body' in cached) assets.push({ bookmark, icon: cached });
      else failures.push({ ...identify(bookmark, host), reason: cached.reason });
    }

    done += 1;
    if (done % 50 === 0 || done === bookmarks.length) {
      log(`  수집 ${done}/${bookmarks.length} (성공 ${assets.length} · 실패 ${failures.length})`);
    }
  }

  return assets;
}

/**
 * 한 호스트의 파비콘을 폴백 사슬로 받는다. 앞에서부터 시도하고 처음 성공한 것을 쓴다.
 *
 * 1. **구글 s2, 정확한 host** — 계획서가 지정한 기본 경로.
 * 2. **구글 s2, 상위 도메인** — s2 는 등록 사이트 단위로 색인해 서브도메인을 모르는 일이 잦다
 *    (실측: `jules.google.com` 404 지만 `google.com` 은 있다). 서브도메인을 한 겹씩 벗겨 재시도한다.
 *    브랜드 아이콘으로의 근사지만, 실측상 이 사이트들은 대개 그 브랜드의 서비스라 잘 맞는다.
 * 3. **구글 faviconV2** — s2 와 색인이 달라 최근 사이트를 아는 경우가 있다(실측: `opal.google`).
 * 4. **사이트 직접** — `/favicon.ico`, 없으면 홈 HTML 의 `<link rel="…icon…">`.
 *    가장 정확하지만 프레임워크 기본 아이콘이 걸리는 일이 있어(실측: Next.js 기본 파비콘)
 *    브랜드 근사(2)보다 뒤에 둔다.
 *
 * ⚠️ 구글 서비스는 모르는 사이트에 **404 + 기본 지구본 이미지**를 준다. 그러니 2xx 만 성공으로
 * 세야 한다 — 404 본문을 받아 쓰면 290장 중 수십 장이 똑같은 지구본이 되고, 그건 회색 타일보다
 * 나쁘다(디자인은 `favicon_url = null` 렌더 경로를 처음부터 지원한다).
 */
async function fetchRemoteIcon(
  url: string,
  host: string,
  throttle: () => Promise<void>,
): Promise<FetchedIcon | { reason: string }> {
  const reasons: string[] = [];

  const s2 = await fetchImage(googleS2(host), throttle);
  if ('body' in s2) return { ...s2, source: 'google-s2' };
  reasons.push(`s2 ${s2.reason}`);

  for (const parent of parentDomains(host)) {
    const viaParent = await fetchImage(googleS2(parent), throttle);
    if ('body' in viaParent) return { ...viaParent, source: 'google-s2-parent' };
    reasons.push(`s2(${parent}) ${viaParent.reason}`);
  }

  const origin = originOf(url);

  if (origin !== null) {
    const v2 = await fetchImage(googleV2(origin), throttle);
    if ('body' in v2) return { ...v2, source: 'google-v2' };
    reasons.push(`v2 ${v2.reason}`);

    // 사설망·루프백은 건드리지 않는다 — 로컬 개발 서버의 아이콘을 긁어 오면
    // 실행 환경마다 결과가 달라지고, 스크립트가 내부 주소를 찔러 보는 모양새가 된다.
    if (isPublicHost(host)) {
      const direct = await fetchImage(`${origin}/favicon.ico`, throttle, BROWSER_UA);
      if ('body' in direct) return { ...direct, source: 'site' };
      reasons.push(`사이트 ${direct.reason}`);

      const declared = await fetchDeclaredIcon(origin, throttle);
      if ('body' in declared) return { ...declared, source: 'site' };
      reasons.push(`사이트 HTML ${declared.reason}`);
    }
  }

  return { reason: reasons.join(' · ') };
}

function googleS2(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function googleV2(target: string): string {
  return (
    'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL' +
    `&size=64&url=${encodeURIComponent(target)}`
  );
}

/** 홈 HTML 의 `<link rel="…icon…" href="…">` 를 따라간다(선언 순서대로 첫 성공 채택). */
async function fetchDeclaredIcon(
  origin: string,
  throttle: () => Promise<void>,
): Promise<FetchedIcon | { reason: string }> {
  await throttle();

  let html: string;
  try {
    const response = await fetch(origin, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'user-agent': BROWSER_UA },
      redirect: 'follow',
    });
    if (!response.ok) return { reason: `HTTP ${response.status}` };
    html = (await response.text()).slice(0, HTML_SCAN_BYTES);
  } catch (error) {
    return { reason: messageOf(error) };
  }

  const hrefs: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href !== null) hrefs.push(href[1]);
  }

  if (hrefs.length === 0) return { reason: 'icon 링크 없음' };

  let reason = '';
  for (const href of hrefs.slice(0, 3)) {
    let resolved: string;
    try {
      resolved = new URL(href, origin).href;
    } catch {
      continue;
    }

    const icon = await fetchImage(resolved, throttle, BROWSER_UA);
    if ('body' in icon) return { ...icon, source: 'site' };
    reason = icon.reason;
  }

  return { reason: reason === '' ? '링크 해석 실패' : reason };
}

/**
 * 이미지를 받아 온다. 재시도 2회.
 *
 * 404 는 재시도하지 않는다 — "그런 파비콘은 없다"는 확정 답이라 두 번 더 물어도 같다.
 * 응답이 정말 이미지인지 **바이트로** 확인한다: 파비콘 자리에 SPA 의 index.html 을 돌려주는
 * 사이트가 흔한데, Content-Type 만 믿으면 HTML 을 파비콘이라고 올리게 된다.
 */
async function fetchImage(
  endpoint: string,
  throttle: () => Promise<void>,
  userAgent?: string,
): Promise<{ body: Buffer; kind: IconKind } | { reason: string }> {
  let reason = '알 수 없는 이유';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await throttle();

    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'follow',
        headers: userAgent === undefined ? undefined : { 'user-agent': userAgent },
      });

      if (!response.ok) {
        reason = `HTTP ${response.status}`;
        if (response.status === 404) break;
        continue;
      }

      const body = Buffer.from(await response.arrayBuffer());

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

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 매직 넘버로 이미지 종류를 판정한다. 아니면 null.
 *
 * SVG 는 일부러 받지 않는다 — 스크립트를 품을 수 있는 형식이라 공개 버킷에 그대로 두고 싶지 않다.
 * (실측 290건에서 SVG 로만 파비콘을 주는 사이트는 없었다.)
 */
function sniff(body: Buffer): IconKind | null {
  if (body.byteLength >= 8 && body.subarray(0, 8).equals(PNG_MAGIC)) return PNG;
  if (body.byteLength >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) {
    return { contentType: 'image/x-icon', extension: 'ico' };
  }
  if (body.byteLength >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (body.byteLength >= 6 && body.subarray(0, 4).toString('latin1') === 'GIF8') {
    return { contentType: 'image/gif', extension: 'gif' };
  }
  if (
    body.byteLength >= 12 &&
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }

  return null;
}

/**
 * `a.b.example.com` → `b.example.com`, `example.com`. 라벨이 2개 남으면 멈춘다.
 * IP 리터럴은 라벨을 벗기면 다른 주소가 되어 버리므로 건드리지 않는다.
 */
function parentDomains(host: string): string[] {
  if (!isDomainName(host)) return [];

  const parents: string[] = [];
  let labels = host.split('.');

  while (labels.length > 2) {
    labels = labels.slice(1);
    parents.push(labels.join('.'));
  }

  return parents;
}

function isDomainName(host: string): boolean {
  return !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(':') && host.includes('.');
}

/** 루프백·사설망·내부 이름이면 false — 직접 접속 대상에서 뺀다. */
function isPublicHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;

  return true;
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);

    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** 모은 바이트를 `<bookmark uuid>.<확장자>` 로 올리고 public URL 을 돌려준다. */
async function uploadAll(
  supabase: SupabaseClient,
  assets: readonly Asset[],
  failures: FaviconFailure[],
  log: (message: string) => void,
): Promise<Map<string, string>> {
  const bucket = supabase.storage.from(FAVICON_BUCKET);
  const urls = new Map<string, string>();
  let done = 0;

  await runPool(assets, UPLOAD_CONCURRENCY, async (asset) => {
    // 확장자는 실제 바이트를 따른다. 대부분 png 지만 사이트가 직접 주는 건 ico 인 경우가 있고,
    // 경로와 Content-Type 이 어긋나면 브라우저가 그리지 못한다.
    const path = `${asset.bookmark.id}.${asset.icon.kind.extension}`;
    const { error } = await bucket.upload(path, asset.icon.body, {
      contentType: asset.icon.kind.contentType,
      upsert: true,
    });

    if (error === null) {
      urls.set(asset.bookmark.id, bucket.getPublicUrl(path).data.publicUrl);
    } else {
      const host = hostOf(asset.bookmark.url);
      failures.push({ ...identify(asset.bookmark, host), reason: `업로드 실패: ${error.message}` });
    }

    done += 1;
    if (done % 50 === 0 || done === assets.length) {
      log(`  업로드 ${done}/${assets.length} (성공 ${urls.size})`);
    }
  });

  return urls;
}

/**
 * A2 이월 — itconnect.dev 파비콘을 사이트 아이콘으로 굳힌다(Next 는 `app/icon.png` 를 자동 인식).
 *
 * 파일이 이미 있으면 덮어쓰지 않는다. 시드는 여러 번 도는데 그때마다 받아 온 바이트로 덮어쓰면
 * 작업 트리가 이유 없이 더러워지고, 손으로 더 나은 아이콘을 넣어 둔 경우 날아간다.
 * PNG 가 아니면 만들지 않는다 — 파일 이름이 곧 형식인 규약이라 확장자를 속일 수 없다.
 */
async function saveAppIcon(
  assets: readonly Asset[],
  bookmarks: readonly BookmarkSeed[],
  log: (message: string) => void,
): Promise<AppIconOutcome> {
  const target = bookmarks.find((bookmark) => bookmark.legacyId === APP_ICON_LEGACY_ID);
  if (target === undefined) return 'skipped';

  const asset = assets.find((candidate) => candidate.bookmark.id === target.id);
  if (asset === undefined || asset.icon.kind.extension !== 'png') {
    log(`app/icon.png 건너뜀 — [${APP_ICON_LEGACY_ID}] ${target.title} 의 PNG 파비콘을 못 구했다`);
    return 'unavailable';
  }

  try {
    await access(APP_ICON_FILE);
    return 'kept';
  } catch {
    await writeFile(APP_ICON_FILE, asset.icon.body);
    log(`app/icon.png 생성 — ${hostOf(target.url)} 파비콘 ${asset.icon.body.byteLength}B`);
    return 'written';
  }
}

/** 마지막 요청으로부터 `intervalMs` 가 지날 때까지 기다리는 게이트를 만든다. */
function createThrottle(intervalMs: number): () => Promise<void> {
  let nextAllowedAt = 0;

  return async () => {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAllowedAt = Date.now() + intervalMs;
  };
}

/** 고정 개수의 실행 흐름이 같은 배열을 나눠 먹는다. `cursor` 증가는 원자적이다(단일 스레드). */
async function runPool<T>(
  items: readonly T[],
  size: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    }),
  );
}

function identify(bookmark: BookmarkSeed, host: string): Omit<FaviconFailure, 'reason'> {
  return { id: bookmark.id, legacyId: bookmark.legacyId, title: bookmark.title, host };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // Node 의 fetch 는 실제 사유를 cause 에 숨긴다 — 'fetch failed' 만 남기면 진단이 불가능하다.
    const cause = error.cause as { code?: string; message?: string } | undefined;
    if (cause?.code !== undefined) return `${cause.code}`;

    return error.message;
  }

  return String(error);
}
