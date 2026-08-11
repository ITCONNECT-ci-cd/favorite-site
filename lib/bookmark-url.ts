/**
 * Discord ingest migration의 `public.normalize_bookmark_url_v1(text)`와 같은 계약을 구현하는
 * 애플리케이션 쪽 URL parser/canonicalizer다.
 *
 * WHATWG `URL`을 쓰지 않는 이유가 중요하다. `URL`은 IDN을 자동 punycode로 바꾸고, dot segment와
 * percent escape를 자체 규칙으로 정리한다. 이 기능의 중복 키는 path/query의 원문을 보존해야 하므로
 * 지원 문법을 작게 고정하고 authority만 직접 해석한다.
 *
 * 버전 1의 규칙을 바꿔서는 안 된다. DB generated column과 이 함수가 달라지면 같은 입력을 서로 다른
 * 중복 키로 판단한다. 변경이 필요하면 DB의 v2 migration과 함께 새 함수를 추가한다.
 */

export type BookmarkUrlParts = {
  scheme: 'http' | 'https';
  host: string;
  port: number | null;
  path: string;
  query: string | null;
  preservedFragment: string | null;
};

const SCHEME_RE = /^(https?):\/\//i;
const INVALID_ASCII_RE = /[\u0000-\u0020\u007f]/;
const INVALID_PERCENT_RE = /%(?![0-9a-f]{2})/i;
const ASCII_RE = /^[\u0000-\u007f]+$/;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const DIGITS_AND_DOTS_RE = /^[0-9.]+$/;

/**
 * 허용 문법의 절대 http(s) URL을 파싱한다. 실패는 예외가 아니라 `null`이다.
 *
 * 반환하는 path/query는 byte-oriented 원문이다. 일반 anchor fragment는 버리되, `#/`로 시작하는
 * SPA route는 identity일 수 있어 opaque text로 보존한다.
 */
export function parseBookmarkUrlV1(input: string): BookmarkUrlParts | null {
  if (input === '' || INVALID_ASCII_RE.test(input) || input.includes('\\') || INVALID_PERCENT_RE.test(input)) {
    return null;
  }

  const schemeMatch = SCHEME_RE.exec(input);
  if (schemeMatch === null) return null;

  const scheme = schemeMatch[1].toLowerCase() as 'http' | 'https';
  const remainder = input.slice(schemeMatch[0].length);
  const authorityEnd = firstDelimiterIndex(remainder);
  const authority = remainder.slice(0, authorityEnd);
  const suffix = remainder.slice(authorityEnd);

  if (authority === '' || authority.includes('@') || authority.includes('[') || authority.includes(']')) {
    return null;
  }

  const parsedAuthority = parseAuthority(authority);
  if (parsedAuthority === null) return null;

  const fragmentIndex = suffix.indexOf('#');
  const withoutFragment = fragmentIndex === -1 ? suffix : suffix.slice(0, fragmentIndex);
  const rawFragment = fragmentIndex === -1 ? null : suffix.slice(fragmentIndex);
  const preservedFragment = rawFragment?.startsWith('#/') === true ? rawFragment : null;
  const queryIndex = withoutFragment.indexOf('?');
  const path = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex);
  const query = queryIndex === -1 ? null : withoutFragment.slice(queryIndex + 1);

  // authority 다음에는 path(`/...`) 또는 query/fragment만 올 수 있다. delimiter 탐색 덕분에 정상
  // 입력은 항상 이 조건을 만족하지만, 이 단언을 두어 parser 수정 때 문법이 넓어지는 것을 막는다.
  if (path !== '' && !path.startsWith('/')) return null;

  return {
    scheme,
    host: parsedAuthority.host.toLowerCase(),
    port: parsedAuthority.port,
    path,
    query,
    preservedFragment,
  };
}

/**
 * 저장 URL과 별개인 전역 중복 키를 만든다. 허용 문법 밖이면 DB helper처럼 `null`을 반환한다.
 */
export function normalizeBookmarkUrlV1(input: string): string | null {
  const parsed = parseBookmarkUrlV1(input);
  if (parsed === null) return null;

  const port = isDefaultPort(parsed.scheme, parsed.port) || parsed.port === null ? '' : `:${parsed.port}`;
  const path = stripTrailingSlashRun(parsed.path);
  const query = normalizeQuery(parsed.query);

  return `${parsed.scheme}://${parsed.host}${port}${path}${query === null ? '' : `?${query}`}${parsed.preservedFragment ?? ''}`;
}

function firstDelimiterIndex(value: string): number {
  const indices = ['/', '?', '#']
    .map((delimiter) => value.indexOf(delimiter))
    .filter((index) => index >= 0);

  return indices.length === 0 ? value.length : Math.min(...indices);
}

function parseAuthority(authority: string): { host: string; port: number | null } | null {
  const colonIndex = authority.lastIndexOf(':');
  let host = authority;
  let port: number | null = null;

  if (colonIndex >= 0) {
    // bracket IPv6는 위에서 거부하며, 그 밖의 host에 colon이 둘 이상이면 지원 문법이 아니다.
    if (authority.indexOf(':') !== colonIndex) return null;

    host = authority.slice(0, colonIndex);
    const rawPort = authority.slice(colonIndex + 1);
    // `:0443`처럼 표기가 다른 같은 포트를 별도 canonical key로 통과시키지 않는다.
    if (!/^[1-9]\d*$/.test(rawPort)) return null;

    port = Number(rawPort);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;
  }

  if (!isValidHost(host)) return null;

  return { host, port };
}

function isValidHost(host: string): boolean {
  if (host === '' || host.length > 253 || !ASCII_RE.test(host)) return false;

  // 숫자와 점만 있으면 DNS 이름으로 우회시키지 않고 엄격한 dotted-decimal IPv4로 해석한다.
  if (DIGITS_AND_DOTS_RE.test(host)) return isValidIpv4(host);

  const labels = host.split('.');
  return labels.every((label) => DNS_LABEL_RE.test(label));
}

function isValidIpv4(host: string): boolean {
  const octets = host.split('.');
  if (octets.length !== 4) return false;

  return octets.every((octet) => {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

function isDefaultPort(scheme: 'http' | 'https', port: number | null): boolean {
  return (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443);
}

function stripTrailingSlashRun(path: string): string {
  if (path === '') return '';
  return path.replace(/\/+$/, '');
}

function normalizeQuery(query: string | null): string | null {
  // delimiter만 있던 `?`는 의미 있는 parameter가 없으므로 canonical 값에서 없앤다.
  if (query === null || query === '') return null;

  const parameters = query
    .split('&')
    .map((raw, index) => ({ raw, name: raw.split('=', 1)[0], index }))
    .filter(({ name }) => !isTrackingQueryName(name));

  if (parameters.length === 0) return null;

  parameters.sort((left, right) => compareUtf8Bytes(left.name, right.name) || left.index - right.index);
  return parameters.map(({ raw }) => raw).join('&');
}

function isTrackingQueryName(name: string): boolean {
  return /^utm_/i.test(name) || /^(?:gclid|fbclid|igshid)$/i.test(name);
}

/** PostgreSQL `COLLATE "C"`와 맞춘 UTF-8 byte lexical comparison. */
function compareUtf8Bytes(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const commonLength = Math.min(leftBytes.length, rightBytes.length);

  for (let index = 0; index < commonLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }

  return leftBytes.length - rightBytes.length;
}
