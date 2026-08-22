// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  updateDiscordIngestMetadata: vi.fn(),
  claimDiscordIngestFavicon: vi.fn(),
  finalizeDiscordIngestFavicon: vi.fn(),
  failDiscordIngestFavicon: vi.fn(),
}));
const provider = vi.hoisted(() => ({
  discordFaviconProviderTarget: vi.fn(),
  fetchDiscordFaviconProvider: vi.fn(),
}));
const storage = vi.hoisted(() => ({
  uploadDiscordFavicon: vi.fn(),
  deleteDiscordFavicon: vi.fn(),
}));
const metadata = vi.hoisted(() => ({
  collectDiscordLinkMetadata: vi.fn(),
  mergeDiscordLinkMetadata: vi.fn(),
}));

vi.mock('@/lib/discord-ingest-db', () => db);
vi.mock('@/lib/discord-favicon-provider', () => provider);
vi.mock('@/lib/discord-favicon-storage', () => storage);
vi.mock('@/lib/discord-link-metadata', () => metadata);

import { enrichDiscordIngest } from '@/lib/discord-ingest-enrichment';

const INPUT = {
  bookmarkId: '11111111-1111-4111-8111-111111111111',
  url: 'https://example.com/path',
  title: 'example.com',
  description: '',
};
const CLAIM = {
  bookmarkId: INPUT.bookmarkId,
  claimedUrl: INPUT.url,
  claimToken: '22222222-2222-4222-8222-222222222222',
};
const ICON = {
  body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  kind: { contentType: 'image/png', extension: 'png' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DISCORD_FAVICON_PROVIDER_APPROVED', 'true');
  metadata.collectDiscordLinkMetadata.mockResolvedValue({
    title: 'Example',
    description: 'Example 설명',
  });
  metadata.mergeDiscordLinkMetadata.mockReturnValue({ title: 'Example', description: 'Example 설명' });
  db.updateDiscordIngestMetadata.mockResolvedValue(true);
  db.claimDiscordIngestFavicon.mockResolvedValue(CLAIM);
  db.finalizeDiscordIngestFavicon.mockResolvedValue(true);
  db.failDiscordIngestFavicon.mockResolvedValue(true);
  provider.discordFaviconProviderTarget.mockReturnValue({
    host: 'example.com',
    origin: 'https://example.com',
  });
  provider.fetchDiscordFaviconProvider.mockResolvedValue(ICON);
  storage.uploadDiscordFavicon.mockResolvedValue({
    path: `discord/${CLAIM.bookmarkId}/${CLAIM.claimToken}.png`,
    publicUrl: 'https://project.supabase.co/storage/v1/object/public/favicons/icon.png',
  });
  storage.deleteDiscordFavicon.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('enrichDiscordIngest', () => {
  it('metadata를 exact bookmark/URL에 보정하고 token-fenced favicon을 저장한다', async () => {
    await enrichDiscordIngest(INPUT);

    expect(metadata.collectDiscordLinkMetadata).toHaveBeenCalledWith(INPUT.url, {
      signal: expect.any(AbortSignal),
    });
    expect(db.updateDiscordIngestMetadata).toHaveBeenCalledWith({
      bookmarkId: INPUT.bookmarkId,
      claimedUrl: INPUT.url,
      expectedTitle: INPUT.title,
      title: 'Example',
      description: 'Example 설명',
    });
    expect(db.claimDiscordIngestFavicon).toHaveBeenCalledWith(INPUT.bookmarkId, INPUT.url);
    expect(storage.uploadDiscordFavicon).toHaveBeenCalledWith(
      CLAIM.bookmarkId,
      CLAIM.claimToken,
      ICON.body,
      ICON.kind,
      expect.any(AbortSignal),
    );
    expect(db.finalizeDiscordIngestFavicon).toHaveBeenCalledWith(
      CLAIM,
      'https://project.supabase.co/storage/v1/object/public/favicons/icon.png',
    );
  });

  it('provider 승인이 없어도 설명 보정은 하고 favicon claim 전에는 멈춘다', async () => {
    vi.stubEnv('DISCORD_FAVICON_PROVIDER_APPROVED', 'false');

    await enrichDiscordIngest(INPUT);

    expect(db.updateDiscordIngestMetadata).toHaveBeenCalledTimes(1);
    expect(db.claimDiscordIngestFavicon).not.toHaveBeenCalled();
    expect(provider.fetchDiscordFaviconProvider).not.toHaveBeenCalled();
  });

  it('metadata 수집 실패와 favicon 실패를 서로 격리하고 exact claim을 해제한다', async () => {
    metadata.collectDiscordLinkMetadata.mockRejectedValue(new Error('private URL body'));
    provider.fetchDiscordFaviconProvider.mockRejectedValue(new Error('provider body'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await enrichDiscordIngest(INPUT);

    expect(db.updateDiscordIngestMetadata).not.toHaveBeenCalled();
    expect(db.failDiscordIngestFavicon).toHaveBeenCalledWith(CLAIM);
    expect(storage.deleteDiscordFavicon).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private URL body');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('provider body');
  });

  it('finalize 응답이 불명확하면 claim 해제 성공 때만 미참조 객체를 지운다', async () => {
    db.finalizeDiscordIngestFavicon.mockRejectedValue(new DOMException('lost', 'AbortError'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    db.failDiscordIngestFavicon.mockResolvedValueOnce(false);
    await enrichDiscordIngest(INPUT);
    expect(storage.deleteDiscordFavicon).not.toHaveBeenCalled();

    vi.clearAllMocks();
    metadata.collectDiscordLinkMetadata.mockResolvedValue(null);
    metadata.mergeDiscordLinkMetadata.mockReturnValue({ title: 'example.com', description: 'fallback' });
    db.updateDiscordIngestMetadata.mockResolvedValue(true);
    db.claimDiscordIngestFavicon.mockResolvedValue(CLAIM);
    db.finalizeDiscordIngestFavicon.mockRejectedValue(new DOMException('lost', 'AbortError'));
    db.failDiscordIngestFavicon.mockResolvedValue(true);
    provider.discordFaviconProviderTarget.mockReturnValue({ host: 'example.com', origin: 'https://example.com' });
    provider.fetchDiscordFaviconProvider.mockResolvedValue(ICON);
    storage.uploadDiscordFavicon.mockResolvedValue({
      path: `discord/${CLAIM.bookmarkId}/${CLAIM.claimToken}.png`,
      publicUrl: 'https://project.supabase.co/storage/v1/object/public/favicons/icon.png',
    });
    storage.deleteDiscordFavicon.mockResolvedValue(true);
    warn.mockImplementation(() => {});

    await enrichDiscordIngest(INPUT);
    expect(storage.deleteDiscordFavicon).toHaveBeenCalledWith(
      `discord/${CLAIM.bookmarkId}/${CLAIM.claimToken}.png`,
      expect.any(AbortSignal),
    );
  });
});
