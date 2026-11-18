# Meta App Setup & App Review — Remaining Manual Steps

The Facebook Messenger and Instagram integrations (Phase 5) are fully
implemented against the official Meta Graph / Messenger / Instagram
APIs. **No real Meta account was used during development** (none is
available in the build environment): the code is verified against
payload fixtures and an injected HTTP test double only. Before real
customers can connect, a human must complete the steps below in the
Meta developer dashboard. Until then the app runs in Meta
**Development mode**, where only users/Pages/accounts with a role on
the app can connect.

## 1. Create the Meta app

1. Go to https://developers.facebook.com/apps → **Create App** →
   type **Business** (required for Messenger/Instagram business
   messaging at scale).
2. Add the products: **Messenger** and **Instagram** (the Instagram
   product that offers "Instagram API with Instagram Login").
3. Complete **Business Verification** for the owning business
   (Settings → Business Verification in Business Manager) — required
   for Advanced Access to messaging permissions.

## 2. Configure environment variables on the server

Facebook / Messenger:

```
META_APP_ID=<app id>
META_APP_SECRET=<app secret>
META_WEBHOOK_VERIFY_TOKEN=<any long random string you choose>
META_GRAPH_API_VERSION=v25.0            # optional, this is the default
META_FACEBOOK_REDIRECT_URI=             # optional override; default ${APP_URL}/api/oauth/facebook/callback
META_APPSECRET_PROOF=true               # optional; sends appsecret_proof with Graph calls
```

Instagram — two auth models, picked automatically by which env vars
exist:

- **Instagram Login** (apps that still offer it): the Instagram
  product's **own** app id/secret from the dashboard — different
  values from the Facebook app secret:

```
INSTAGRAM_APP_ID=<instagram app id>
INSTAGRAM_APP_SECRET=<instagram app secret>
INSTAGRAM_REDIRECT_URI=                 # optional override; default ${APP_URL}/api/oauth/instagram/callback
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=         # optional; falls back to META_WEBHOOK_VERIFY_TOKEN
```

- **Facebook Login** (newer apps — Meta's dashboard states "API setup
  with Instagram login is not available for newer apps"): no extra
  env vars; the flow reuses `META_APP_ID` / `META_APP_SECRET` and
  presents the scopes `pages_show_list`, `instagram_basic`,
  `instagram_manage_messages` on the classic Facebook Login dialog
  (the Instagram use case's "API setup with Facebook login" tab). The
  Instagram professional account must be linked to a Facebook Page;
  the channel stores that Page's access token and sends via
  graph.facebook.com. Do NOT use a Facebook Login for Business
  configuration (config_id) for this: its token only carries the
  assets picked in that dialog (an Instagram account, no Pages), so
  /me/accounts returns nothing. `INSTAGRAM_LOGIN_CONFIG_ID` is
  therefore unused. For this model, register the Instagram callback
  under **Facebook Login for Business → Settings → Valid OAuth
  Redirect URIs** instead of the Instagram product.

## 3. Register redirect URIs

- **Facebook Login → Settings → Valid OAuth Redirect URIs**:
  `https://<your-domain>/api/oauth/facebook/callback`
- **Instagram product → OAuth redirect URIs**:
  `https://<your-domain>/api/oauth/instagram/callback`

(Use your real `APP_URL`; the Channels page in the app shows the exact
URIs for the current deployment.)

## 4. Configure webhooks

Messenger product → Webhooks, and Instagram product → Webhooks:

| Field | Facebook | Instagram |
|---|---|---|
| Callback URL | `https://<your-domain>/api/webhooks/facebook` | `https://<your-domain>/api/webhooks/instagram` |
| Verify token | your `META_WEBHOOK_VERIFY_TOKEN` | your `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (or the Meta one) |
| Subscription fields | `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads` | `messages`, `messaging_postbacks`, `messaging_seen` |

The app also subscribes each connected Page/account programmatically
at connect time; the dashboard-level subscription above is still
required so Meta knows where to deliver events.

## 5. Permissions to request (Advanced Access via App Review)

Facebook Login / Messenger permissions:

- `pages_show_list` — list the user's Pages at connect time.
- `pages_read_engagement` — read Page metadata/conversations.
- `pages_messaging` — **send and receive Messenger messages** (the
  core permission; requires a screencast of the working inbox flow).
- `pages_manage_metadata` — subscribe the Page to webhooks
  programmatically (`/{page-id}/subscribed_apps`).

Instagram permissions:

- `instagram_business_basic` — read the professional account profile.
- `instagram_business_manage_messages` — **send and receive Instagram
  DMs**.

Each permission needs: a written explanation of how the product uses
it, a screencast showing the end-to-end flow in this app, and a test
account/instructions for the reviewer. Expect the review to iterate —
budget days, not hours.

## 6. Other launch requirements

- **Privacy Policy URL** and **Terms URL** must be set in the app's
  Basic Settings (publicly reachable pages).
- **Data deletion callback**: Meta requires a Data Deletion Request
  callback URL (or deletion instructions URL). ⚠️ **TODO before
  public launch — not yet implemented in this codebase.** Requests
  must be answered by deleting/anonymizing the requester's contact
  data; implement `POST /api/webhooks/meta/data-deletion` (signed
  request parsing + `confirmation_code` response) and register it in
  the dashboard.
- **App icon, category, business email** in Basic Settings.
- Switch the app to **Live mode** only after Advanced Access is
  granted for all permissions above and Business Verification passed.

## 7. Testing in Development mode (before review)

1. Add test users under **App Roles → Roles** (Admin/Developer/Tester)
   and connect **their** Pages / Instagram professional accounts from
   the app's Channels page — this works fully in Development mode.
2. Instagram testers must also be added under the Instagram product's
   **Instagram Testers** list and accept the invite in the Instagram
   app (Settings → Apps and Websites → Tester Invites).
3. Send the Page/account a DM from another account and confirm:
   webhook delivery (check `WebhookEvent` rows), the conversation in
   the inbox, and a reply landing on the phone within the 24h window.

## 8. Platform rules the implementation follows

- **24-hour messaging window**: standard replies (`messaging_type:
  RESPONSE`) are only sent within 24h of the customer's last message.
  The messaging engine refuses out-of-window sends for Facebook /
  Instagram channels *before* any API call and marks the message
  FAILED with an explanatory error. The Messenger `HUMAN_AGENT` tag
  extends the window to 7 days for human-handled cases — **not yet
  implemented**; add it deliberately (with UI disclosure) if support
  workflows need it. Instagram has no equivalent general-purpose tag.
- **Token lifetimes**: Page access tokens derived from a long-lived
  user token do not expire on a schedule (they can still be revoked).
  Instagram long-lived tokens last ~60 days and are refreshed via
  `ig_refresh_token` (implemented in the provider; schedule the
  token-refresh worker before expiry in production).
- **Rate limits**: Graph API usage is per-app/per-Page throttled
  (platform rate limiting, error code 613 / `(#613)`); outbound sends
  already retry with exponential backoff via BullMQ (3 attempts).
  Sustained 613s should surface as FAILED messages with Meta's error
  text, which is stored in `Message.metadata.error`.
- **Errors**: Meta error bodies are parsed into `MetaGraphError`
  (code/subcode/fbtrace_id preserved for support). Tokens are never
  written to logs or included in error messages.
