# Hermes Favorite integration

The `favorite` Hermes profile receives only two model-visible MCP tools:

- `favorite_list_categories`
- `favorite_ingest`

The MCP process reads `DISCORD_INGEST_API_URL` and `DISCORD_INGEST_HMAC_SECRET` from the profile secret environment, signs `timestamp + "." + rawBody` with HMAC-SHA-256, and calls the fixed HTTPS ingest endpoint. The secret is never a prompt or tool argument. The agent has no web, browser, file, terminal, code-execution, Discord-admin, or direct database tool.

Hermes binds the triggering Discord snowflake to a concurrency-safe session ContextVar before starting the agent. `favorite-message-context` reads only `HERMES_SESSION_MESSAGE_ID` through Hermes' public `gateway.session_context.get_session_env()` API. Its `pre_llm_call` hook injects the ID as ephemeral turn context, and its `tool_request` middleware replaces any model-supplied `favorite_ingest.messageId` with that trusted value immediately before execution. A missing or malformed binding fails MCP schema validation. The plugin does not query session history, read message content, or read credentials.

## Install/update

Copy `favorite-message-context` to `$HERMES_HOME/plugins/favorite-message-context`, enable that plugin, add the stdio MCP server with the exact server key `favorite-ingest` using the repository-local `tsx` executable and `scripts/discord-favorite-mcp.ts`, and enable only the two MCP tools for the Discord platform. Hermes sanitizes that key into the runtime registry prefix `mcp__favorite_ingest__`; the plugin matches the exact `mcp__favorite_ingest__favorite_ingest` execution name. Use `favorite-channel-prompt.md` as the prompt for channel `1536239187517247488` and keep the existing user/channel allowlists and `allow_bots: none`.

Discord output must disable every mention parse path in profile configuration:

```yaml
discord:
  allow_mentions:
    everyone: false
    roles: false
    users: false
    replied_user: false
```

For environments that configure the adapter through secrets instead, set all four `DISCORD_ALLOW_MENTION_*` values to `false`, including `DISCORD_ALLOW_MENTION_USERS` and `DISCORD_ALLOW_MENTION_REPLIED_USER`. Before enabling free response, send literal user, role, and `@everyone` mention text in the canary channel and confirm Discord delivers it without a ping.

Set `HERMES_DISCORD_TEXT_BATCH_DELAY_SECONDS=0` for this profile. Hermes' default text batching can merge two nearby Discord messages into one turn while retaining only the first snowflake, which is incompatible with exact ingest provenance. The canary must send two messages back-to-back and verify that their receipts keep distinct message IDs.

Do not turn on the free-response channel until the production API, runtime database role, HMAC secret, MCP probe, and mention-based canary all pass. Afterward keep global `require_mention: true` and add only the target channel to `free_response_channels`.

## Secret rotation

Generate unrelated random values for the PostgreSQL runtime password and HMAC secret. Rotate the database role password and Vercel DSN together, then rotate the Vercel and Hermes HMAC values together while the gateway is stopped. Never place either value in Git, a Discord message, CLI arguments, or migration SQL.

## Kill switch

1. Stop the `favorite` gateway.
2. Set `discord_ingest_runtime` to `NOLOGIN` and terminate only sessions whose role is `discord_ingest_runtime`.
3. Confirm the HMAC endpoint returns a generic unavailable result and no new bookmark can be written.
4. Restore `LOGIN`, restart the API deployment if needed, then start the gateway only after verification.

Retention health must alert when any receipt is expired for 24 hours or more. Investigate the Supabase Cron history, run the receipt cleanup function manually if required, and reconcile Storage objects whose token path no longer has a matching finalized bookmark.
