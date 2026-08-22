import { isIP } from 'node:net';

import { getDomain } from 'tldts';

import { parseBookmarkUrlV1 } from '@/lib/bookmark-url';
import {
  sniffDiscordIcon,
  type DiscordIconKind,
} from '@/lib/discord-favicon-image';

const MAX_ICON_BYTES = 1_000_000;
const PROVIDER_HOSTS = new Set(['www.google.com']);

export type DiscordFaviconProviderTarget = { origin: string; host: string };

/**
 * 외부 favicon provider에 전달해도 되는 공개 DNS hostname만 남긴다.
 * bookmark origin에는 접속하지 않으며 IP·내부 suffix·등록 불가능 도메인은 provider에도 보내지 않는다.
 */
export function discordFaviconProviderTarget(
  rawUrl: string,
): DiscordFaviconProviderTarget | null {
  if (rawUrl.length > 2048 || /[^\x00-\x7f]/.test(rawUrl)) return null;

  const parsed = parseBookmarkUrlV1(rawUrl.trim());
  if (parsed === null || isIP(parsed.host) !== 0) return null;

  const host = parsed.host.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /\.(?:local|internal|home|lan|test|invalid|example|onion|arpa)$/.test(host)
  ) {
    return null;
  }
  if (getDomain(host, { allowPrivateDomains: false }) === null) return null;

  const port = parsed.port === null ? '' : `:${parsed.port}`;
  return { host, origin: `${parsed.scheme}://${host}${port}` };
}

/** Google S2와 허용된 gstatic redirect에서만 이미지 바이트를 받는다. */
export async function fetchDiscordFaviconProvider(
  target: DiscordFaviconProviderTarget,
  signal: AbortSignal,
): Promise<{ body: Uint8Array; kind: DiscordIconKind }> {
  for (const initialEndpoint of providerEndpoints(target)) {
    let endpoint = initialEndpoint;

    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await fetch(endpoint, {
        cache: 'no-store',
        redirect: 'manual',
        signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null || redirects === 3) throw new Error('provider redirect rejected');

        const next = new URL(location, endpoint);
        if (next.protocol !== 'https:' || !isProviderHost(next.hostname)) {
          throw new Error('provider redirect host rejected');
        }
        endpoint = next;
        continue;
      }

      // S2가 새 subdomain을 모를 때만 등록 도메인과 faviconV2 provider 경로를 차례로 시도한다.
      if (response.status === 404) {
        await response.body?.cancel().catch(() => {});
        break;
      }
      if (!response.ok) throw new Error(`provider HTTP ${response.status}`);

      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new Error('provider body too large');
      }

      const body = await readLimitedBody(response, signal);
      const kind = sniffDiscordIcon(body);
      if (kind === null) throw new Error('provider response is not a supported image');

      return { body, kind };
    }
  }

  throw new Error('provider HTTP 404');
}

function providerEndpoints(target: DiscordFaviconProviderTarget): URL[] {
  const endpoints = [googleS2(target.origin)];
  const registrable = getDomain(target.host, { allowPrivateDomains: false });
  if (registrable !== null && registrable !== target.host) {
    const scheme = new URL(target.origin).protocol;
    endpoints.push(googleS2(`${scheme}//${registrable}`));
  }

  const v2 = new URL('https://t2.gstatic.com/faviconV2');
  v2.searchParams.set('client', 'SOCIAL');
  v2.searchParams.set('type', 'FAVICON');
  v2.searchParams.set('fallback_opts', 'TYPE,SIZE,URL');
  v2.searchParams.set('size', '64');
  v2.searchParams.set('url', target.origin);
  endpoints.push(v2);
  return endpoints;
}

function googleS2(origin: string): URL {
  const endpoint = new URL('https://www.google.com/s2/favicons');
  endpoint.searchParams.set('domain_url', origin);
  endpoint.searchParams.set('sz', '64');
  return endpoint;
}

function isProviderHost(host: string): boolean {
  return PROVIDER_HOSTS.has(host) || host === 'gstatic.com' || host.endsWith('.gstatic.com');
}

async function readLimitedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (response.body === null) throw new Error('empty provider response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ICON_BYTES) throw new Error('provider body too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  if (total === 0) throw new Error('empty provider response');

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
