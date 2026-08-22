/**
 * Discord agent가 사용할 유일한 서버 간 ingest 경계.
 *
 * raw body·timestamp HMAC가 인증이며 Supabase 사용자 세션은 사용하지 않는다. 그래서 루트 proxy matcher가
 * 이 경로를 완전히 제외한다. 이 파일은 body/signature/DB 오류 원문을 log 또는 응답에 싣지 않는다.
 */
import { after } from 'next/server';

import { ingest, listCategories } from '@/lib/discord-ingest-db';
import { enrichDiscordIngest } from '@/lib/discord-ingest-enrichment';

import {
  parseDiscordIngestBody,
  readDiscordIngestRawBody,
  verifyDiscordIngestSignature,
} from './logic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const TIMESTAMP_HEADER = 'x-discord-ingest-timestamp';
const SIGNATURE_HEADER = 'x-discord-ingest-signature';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: Request): Promise<Response> {
  const raw = await readDiscordIngestRawBody(request);
  if (!raw.ok) {
    return raw.reason === 'too-large'
      ? jsonError('payload_too_large', 413)
      : jsonError('invalid_request', 400);
  }

  const secret = process.env.DISCORD_INGEST_HMAC_SECRET;
  if (secret === undefined || secret.trim() === '') {
    console.error('[api/discord-ingest] server authentication is not configured');
    return jsonError('service_unavailable', 503);
  }

  const authenticated = verifyDiscordIngestSignature({
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    secret,
    rawBody: raw.bytes,
  });
  if (!authenticated) return jsonError('unauthorized', 401);

  const operation = parseDiscordIngestBody(raw.bytes);
  if (operation === null) return jsonError('invalid_request', 400);

  try {
    if (operation.operation === 'list_categories') {
      const categories = await listCategories();
      return Response.json({ categories }, { headers: NO_STORE_HEADERS });
    }

    const result = await ingest({
      url: operation.url,
      title: operation.title,
      description: operation.description,
      categoryId: operation.categoryId,
      messageId: operation.messageId,
    });
    const bookmarkId = result.bookmarkId;
    const savedTitle = result.title;
    if (result.resultCode === 'success' && bookmarkId !== null && savedTitle !== null) {
      after(() =>
        enrichDiscordIngest({
          bookmarkId,
          url: operation.url,
          title: savedTitle,
          description: operation.description,
        }),
      );
    }
    return Response.json(result, { headers: NO_STORE_HEADERS });
  } catch {
    // driver/DB 원문은 SQLSTATE, role/table 또는 접속 정보를 포함할 수 있다. 고정 문구만 남긴다.
    console.error('[api/discord-ingest] database operation failed');
    return jsonError('service_unavailable', 503);
  }
}

function jsonError(error: 'payload_too_large' | 'invalid_request' | 'unauthorized' | 'service_unavailable', status: number) {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS });
}
