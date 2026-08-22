import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

import { getDomain } from 'tldts';

import { parseBookmarkUrlV1 } from '@/lib/bookmark-url';

const MAX_HTML_BYTES = 200_000;
const MAX_REDIRECTS = 2;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;
const BROWSER_UA =
  'Mozilla/5.0 (compatible; ITCONNECT-Favorite-Metadata/1.0; +https://itconnect.dev)';

export type DiscordLinkMetadata = {
  title: string | null;
  description: string | null;
};

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type MetadataResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
};
export type MetadataNetwork = {
  resolve(host: string): Promise<readonly ResolvedAddress[]>;
  request(target: URL, pinned: ResolvedAddress, signal: AbortSignal): Promise<MetadataResponse>;
};

type CollectOptions = { signal: AbortSignal; network?: MetadataNetwork };

/**
 * HTML의 title/description만 읽는 제한 수집기다. 모든 redirect에서 DNS를 다시 검증하고 실제 소켓은
 * 검증한 주소에 pin한다. 본문·script·쿠키는 해석하거나 전달하지 않는다.
 */
export async function collectDiscordLinkMetadata(
  rawUrl: string,
  options: CollectOptions,
): Promise<DiscordLinkMetadata | null> {
  const network = options.network ?? DEFAULT_NETWORK;
  let target = metadataTarget(rawUrl);
  if (target === null) return null;

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (options.signal.aborted) return null;
      const addresses = await network.resolve(target.hostname);
      if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
        return null;
      }

      const response = await network.request(target, addresses[0], options.signal);
      if (isRedirect(response.status)) {
        const location = header(response.headers, 'location');
        if (location === null || redirects === MAX_REDIRECTS) return null;

        const redirected = metadataTarget(new URL(location, target).href);
        if (redirected === null || (target.protocol === 'https:' && redirected.protocol !== 'https:')) {
          return null;
        }
        target = redirected;
        continue;
      }

      if (response.status < 200 || response.status >= 300) return null;
      const contentType = header(response.headers, 'content-type');
      if (contentType === null || !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) {
        return null;
      }
      const contentEncoding = header(response.headers, 'content-encoding');
      if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') return null;
      if (response.body.byteLength === 0 || response.body.byteLength > MAX_HTML_BYTES) return null;

      return extractDiscordLinkMetadata(decodeHtml(response.body, contentType));
    }
  } catch {
    return null;
  }

  return null;
}

/** title/description 이외의 페이지 내용은 버리고, 표시 한계까지 정규화한다. */
export function extractDiscordLinkMetadata(html: string): DiscordLinkMetadata {
  const head = html.slice(0, MAX_HTML_BYTES);
  const meta = new Map<string, string>();

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = tagAttributes(tag);
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key !== '' && content !== undefined && !meta.has(key)) meta.set(key, content);
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  const title = cleanMetadataText(meta.get('og:title') ?? titleMatch?.[1] ?? '', MAX_TITLE_LENGTH);
  const description = cleanMetadataText(
    meta.get('og:description') ?? meta.get('description') ?? '',
    MAX_DESCRIPTION_LENGTH,
  );

  return { title: title === '' ? null : title, description: description === '' ? null : description };
}

/**
 * agent가 이미 만든 의미 있는 값은 보존한다. hostname/빈 설명처럼 정책상 임시값인 필드만 교체하며,
 * 페이지가 막혀도 설명은 빈 값으로 남기지 않는다.
 */
export function mergeDiscordLinkMetadata(input: {
  url: string;
  title: string;
  description: string;
  metadata: DiscordLinkMetadata | null;
}): { title: string; description: string } {
  const host = parseBookmarkUrlV1(input.url)?.host ?? '웹사이트';
  const currentTitle = cleanMetadataText(input.title, MAX_TITLE_LENGTH);
  const fetchedTitle = cleanMetadataText(input.metadata?.title ?? '', MAX_TITLE_LENGTH);
  const title =
    currentTitle === '' || isHostnameTitle(currentTitle, host)
      ? fetchedTitle || currentTitle || host
      : currentTitle;

  const currentDescription = cleanMetadataText(input.description, MAX_DESCRIPTION_LENGTH);
  const fetchedDescription = cleanMetadataText(
    input.metadata?.description ?? '',
    MAX_DESCRIPTION_LENGTH,
  );
  const fallback = cleanMetadataText(
    `${title}에서 제공하는 주요 정보와 서비스를 확인하는 웹사이트`,
    MAX_DESCRIPTION_LENGTH,
  );

  return {
    title: title || host,
    description: currentDescription || fetchedDescription || fallback,
  };
}

const BLOCKED_ADDRESSES = blockedAddresses();

function blockedAddresses(): { ipv4: BlockList; ipv6: BlockList } {
  // Node BlockList는 IPv4를 IPv4-mapped IPv6로도 비교한다. family별 목록을 분리하지 않으면
  // `::/96` 규칙이 공개 IPv4 전체를 막으므로 두 목록을 의도적으로 합치지 않는다.
  const ipv4 = new BlockList();
  const ipv6 = new BlockList();
  for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const) {
    ipv4.addSubnet(network, prefix, 'ipv4');
  }
  for (const [network, prefix] of [
    ['::', 96],
    ['::1', 128],
    ['::ffff:0:0', 96],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ] as const) {
    ipv6.addSubnet(network, prefix, 'ipv6');
  }
  return { ipv4, ipv6 };
}

