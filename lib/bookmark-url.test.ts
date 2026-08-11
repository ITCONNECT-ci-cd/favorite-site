import { describe, expect, it } from 'vitest';

import { normalizeBookmarkUrlV1, parseBookmarkUrlV1 } from '@/lib/bookmark-url';

describe('normalizeBookmarkUrlV1 — design §7 고정 corpus', () => {
  it.each([
    ['HTTPS://Example.COM:443/', 'https://example.com'],
    ['http://EXAMPLE.com:80/a/?utm_source=x&b=2&a=1#top', 'http://example.com/a?a=1&b=2'],
    ['https://e.test/p///', 'https://e.test/p'],
    ['https://e.test/?a=2&a=1&b', 'https://e.test?a=2&a=1&b'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBookmarkUrlV1(input)).toBe(expected);
  });

  it.each([
    'https://user:pw@e.test/',
    'https://[::1]/',
    'https://예시.한국/',
    'https://e.test/%ZZ',
  ])('%s 는 거부한다', (input) => {
    expect(normalizeBookmarkUrlV1(input)).toBeNull();
  });
});

describe('normalizeBookmarkUrlV1 — query 원문 계약', () => {
  it('같은 이름은 a / a= / a=x 표기와 원래 순서를 보존한다', () => {
    expect(normalizeBookmarkUrlV1('https://e.test?a=&a&a=x')).toBe('https://e.test?a=&a&a=x');
  });

  it('raw 이름을 C collation 순서로 정렬하고 이름 대소문자는 보존한다', () => {
    expect(normalizeBookmarkUrlV1('https://e.test?b=1&A=2&a=3')).toBe(
      'https://e.test?A=2&a=3&b=1',
    );
  });

  it('tracking 이름은 ASCII case-insensitive로 제거한다', () => {
    expect(
      normalizeBookmarkUrlV1(
        'https://e.test?keep=1&UTM_source=x&gClId=y&FBCLID=z&IgShId=q',
      ),
    ).toBe('https://e.test?keep=1');
  });

  it('percent-encoded 이름은 decode하지 않아 tracking 이름으로 보지 않는다', () => {
    expect(normalizeBookmarkUrlV1('https://e.test?utm_source=x&%75tm_source=y')).toBe(
      'https://e.test?%75tm_source=y',
    );
  });

  it('빈 query와 fragment delimiter는 canonical 값에서 없앤다', () => {
    expect(normalizeBookmarkUrlV1('https://e.test/?')).toBe('https://e.test');
    expect(normalizeBookmarkUrlV1('https://e.test/#')).toBe('https://e.test');
  });

  it('일반 anchor는 제거하지만 #/ SPA route는 query tail까지 opaque하게 보존한다', () => {
    expect(normalizeBookmarkUrlV1('https://e.test/path/#section')).toBe('https://e.test/path');
    expect(normalizeBookmarkUrlV1('https://e.test/path/#/route?utm_source=x&gclid=y')).toBe(
      'https://e.test/path#/route?utm_source=x&gclid=y',
    );
  });

  it('Google Analytics property identity가 다른 SPA URL을 충돌시키지 않는다', () => {
    const first = normalizeBookmarkUrlV1(
      'https://analytics.google.com/analytics/web/#/p123456789/reports/intelligenthome',
    );
    const second = normalizeBookmarkUrlV1(
      'https://analytics.google.com/analytics/web/#/p987654321/reports/intelligenthome',
    );

    expect(first).toBe(
      'https://analytics.google.com/analytics/web#/p123456789/reports/intelligenthome',
    );
    expect(second).toBe(
      'https://analytics.google.com/analytics/web#/p987654321/reports/intelligenthome',
    );
    expect(first).not.toBe(second);
  });
});

describe('parseBookmarkUrlV1 — authority와 문자 경계', () => {
  it('비기본 포트와 path/query 원문을 보존한다', () => {
    expect(parseBookmarkUrlV1('HTTP://LOCALHOST:8080/%2f?a=%2F#gone')).toEqual({
      scheme: 'http',
      host: 'localhost',
      port: 8080,
      path: '/%2f',
      query: 'a=%2F',
      preservedFragment: null,
    });
    expect(normalizeBookmarkUrlV1('HTTP://LOCALHOST:8080/%2f?a=%2F#gone')).toBe(
      'http://localhost:8080/%2f?a=%2F',
    );
  });

  it.each([
    'https://e.test:0',
    'https://e.test:0443',
    'https://e.test:65536',
    'https://e.test:',
    'https://e.test:abc',
    'https://256.1.1.1/',
    'https://127.1/',
    'https://01.2.3.4/',
    'https://-bad.test/',
    'https://bad-.test/',
    'https://bad..test/',
    'https://bad_test/',
    'https://e.test/a b',
    'https://e.test/a\tb',
    'https://e.test/a\\b',
    'https://e.test/%',
    'https://e.test/%0G',
    'ftp://e.test/',
    'https:///path',
  ])('%s 는 거부한다', (input) => {
    expect(parseBookmarkUrlV1(input)).toBeNull();
  });

  it.each([
    'http://127.0.0.1/',
    'https://localhost/',
    'https://xn--9d0b75k.xn--3e0b707e/',
    'https://a-b.example/',
  ])('%s 는 허용한다', (input) => {
    expect(parseBookmarkUrlV1(input)).not.toBeNull();
  });

  it('query의 빈 segment도 C-name 정렬 뒤 보존한다', () => {
    expect(normalizeBookmarkUrlV1('https://e.test?b=1&&a=2')).toBe(
      'https://e.test?&a=2&b=1',
    );
  });
});

describe('normalizeBookmarkUrlV1 — idempotence', () => {
  it.each([
    'HTTPS://Example.COM:443/',
    'http://EXAMPLE.com:80/a/?utm_source=x&b=2&a=1#top',
    'https://e.test/?a=2&a=1&b',
    'http://localhost:8080/path///?z=1&A=2',
    'https://xn--9d0b75k.xn--3e0b707e/%E3%85%87?%75tm_source=x',
    'https://analytics.google.com/analytics/web/#/p123456789/reports/intelligenthome?utm_source=opaque',
  ])('normalize(normalize(%s)) = normalize(%s)', (input) => {
    const once = normalizeBookmarkUrlV1(input);
    expect(once).not.toBeNull();
    expect(normalizeBookmarkUrlV1(once!)).toBe(once);
  });
});
