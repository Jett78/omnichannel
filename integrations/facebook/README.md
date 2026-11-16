# Facebook Messenger integration

Status: **implemented (Phase 5)** — official Meta Graph API / Messenger
Platform only. Adapter: `integrations/meta/facebook-provider.ts`
(shared Graph client + webhook translation live alongside it in
`integrations/meta/`).

## Auth model

Facebook Login OAuth:

1. Dashboard "Connect" → `GET …/channels/facebook/connect` creates an
   `OAuthConnectionSession` and redirects to
   `https://www.facebook.com/{version}/dialog/oauth` with scopes
   `pages_show_list, pages_read_engagement, pages_messaging,
   pages_manage_metadata`.
2. Callback exchanges the code for a user token, upgrades it to a
   **long-lived** user token (`fb_exchange_token`), and lists Pages via
   `GET /me/accounts` (incl. linked `instagram_business_account`).
3. The user picks a Page (must carry the MANAGE or MODERATE task). The
   **Page access token** is stored encrypted (AES-256-GCM) as the
   channel credential; the Page is subscribed to webhooks via
   `POST /{page-id}/subscribed_apps`
   (`messages, messaging_postbacks, message_deliveries, message_reads`).

## Endpoints used

| Purpose | Call |
|---|---|
| Code exchange | `POST /{version}/oauth/access_token` |
| Long-lived token | `GET /{version}/oauth/access_token?grant_type=fb_exchange_token` |
| List Pages | `GET /{version}/me/accounts` |
| Subscribe / unsubscribe | `POST` / `DELETE /{version}/{page-id}/subscribed_apps` |
| Send message / typing | `POST /{version}/{page-id}/messages` (`messaging_type: RESPONSE`) |
| Conversations (backfill) | `GET /{version}/{page-id}/conversations?platform=messenger` |
| Thread messages (backfill) | `GET /{version}/{conversation-id}/messages` |
| Contact profile | `GET /{version}/{psid}?fields=first_name,last_name,profile_pic` |
| Webhooks | `POST /api/webhooks/facebook` (HMAC-SHA256 `X-Hub-Signature-256` verified; delivery/read receipts advance message status) |

## Rules honoured

- **24h standard messaging window** — enforced by the messaging engine
  before any send; out-of-window replies fail with an explanatory
  error (no `HUMAN_AGENT` tag support yet).
- Echo events (`message.is_echo`) are ignored; postbacks become SYSTEM
  messages with deterministic ids for idempotent ingest.
- Tokens travel only in `Authorization: Bearer` headers — never in
  URLs, logs, or API responses to the browser.

## Configuration

`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`
(optional: `META_GRAPH_API_VERSION`, `META_FACEBOOK_REDIRECT_URI`,
`META_APPSECRET_PROOF`). Full setup + App Review checklist:
[`docs/META-APP-REVIEW.md`](../../docs/META-APP-REVIEW.md).

> Verified against payload fixtures and an injected HTTP test double
> (`npm run test:phase5`). A live check requires a real Meta app —
> see the App Review doc.
