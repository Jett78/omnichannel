# TikTok Business Messaging — How to Get Access

TikTok's Business Messaging API is **gated**: there is no self-serve
switch. TikTok must approve *our developer app* through a manual,
company-level security review before a single messaging call can
succeed. This document is the exact path, sourced from TikTok's
official documentation (see `docs/TIKTOK-RESEARCH.md` for the full
research and citations).

Until every applicable step below is complete, the TikTok channel in
Unified Omnichannel Inbox stays in its honest "Access restricted by
TikTok" state: the provider adapter is registered but every operation
returns the access error, and the dashboard offers no connect flow.

## Who this applies to

- **Us (the developer)**: we must hold an approved TikTok API for
  Business developer app and pass TikTok's reviews. One approval
  covers the whole SaaS — individual workspaces do not apply.
- **Each business that wants to connect (the TikTok account)** must:
  - be a TikTok account with **Advanced Access** entitlement or a
    **Verified Business Account (VBA)** — General accounts are
    ineligible (the account owner can upgrade the entitlement level in
    TikTok's business tools);
  - be **signed up outside the EEA, Switzerland and the UK** — accounts
    from those regions cannot use the API at all;
  - if signed up in the **US**, be served only after we also pass the
    US Data Security Review and sign the USDS Addendum;
  - have **direct messages set to accept messages from everyone** in
    the TikTok app before authorizing.

## Step-by-step

### 1. Create the TikTok API for Business developer app

1. Register as a developer on the TikTok API for Business portal and
   create an app: https://business-api.tiktok.com/portal/apps
2. In the app application, include the **"Ad Account Management"**,
   **"CTX Events Management"** and **"Measurement"** scopes of
   permission (TikTok's access guide names these as the prerequisite
   scopes for a Business Messaging application).
3. Wait for the app itself to be **approved** — an approved app and a
   valid app ID are prerequisites for the messaging review.
4. Put the app's credentials in the server environment (never in the
   browser, never in chat):

   ```
   TIKTOK_CLIENT_KEY=<app id from the developer portal>
   TIKTOK_CLIENT_SECRET=<app secret>
   # optional overrides:
   # TIKTOK_REDIRECT_URI=https://<your-domain>/api/oauth/tiktok/callback
   # TIKTOK_WEBHOOK_SECRET=
   ```

   Configuring these does **not** enable messaging — it only prepares
   the deployment. The Channels page will still show TikTok as
   restricted until step 2 completes.

### 2. Pass the Data Security & Privacy Review (required, all regions)

1. Read TikTok's review description on the official access page:
   https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3
2. Submit the **Data Security & Privacy Review intake form** linked
   from that page ("start your application by submitting your
   information through this form"). Declare the regions whose accounts
   you intend to serve — **exclude the US** unless you need US accounts
   now; including it adds the US review (step 3) and extends the
   timeline. US access can be added later.
3. TikTok initiates the review **within 10 working days** and emails
   the contact person the **DSPR DDQ** ("TikTok/ByteDance Third-Party
   Due Diligence Questionnaire").
4. Complete the questionnaire in detail and attach supporting security
   documentation if available — TikTok explicitly recommends an
   **ISO 27001 certificate, SOC 2 report, or a recent vulnerability
   scan / penetration test report** to speed approval.
5. Monitor the contact email and answer TikTok's follow-ups promptly.
   There is **no portal progress tracking** and support tickets cannot
   report review status; approval (or rejection) arrives by email.

### 3. US accounts only: US Data Security Review + USDS Addendum

Skip this step if no US-signed-up accounts will be served.

1. Expect the **USDS VAQ** questionnaire email from TikTok U.S. Data
   Security Inc. roughly a week after the DSPR DDQ. TikTok calls it
   the most critical piece for US access — **submit it by the deadline
   in the email**.
2. After passing, TikTok emails you to execute the **USDS Addendum**;
   sign it. Only then may the app call Business Messaging for
   US-registered accounts.
3. If the US review fails, TikTok notifies you by email; you may still
   complete the DSPR and serve non-US accounts.

### 4. After approval — what happens next (build checklist)

Approval is the trigger for a follow-up implementation phase (a normal
Phase 5/6-style build, estimated against the documented contract in
`docs/TIKTOK-RESEARCH.md` §4):

- [ ] Implement the TikTok-account OAuth flow with the existing
      `OAuthConnectionSession` pattern: authorization URL from the app
      settings → `auth_code` → `POST /open_api/v1.3/tt_user/oauth2/token/`
      → store access/refresh tokens **encrypted** via the existing
      channel-credential service; schedule refresh (access tokens live
      ~24 h, refresh tokens ~1 year).
- [ ] Register the webhook: `POST /business/webhook/update/` with
      `event_type: DIRECT_MESSAGE` and callback
      `{APP_URL}/api/webhooks/tiktok`; implement `verifyWebhook` with
      the documented `TikTok-Signature` HMAC-SHA256 scheme
      (timestamp + raw body, app secret, reject stale timestamps).
- [ ] Implement `parseWebhook` for `im_receive_msg` / `im_send_msg` /
      `im_referral_msg` (+ `im_receive_msg_eu`), normalized into the
      internal message format; channel identity = the account's
      app-scoped `open_id` (`business_id`).
- [ ] Implement `sendMessage` via `POST /business/message/send/`
      (text, image via `/business/message/media/upload/`, post
      shares), typing + mark-as-read sender actions, and media
      download via `/business/message/media/download/`.
- [ ] Enforce the documented messaging limits in the engine: never
      initiate conversations; 48-hour window rules (10 messages after
      a first inbound, unlimited while the user replies within 48 h,
      max 3 after the window lapses).
- [ ] Backfill via `/business/message/conversation/list/` and
      `/business/message/content/list/`.
- [ ] Replace the dashboard card's gated state with the real connect
      flow (account eligibility check via
      `/business/message/capabilities/get/` where applicable) and
      region warnings (EEA/CH/UK unsupported; US requires step 3).
- [ ] Fixture tests from the official webhook schema examples,
      labelled as doc examples — no live account exists until a real
      business connects.

## What NOT to do

- Do not use unofficial DM libraries, session cookies, or automation
  of the TikTok app/website — they violate TikTok's terms and are
  explicitly out of scope for this product.
- Do not buy "TikTok DM API access" from third-party resellers; access
  is granted to the developer app by TikTok's review only.
- Do not tell customers TikTok is supported before step 2 completes —
  the dashboard's gated state is the truthful status.
