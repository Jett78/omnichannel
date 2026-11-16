# TikTok Business Messaging — Research (Phase 7)

Researched 2026-11-16 against TikTok's official documentation only
(`business-api.tiktok.com` — TikTok API for Business; `developers.tiktok.com`
— TikTok for Developers). Third-party pages were used only to discover
official pages, never as evidence. Where the official docs are silent or
ambiguous, this document says so instead of guessing.

## VERDICT: (B) GATED — scaffolding only

A real, documented, official **Business Messaging API** exists under
TikTok API for Business (v1.3). It is **not self-serve**: before any
Business Messaging call can succeed, the *developer* must pass TikTok's
manual **Data Security & Privacy Review** (and, to serve US-registered
accounts, the additional **US Data Security Review** + USDS Addendum).
TikTok states that even when a TikTok account successfully authorizes an
app, "Business Messaging API calls will fail" if the developer has not
passed the required reviews.

We hold no TikTok developer approval and no TikTok credentials, and the
review is a company-level due-diligence process (questionnaires, security
documentation) that cannot be completed from this codebase. Therefore
Phase 7 implements **setup scaffolding only**: env configuration, a
registered provider adapter whose operational methods throw a clear
access error, an honest dashboard state, and the approval playbook in
`docs/TIKTOK-ACCESS.md`. No endpoints are called, no payload shapes are
parsed, and nothing is faked.

Decisive facts:

1. **Reviews are a hard prerequisite.** "Business Messaging API
   developers are required to complete necessary reviews as a
   prerequisite for Business Messaging API access." Application starts
   with an intake form; TikTok initiates the manual review within 10
   working days; there is no self-serve progress tracking.
   — https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3
2. **Authorization alone does not unlock the API.** "…your app will not
   be able to retrieve or interact with any related data through the
   Business Messaging API. As a result, Business Messaging API calls
   will fail…" (same page, FAQ on EEA/US accounts without the reviews).
3. **Only high-entitlement accounts are eligible.** "The Business
   Messaging API only supports TikTok Accounts with Advanced Access or
   Verified Business Accounts ('VBA'…). General TikTok Accounts are not
   eligible, but users can upgrade their TikTok accounts' entitlement
   level." (same page, FAQ).
4. **Whole regions are excluded.** The API "is not yet available in the
   European Economic Area, Switzerland or the UK"; accounts signed up
   there cannot be managed and their DMs cannot be retrieved via the
   API or webhooks (same page).
5. **The consumer developer platform has no messaging at all.** TikTok
   for Developers (Login Kit, Display API, Content Posting API,
   Research API) publishes no direct-message scope; its scope list is
   `user.info.*`, `video.list`, `video.upload`, `video.publish`, etc.
   Business Messaging lives only in TikTok API for Business.
   — https://developers.tiktok.com/doc/tiktok-api-scopes (scope list as
   published; no messaging/DM scope exists in it)

## 1. What the official offering is

**TikTok Business Messaging API**, part of **TikTok API for Business**,
base URL `https://business-api.tiktok.com/open_api/v1.3`. It "enables
TikTok accounts to send and receive direct messages with TikTok users
on API-integrated platforms."

