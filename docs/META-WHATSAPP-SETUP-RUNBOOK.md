# Meta + WhatsApp setup runbook

What was actually done on 2026-11-17 to connect Messenger and WhatsApp to
OmniChannel, in the order that works. Keep this with the project — every trap
below was hit live and cost time.

Production app: https://omnichannel-nepal-tech.vercel.app
Meta app: **OmniChannel**, App ID `1090983867312567`, business portfolio **jet_deula**.

---

## Part 1 — Meta app setup (done once, by the platform owner)

1. Create the app at developers.facebook.com and add the use cases:
   **Messenger**, **Instagram**, **WhatsApp**.
2. Set the app credentials as environment variables on the web deployment
   (Vercel): `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`
   (a long random token we generate ourselves — the same value is typed into
   Meta's webhook config in step 4). Never paste the App Secret or any token
   into chat; use the dashboards / secure forms.
3. **Facebook Login for Business → Settings**: register the OAuth redirect URI
   `https://omnichannel-nepal-tech.vercel.app/api/oauth/facebook/callback`
   and turn **"Login with the JavaScript SDK" = Yes** (without it the connect
   popup dies with "JSSDK Option is Not Toggled").
4. Register webhooks (inside each use case's settings):
   - Messenger → callback `https://omnichannel-nepal-tech.vercel.app/api/webhooks/facebook`
   - WhatsApp → callback `https://omnichannel-nepal-tech.vercel.app/api/webhooks/whatsapp`
   - Verify token for both: the `META_WEBHOOK_VERIFY_TOKEN` value.
   - Subscribe the **`messages`** field (and for Messenger also
     `messaging_postbacks`, `message_deliveries`, `message_reads`).
5. **Enable every permission the connect flow requests inside its use case**
   (Use cases → the use case → Permissions). If a permission is missing there,
   connecting fails with "Invalid Scopes: …" — e.g. `pages_read_engagement`
   had to be enabled under the Messenger use case.
6. Verify the webhook handshake before connecting anything: a GET with the
   correct verify token returns the challenge; a wrong token returns 403.

### Connecting a Facebook Page (per workspace)

Channels → Facebook → Connect → Facebook login → select the Page(s) → done.
The Page token is stored encrypted in the database (per workspace). Test with
a real message to the Page: it must appear in the Inbox, and a reply from the
Inbox must arrive in Messenger. (Meta's dashboard "Send to server" sample is
only a transport test — it carries a fake Page id and is ignored on purpose.)

---

## Part 2 — WhatsApp manual connect (system-user token)

Use this when Embedded Signup is unavailable (see Part 3). You need three
values: **WABA ID**, **Phone number ID**, **system-user token**.

1. **WABA ID**: Business Settings → Accounts → WhatsApp accounts → the
   account (e.g. "Jeet Deula", ID `3498072133703571`).
2. **Create a system user**: Business Settings → Users → System users → Add →
   name it (e.g. `omnichannel`) → role **Admin** (an Employee system user can
   never be granted app permissions).
3. **Assign assets FROM THE SYSTEM USER'S OWN PAGE** — this is the trap.
   Open the system user → **Assign assets**:
   - **Apps** → OmniChannel → turn **Manage app** ON → Assign.
   - **WhatsApp accounts** → the WABA → **Full control** → Assign.
   Then confirm the system user's page **lists both assets**. Assigning from
   the app's page instead shows "Full access" there but lands nothing on the
   system user, and token generation then fails with
   "No permissions available — Assign an app role to the system user".
4. **Generate the token** from the system user page → Generate token → app
   **OmniChannel** → expiration **Never** → permissions
   `whatsapp_business_messaging` + `whatsapp_business_management`
   (+ `business_management` if offered) → Generate. **Copy it immediately —
   it is shown once.** Paste it only into the OmniChannel Channels form.
5. **Phone number ID** (NOT the phone number itself): WhatsApp Manager → the
   account → Phone numbers shows it; or `GET /{waba-id}/phone_numbers`.
   Example: number +977 970-6391674 → Phone number ID `1367670089770954`.
6. **Connect**: OmniChannel → Channels → WhatsApp panel → manual form →
   WABA ID + Phone number ID + token → **Connect manually**. The server
   verifies the token against the WABA, matches the number, and subscribes
   the app to the account (`subscribed_apps`).
7. **Verify**: Channels shows the channel CONNECTED; in the app dashboard's
   webhook panel, the `messages` field **Test → Send to server** sample must
   arrive on our server (proves Meta → OmniChannel delivery end to end).

> Security: if a token was ever pasted somewhere it shouldn't be (e.g. a
> chat), revoke it (Business Settings → System users → Revoke tokens) and
> generate a fresh one, then reconnect with the new token.

---

## Part 3 — What is still gated (for the real business number / selling)

- **Embedded Signup** needs a Facebook Login for Business *configuration*
  whose variation includes WhatsApp. A "General" variation shows no WhatsApp
  step and the signup ends with "finished without returning a WhatsApp
  Business Account". Current config ID: `1154263387087462`
  (env `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`).
- With a correct config the popup still stops at **"Meta can't onboard
  customers right now"** until the portfolio completes **Business
  Verification** and the app completes **Tech Provider** enrollment +
  **App Review** for the WhatsApp permissions. This is Meta's eligibility
  gate, not a bug — Chatwoot and other platforms sit behind the same gate
  with the same architecture (platform-level App ID + configuration ID).
- **A number registered in the WhatsApp Business phone app cannot be
  registered through the API** ("This phone number is already registered to
  a WhatsApp account") and **its messages are not delivered to the API**
  until it is onboarded through Embedded Signup (coexistence). Manual
  connect (Part 2) links such an account and the channel shows CONNECTED,
  but message flow starts only after onboarding. A number that has never
  been on WhatsApp can instead be registered directly in the dashboard
  (WhatsApp → API Setup → Add phone number) and then connected with Part 2 —
  that path works today.
- The app must also be **published** (Meta warns that an unpublished app
  receives no production webhook data) and needs a **data-deletion
  callback** before public launch (see docs/META-APP-REVIEW.md).

## Checking a number's verification status

- **App-side status**: WhatsApp Manager → the account → Phone numbers
  (shows the number working inside the WhatsApp Business app).
- **API-side status**: the app dashboard's WhatsApp → API Setup page lists
  only API-registered numbers. Via the API, `GET /{waba-id}/phone_numbers`
  reports `status` and `code_verification_status` — for the phone-app number
  above these read `DISCONNECTED` / `NOT_VERIFIED`, which is the platform
  state that blocks message delivery until onboarding.

## App-side gotcha fixed 2026-11-17

`listPhoneNumbers` must not request the `messaging_limit` field: the Graph
API rejects the whole request with `(#100) Tried accessing nonexisting field
(messaging_limit)` for app-type (SMB) WABAs, which surfaced in the UI as a
generic "Something went wrong" on manual connect.
