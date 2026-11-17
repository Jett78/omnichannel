# Meta + WhatsApp setup — detailed step-by-step plan

Every step we actually did on 2026-11-17, from the very start: which URL to
open, what to click, and what to type. Follow it top to bottom to reproduce
the setup, or jump to the part you need.

**Key facts for our setup**

| Thing | Value |
|---|---|
| Our app (production) | https://omnichannel-nepal-tech.vercel.app |
| Our Channels page | https://omnichannel-nepal-tech.vercel.app/channels |
| Meta app name | OmniChannel |
| Meta App ID | `1090983867312567` |
| Meta app dashboard | https://developers.facebook.com/apps/1090983867312567 |
| Business portfolio | jet_deula |
| Business Settings | https://business.facebook.com/settings |
| WhatsApp Business Account (WABA) | "Jeet Deula", ID `3498072133703571` |
| Business phone number | +977 970-6391674 |
| **Phone number ID** (not the number!) | `1367670089770954` |
| System user | `omnichannel`, ID `61596462849605`, role Admin |
| Embedded Signup config ID (current) | `1154263387087462` |

Secrets (App Secret, tokens) are **never** written in this document. They
live in Vercel environment variables and in Meta's dashboards.

---

## Phase 1 — Create the Meta app

1. Open https://developers.facebook.com/apps → **Create App**.
2. Choose the app type that offers business use cases, name it **OmniChannel**.
3. On the app dashboard, under **Add use cases** (or "Customize"), add all
   three: **Messenger** ("Engage with customers on Messenger"), **Instagram**,
   and **WhatsApp** ("Connect with customers via WhatsApp" / WhatsApp
   Business). Each use case unlocks its own settings pages and permissions —
   there are no separate sidebar product pages; settings live *inside* each
   use case's Customize page.

## Phase 2 — Put the app credentials into our app (Vercel)

1. In the Meta app dashboard → **Settings → Basic**, note the **App ID** and
   **App Secret** (click Show, confirm with your Facebook password).
2. Open our project on Vercel → **Settings → Environment Variables** and set
   (Production + Preview):
   - `META_APP_ID` = `1090983867312567`
   - `META_APP_SECRET` = the App Secret from step 1
   - `META_WEBHOOK_VERIFY_TOKEN` = a long random string **we invent**
     (this is not from Meta — Meta will ask for it later and we must type the
     same value there; it is how Meta proves it is calling *our* webhook).
3. Redeploy the Vercel project so the new variables take effect
   (Deployments → ⋯ → Redeploy).

## Phase 3 — Facebook Login for Business settings

In the Meta app dashboard → **Facebook Login for Business**:

1. **Settings** → **Valid OAuth Redirect URIs** → add exactly:
   `https://omnichannel-nepal-tech.vercel.app/api/oauth/facebook/callback`
   → Save.
2. Same page → **Login with the JavaScript SDK** → set to **Yes**
   (without this, the WhatsApp connect popup fails with
   "JSSDK Option is Not Toggled"). If an **Allowed Domains** field appears,
   add `omnichannel-nepal-tech.vercel.app`.
3. **Configurations** → this is where Embedded Signup configurations live
   (see Phase 7).

## Phase 4 — Register the webhooks

Webhooks are configured **inside each use case**, not in Business Settings.

### Messenger

1. App dashboard → use case **Engage with customers on Messenger** →
   **Messenger settings / Webhooks** → Configure.
2. Callback URL: `https://omnichannel-nepal-tech.vercel.app/api/webhooks/facebook`
3. Verify token: the same value as `META_WEBHOOK_VERIFY_TOKEN` (Phase 2).
4. Subscribe fields: `messages`, `messaging_postbacks`,
   `message_deliveries`, `message_reads`.

### WhatsApp

1. App dashboard → **WhatsApp** use case → **API Setup** → Step 2
   "Configure webhooks" → Edit.
2. Callback URL: `https://omnichannel-nepal-tech.vercel.app/api/webhooks/whatsapp`
3. Verify token: same `META_WEBHOOK_VERIFY_TOKEN` value.
4. Subscribe the **`messages`** field (the field list has a Test button per
   field — used in Phase 8 for verification).

Handshake check: with the correct token Meta's dialog closes successfully;
our server echoes the challenge for the right token and answers 403 for a
wrong one.

## Phase 5 — Enable permissions inside each use case

If a permission is not enabled in its use case, connecting fails with
**"Invalid Scopes: …"**.

1. App dashboard → use case **Engage with customers on Messenger** →
   **Permissions** → enable `pages_read_engagement` (plus the other
   Messenger/Page permissions listed there that our connect requests).
