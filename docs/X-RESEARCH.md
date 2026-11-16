# X (Twitter) Direct Messages — Research (Phase 8)

Researched 2026-11-16 against X's official documentation
(`docs.x.com` — X API v2 documentation and X's published OpenAPI
contract). Environment note: `docs.x.com` is not directly fetchable
from this build environment, so the official documentation was read
through the docs' own published source (a verbatim mirror of the
docs.x.com MDX source) and X's published OpenAPI definitions, and
cross-checked against multiple independent implementers of the same
docs (Vercel Chat SDK's X adapter, Outstand, Scalekit). Where the
official material is silent, ambiguous, or in transition, this
document says so instead of guessing.

## VERDICT: (A) SELF-SERVE (paid, pay-per-use) — full implementation

A complete, documented **Direct Messages API exists in X API v2**
(lookup + manage endpoints), and it is available to **any approved
developer account on X's pay-per-use pricing** — no Enterprise
contract, no manual product approval, no partner programme. X
replaced the old Free/Basic/Pro subscription tiers with prepaid
pay-per-use credits (February 2026); the official pricing page states
the model plainly: "The X API uses **pay-per-usage** pricing. No
subscriptions, no monthly caps—pay only for what you use", with
credits purchased upfront in the Developer Console. DM resources are
priced on that public rate card (DM event reads and DM sends are
ordinary billable operations), which is only possible because the
endpoints are open to self-serve accounts.

Therefore Phase 8 implements the integration **for real**, mirroring
Phase 5/6: OAuth 2.0 Authorization Code + PKCE connection flow via the
existing `OAuthConnectionSession` pattern, a typed API client, the DM
REST endpoints, webhook CRC + signature verification, both documented
webhook payload families, and rate-limit-aware error mapping.
Production activation is: create the X app, buy credits, set env,
register the webhook, connect accounts (see `docs/X-ACCESS.md`).

**No real X developer account, app, or credits exist in this
environment**, so — exactly as in Phases 5/6 — verification here is
fixtures + an injected fake-fetch test double whose payloads are
copied from the official documentation examples. Nothing in this
phase claims a live X connection or a delivered DM.

Decisive facts:

1. **The DM endpoints are documented, current X API v2 endpoints.**
   Lookup: `GET /2/dm_events`, `GET /2/dm_conversations/with/:participant_id/dm_events`,
   `GET /2/dm_conversations/:dm_conversation_id/dm_events`. Manage:
   `POST /2/dm_conversations/with/:participant_id/messages`,
   `POST /2/dm_conversations/:dm_conversation_id/messages`,
   `POST /2/dm_conversations` (group), `DELETE /2/dm_events/:id`.
   — https://docs.x.com/x-api/direct-messages/lookup/introduction
   — https://docs.x.com/x-api/direct-messages/manage/introduction
2. **Access is pay-per-use self-serve, not approval-gated.** The
   pricing page describes prepaid credits and no subscriptions;
   Enterprise is positioned only as the high-volume option ("For
   high-volume access with dedicated support, custom rate limits, and
   additional features, contact our enterprise sales team"). The
   published rate card prices DM operations for self-serve accounts:
   **DM Event: Read $0.010 per resource**, **DM send (DM Interaction:
   Create) $0.015 per request**, and X Activity API `dm.received`
   webhook events at **$0.010 per event**.
   — https://docs.x.com/x-api/getting-started/pricing
3. **Auth is user-context OAuth; no app-only access to DMs.** "DM
   endpoints require user authentication… App-Only authentication is
   not supported. All Direct Messages are private." OAuth 2.0
   Authorization Code with PKCE is the recommended flow (OAuth 1.0a
   User Context is documented as legacy support). Required scopes:
   `dm.read` (+ `tweet.read`, `users.read`) to read; `dm.write` +
   `dm.read` (+ `tweet.read`, `users.read`) to send/delete.
   — https://docs.x.com/x-api/direct-messages/lookup/integrate
   — https://docs.x.com/x-api/direct-messages/manage/integrate
4. **Rate limits are published per endpoint** (per-user, user
   context): DM event reads **15 requests / 15 min**; DM sends
   **15 / 15 min and 1,440 / 24 h per user**, **1,440 / 24 h per
   app**; DM event deletes 300 / 15 min, 1,500 / 24 h per user.
   — https://docs.x.com/x-api/fundamentals/rate-limits
5. **Real-time delivery is documented and self-serve.** The
   **X Activity API (XAA)** — `POST /2/activity/subscriptions` with
   `event_type` values `dm.received` / `dm.sent` / `dm.read` /
   `dm.indicate_typing`, `filter.user_id`, delivered to a webhook
   registered through the v2 Webhooks API (`POST /2/webhooks`) or via
   the persistent `GET /2/activity/stream` — is X's current path;
   private events like DMs require the account's OAuth 2.0 token with
   the matching scope (`dm.read`). X's older **Account Activity API**
   (`direct_message_events`) still delivers but X marks it as being
   deprecated in favour of XAA. Webhook security is the documented
   CRC challenge + `x-twitter-webhooks-signature` HMAC scheme.
   — https://docs.x.com/x-api/activity/introduction
   — https://docs.x.com/x-api/account-activity/introduction
   — https://docs.x.com/x-api/webhooks/introduction

## 1. Access tiers & pricing (current)

| Path | What it is | DM access |
|---|---|---|
| **Pay-per-use (current, self-serve)** | Prepaid credits bought in the Developer Console (console.x.com); each request deducts per-resource prices; charges deduplicated per resource within a 24 h UTC window; optional auto-recharge and per-cycle spending limits. Launched 2026-02-06, replacing subscriptions for new developers. | **Yes** — DM reads $0.010/resource, DM sends $0.015/request, `dm.received` webhook events $0.010/event. Post reads capped at 3M per billing cycle. |
| Free / Basic / Pro (legacy subscriptions) | Free $0, Basic $200/mo, Pro $5,000/mo historically. **Closed to new signups** in the February 2026 change; remaining Basic subscribers were migrated to pay-per-use during 2026 and Pro was deprecated later in 2026. | Legacy only — not an activation path for a new deployment. |
| Enterprise | Custom contract (historically from ~$42,000/mo), dedicated support, custom rate limits, higher XAA subscription ceilings (75,000 vs 1,500 self-serve). | Yes, but unnecessary for DM support at ordinary volumes. |

The only prerequisites the DM docs name are: "An approved developer
account" (the standard self-serve developer signup — accept the
Developer Agreement in the console), "A Project and App in the
Developer Console", and user access tokens via 3-legged OAuth. There
is no DM-specific manual review comparable to TikTok's Data Security
& Privacy Review or Meta's App Review.

## 2. The DM API surface (X API v2)

Base URL `https://api.x.com/2`. All DM endpoints require a
**user-context** token (OAuth 2.0 user token or OAuth 1.0a user
context); the Bearer <redacted> cannot read or send DMs.

| Endpoint | Purpose | Scopes (OAuth 2.0) |
|---|---|---|
| `GET /2/dm_events` | All DM events for the authenticated user (1:1 + group), newest first, paginated (`max_results` ≤ 100, `pagination_token`) | `dm.read`, `tweet.read`, `users.read` |
| `GET /2/dm_conversations/with/:participant_id/dm_events` | Events of the 1:1 conversation with one user | same |
| `GET /2/dm_conversations/:dm_conversation_id/dm_events` | Events of one conversation | same |
| `GET /2/dm_events/:id` | One DM event | same |
| `POST /2/dm_conversations/with/:participant_id/messages` | Send to a user (creates the 1:1 conversation if needed). Body `{"text": …}` | `dm.write`, `dm.read`, `tweet.read`, `users.read` |
| `POST /2/dm_conversations/:dm_conversation_id/messages` | Send into an existing conversation | same |
| `POST /2/dm_conversations` | Create a **group** conversation: `{"conversation_type": "Group", "participant_ids": […], "message": {"text": …}}` | same |
| `DELETE /2/dm_events/:id` | Delete a DM event the user sent | `dm.write`, `dm.read`, … |

Send response (official example, manage introduction):
`{"data": {"dm_conversation_id": "1234567890-0987654321", "dm_event_id": "1122334455667788990"}}`.

Key semantics (all from the official integration guides):

- **Event types**: `MessageCreate` (fields `text`, `sender_id`),
  `ParticipantsJoin`, `ParticipantsLeave`. Fields/expansions:
  `dm.fields=created_at,sender_id,attachments,dm_conversation_id`,
  `expansions=sender_id,participant_ids,attachments.media_keys`,
  `user.fields=username,profile_image_url`, `media.fields=url,type`.
  Official `MessageCreate` example:
  `{"id": "1582838499983564806", "event_type": "MessageCreate", "text": "Hi everyone.", "sender_id": "944480690", "dm_conversation_id": "1578398451921985538", "created_at": "2022-10-19T20:58:00.000Z"}`.
- **No conversation-list endpoint exists.** Conversations are derived
  by grouping `GET /2/dm_events` results by `dm_conversation_id`.
- **1:1 conversation ID format**: `{smaller_user_id}-{larger_user_id}`
  (numeric order of the two participant ids). Group conversation ids
  are opaque snowflakes.
- **History is limited to the last 30 days**: "Events from up to 30
  days ago are available through these endpoints." Backfill beyond
  30 days is impossible via the API — our DB is the long-term record.
- **Media**: sending an attachment requires first uploading it via
  the Media Upload endpoint to obtain a `media_id` (uploaded by the
  same authenticated user, valid 24 h, one attachment per message);
  the send body is `{"text": …, "attachments": [{"media_id": …}]}`.
- **No messaging window.** Unlike Messenger/WhatsApp there is no
  24 h reply window on X; a DM may be sent whenever the recipient's
  settings permit it (see §4).

### OAuth 2.0 details (official authentication docs)

- Authorize URL: `https://x.com/i/oauth2/authorize` with
  `response_type=code`, `client_id`, `redirect_uri` (exact-match
  validation), `scope` (space-separated), `state`,
  `code_challenge`, `code_challenge_method=S256`.
  — https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- Token endpoint: `POST https://api.x.com/2/oauth2/token`
  (form-urlencoded). Access tokens live **2 hours**; adding the
  `offline.access` scope issues a **refresh token**; refresh via
  `grant_type=refresh_token` at the same endpoint. Authorization
  codes expire in **30 seconds** — exchange immediately.
- App types: "Web App" and "Automated App or bot" are **confidential
  clients** (issued a Client Secret; token requests authenticate with
  the HTTP Basic header). OAuth 2.0 must be enabled in the app's User
  authentication settings, with the callback URL registered.
- Revocation: `POST /2/oauth2/revoke`.
- Connected-account identity: `GET /2/users/me`
  (`user.fields=name,username,profile_image_url`).

## 3. Real-time options

Two webhook generations exist; X's strategic direction is XAA.

**X Activity API (XAA) — current, implemented for subscriptions.**
- Register a webhook once per app: `POST /2/webhooks` with
  `{"url": …}` (app Bearer <redacted>); X immediately CRC-validates the URL.
- Subscribe per account + event type:
  `POST /2/activity/subscriptions` with
  `{"event_type": "dm.received", "filter": {"user_id": "…"}, "webhook_id": "…", "tag": "…"}`,
  authorized with the account's OAuth 2.0 token holding `dm.read`.
  Also `dm.sent`, `dm.read`, `dm.indicate_typing`. Self-serve ceiling:
  **1,500 subscriptions** (Enterprise 75,000).
- Delivery: POST to the registered webhook (or the persistent
  `GET /2/activity/stream`). Deliveries are enveloped as
  `{data: {event_type, filter, payload}}`; the DM payload follows the
  v2 DM event object shape. `dm.received` is billed **$0.010/event**;
  `dm.sent`/`dm.read` are not billed.
- Sources: XAA introduction + create-subscription reference (X's
  published OpenAPI), pricing page webhook-events table.

**Account Activity API (AAA) — legacy, payloads still parsed.**
- One webhook + per-account "all events" subscriptions
  (`POST /2/account_activity/webhooks/:webhook_id/subscriptions/all`);
  on pay-per-use it allows only **3 unique subscriptions and
  1 webhook**. Payload family: top-level `for_user_id` plus
  `direct_message_events` (each `{"type": "message_create", "id",
  "created_timestamp", "message_create": {"sender_id", "target":
  {"recipient_id"}, "message_data": {"text", …}}}`), a `users` map,
  `direct_message_indicate_typing_events`, and
  `direct_message_read_events` (`message_read.last_read_event_id`).
- X's AAA introduction now carries a deprecation notice pointing to
  XAA. We do **not** build new subscription management on AAA, but
  `parseWebhook` accepts its documented payload shape so existing
  AAA setups keep working during the migration window.

**Webhook security (both generations)** — official webhooks docs:
- **CRC**: X sends `GET <webhook>?crc_token=…`; the endpoint must
  reply `{"response_token": "sha256=" + base64(HMAC-SHA256(crc_token, secret))}`.
  X re-validates periodically.
- **POST signature**: header `x-twitter-webhooks-signature` =
  `"sha256=" + base64(HMAC-SHA256(raw_body, secret))`.
- **Which secret?** The long-standing docs key both operations with
  the app's **consumer secret** (OAuth 1.0a). X's webhook docs
  updated in November 2026 recommend the **OAuth 2.0 client secret**
  instead, with no published shutoff for consumer-secret signing.
  This is a genuine ambiguity in transition; our implementation
  answers CRC with the client secret when configured (falling back
  to the consumer secret) and verifies POST signatures against
  **either** configured app secret. See `docs/X-ACCESS.md`.
— https://docs.x.com/x-api/webhooks/introduction

**No DM stream.** The filtered/power streams are Post streams; they
do not carry DMs. The only push paths for DMs are AAA/XAA above
(XAA's activity stream is the streaming variant of the same
subscriptions).

## 4. Eligibility & restrictions

- **Own-account model only.** Every DM read/write acts on the
  *authenticated user's own* DMs. There is no cross-account firehose;
  each business account connects its own X account via OAuth.
- **Who can be messaged is governed by the recipient's settings.**
  A send succeeds when the recipient follows the sender, has an
  existing conversation with the sender, or allows message requests
  (X setting "Allow message requests from: Everyone / Verified users
  only"). X's own troubleshooting doc states the failure mode
  plainly: "The recipient may have DM settings that prevent messages
  from unknown users, or may have blocked you." The API answers 403
  and we surface X's error text on the message — never a fake success.
  Since 2023 X has additionally restricted message requests from
  non-verified senders by default for many accounts; this is an
  account/setting matter, not an API tier matter.
- **Send caps**: 15/15 min and 1,440/24 h per user; 1,440/24 h per
  app (rate-limits page, §0 fact 4). X's platform-level account
  limits (help center) apply on top.
- **Group conversations** are supported by the v2 REST endpoints;
  AAA webhooks historically covered 1:1 messages only.
- **No market/age restrictions** are documented for the DM API
  itself (normal X account rules apply).
- **Encrypted "X Chat" is a different product** (launched 2026,
  end-to-end encrypted DMs via the Chat XDK, `chat.*` events). It is
  **not** the classic DM API above and is out of scope for this
  phase; the endpoints implemented here are the documented Direct
  Messages API.

## 5. Sandbox / testing

- **No DM sandbox is documented.** The Developer Console
  (console.x.com) is where projects/apps/keys live; X's quickstarts
  point at the `xurl` CLI for trying requests. Testing DMs requires
  real X accounts and consumes real credits (each DM read $0.010,
  send $0.015) — one more reason this phase verifies with labelled
  fake-fetch doubles instead of live calls.

## 6. What this means for Unified Omnichannel Inbox

- Phase 8 ships the full adapter: `integrations/x/` (config, typed
  API client, webhook parsing/verification, provider), an
  `x-connection.service.ts` OAuth flow on the Phase 5 session
  pattern, XAA subscription best-effort at connect (when the operator
  has registered a webhook and set `X_WEBHOOK_ID`), CRC handling in
  the webhook route, `for_user_id` / XAA `filter.user_id` channel
  resolution in the webhook processor, and an honest Channels card
  (setup steps when unconfigured; real connect when configured).
- The `X` value has existed in the Prisma `Provider` enum since the
  Phase 1 init migration — no schema migration is needed.
- Known limits carried into the design: 30-day API history (our DB
  is the record), conversations derived from events (no list
  endpoint), outbound media requires a pre-uploaded `media_id` (the
  media-upload flow is a documented follow-up; text sends are the
  supported path and attachment sends fail with a clear error rather
  than pretending), typing indicators cannot be *sent* via the v2 DM
  REST endpoints (only received as events), and read receipts are
  mapped from AAA read events (XAA `dm.read` payload mapping is a
  follow-up once its payload is exercised with a real account).

## Sources (official X pages, read 2026-11-16)

1. Pricing (pay-per-usage model) —
   https://docs.x.com/x-api/getting-started/pricing
2. DM Lookup introduction —
   https://docs.x.com/x-api/direct-messages/lookup/introduction
3. DM Lookup integration guide (scopes, event examples, 1:1 ID
   format, fields/expansions) —
   https://docs.x.com/x-api/direct-messages/lookup/integrate
4. Manage DMs introduction (send endpoints + official send example) —
   https://docs.x.com/x-api/direct-messages/manage/introduction
5. Manage DMs integration guide (scopes, media, error table) —
   https://docs.x.com/x-api/direct-messages/manage/integrate
6. Rate limits (DM rows) —
   https://docs.x.com/x-api/fundamentals/rate-limits
7. OAuth 2.0 Authorization Code Flow with PKCE —
   https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
8. Webhooks introduction (CRC + signature scheme) —
   https://docs.x.com/x-api/webhooks/introduction
9. Account Activity API introduction —
   https://docs.x.com/x-api/account-activity/introduction
10. X Activity API (introduction + subscription reference in X's
    published OpenAPI) —
    https://docs.x.com/x-api/activity/introduction
