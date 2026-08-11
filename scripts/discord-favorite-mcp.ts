import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import {
  FavoriteIngestClientError,
  ingestFavorite,
  ingestInputSchema,
  listCategoriesInputSchema,
  listFavoriteCategories,
} from './discord-favorite-mcp-client';

const server = new McpServer(
  { name: 'favorite-discord-ingest', version: '1.0.0' },
  {
    instructions:
      'Read fresh categories before each Discord message, then call favorite_ingest once per URL (maximum five). The signing secret is host-only and is never a tool argument.',
  },
);

server.registerTool(
  'favorite_list_categories',
  {
    title: 'Favorite categories',
    description:
      'Read the current category tree. Keep only leaf categories and choose the leaf named 기타 when uncertain. Call once immediately before processing each Discord message.',
    inputSchema: listCategoriesInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const categories = await listFavoriteCategories();
      return {
        content: [{ type: 'text', text: JSON.stringify({ categories }) }],
        structuredContent: { categories },
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

server.registerTool(
  'favorite_ingest',
  {
    title: 'Save a Discord favorite',
    description:
      'Save one URL from the current Discord message. Pass the Discord message ID as its original 17-20 digit string. Never retry except one internal_error backoff retry or rate_limited after retryAt.',
    inputSchema: ingestInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (input) => {
    try {
      const result = await ingestFavorite(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

serveStdio(() => server, {
  onerror: () => {
    console.error('[favorite-discord-ingest] MCP transport failed');
  },
});

function toolError(error: unknown) {
  if (!(error instanceof FavoriteIngestClientError)) {
    console.error('[favorite-discord-ingest] unexpected tool failure');
  }

  return {
    content: [{ type: 'text' as const, text: 'ingest_api_unavailable' }],
    isError: true,
  };
}
