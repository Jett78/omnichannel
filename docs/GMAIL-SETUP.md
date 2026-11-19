# Gmail channel — setup guide (Phase 9)

The Gmail channel connects a workspace's mailbox to the unified inbox
through Google's **official Gmail API** and OAuth 2.0 sign-in. New
mail is polled about once a minute (history feed), replies are sent
as properly threaded email, and there is **no reply window** on
email.

## How it works

- **Connect** — Channels → Gmail → *Connect now* → Google sign-in
  (scope: `gmail.modify` — read, compose, send) with offline access,
  so the app stores an encrypted refresh token.
- **Inbound** — the worker sweeps every connected mailbox's history
  feed from a stored cursor (`channel.config.gmailHistoryId`, set to
  the connect-time baseline). Only mail arriving *after* the connect
  is ingested; **Import recent chats** on the channel backfills
  recent threads explicitly. Duplicates are dropped by the engine's
  idempotency key.
- **Outbound** — replies go out with the thread's subject (`Re:`),
  `In-Reply-To` and `References` headers and the Gmail `threadId`,
  so they thread correctly in the customer's mail client.
- **Tokens** — access tokens (~1 h) are refreshed by the shared
  token-refresh chain and lazily by the poller. A rejected refresh
  token marks the channel **EXPIRED** (reconnect from Channels).
- **Attachments** — inbound attachment bytes are fetched on demand
  through the inbox media route using the channel credential.

## Operator setup (one time, by the deployment owner)

1. Go to [Google Cloud Console](https://console.cloud.google.com) and
   create (or pick) a project.
2. **APIs & Services → Library** → enable **Gmail API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - App name: *Unified Omnichannel Inbox*; support email: yours.
   - Scopes: add `https://www.googleapis.com/auth/gmail.modify`.
   - While the publishing status is **Testing**, add every mailbox
     owner who should connect as a **Test user** (up to 100).
     ⚠️ In Testing status Google expires refresh tokens after
     **7 days** — mailboxes will need a weekly reconnect. Publish the
     app (below) to remove this.
4. **APIs & Services → Credentials → Create credentials → OAuth
   client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI (exact match):
     `https://omnichannel-nepal-tech.vercel.app/api/oauth/gmail/callback`
     (for local dev also add `http://localhost:3000/api/oauth/gmail/callback`).
   - Copy the **Client ID** and **Client secret**.
5. Set the environment variables (never paste them in chat):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - On **Vercel** (web app — connect flow) **and** on the **Render
     worker** (it polls Gmail and sends replies, so it needs them
     for token refresh).
   - Optional: `GOOGLE_REDIRECT_URI` if APP_URL doesn't match the
     public origin.
6. Redeploy/restart both services. Channels → Gmail now shows
   *Connect now* instead of the setup dialog.

## Going public (selling)

Gmail scopes are **restricted** under Google's policy. Before
customers outside your test-user list can connect, the consent
screen must be **published** and pass Google's **OAuth verification
for restricted scopes**, which includes a **CASA security
assessment** of the app (annual). Until then, only listed test
users can connect. This is Google's gate, not a code limitation —
the same applies to every SaaS reading Gmail.

## Upgrade path: real-time push (optional, not built)

Polling (~1 minute) is the v1 transport. True push requires a Google
Cloud Pub/Sub topic, a `users.watch` call per mailbox with daily
renewal, and domain verification for the push endpoint. The poller's
ingest path is shared, so push would slot in as a second producer
without engine changes.

## Troubleshooting

- **"This deployment is not configured for Gmail"** — the env vars
  are missing on that service (web or worker).
- **Channel EXPIRED after ~7 days** — the consent screen is still in
  Testing status (refresh tokens expire). Reconnect, and publish the
  app to fix it permanently.
- **redirect_uri_mismatch** — the Authorized redirect URI on the
  OAuth client doesn't exactly match the one shown in the Channels
  Gmail dialog.
- **Mail stopped arriving but channel says CONNECTED** — check the
  worker is awake (free-tier sleep delays polls; nothing is lost,
  the cursor resumes where it stopped). If the history cursor aged
  out (mailbox idle for many days), the poller resets it to current
  and logs it — use **Import recent chats** to backfill the gap.
