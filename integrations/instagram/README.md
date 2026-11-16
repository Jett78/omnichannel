# Instagram integration

Status: **implemented (Phase 5)** — **Instagram API with Instagram
Login**, the currently supported Meta model. Adapter:
`integrations/meta/instagram-provider.ts` (shared Graph client +
webhook translation live alongside it in `integrations/meta/`).

Unlike the legacy Messenger-API-for-Instagram flow, Instagram Login
needs **no Facebook Page**: the professional account authorizes
directly with Instagram, and all calls go to `graph.instagram.com`
(token exchange starts at `api.instagram.com`).

## Auth model

1. Dashboard "Connect" → `GET …/channels/instagram/connect` creates an
   `OAuthConnectionSession` and redirects to
   `https://www.instagram.com/oauth/authorize` with scopes
   `instagram_business_basic, instagram_business_manage_messages`.
2. Callback: `POST api.instagram.com/oauth/access_token` (form) →
   short-lived token; `GET graph.instagram.com/access_token?
   grant_type=ig_exchange_token` → **long-lived token (~60 days)**;
   profile via `GET graph.instagram.com/{version}/me`.
3. **Eligibility**: only professional accounts — `account_type` must be
   `BUSINESS` or `MEDIA_CREATOR`. Personal accounts are rejected with
   a clear reason at connect time.
4. The long-lived token is stored encrypted (AES-256-GCM) as the
   channel credential and refreshed in place via
   `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`
   (provider `refreshToken`). The account is subscribed to webhooks via
   `POST /{version}/me/subscribed_apps`
   (`messages, messaging_postbacks, messaging_seen`).

## Endpoints used

| Purpose | Call |
|---|---|
| Code exchange | `POST api.instagram.com/oauth/access_token` (form) |
| Long-lived token | `GET graph.instagram.com/access_token?grant_type=ig_exchange_token` |
| Token refresh | `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` |
| Profile | `GET graph.instagram.com/{version}/me` |
| Subscribe / unsubscribe | `POST` / `DELETE graph.instagram.com/{version}/me/subscribed_apps` |
| Send message / typing | `POST graph.instagram.com/{version}/{ig-id}/messages` (`messaging_type: RESPONSE`) |
| Conversations (backfill) | `GET graph.instagram.com/{version}/{ig-id}/conversations?platform=instagram` |
| Thread messages (backfill) | `GET graph.instagram.com/{version}/{conversation-id}/messages` |
| Contact profile | `GET graph.instagram.com/{version}/{igsid}` (best-effort) |
| Webhooks | `POST /api/webhooks/instagram` (HMAC-SHA256 with the **Instagram** app secret; read receipts advance message status) |

## Rules honoured

- **24h standard messaging window** — enforced by the messaging engine
  before any send; out-of-window replies fail with an explanatory
  error.
- Echo events are ignored; story mentions / shares are preserved as
  attachments (original payload in `raw`).
- The Instagram product's **own** app id/secret are used
  (`INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`) — distinct from the
  Facebook app secret, including for webhook signature verification.

## Configuration

`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (optional:
`INSTAGRAM_REDIRECT_URI`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` — falls
back to `META_WEBHOOK_VERIFY_TOKEN`). Full setup + App Review
checklist: [`docs/META-APP-REVIEW.md`](../../docs/META-APP-REVIEW.md).

> Verified against payload fixtures and an injected HTTP test double
> (`npm run test:phase5`). A live check requires a real Meta app with
> an Instagram professional test account — see the App Review doc.
