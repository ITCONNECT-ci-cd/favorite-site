// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pg = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  listeners: [] as Array<{ event: string; listener: () => void }>,
  query: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class PoolStub {
    constructor(config: Record<string, unknown>) {
      pg.configs.push(config);
    }

    on(event: string, listener: () => void) {
      pg.listeners.push({ event, listener });
      return this;
    }

    query(config: Record<string, unknown>) {
      return pg.query(config);
    }
  },
}));

const TEST_DSN = 'postgresql://runtime:not-a-secret@db.example.test:5432/postgres?sslmode=require';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DISCORD_INGEST_DATABASE_URL', TEST_DSN);
  pg.configs.length = 0;
  pg.listeners.length = 0;
  pg.query.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('discord-ingest-db — 최소 auto-commit adapter', () => {
  it('runtime API는 고정 ingest/enrichment 함수만 노출한다', async () => {
    const adapter = await import('@/lib/discord-ingest-db');

    expect(Object.keys(adapter).sort()).toEqual([
      'claimDiscordIngestFavicon',
      'failDiscordIngestFavicon',
      'finalizeDiscordIngestFavicon',
      'ingest',
      'listCategories',
      'updateDiscordIngestMetadata',
    ]);
  });

  it('category 4개 column을 hard-coded statement 한 번으로 읽고 camelCase로 돌려준다', async () => {
    pg.query.mockResolvedValue({
      rows: [{ id: 'category-id', name: '기타', parentId: null, sortOrder: 7 }],
    });
    const { listCategories } = await import('@/lib/discord-ingest-db');

    await expect(listCategories()).resolves.toEqual([
      { id: 'category-id', name: '기타', parentId: null, sortOrder: 7 },
    ]);

    expect(pg.query).toHaveBeenCalledTimes(1);
    const query = pg.query.mock.calls[0][0] as Record<string, unknown>;
    expect(query.text).toContain('from public.categories');
    expect(query.text).toContain('parent_id::text as "parentId"');
    expect(query.text).not.toContain(';');
    expect(query.values).toEqual([]);
    expect(query).not.toHaveProperty('name');
    // 이 전용 pool 전체의 query_timeout은 아래 config test가 고정한다.
  });

  it('ingest 다섯 값을 parameter로만 넘기고 정확히 한 result row를 변환한다', async () => {
    pg.query.mockResolvedValue({
      rows: [
        {
          resultCode: 'success',
          bookmarkId: 'bookmark-id',
          title: '제목',
          categoryName: '기타',
          retryAt: new Date('2026-08-10T06:00:00.000Z'),
        },
      ],
    });
    const { ingest } = await import('@/lib/discord-ingest-db');
    const input = {
      url: "https://example.test/?q='; BEGIN; --",
      title: '제목',
      description: '설명',
      categoryId: 'category-id',
      messageId: '1536248705844248606',
    };

    await expect(ingest(input)).resolves.toEqual({
      resultCode: 'success',
      bookmarkId: 'bookmark-id',
      title: '제목',
      categoryName: '기타',
      retryAt: '2026-08-10T06:00:00.000Z',
    });

    expect(pg.query).toHaveBeenCalledTimes(1);
    const query = pg.query.mock.calls[0][0] as Record<string, unknown>;
    expect(query.text).toContain('public.ingest_bookmark($1::text, $2::text, $3::text, $4::text, $5::text)');
    expect(query.text).not.toContain(input.url);
    expect(query.text).not.toContain(';');
    expect(query.values).toEqual([
      input.url,
      input.title,
      input.description,
      input.categoryId,
      input.messageId,
    ]);
    expect(query).not.toHaveProperty('name');
  });

  it('pool은 전용 application name, 2 connections, server/client timeout으로 고정한다', async () => {
    pg.query.mockResolvedValue({ rows: [] });
    const { listCategories } = await import('@/lib/discord-ingest-db');

    await listCategories();

    expect(pg.configs).toEqual([
      expect.objectContaining({
        connectionString: TEST_DSN,
        application_name: 'discord-link-ingest',
        max: 2,
        query_timeout: 5_000,
        statement_timeout: 4_500,
        idle_in_transaction_session_timeout: 10_000,
      }),
    ]);
    expect(pg.listeners.map(({ event }) => event)).toContain('error');
  });

  it('metadata 보정은 exact id·URL과 새 값을 parameter로만 넘긴다', async () => {
    pg.query.mockResolvedValue({ rows: [{ updated: true }] });
    const { updateDiscordIngestMetadata } = await import('@/lib/discord-ingest-db');
    const input = {
      bookmarkId: '11111111-1111-4111-8111-111111111111',
      claimedUrl: "https://example.com/?q='; delete from bookmarks; --",
      expectedTitle: 'example.com',
      title: 'Example',
      description: '설명',
    };

    await expect(updateDiscordIngestMetadata(input)).resolves.toBe(true);

    const query = pg.query.mock.calls[0][0] as Record<string, unknown>;
    expect(query.text).toContain('public.discord_ingest_update_metadata(');
    expect(query.text).not.toContain(input.claimedUrl);
    expect(query.text).not.toContain(';');
    expect(query.values).toEqual([
      input.bookmarkId,
      input.claimedUrl,
      input.expectedTitle,
      input.title,
      input.description,
    ]);
  });

  it('favicon claim/finalize/failure를 exact token CAS 함수로만 전달한다', async () => {
    const bookmarkId = '11111111-1111-4111-8111-111111111111';
    const claimToken = '22222222-2222-4222-8222-222222222222';
    const claimedUrl = 'https://example.com/path';
    pg.query
      .mockResolvedValueOnce({ rows: [{ claimToken }] })
      .mockResolvedValueOnce({ rows: [{ updated: true }] })
      .mockResolvedValueOnce({ rows: [{ updated: false }] });
    const adapter = await import('@/lib/discord-ingest-db');

    const claim = await adapter.claimDiscordIngestFavicon(bookmarkId, claimedUrl);
    expect(claim).toEqual({ bookmarkId, claimedUrl, claimToken });
    await expect(
      adapter.finalizeDiscordIngestFavicon(claim!, 'https://project.test/icon.png'),
    ).resolves.toBe(true);
    await expect(adapter.failDiscordIngestFavicon(claim!)).resolves.toBe(false);

    expect(pg.query.mock.calls.map(([query]) => String(query.text))).toEqual([
      expect.stringContaining('public.discord_ingest_claim_favicon'),
      expect.stringContaining('public.discord_ingest_finalize_favicon'),
      expect.stringContaining('public.discord_ingest_fail_favicon'),
    ]);
    expect(pg.query.mock.calls[1][0].values).toEqual([
      bookmarkId,
      claimToken,
      claimedUrl,
      'https://project.test/icon.png',
    ]);
  });

  it('claim 없음은 null이고 잘못된 token/boolean row는 거부한다', async () => {
    pg.query.mockResolvedValueOnce({ rows: [] });
    const adapter = await import('@/lib/discord-ingest-db');
    await expect(
      adapter.claimDiscordIngestFavicon(
        '11111111-1111-4111-8111-111111111111',
        'https://example.com',
      ),
    ).resolves.toBeNull();

    pg.query.mockResolvedValueOnce({ rows: [{ claimToken: 'not-a-uuid' }] });
    await expect(
      adapter.claimDiscordIngestFavicon(
        '11111111-1111-4111-8111-111111111111',
        'https://example.com',
      ),
    ).rejects.toThrow('invalid discord favicon claim row');

    pg.query.mockResolvedValueOnce({ rows: [{ updated: 'true' }] });
    await expect(
      adapter.updateDiscordIngestMetadata({
        bookmarkId: '11111111-1111-4111-8111-111111111111',
        claimedUrl: 'https://example.com',
        expectedTitle: 'example.com',
        title: 'Example',
        description: '설명',
      }),
    ).rejects.toThrow('invalid discord enrichment result row');
  });

  it.each([
    ['미설정', undefined],
    ['빈 문자열', ''],
    ['TLS 누락', 'postgresql://runtime:password@db.example.test/postgres'],
    ['다른 scheme', 'https://db.example.test/postgres?sslmode=require'],
  ])('%s DSN이면 query 전에 fail closed한다', async (_label, value) => {
    vi.stubEnv('DISCORD_INGEST_DATABASE_URL', value);
    const { listCategories } = await import('@/lib/discord-ingest-db');

    await expect(listCategories()).rejects.toThrow('database is not configured');
    expect(pg.query).not.toHaveBeenCalled();
  });

  it('DB contract와 다른 cardinality/result code는 외부 응답으로 통과시키지 않는다', async () => {
    pg.query.mockResolvedValue({ rows: [] });
    const { ingest } = await import('@/lib/discord-ingest-db');
    const input = { url: 'https://e.test', title: '', description: '', categoryId: 'x', messageId: '1' };

    await expect(ingest(input)).rejects.toThrow('invalid discord ingest result cardinality');

    vi.resetModules();
    pg.query.mockResolvedValue({
      rows: [{ resultCode: 'sql_error: password=leak', bookmarkId: null, title: null, categoryName: null, retryAt: null }],
    });
    const second = await import('@/lib/discord-ingest-db');
    await expect(second.ingest(input)).rejects.toThrow('invalid discord ingest result row');
  });
});

describe('discord ingest secret/client source boundary', () => {
  it('production TS에서 DSN env와 pg import는 adapter 한 파일에만 있다', () => {
    const root = process.cwd();
    const productionFiles = [...walkTs(join(root, 'app')), ...walkTs(join(root, 'lib'))]
      .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'));

    const dsnReaders = productionFiles.filter((path) =>
      readFileSync(path, 'utf8').includes('DISCORD_INGEST_DATABASE_URL'),
    );
    const pgImports = productionFiles.filter((path) =>
      /(?:from\s+['"]pg['"]|import\s*\(\s*['"]pg['"]\s*\)|require\(\s*['"]pg['"]\s*\))/.test(
        readFileSync(path, 'utf8'),
      ),
    );

    expect(dsnReaders).toEqual([join(root, 'lib/discord-ingest-db.ts')]);
    expect(pgImports).toEqual([join(root, 'lib/discord-ingest-db.ts')]);
  });
});

function walkTs(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkTs(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
