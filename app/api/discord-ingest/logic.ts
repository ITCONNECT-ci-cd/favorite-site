import { createHmac, timingSafeEqual } from 'node:crypto';

import type { DiscordIngestInput } from '@/lib/discord-ingest-db';

export const MAX_DISCORD_INGEST_BODY_BYTES = 16 * 1024;
export const DISCORD_INGEST_MAX_CLOCK_SKEW_SECONDS = 300;

export type DiscordIngestOperation =
  | { operation: 'list_categories' }
  | ({ operation: 'ingest' } & DiscordIngestInput);

export type RawBodyRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'too-large' | 'unreadable' };

/**
 * Content-Length 선거부 뒤 body stream을 직접 읽는다. `request.text()`를 쓰지 않아 헤더가 없거나
 * 거짓이어도 16 KiB를 넘는 순간 다음 chunk를 요청하지 않고 stream을 cancel한다.
 */
export async function readDiscordIngestRawBody(request: Request): Promise<RawBodyRead> {
  if (declaredBodyIsTooLarge(request.headers.get('content-length'))) {
    return { ok: false, reason: 'too-large' };
  }

  if (request.body === null) return { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > MAX_DISCORD_INGEST_BODY_BYTES) {
        await cancelQuietly(reader);
        return { ok: false, reason: 'too-large' };
      }

      chunks.push(value);
    }
  } catch {
    await cancelQuietly(reader);
    return { ok: false, reason: 'unreadable' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes };
}

/** raw bytes를 strict UTF-8 JSON으로 읽고 두 operation의 정확한 field allowlist를 강제한다. */
export function parseDiscordIngestBody(bytes: Uint8Array): DiscordIngestOperation | null {
  let raw: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(raw) || typeof raw.operation !== 'string') return null;

  if (raw.operation === 'list_categories') {
    return hasExactKeys(raw, ['operation']) ? { operation: 'list_categories' } : null;
  }

  if (raw.operation !== 'ingest') return null;

  const keys = ['operation', 'url', 'title', 'description', 'categoryId', 'messageId'] as const;
  if (!hasExactKeys(raw, keys)) return null;
  if (
    typeof raw.url !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.description !== 'string' ||
    typeof raw.categoryId !== 'string' ||
    typeof raw.messageId !== 'string'
  ) {
    return null;
  }

  return {
    operation: 'ingest',
    url: raw.url,
    title: raw.title,
    description: raw.description,
    categoryId: raw.categoryId,
    messageId: raw.messageId,
  };
}

/**
 * `v1=hex(HMAC-SHA256(secret, timestamp + "." + rawBody))`를 검증한다.
 * 서명은 decode 후 같은 32-byte 길이에서 `timingSafeEqual`로 비교한다.
 */
export function verifyDiscordIngestSignature(input: {
  timestamp: string | null;
  signature: string | null;
  secret: string;
  rawBody: Uint8Array;
  nowMs?: number;
}): boolean {
  const { timestamp, signature, secret, rawBody, nowMs = Date.now() } = input;

  if (timestamp === null || !/^(?:0|[1-9]\d*)$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;

  const nowSeconds = Math.floor(nowMs / 1_000);
  if (Math.abs(nowSeconds - timestampSeconds) > DISCORD_INGEST_MAX_CLOCK_SKEW_SECONDS) return false;

  const signatureMatch = /^v1=([0-9a-f]{64})$/i.exec(signature ?? '');
  if (signatureMatch === null) return false;

  const expected = createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(rawBody)
    .digest();
  const received = Buffer.from(signatureMatch[1], 'hex');

  return timingSafeEqual(expected, received);
}

function declaredBodyIsTooLarge(value: string | null): boolean {
  if (value === null || !/^\d+$/.test(value)) return false;

  try {
    return BigInt(value) > BigInt(MAX_DISCORD_INGEST_BODY_BYTES);
  } catch {
    return false;
  }
}

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // 이미 실패한/닫힌 stream의 cancel 오류는 원래 body 판정을 바꾸지 않는다.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
