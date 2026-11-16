# WhatsApp Business Cloud API — setup guide (Phase 6)

This is the manual runbook for connecting a **real** WhatsApp Business
number to the Unified Omnichannel Inbox. The code (provider, connection
service, webhook pipeline, inbox composer) is implemented and verified
against realistic webhook fixtures and an injected HTTP test double
(`npm run test:phase6`). No real Meta app or WhatsApp account exists in
the development environment, so **every step below is a manual step you
(or your business admin) must do in Meta's consoles** before a live
number can connect. Nothing here is optional if you want production
messaging: Meta requires App Review for the WhatsApp permissions.

Only the official **WhatsApp Business Platform Cloud API**
(`graph.facebook.com`) is used. Unofficial clients (Baileys,
whatsapp-web.js, browser automation) are never used.

---

## 1. Create the Meta app and add the WhatsApp product

1. Go to [developers.facebook.com](https://developers.facebook.com) →
   **My Apps → Create App** → type **Business** (the same app used for
   Messenger/Instagram in Phase 5 can be reused).
2. Add the **WhatsApp** product to the app (App Dashboard → Add Product).
3. In **WhatsApp → API Setup** Meta creates a test WhatsApp Business
   Account (WABA) with a test phone number — usable immediately for
   development (see §9).
4. Note the **App ID** and **App Secret** (Settings → Basic). Set:
   - `META_APP_ID`, `META_APP_SECRET` — used for the Embedded Signup
     code exchange, `debug_token`, and as the fallback webhook
     signature secret.
   - `WHATSAPP_APP_SECRET` (optional) — a dedicated signature secret if
     you use a separate app for WhatsApp. Falls back to
     `META_APP_SECRET`.
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (optional) — the webhook verify
     token for the WhatsApp product. Falls back to
     `META_WEBHOOK_VERIFY_TOKEN`.

## 2. Embedded Signup configuration (Facebook Login for Business)

Embedded Signup is the in-dashboard "Connect with Embedded Signup"
flow: the agent clicks once, completes Meta's popup, and the number is
connected — no token copying.

1. In the app dashboard open **Facebook Login for Business → Settings**
   and create a **Configuration** for WhatsApp Embedded Signup:
   - Type: **WhatsApp Embedded Signup**.
   - Permissions requested: **`whatsapp_business_messaging`** and
     **`whatsapp_business_management`**.
2. Copy the **Configuration ID** and set
   `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID=<id>`.
3. The dashboard loads Meta's JS SDK on demand (only when the button is
   clicked) and calls `FB.login` with that `config_id`. The popup
   returns a short-lived `code`; our server exchanges it, then verifies
   with `debug_token` that the token's granular scopes actually include
   the WABA the popup reported — a signup that didn't share the WABA is
   rejected with a 403.
4. Without the config id (or the app id/secret), the Channels page says
   so plainly and points to manual connect; the API returns a 503
   naming the missing variables.

### App Review / Tech Provider requirements

To let *other businesses* connect their numbers through your app
(the SaaS case), Meta additionally requires:

- **Business Verification** for your own business (Business Settings →
  Business Info).
- **Advanced Access** for `whatsapp_business_messaging` and
  `whatsapp_business_management`, via **App Review**: submit screencasts
  showing Embedded Signup, receiving a message, replying, and sending a
  template from your app.
- If you onboard customers as a **Tech Provider / Solution Provider**,
  complete Meta's Tech Provider onboarding for the app. Until then,
  Embedded Signup only works for WABAs your own business controls
  (development mode / app roles).

## 3. Manual connect (system-user token)

For numbers you administer yourself, manual connect avoids Embedded
Signup entirely:

1. **Business Settings → Users → System Users** → add a system user
   (Admin), then **Add Assets**:
   - Apps → your app (full control), and
   - WhatsApp Accounts → the WABA.
2. **Generate New Token** for your app with permissions
   `whatsapp_business_messaging` + `whatsapp_business_management`.
   System-user tokens don't expire by default — treat the token like a
   password.
3. In the dashboard: Channels → WhatsApp panel → **Connect manually**:
   WABA ID, phone number ID (WhatsApp → API Setup lists both), and the
   token. The server validates the token by reading the WABA and its
   phone numbers **before** storing anything — a token that can't read
   the WABA is rejected with Meta's error. The token is then stored
   AES-256-GCM-encrypted and never shown again.
4. Webhook signature verification still needs `WHATSAPP_APP_SECRET` or
   `META_APP_SECRET` set on the server.

## 4. Register the webhook

1. **App Dashboard → WhatsApp → Configuration → Webhook**:
   - Callback URL: `{APP_URL}/api/webhooks/whatsapp`
     (e.g. `https://omnichannel.example.com/api/webhooks/whatsapp`)
   - Verify token: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
     (fallback `META_WEBHOOK_VERIFY_TOKEN`).
2. **Subscribe the `messages` field** for the webhook object.
3. The app also calls `POST /{waba-id}/subscribed_apps` during connect
   so the WABA itself is subscribed to the app — both are required.
   If that call fails during connect, the channel is still created but
   records `webhookSubscription: failed` and the dashboard warns that
   incoming messages may not arrive.
4. Our endpoint verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw
   body with the app secret) before recording anything.

## 5. Phone number registration + PIN (and the coexistence warning)

A number must be **registered** with the Cloud API before it can send
or receive:

