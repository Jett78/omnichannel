# X (Twitter) integration — Phase 8

Status: **implemented** (verdict (A) SELF-SERVE, pay-per-use) — provider,
OAuth 2.0 + PKCE connect flow, X Activity API webhooks (plus legacy AAA
payload parsing), and the token-refresh chain are built and tested
against labelled fake-fetch doubles built from X's official
documentation examples. **No real X account, developer app, credits or
tokens exist in this project** — activation is
[`docs/X-ACCESS.md`](../../docs/X-ACCESS.md); research evidence is
[`docs/X-RESEARCH.md`](../../docs/X-RESEARCH.md).

## Files

| File | Role |
|---|---|
| `x-config.ts` | Env config (`X_CLIENT_ID`/`X_CLIENT_SECRET` required; consumer keys, bearer, webhook id, redirect URI optional). Missing config → 503 `X_NOT_CONFIGURED` naming variables, never values. |
| `x-api-client.ts` | Typed fetch client for `https://api.x.com/2`: user-token Bearer auth, Basic + form bodies for token endpoints, X problem-body errors mapped to `XApiError` with `x-rate-limit-*` info and retryable classification (429/5xx). |
| `x-webhook.ts` | Pure helpers: CRC response token + POST signature verification (HMAC-SHA256, timing-safe, client secret first with consumer-secret fallback, fail closed), 1:1 conversation-id derivation (BigInt ordering), v2 DM-event normalization, XAA `dm.received` + AAA `direct_message_events` parsing, AAA read-receipt → watermark status updates. |
| `x-provider.ts` | `XProvider implements IMessagingProvider` (id `"x"`): OAuth URL/exchange/refresh (rotating refresh tokens), own-profile lookup, XAA subscription create/delete, send DM, conversation/message backfill (30-day window, derived conversation list), contact profiles, best-effort disconnect (unsubscribe + revoke). |

Connection flow lives in `services/x-connection.service.ts`
(OAuthConnectionSession pattern: state hash only, PKCE verifier
encrypted in the session payload, 15-minute single-use), routes in
`app/api/workspaces/[workspaceId]/channels/x/connect` and
`app/api/oauth/x/callback`, CRC + webhooks in
`app/api/webhooks/[provider]`, channel resolution (`for_user_id` /
XAA `filter.user_id`) in `workers/processors/webhook.processor.ts`,
and refresh scheduling in `lib/token-refresh.ts` +
`workers/processors/token-refresh.processor.ts`.

## Honest limits

- Access tokens live 2 hours — the refresh chain is load-bearing; a
  rejected refresh token marks the channel EXPIRED for reconnect.
- Outbound media sends are NOT wired (X needs a pre-uploaded
  `media_id`); attempting one fails with a clear error.
- XAA `dm.read` payloads are not mapped to status updates yet (AAA
  read receipts are). XAA `dm.sent` echoes are parsed and skipped as
  own messages.
- History/backfill covers only the last 30 days (X's limit), and
  every read is billed per resource on pay-per-use pricing.