function metadataTarget(rawUrl: string): URL | null {
  if (rawUrl.length < 1 || rawUrl.length > 2048) return null;
  const parsed = parseBookmarkUrlV1(rawUrl.trim());
  if (parsed === null || isIP(parsed.host) !== 0) return null;
  if (
    parsed.host === 'localhost' ||
    parsed.host.endsWith('.localhost') ||
    /\.(?:local|internal|home|lan|test|invalid|example|onion|arpa)$/.test(parsed.host) ||
    getDomain(parsed.host, { allowPrivateDomains: false }) === null
  ) {
    return null;
  }
  if (
    parsed.port !== null &&
    !((parsed.scheme === 'http' && parsed.port === 80) ||
      (parsed.scheme === 'https' && parsed.port === 443))
  ) {
    return null;
  }

  try {
    const target = new URL(rawUrl.trim());
    target.hash = '';
    return target;
  } catch {
    return null;
  }
}

function isPublicAddress(candidate: ResolvedAddress): boolean {
  if (candidate.family !== 4 && candidate.family !== 6) return false;
  if (isIP(candidate.address) !== candidate.family) return false;
  return candidate.family === 4
    ? !BLOCKED_ADDRESSES.ipv4.check(candidate.address, 'ipv4')
    : !BLOCKED_ADDRESSES.ipv6.check(candidate.address, 'ipv6');
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function decodeHtml(body: Uint8Array, contentType: string): string {
  const prefix = new TextDecoder('utf-8').decode(body.subarray(0, Math.min(4096, body.length)));
  const declared = /charset\s*=\s*["']?([^\s;"'>]+)/i.exec(contentType)?.[1]
    ?? /<meta\b[^>]*charset\s*=\s*["']?([^\s;"'>]+)/i.exec(prefix)?.[1]
    ?? 'utf-8';
  const label = /^(?:euc-kr|ks_c_5601-1987)$/i.test(declared) ? 'euc-kr' : declared;

  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function tagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1].replace(/^</, '').toLowerCase();
    if (name === 'meta' || name === '') continue;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function cleanMetadataText(value: string, limit: number): string {
  const withoutMarkup = value.replace(/<[^>]*>/g, ' ');
  const decoded = decodeEntities(withoutMarkup)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...decoded].slice(0, limit).join('');
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, decimal, hex, name) => {
    if (typeof decimal === 'string') return safeCodePoint(Number(decimal), entity);
    if (typeof hex === 'string') return safeCodePoint(Number.parseInt(hex, 16), entity);
    return named[String(name).toLowerCase()] ?? entity;
  });
}

function safeCodePoint(value: number, fallback: string): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
    return fallback;
  }
  return String.fromCodePoint(value);
}

function isHostnameTitle(title: string, host: string): boolean {
  const normalizedTitle = title.toLowerCase().replace(/^www\./, '').replace(/\/$/, '');
  const normalizedHost = host.toLowerCase().replace(/^www\./, '');
  return normalizedTitle === normalizedHost;
}

const DEFAULT_NETWORK: MetadataNetwork = {
  async resolve(host) {
    const addresses = await dnsLookup(host, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
  },
  request: requestPinned,
};

function requestPinned(
  target: URL,
  pinned: ResolvedAddress,
  signal: AbortSignal,
): Promise<MetadataResponse> {
  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      {
        method: 'GET',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9',
          'accept-encoding': 'identity',
          'user-agent': BROWSER_UA,
        },
        lookup: ((
          _hostname: string,
          options: { all?: boolean } | ((error: Error | null, address: string, family: number) => void),
          callback?: (...args: unknown[]) => void,
        ) => {
          const done = (typeof options === 'function' ? options : callback) as
            | ((...args: unknown[]) => void)
            | undefined;
          if (done === undefined) throw new Error('lookup callback missing');
          if (typeof options === 'object' && options.all === true) {
            done(null, [{ address: pinned.address, family: pinned.family }]);
          } else {
            done(null, pinned.address, pinned.family);
          }
        }) as never,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = response.headers;
        if (isRedirect(status)) {
          response.resume();
          resolve({ status, headers, body: new Uint8Array() });
          return;
        }

        const chunks: Uint8Array[] = [];
        let total = 0;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          const body = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve({ status, headers, body });
        };
        response.on('data', (chunk: Buffer) => {
          if (finished) return;
          const remaining = MAX_HTML_BYTES - total;
          if (remaining <= 0) {
            finish();
            response.destroy();
            return;
          }
          const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
          total += accepted.byteLength;
          chunks.push(accepted);
          if (total === MAX_HTML_BYTES) {
            // title/meta는 head에 있으므로 앞부분만 확정적으로 읽고 나머지 body는 소켓에서 받지 않는다.
            finish();
            response.destroy();
          }
        });
        response.on('end', finish);
      },
    );
    request.on('error', reject);
    request.end();
  });
}