Documented endpoints (API Reference Overview,
https://business-api.tiktok.com/portal/docs/api-reference/v1.3):

| Endpoint | Purpose | Permission |
|---|---|---|
| `POST /business/message/send/` | Send a message to a conversation | Business Messaging Send |
| `GET /business/message/conversation/list/` | List conversations (up to 100 records) | Business Messaging Read |
| `GET /business/message/content/list/` | List messages in a conversation (20 most recent) | Business Messaging Read |
| `POST /business/message/media/upload/` | Upload an image (returns `media_id`, valid 30 days) | Business Messaging Send |
| `POST /business/message/media/download/` | Get a `download_url` for an image in a message | Business Messaging Read |
| `GET /business/message/capabilities/get/` | Check whether an account may send media in a conversation | Business Messaging Read |
| `POST /business/message/direct_reply/update/` · `GET …/get/` | Comment-to-Message setting | Send / Read |
| `POST /business/webhook/update/` | Register the Business Messaging webhook callback | (app-level) |
| `/business/message/auto_message/*` | Automatic messages (welcome etc.) | Auto Message Setting |

Guide: https://business-api.tiktok.com/portal/docs/manage-direct-messages-for-a-business-account/v1.3

It is a **separate system from TikTok Shop messaging** ("Integration
with the TikTok Business Messaging API does not allow management of
TikTok Shop Messages" — access page FAQ), and separate from TikTok for
Developers' Login Kit tokens: Business Messaging uses TikTok API for
Business app credentials and TikTok-account authorization (below).

## 2. Access model — approvals required

In order (all from the access page above):

1. **An approved TikTok API for Business developer app** with a valid
   app ID. A new app application should include the "Ad Account
   Management", "CTX Events Management" and "Measurement" scopes of
   permission.
2. **Data Security & Privacy Review (DSPR)** — required for all
   developers. Starts with TikTok's intake form; TikTok initiates the
   review within **10 working days**; the developer then receives the
   "TikTok/ByteDance Third-Party Due Diligence Questionnaire" (DSPR
   DDQ) by email. Supporting documents such as ISO 27001, SOC 2, or a
   recent penetration-test report are recommended to expedite it.
   Reviews are **manually managed**; no portal progress tracking.
3. **US Data Security Review + USDS Addendum** — additionally required
   to manage accounts *signed up in the US* (USDS VAQ questionnaire,
   arriving ~1 week after the DDQ; TikTok emails approved developers to
   execute the USDS Addendum). TikTok advises excluding the US from the
   application if US accounts are not needed yet, to shorten review.
4. Only after the applicable reviews pass may the app call Business
   Messaging endpoints on behalf of accounts in the approved regions.

This is an approval/partnership gate, not a self-serve toggle: there is
no way to obtain working Business Messaging access by registering an
app alone.

## 3. Account eligibility and supported markets

- **Account type**: TikTok accounts with **Advanced Access**
  entitlement or **Verified Business Accounts (VBA)** only. General
  TikTok Accounts are ineligible; users can upgrade their entitlement
  level (access page FAQ; entitlements overview linked from it:
  https://ads.tiktok.com/help/article/about-tiktok-account-entitlements).
- **Region** (determined by the account's sign-up location):
  - **EEA, Switzerland, UK — not available at all**; DMs from accounts
    in these regions cannot be retrieved via the API or webhooks.
  - **US** — available only through developers who passed both reviews
    and signed the USDS Addendum.
  - **Rest of World** (incl. APAC, LATAM, METAP, and Nepal) — available
    through developers who passed the DSPR.
- **DM setting**: businesses must set their TikTok account to **accept
  direct messages from everyone** before authorizing an app, or
  messages must be accepted manually in the TikTok app (webhook
  subscription guide, §5 sources).
- Feature availability varies by region (e.g. image attachments only
  where both parties are in countries supporting image DMs).

## 4. Capabilities (as documented — for the post-approval build)

Documented here so the follow-up implementation (once access is
granted) has a verified target. **None of this is implemented in
Phase 7.**

- **Authorization**: the TikTok account holder authorizes the developer
  app via the app's authorization URL; the app receives an `auth_code`
  and exchanges it at `POST /open_api/v1.3/tt_user/oauth2/token/` for an
  access token (~24 h) and refresh token (~1 year). The account's
  app-scoped `open_id` from that exchange is used as the `business_id`
  parameter in Business Messaging calls. (Webhook schema doc and
  manage-messages guide, §5 sources; token lifetimes are as documented
  in TikTok's Accounts API authorization/authentication guides.)
- **Receiving**: webhook notifications for new messages; the first
  message from a user triggers a conversation event with a unique
  `conversation_id`. Subscribe via `POST /business/webhook/update/`
  with `app_id`, `secret`, `callback_url`, `event_type:
  DIRECT_MESSAGE`. Events include `im_receive_msg` (user → business),
  `im_send_msg`, `im_referral_msg`, and `im_receive_msg_eu` (sender in
  EEA/CH/UK). Deliveries retry for up to 72 h with exponential backoff;
  the callback must answer HTTP 200 over HTTPS.
  — https://business-api.tiktok.com/portal/docs/subscribe-to-business-messaging-webhook-events-via-webhooks-api/v1.3
  — https://business-api.tiktok.com/portal/docs/accounts-api-webhooks-guide/v1.3
- **Webhook signature**: `TikTok-Signature` header of the form
  `t=<unix-seconds>,s=<signature>`; the signature is HMAC-SHA256 over
  the concatenation of the timestamp and the raw request body, keyed
  with the **app secret**; stale timestamps should be rejected.
  — https://business-api.tiktok.com/portal/docs/webhook-verification/v1.3
- **Sending**: `POST /business/message/send/` with the
  `conversation_id`. Message types: **text**, **image** (via uploaded
  `media_id`), and message templates incl. **TikTok post shares**.
  Sender actions: **typing** indicator and **mark-as-read** ("Seen").
  **A business may never initiate a conversation** — it can only reply
  to users who messaged first.
- **Messaging window / limits** (non-mutual-follow conversations):
  after a user's first message, up to **10 messages within 48 hours**;
  once the user replies, **unlimited messages within 48 hours of their
  last reply**; if more than 48 hours pass without a user reply, at
  most **3 additional messages** until they respond again.
  — https://business-api.tiktok.com/portal/docs/messaging-limits-for-business-messaging-api/v1.3
- **Message statuses**: the docs describe delivery via webhook events
  (`im_send_msg` for messages the business sends); a full
  delivered/read receipt model comparable to Meta's is **not**
  documented in the pages reviewed — treat status granularity as
  **unverified** until the post-approval build can read the full
  webhook schema with an approved app.
- **Rate limits**: endpoint-level limits are listed per endpoint in
  the API Reference; no single global Business Messaging rate limit is
  published on the pages reviewed (**ambiguous — do not assume**).

## 5. Sandbox / test facilities

- TikTok API for Business documents **sandbox accounts** for testing
  integrations without a real TikTok for Business account (Get Started
  workflow). The pages reviewed describe the sandbox in the context of
  the Marketing/Accounts APIs; **whether sandbox accounts can exercise
  Business Messaging endpoints is not stated** in the official pages
  reviewed — flagged as ambiguous, to be confirmed with TikTok during
  the review process.
- TikTok for Developers offers sandbox mode for its own products
  (e.g. Content Posting), but those products have no messaging scope,
  so they cannot be used to test Business Messaging.
- Either way, sandbox testing presupposes a registered developer app;
  it does not bypass the Data Security & Privacy Review for production
  Business Messaging access.

## 6. What this means for Unified Omnichannel Inbox

- Phase 7 ships scaffolding only: configuration, a gated provider
  adapter, dashboard state, and `docs/TIKTOK-ACCESS.md`.
- The day TikTok approves this deployment's app (DSPR passed; US
  review too if US accounts are in scope), the follow-up build is a
  normal Phase 5/6-style implementation against §4: OAuth via the
  existing `OAuthConnectionSession` pattern, webhook signature
  verification per the documented scheme, `parseWebhook` for
  `im_receive_msg`, send via `/business/message/send/`, 48-hour window
  enforcement in the messaging engine, and conversation/message
  backfill from the list endpoints. The `TIKTOK` provider enum value
  already exists in the schema (Phase 1 init migration), so no data
  migration gates that work.

## Sources (official TikTok pages, read 2026-11-16)

1. Access to Business Messaging API —
   https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3
2. Manage direct messages for a TikTok account —
   https://business-api.tiktok.com/portal/docs/manage-direct-messages-for-a-business-account/v1.3
3. API Reference Overview (Business Messaging endpoints) —
   https://business-api.tiktok.com/portal/docs/api-reference/v1.3
4. Messaging limits for TikTok Business Messaging API —
   https://business-api.tiktok.com/portal/docs/messaging-limits-for-business-messaging-api/v1.3
5. Subscribe to TikTok Business Messaging events via Webhooks —
   https://business-api.tiktok.com/portal/docs/subscribe-to-business-messaging-webhook-events-via-webhooks-api/v1.3
6. Webhook verification —
   https://business-api.tiktok.com/portal/docs/webhook-verification/v1.3
7. Accounts Webhooks guide —
   https://business-api.tiktok.com/portal/docs/accounts-api-webhooks-guide/v1.3
8. TikTok API scopes (TikTok for Developers — no messaging scope) —
   https://developers.tiktok.com/doc/tiktok-api-scopes
