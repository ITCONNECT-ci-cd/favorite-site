// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  DISCORD_INGEST_MAX_CLOCK_SKEW_SECONDS,
  MAX_DISCORD_INGEST_BODY_BYTES,
  parseDiscordIngestBody,
  readDiscordIngestRawBody,
  verifyDiscordIngestSignature,
} from './logic';

const encoder = new TextEncoder();
const NOW_MS = Date.parse('2026-08-10T06:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW_MS / 1_000);

describe('readDiscordIngestRawBody', () => {
  it('Content-Length가 16 KiB를 넘으면 body를 읽기 전에 거부한다', async () => {
    const headers = new Headers({ 'content-length': String(MAX_DISCORD_INGEST_BODY_BYTES + 1) });
    const request = { headers } as Request;
    Object.defineProperty(request, 'body', {
      get: () => {
        throw new Error('body를 읽으면 안 된다');
      },
    });

    await expect(readDiscordIngestRawBody(request)).resolves.toEqual({ ok: false, reason: 'too-large' });
  });

  it('헤더가 없어도 16 KiB+1번째 byte에서 stream을 cancel한다', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_DISCORD_INGEST_BODY_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const request = new Request('https://example.test/api/discord-ingest', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readDiscordIngestRawBody(request)).resolves.toEqual({ ok: false, reason: 'too-large' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('한도 이내 raw bytes를 재직렬화 없이 그대로 돌려준다', async () => {
    const text = '{ "operation" : "list_categories" }';
    const request = new Request('https://example.test/api/discord-ingest', { method: 'POST', body: text });

    const result = await readDiscordIngestRawBody(request);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes).toEqual(encoder.encode(text));
  });
});

describe('parseDiscordIngestBody', () => {
  it('list_categories는 operation 한 field만 허용한다', () => {
    expect(parseDiscordIngestBody(encoder.encode('{"operation":"list_categories"}'))).toEqual({
      operation: 'list_categories',
    });
    expect(
      parseDiscordIngestBody(encoder.encode('{"operation":"list_categories","extra":true}')),
    ).toBeNull();
  });

  it('ingest는 정확한 6개 string field를 보존한다', () => {
    const body = {
      operation: 'ingest',
      url: 'https://e.test/',
      title: '',
      description: '',
      categoryId: 'not-yet-validated-by-db',
      messageId: '1536248705844248606',
    };
    expect(parseDiscordIngestBody(encoder.encode(JSON.stringify(body)))).toEqual(body);
  });

  it.each([
    'null',
    '[]',
    '{}',
    '{"operation":"unknown"}',
    '{"operation":"ingest","url":"https://e.test","title":"","description":"","categoryId":"x"}',
    '{"operation":"ingest","url":7,"title":"","description":"","categoryId":"x","messageId":"1"}',
    '{broken',
  ])('깨진/allowlist 밖 body를 거부한다: %s', (text) => {
    expect(parseDiscordIngestBody(encoder.encode(text))).toBeNull();
  });

  it('invalid UTF-8을 거부한다', () => {
    expect(parseDiscordIngestBody(new Uint8Array([0xc3, 0x28]))).toBeNull();
  });
});

describe('verifyDiscordIngestSignature', () => {
  it('고정 HMAC-SHA-256 vector와 일치한다', () => {
    const rawBody = encoder.encode('{"operation":"list_categories"}');
    expect(
      verifyDiscordIngestSignature({
        timestamp: '1786341600',
        signature: 'v1=7f76ec01454e4d6868d80726a7646366e22652d81cf4ecae7ebe5c54db0f79e9',
        secret: 'test-secret',
        rawBody,
        nowMs: Date.parse('2026-08-10T06:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('±300초 경계는 허용하고 301초는 거부한다', () => {
    const rawBody = encoder.encode('{}');

    for (const offset of [
      -DISCORD_INGEST_MAX_CLOCK_SKEW_SECONDS,
      DISCORD_INGEST_MAX_CLOCK_SKEW_SECONDS,
    ]) {
      const timestamp = String(NOW_SECONDS + offset);
      const signature = testSignature('test-secret', timestamp, rawBody);
      expect(
        verifyDiscordIngestSignature({ timestamp, signature, secret: 'test-secret', rawBody, nowMs: NOW_MS }),
      ).toBe(true);
    }

    const staleTimestamp = String(NOW_SECONDS - DISCORD_INGEST_MAX_CLOCK_SKEW_SECONDS - 1);
    expect(
      verifyDiscordIngestSignature({
        timestamp: staleTimestamp,
        signature: testSignature('test-secret', staleTimestamp, rawBody),
        secret: 'test-secret',
        rawBody,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it('raw body 한 byte 또는 서명 형식이 다르면 거부한다', () => {
    const timestamp = String(NOW_SECONDS);
    const signed = encoder.encode('{"a":1}');
    const signature = testSignature('test-secret', timestamp, signed);

    expect(
      verifyDiscordIngestSignature({
        timestamp,
        signature,
        secret: 'test-secret',
        rawBody: encoder.encode('{ "a":1}'),
        nowMs: NOW_MS,
      }),
    ).toBe(false);
    expect(
      verifyDiscordIngestSignature({ timestamp, signature: 'sha256=bad', secret: 'test-secret', rawBody: signed, nowMs: NOW_MS }),
    ).toBe(false);
  });
});

function testSignature(secret: string, timestamp: string, rawBody: Uint8Array): string {
  return `v1=${createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex')}`;
}
