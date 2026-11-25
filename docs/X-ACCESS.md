> **REMOVED — 2026-11-25, at Jeet's request.** The X (Twitter)
> channel was removed completely: the provider adapter, connection
> service, connect + OAuth callback routes, webhook CRC handling,
> Channels-page card/dialog/banners, onboarding pick, channel icon
> metadata, env block and the Phase 8 test suite are all deleted,
> and the `Provider` enum no longer has an `X` value (migration
> `20261125043752_remove_x_provider`). The integration was never
> activated on this deployment (it needed the operator's own
> console.x.com app + prepaid credits), so no channels, sessions or
> webhook events ever used the value. This file and X-RESEARCH.md
> remain as historical research only.
>
> **Pending:** that migration is committed and verified on a local
> database; it still needs applying to the production Neon database
> (the deployed app is unaffected meanwhile — the database enum
> simply keeps an extra unused value until then).

# X Direct Messages — activation playbook

> Research: [`X-RESEARCH.md`](./X-RESEARCH.md) (verdict: **(A) SELF-SERVE**,
> pay-per-use). This document is the exact, ordered checklist to take the
> Phase 8 implementation live with a real X account. No step here needs
> manual approval from X — activation is: create the app, buy credits,
> register the webhook, connect accounts.
>
> Honest status: the code is implemented and tested against labelled
> fake-fetch doubles built from X's official documentation examples.
> **No real X developer account, app, credits, or tokens exist in this
> project yet** — nothing has ever been connected or sent.

## 1. Create the developer account and app (console.x.com)

1. Sign in at https://console.x.com with the X account that will own the
   app (any account; the *connected* accounts are chosen later per
   workspace). Accept the **Developer Agreement and Policy**.
2. Create a **Project**, then an **App** inside it.
3. In the app's **Settings → User authentication settings**, set:
   - **App permissions**: Read and write (this is the portal-level
     permission; the DM scopes are requested at OAuth time).
   - **Type of App**: **Web App** (or "Automated App or bot") — a
     *confidential* client. Native/public clients do not get a client
     secret and cannot use this integration.
   - **Callback URI**: `{APP_URL}/api/oauth/x/callback` — **exact match**,
     e.g. `https://omnichannel-nepal-tech.vercel.app/api/oauth/x/callback`.
     X rejects the flow if this differs by even a trailing slash.
   - **Website URL**: your app URL.
4. Copy the app's **OAuth 2.0 Client ID** and **Client Secret**
   ("Keys and tokens" in the console). These are the app credentials —
   they are NOT the tokens of any messaging account.

## 2. Buy pay-per-use credits

X API pricing is **pay-per-usage** (since 6 Feb 2026; the legacy
Free/Basic/Pro subscriptions are closed to new signups). In the
Developer Console → **Billing**:

1. Add a payment method and purchase credits (prepaid).
2. Set a **spending limit / auto-recharge** you are comfortable with —
   every DM read, DM send and delivered webhook event is billed.

