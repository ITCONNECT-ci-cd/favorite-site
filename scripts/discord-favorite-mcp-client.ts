import { createHmac } from 'node:crypto';

import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 8_000;

const categorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    parentId: z.string().uuid().nullable(),
    sortOrder: z.number().int(),
  })
  .strict();

const listCategoriesResponseSchema = z
  .object({ categories: z.array(categorySchema) })
  .strict();

const resultCodeSchema = z.enum([
  'success',
  'duplicate_url',
  'duplicate_message',
  'invalid_url',
  'url_too_long',
  'invalid_category',
  'rate_limited',
  'invalid_message_id',
  'internal_error',
]);

const ingestResponseSchema = z
  .object({
    resultCode: resultCodeSchema,
    bookmarkId: z.string().uuid().nullable(),
    title: z.string().nullable(),
    categoryName: z.string().nullable(),
    retryAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const listCategoriesInputSchema = z.object({}).strict();

export const ingestInputSchema = z
  .object({
    url: z.string().min(1).max(2048),
    title: z.string().max(120),
    description: z.string().max(200),
    categoryId: z.string().uuid(),
    messageId: z.string().regex(/^\d{17,20}$/),
  })
  .strict();

export type FavoriteCategory = z.infer<typeof categorySchema>;
export type FavoriteIngestInput = z.infer<typeof ingestInputSchema>;
export type FavoriteIngestResult = z.infer<typeof ingestResponseSchema>;

type IngestOperation =
  | { operation: 'list_categories' }
  | ({ operation: 'ingest' } & FavoriteIngestInput);

type RequestOptions = {
  endpoint?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
};

export class FavoriteIngestClientError extends Error {
  constructor() {
    super('favorite ingest API is unavailable');
    this.name = 'FavoriteIngestClientError';
  }
}

export async function listFavoriteCategories(
  options: RequestOptions = {},
): Promise<FavoriteCategory[]> {
  const body = await requestFavoriteIngest({ operation: 'list_categories' }, options);
  const parsed = listCategoriesResponseSchema.safeParse(body);
  if (!parsed.success) throw new FavoriteIngestClientError();
  return parsed.data.categories;
}

export async function ingestFavorite(
  input: FavoriteIngestInput,
  options: RequestOptions = {},
): Promise<FavoriteIngestResult> {
  const validated = ingestInputSchema.safeParse(input);
  if (!validated.success) throw new FavoriteIngestClientError();

  const body = await requestFavoriteIngest(
    { operation: 'ingest', ...validated.data },
    options,
  );
  const parsed = ingestResponseSchema.safeParse(body);
  if (!parsed.success) throw new FavoriteIngestClientError();
  return parsed.data;
}

export function signFavoriteIngestBody(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return `v1=${createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(rawBody, 'utf8')
    .digest('hex')}`;
}

async function requestFavoriteIngest(
  operation: IngestOperation,
  options: RequestOptions,
): Promise<unknown> {
  const endpoint = parseEndpoint(options.endpoint ?? process.env.DISCORD_INGEST_API_URL);
  const secret = options.secret ?? process.env.DISCORD_INGEST_HMAC_SECRET;
  if (secret === undefined || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new FavoriteIngestClientError();
  }

  const rawBody = JSON.stringify(operation);
  const timestamp = String(Math.floor((options.nowMs ?? Date.now()) / 1_000));
  const signature = signFavoriteIngestBody(secret, timestamp, rawBody);

  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-discord-ingest-signature': signature,
        'x-discord-ingest-timestamp': timestamp,
      },
      body: rawBody,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) throw new FavoriteIngestClientError();
    return (await response.json()) as unknown;
  } catch {
    throw new FavoriteIngestClientError();
  }
}

function parseEndpoint(value: string | undefined): URL {
  if (value === undefined) throw new FavoriteIngestClientError();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FavoriteIngestClientError();
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.pathname !== '/api/discord-ingest'
  ) {
    throw new FavoriteIngestClientError();
  }

  return parsed;
}
