// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  collectDiscordLinkMetadata,
  extractDiscordLinkMetadata,
  mergeDiscordLinkMetadata,
  type MetadataNetwork,
  type MetadataResponse,
  type ResolvedAddress,
} from '@/lib/discord-link-metadata';

const PUBLIC_V4: ResolvedAddress = { address: '93.184.216.34', family: 4 };

describe('Discord link metadata extraction', () => {
  it('OG/title/description만 entity decode와 표시 한계 정규화 후 돌려준다', () => {
    const result = extractDiscordLinkMetadata(`
      <html><head>
        <title>무시되는 &amp; title</title>
        <meta content="  AI &amp; 자동화 &#x1F680;  " property="og:title">
        <meta name="description" content="기본 설명">
        <meta content="OG &quot;설명&quot;\n두 줄" property="og:description">
      </head><body>본문은 쓰지 않는다</body></html>
    `);

    expect(result).toEqual({
      title: 'AI & 자동화 🚀',
      description: 'OG "설명" 두 줄',
    });
  });

  it('의미 있는 agent 값을 보존하고 hostname·빈 설명만 보정한다', () => {
    expect(
      mergeDiscordLinkMetadata({
        url: 'https://www.example.com/path',
        title: 'www.example.com',
        description: '',
        metadata: { title: 'Example 서비스', description: 'Example의 핵심 기능 소개' },
      }),
    ).toEqual({ title: 'Example 서비스', description: 'Example의 핵심 기능 소개' });

    expect(
      mergeDiscordLinkMetadata({
        url: 'https://www.example.com/path',
        title: '사람이 정한 제목',
        description: '사람이 정한 설명',
        metadata: { title: '웹 제목', description: '웹 설명' },
      }),
    ).toEqual({ title: '사람이 정한 제목', description: '사람이 정한 설명' });
  });

  it('페이지가 막혀도 hostname 기반 설명을 비워 두지 않는다', () => {
    const result = mergeDiscordLinkMetadata({
      url: 'https://newsletter.example.com/',
      title: 'newsletter.example.com',
      description: '',
      metadata: null,
    });

    expect(result.title).toBe('newsletter.example.com');
    expect(result.description).toContain('newsletter.example.com');
    expect(result.description).not.toBe('');
  });
});

describe('Discord link metadata network boundary', () => {
  it.each([
    'http://127.0.0.1/admin',
    'http://localhost/',
    'https://service.internal/',
    'https://example.com:8443/',
    'https://user:pw@example.com/',
  ])('%s 는 DNS/HTTP 전에 거부한다', async (url) => {
    const network = fakeNetwork();

    await expect(
      collectDiscordLinkMetadata(url, { signal: AbortSignal.timeout(1_000), network }),
    ).resolves.toBeNull();
    expect(network.resolve).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
  });

  it('DNS 결과 중 하나라도 private/reserved면 요청하지 않는다', async () => {
    const network = fakeNetwork({
      addresses: {
        'example.com': [PUBLIC_V4, { address: '10.0.0.7', family: 4 }],
      },
    });

    await expect(
      collectDiscordLinkMetadata('https://example.com/', {
        signal: AbortSignal.timeout(1_000),
        network,
      }),
    ).resolves.toBeNull();
    expect(network.request).not.toHaveBeenCalled();
  });

  it('검증한 주소에 소켓을 pin하고 redirect host도 DNS부터 다시 검증한다', async () => {
    const secondAddress: ResolvedAddress = { address: '192.30.252.153', family: 4 };
    const network = fakeNetwork({
      addresses: {
        'example.com': [PUBLIC_V4],
        'www.iana.org': [secondAddress],
      },
      responses: [
        response(302, '', { location: 'https://www.iana.org/final' }),
        response(
          200,
          '<html><head><title>IANA</title><meta name="description" content="공식 정보"></head></html>',
        ),
      ],
    });

    await expect(
      collectDiscordLinkMetadata('https://example.com/start', {
        signal: AbortSignal.timeout(1_000),
        network,
      }),
    ).resolves.toEqual({ title: 'IANA', description: '공식 정보' });

    expect(network.resolve.mock.calls.map(([host]) => host)).toEqual(['example.com', 'www.iana.org']);
    expect(network.request.mock.calls[0][1]).toEqual(PUBLIC_V4);
    expect(network.request.mock.calls[1][1]).toEqual(secondAddress);
    expect(String(network.request.mock.calls[1][0])).toBe('https://www.iana.org/final');
  });

  it('redirect의 private DNS와 HTTPS→HTTP downgrade를 거부한다', async () => {
    const privateRedirect = fakeNetwork({
      addresses: {
        'example.com': [PUBLIC_V4],
        'iana.org': [{ address: '169.254.169.254', family: 4 }],
      },
      responses: [response(302, '', { location: 'https://iana.org/private' })],
    });
    await expect(
      collectDiscordLinkMetadata('https://example.com/', {
        signal: AbortSignal.timeout(1_000),
        network: privateRedirect,
      }),
    ).resolves.toBeNull();
    expect(privateRedirect.request).toHaveBeenCalledTimes(1);

    const downgrade = fakeNetwork({
      responses: [response(302, '', { location: 'http://www.iana.org/' })],
    });
    await expect(
      collectDiscordLinkMetadata('https://example.com/', {
        signal: AbortSignal.timeout(1_000),
        network: downgrade,
      }),
    ).resolves.toBeNull();
    expect(downgrade.resolve).toHaveBeenCalledTimes(1);
  });

  it('HTML이 아니거나 200KB를 넘거나 요청이 실패하면 원문 없이 null로 접는다', async () => {
    for (const planned of [
      response(200, '{"title":"not html"}', { 'content-type': 'application/json' }),
      response(200, 'x'.repeat(200_001)),
    ]) {
      const network = fakeNetwork({ responses: [planned] });
      await expect(
        collectDiscordLinkMetadata('https://example.com/', {
          signal: AbortSignal.timeout(1_000),
          network,
        }),
      ).resolves.toBeNull();
    }

    const failed = fakeNetwork();
    failed.request.mockRejectedValue(new Error('secret response body'));
    await expect(
      collectDiscordLinkMetadata('https://example.com/', {
        signal: AbortSignal.timeout(1_000),
        network: failed,
      }),
    ).resolves.toBeNull();
  });
});

function response(
  status: number,
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' },
): MetadataResponse {
  return { status, headers, body: new TextEncoder().encode(body) };
}

function fakeNetwork(options: {
  addresses?: Record<string, readonly ResolvedAddress[]>;
  responses?: MetadataResponse[];
} = {}) {
  let cursor = 0;
  const resolve = vi.fn(async (host: string) => options.addresses?.[host] ?? [PUBLIC_V4]);
  const request = vi.fn(async (_target: URL, _pinned: ResolvedAddress, _signal: AbortSignal) => {
    void _target;
    void _pinned;
    void _signal;
    const planned = options.responses?.[cursor] ?? response(200, '<html><title>Example</title></html>');
    cursor += 1;
    return planned;
  });
  return { resolve, request } satisfies MetadataNetwork;
}