- Dashboard: Channels → WhatsApp panel → **Register number** on the
  connected channel → enter the number's **6-digit two-step
  verification PIN** (set in WhatsApp Manager → Phone numbers →
  Two-step verification). The server calls
  `POST /{phone-number-id}/register` with that PIN.
- **Coexistence warning:** registering a number that is actively used
  in the **WhatsApp Business app** on a phone can disrupt that usage.
  Meta supports a coexistence setup for eligible Business-app numbers,
  but you must check the current rules in WhatsApp Manager for your
  number before registering. When in doubt, use a dedicated number for
  the API.
- Deregistering (`POST /{phone-number-id}/deregister`, exposed in the
  API) releases the number from the Cloud API.

## 6. Message templates

- Templates are created and approved in **WhatsApp Manager → Message
  Templates** (or via the API). Categories: **Utility**, **Marketing**,
  **Authentication**. Approval can take minutes to hours; rejected
  templates cannot be sent.
- The inbox only lists **APPROVED** templates
  (`GET /{waba-id}/message_templates`), extracting the BODY text and its
  `{{n}}` placeholder count for the composer.
- Templates are Meta's sanctioned way to message **outside** the
  24-hour window (§7) and to start conversations.
- **Pricing note:** WhatsApp charges per delivered template
  conversation (pricing varies by country and category; utility
  templates within the 24h service window are cheaper/free under
  current Meta pricing). Check Meta's current pricing page for your
  WABA's country before running campaigns — this app does not track
  per-message costs.

## 7. The 24-hour window + opt-in policy (enforced by this app)

- **24-hour customer service window:** free-form replies are only
  allowed within 24 hours of the customer's **most recent inbound
  message**. Outside it, our engine settles the send **FAILED**
  immediately (no API call) with the reason, and the inbox composer
  shows an advisory banner. Templates skip the window check because
  they are the sanctioned outside-window path.
- **Opt-in:** WhatsApp requires the customer to have opted in before a
  business sends template messages. **v1 consent gate (deliberate
  minimum):** the template composer requires the agent to tick *"The
  customer has opted in to receive WhatsApp messages from this
  business"* on every send; the API rejects template sends without
  `optInConfirmed: true`, and the confirmation + confirming user are
  recorded in the message metadata (`optInConfirmed`,
  `optInConfirmedBy`). There is intentionally **no CRM consent
  database yet** — if you need auditable per-contact consent records,
  build that before scaling template sends.

## 8. Media handling

- Inbound media arrives as media IDs, never public URLs. The media
  worker resolves each ID through the two-step Cloud API download
  (lookup → authenticated GET).
- If S3 storage is configured (`S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, optional `S3_ENDPOINT`/`S3_REGION`), bytes
  are stored at `whatsapp/{messageId}/{attachmentId}` and the storage
  key recorded. **If S3 is not configured, the bytes are fetched and
  then discarded** (storage key stays null) and the worker logs this
  plainly — configure S3 before relying on inbound media in
  production.

## 9. Test numbers

- The WhatsApp product's **API Setup** page provides a free **test
  number** + test WABA. You can message up to 5 recipient numbers you
  add to the test list. Test numbers are ideal for verifying the
  webhook, the 24h window behaviour and template sends (Meta provides
  the pre-approved `hello_world` template) before App Review.
- Test numbers cannot message arbitrary customers and have sending
  limits — they are for development only.

## 10. Troubleshooting

| Symptom / error | Meaning | Fix |
|---|---|---|
| `(#131047)` Re-engagement message | Free-form message sent outside the 24-hour window (or to a user who never messaged you) | Wait for the customer to message you, or send an approved template with confirmed opt-in |
| `132xxx` errors (e.g. 132000, 132001, 132005) | Template problem: doesn't exist for the language, paused/low-quality, or parameter mismatch | Check the template name + language in WhatsApp Manager, match the `{{n}}` parameter count, check quality rating |
| `(#133016)` Account temporarily locked | Too many failed registration/PIN attempts | Wait for the lockout to expire (up to 24h), then register with the correct 6-digit PIN |
| `(#613)` API rate limit / calls too fast | WABA throughput or app-level rate limiting | Back off, spread sends, request a throughput upgrade in WhatsApp Manager |
| `(#131030)` Recipient not in allowed list | Test number restriction | Add the recipient to the test number's allowed list, or use a registered production number |
| `(#131031)` Account restricted / locked | WABA integrity lock (policy) | Resolve the restriction in Business Settings / WhatsApp Manager |
| `(#190)` Invalid access token | System-user token revoked, or wrong asset assignment | Regenerate the token and re-check asset assignments (§3) |
| Webhook not arriving | WABA not subscribed, wrong verify token, or `messages` field not subscribed | Re-check §4; the Channels page flags channels whose `subscribed_apps` call failed |
| 503 "not configured" from connect endpoints | Missing env vars on the server | The error names them: `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` (Embedded Signup) or the app secret (webhooks) |

## 11. What is implemented vs. still manual

Implemented in code (Phase 6): Cloud API provider (send text/template/
media, read receipts, media download), Embedded Signup + manual
connection flows, phone registration/deregistration, template listing,
webhook ingest + delivery-status pipeline, 24h window + opt-in
enforcement, inbox template composer.

Still manual (cannot be done from code): creating the Meta app and
WhatsApp product, Business Verification, App Review for Advanced
Access, creating/approving templates, setting the two-step
verification PIN, and adding production phone numbers in Meta's
consoles.