Rates that apply to this integration (X's published rate card):

| Operation | Price |
|---|---|
| DM event read (each message returned by the DM GET endpoints) | **$0.010 / resource** |
| DM send (`DM Interaction: Create`) | **$0.015 / request** |
| `dm.received` webhook event delivered (X Activity API) | **$0.010 / event** |

Budget note: the provider's backfill (`getConversations`) reads up to
3 pages × 100 DM events per call — up to ~$3 of reads per full backfill.
Normal operation relies on webhooks, not polling.

## 3. Configure the deployment (env)

Set on the web app (and the worker, which runs token refresh):

```bash
# Required — OAuth 2.0 confidential client credentials (step 1.4)
X_CLIENT_ID=
X_CLIENT_SECRET=

# Required for webhook registration only (step 4): the APP's bearer
# token from the console ("Keys and tokens" → Bearer <redacted>).
# Used by the operator, once, outside the app — the app itself never
# calls the API with it.
X_BEARER_TOKEN=

# Optional
X_CONSUMER_KEY=        # OAuth 1.0a keys — only a fallback webhook
X_CONSUMER_SECRET=     # signing key (see the CRC note in step 4)
X_WEBHOOK_ID=          # returned by step 4; enables per-account
                       # X Activity API subscriptions at connect time
X_REDIRECT_URI=        # override only if APP_URL is not the public
                       # origin; must match the console callback exactly
```

Restart/redeploy after setting them. The Channels page then shows X as
ready to connect (before that it shows these setup steps — by design).

## 4. Register the webhook (one-time, per app)

Real-time DMs arrive through the **X Activity API (XAA)**:

1. Deploy first with `X_CLIENT_SECRET` set — X validates the webhook
   URL immediately with a **CRC challenge** (`GET /api/webhooks/x?crc_token=…`)
   and registration fails if the endpoint doesn't answer correctly.
2. Register (operator action, app bearer token):

   ```bash
   curl -X POST https://api.x.com/2/webhooks \
     -H "Authorization: Bearer $X_BEARER_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"url": "{APP_URL}/api/webhooks/x"}'
   ```

3. Put the returned webhook `id` in **`X_WEBHOOK_ID`** and redeploy.
   From then on, every account connected from the Channels page gets
   `dm.received` + `dm.sent` subscriptions automatically; the outcome
   is recorded on the channel (subscribed / failed + reason / skipped).
   Without `X_WEBHOOK_ID`, accounts still connect and can send/read via
   the REST endpoints — they just receive no real-time events.

> **CRC/signature key ambiguity (flagged in X-RESEARCH.md):** classic
> Account Activity docs key the CRC + `x-twitter-webhooks-signature`
> HMAC with the OAuth 1.0a **consumer secret**; X's current webhook docs
> recommend the **OAuth 2.0 client secret**, with no shutoff published.
> This implementation answers CRC with the client secret first
> (consumer secret as fallback) and accepts a POST signature matching
> **either** configured secret — and fails closed when none is set. If
> registration fails the CRC check, set `X_CONSUMER_KEY` /
> `X_CONSUMER_SECRET` from the app's OAuth 1.0a keys and retry.

> **Legacy AAA:** the older Account Activity API is deprecated by X in
> favour of XAA. This implementation still *parses* AAA
> `direct_message_events` payloads (and its read receipts) if an
> existing AAA setup delivers them, but builds no new subscriptions on
> it. AAA's pay-per-use ceiling is 3 subscriptions / 1 webhook.

## 5. Connect accounts (per workspace)

1. Sign in → **Channels** → X card → **Connect now** → X's consent
   screen (scopes: `dm.read dm.write tweet.read users.read
   offline.access`). Authorize with the account whose DMs the workspace
   should handle — it can be any X account (personal or business);
   only that account's own DMs are accessible, by X's design.
2. The channel appears as **X — @username**. Tokens are stored
   encrypted; nothing token-shaped ever reaches the browser.
3. **Token lifetime:** access tokens live **2 hours**; the worker's
   token-refresh chain (armed at connect) refreshes and rotates them
   automatically. If a refresh token is ever revoked, the channel is
   marked **EXPIRED** and shows as needing a reconnect — it never fails
   silently.

## 6. Platform rules to know (enforced or surfaced by the code)

- **Recipient DM settings govern sends.** If the recipient doesn't
  follow the account, has message requests off, or restricts requests
  to verified users, X returns 403 and the message is marked FAILED
  with X's own error text — the app never pretends a send succeeded.
- **History is 30 days.** Backfill can only see the last 30 days of DM
  events; there is no conversation-list endpoint (conversations are
  derived from events).
- **Rate limits (per connected account):** DM reads 15 requests /
  15 min; DM sends 15 / 15 min and 1,440 / 24 h. 429s surface with
  X's `x-rate-limit-*` values and are classified retryable.
- **Outbound media is not wired yet:** sending an attachment fails with
  a clear error — X requires a separate media-upload step producing a
  `media_id` first (documented follow-up, not faked).
- **Encrypted "X Chat"** (the newer end-to-end-encrypted product) is a
  different API surface and is out of scope.

## 7. What NOT to do

- No unofficial X clients, cookie/session-token methods, browser
  automation, or scraping — official `api.x.com` only.
- No third-party "X DM API" resellers/proxies.
- Don't connect an account you don't control, and don't paste tokens
  anywhere outside the OAuth flow — the app never asks for them.