2. Same idea for Instagram and WhatsApp use cases: enable the permissions
   listed on their Permissions pages (`whatsapp_business_messaging`,
   `whatsapp_business_management` for WhatsApp).

## Phase 6 — Connect a Facebook Page in OmniChannel

1. Open https://omnichannel-nepal-tech.vercel.app/channels and **check the
   workspace switcher first** — a channel is created inside whichever
   workspace is active. (Our WhatsApp channel accidentally landed in
   "Admin 2 Workspace" this way; the Facebook Pages are in "Admin
   Workspace".)
2. Facebook card → **Connect** → log in to Facebook → grant the permissions →
   select the Page(s) → confirm.
3. Result: the Page appears in the Connected list as **CONNECTED** (the Page
   access token is stored encrypted in our database, per workspace).
4. Test: send a message to the Page from another account → it appears in
   **Inbox** as an open conversation → reply from the Inbox → the reply
   arrives in Messenger marked sent/read.

## Phase 7 — WhatsApp Embedded Signup configuration

1. App dashboard → **Facebook Login for Business → Configurations** →
   **Create configuration**.
2. The variation **must include WhatsApp**. A configuration with variation
   **General** never shows a WhatsApp step and our signup ends with
   "Embedded Signup finished without returning a WhatsApp Business Account".
   (Our first config, `1051527517992614`, was General — wrong. The WhatsApp
   variation is offered only after starting **Tech Provider** enrollment.)
3. Permissions on the configuration: `whatsapp_business_messaging` +
   `whatsapp_business_management`; token type: system-user token.
4. Copy the configuration ID → Vercel env `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`
   (current value `1154263387087462`) → redeploy.
5. Expected result today: OmniChannel → Channels → WhatsApp →
   **Connect with Embedded Signup** opens the popup, but Meta stops it with
   **"Meta can't onboard customers right now"** — that is the Business
   Verification + Tech Provider gate (Phase 10), not a bug.

## Phase 8 — WhatsApp manual connect (system-user token)

This connects the WhatsApp account with a permanent token. It needs three
values: **WABA ID**, **Phone number ID**, **system-user token**.

### Step A — Find the WABA ID

Business Settings (https://business.facebook.com/settings) → **Accounts →
WhatsApp accounts** → click the account ("Jeet Deula") → the panel shows
**WhatsApp Business Account ID: `3498072133703571`**.

### Step B — Create the system user

1. Business Settings → **Users → System users** → **Add**.
2. Name: `omnichannel`. Role: **Admin** (the role cannot be changed later,
   and an Employee system user can never be given app permissions).
   → Create system user.

### Step C — Assign assets FROM THE SYSTEM USER'S PAGE (the big trap)

1. Still in **Users → System users**, click the `omnichannel` user.
2. Click **Assign assets** → asset type **Apps** → select **OmniChannel** →
   in the permissions column turn **Manage app** ON → **Assign assets**.
3. Click **Assign assets** again → asset type **WhatsApp accounts** →
   select **Jeet Deula** → **Full control** → **Assign assets**.
4. **Verify**: the system user's page must now LIST both assets under
   "Assigned assets". ⚠️ Assigning the user from the *app's* page instead
   shows "Full access" there but lands **nothing** on the system user
   (its page reads "No assets assigned") and Step D then fails.

### Step D — Generate the token

1. On the system user's page → **Generate token** (top right).
2. **Select app**: OmniChannel.
3. **Set expiration**: **Never**.
4. **Assign permissions**: tick `whatsapp_business_messaging` and
   `whatsapp_business_management` (and `business_management` if offered).
   If this step says **"No permissions available — Assign an app role to
   the system user"**, Step C did not land — redo it from the system user's
   page and check the verification in C.4.
5. **Generate token** → copy the token immediately — **it is shown only
   once**. Paste it only into the OmniChannel form in Step F (never into
   chat or a document).

### Step E — Find the Phone number ID

⚠️ The form needs the **Phone number ID**, which is NOT the phone number.
(Typing `9706391674` into that field was one of our failed attempts.)

- WhatsApp Manager: Business Settings → **Accounts → WhatsApp accounts** →
  **Jeet Deula** → **Phone numbers** — the ID is shown with the number, or
- API: `GET https://graph.facebook.com/v25.0/3498072133703571/phone_numbers`
  with the token returns `"id": "1367670089770954"` for +977 970-6391674.

### Step F — Connect in OmniChannel

1. Open https://omnichannel-nepal-tech.vercel.app/channels → check the
   workspace switcher is the workspace you want → scroll to the **WhatsApp**
   panel → the manual form ("Connect manually"):
   - **WhatsApp Business Account ID**: `3498072133703571`
   - **Phone number ID**: `1367670089770954`
   - **System-user access token**: paste the token from Step D
2. Click **Connect manually**. Our server verifies the token against the
   WABA, checks the number belongs to it, subscribes the app to the account,
   and stores the token encrypted.
3. Success = the channel appears as **CONNECTED** with name "Jeet Deula".

### Step G — Verify delivery (Meta → our server)

1. App dashboard → **WhatsApp → API Setup → Configure webhooks** → on the
   **`messages`** field click **Test** → **Send to server**.
2. The sample event must arrive on our server (it carries a fake number, so
   it correctly creates no conversation — it only proves delivery works,
   like the Messenger sample test).
3. Real messages: they start arriving only after the number is onboarded
   (Phase 10). Until then, sending a WhatsApp message to the number reaches
   the phone app only — see "messages not arriving" in troubleshooting.

## Phase 9 — Checking whether a number is "verified"

Two different statuses — do not mix them up:

- **Inside the WhatsApp Business app** (the number works on the phone):
  WhatsApp Manager → the account → Phone numbers shows it healthy.
- **On the API platform** (messages can flow to systems like ours):
  - App dashboard → **WhatsApp → API Setup**: this page lists only
    API-registered numbers. Ours shows none added = not API-registered.
  - API fields for our number today: `status: DISCONNECTED`,
    `code_verification_status: NOT_VERIFIED` (from
    `GET /{waba-id}/phone_numbers`).
  - These flip to CONNECTED / VERIFIED only through API registration of a
    fresh number, or Embedded Signup onboarding of an app number.

## Phase 10 — Remaining gates (needed to sell / use the real number)

1. **Business Verification** of the jet_deula portfolio: Business Settings →
   **Security Centre / Business info** → submit the registered business
   documents Meta asks for.
2. **Tech Provider enrollment** for the app (developers dashboard) — unlocks
   the WhatsApp Embedded Signup variation and onboarding of customers.
3. **App Review**: request Advanced Access for the WhatsApp (and Messenger)
   permissions, with screencasts of the working flows.
4. **Publish the app**: Meta warns that while the app is unpublished, no
   production webhook data is delivered.
5. **Data-deletion callback** URL in the app settings (required before
   public launch — see docs/META-APP-REVIEW.md).
6. After 1–4: redo Phase 7's Embedded Signup from OmniChannel with the
   business number → coexistence onboarding flips the number's API status
   (Phase 9) and its messages start arriving in the Inbox while the number
   keeps working in the phone app.

Alternative that works **today** without any verification: register a phone
number that has **never been on WhatsApp** in the dashboard (WhatsApp → API
Setup → Add phone number, verify by SMS/voice code, set a two-step PIN),
then connect it with Phase 8 (Steps A, E, F — the token from Step D works
as-is).

---

## Troubleshooting — every error we actually hit

| Error / symptom | Cause | Fix |
|---|---|---|
| "Invalid Scopes: pages_read_engagement" on Facebook connect | Permission not enabled in the use case | Phase 5 |
| "JSSDK Option is Not Toggled" in the signup popup | JS SDK login off | Phase 3, step 2 |
| "Embedded Signup finished without returning a WhatsApp Business Account" | Configuration variation is "General" | Phase 7, step 2 |
| "Meta can't onboard customers right now" | Tech Provider + Business Verification gate | Phase 10 |
| "No permissions available — Assign an app role to the system user" in the token wizard | Assets assigned from the app page, not the system user's page (or system user is Employee role) | Phase 8, Steps B–C |
| "Something went wrong" on Connect manually (attempt 1) | Phone **number** typed where Phone number **ID** belongs | Phase 8, Step E |
| "Something went wrong" on Connect manually (attempt 2) | Our bug: `listPhoneNumbers` requested the `messaging_limit` field, which Graph rejects with `(#100)` for app-type WABAs | Fixed in code 2026-11-17 (field removed; the mapping already treated it as optional) |
| "This phone number is already registered to a WhatsApp account" when adding the number in API Setup | The number lives in the WhatsApp Business app; it cannot also be API-registered directly | Coexistence via Embedded Signup (Phase 10) or use a fresh number |
| Channel CONNECTED but no messages in Inbox | Meta does not route a phone-app number's messages to the API until onboarding; also confirm the channel is in the workspace you are looking at | Phase 9 + Phase 10; check workspace switcher (Phase 6, step 1) |
| Token pasted somewhere unsafe (e.g. chat) | Token is a permanent credential | Revoke it: Business Settings → System users → Revoke tokens → redo Phase 8 Steps D + F with a fresh token |
