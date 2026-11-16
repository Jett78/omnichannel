# WhatsApp integration

Status: **implemented (Phase 6)** — official **WhatsApp Business
Platform Cloud API** only (`graph.facebook.com`). No unofficial clients
(Baileys / whatsapp-web.js), no scraping.

Setup runbook: [`docs/WHATSAPP-SETUP.md`](../../docs/WHATSAPP-SETUP.md).

## What's here

- `whatsapp-provider.ts` — `IMessagingProvider` implementation
  (id `"whatsapp"`) plus the management API used by the connection
  service. Reuses the shared Meta Graph client
  (`integrations/meta/meta-graph-client.ts`) and config
  (`integrations/meta/meta-config.ts` → `getWhatsAppConfig()`).

## Behaviour

- **Webhooks**: `X-Hub-Signature-256` HMAC-SHA256 verified with
  `WHATSAPP_APP_SECRET ?? META_APP_SECRET`. Payloads are
  `whatsapp_business_account` objects; the channel is identified by
  `changes[].value.metadata.phone_number_id` (the `entry.id` is the
  WABA id, **not** the channel). All message types are parsed — text,
  media (as `whatsapp-media:<id>` attachment refs), location, contacts,
  reactions, orders, button/referral as SYSTEM, interactive replies as
  TEXT with the tapped title, and unknown types as SYSTEM
  (`Unsupported WhatsApp message type: <type>` — never dropped).
  Contact names come from the payload's `contacts[]`; the contact's
  phone is set from `wa_id` at ingest.
- **Statuses**: sent / delivered / read advance outbound messages
  monotonically; **failed** settles a QUEUED/SENT message FAILED with
  Meta's error text in `metadata.error` (never downgrades
  DELIVERED/READ).
- **Sending**: text (`preview_url` auto-detected), approved **template**
  messages (name/language/body params), image/video/audio/document by
  link or media id. Location sends are not supported from the composer.
  Read receipts via `markAsRead` (`status:"read"` + wamid).
  `sendTyping` is intentionally not implemented — WhatsApp typing
  requires a specific inbound message id the interface can't supply.
- **No list endpoints**: the Cloud API has no conversation/message list
  or profile-by-wa_id endpoints — `getConversations`/`getMessages`
  return `[]` and `getContactProfile` returns `{}` by design. Our
  database is the source of truth.
- **Media**: two-step download (GET media id → authenticated GET of the
  returned URL). The media worker stores bytes in S3 when configured;
  without S3 the bytes are fetched and discarded (never fake-stored).
- **Rules enforced in the engine** (not here): the 24-hour customer
  service window for free-form sends (templates exempt) and the
  template opt-in gate (`optInConfirmed` required, recorded on the
  message).

## Connection flows

`services/whatsapp-connection.service.ts`:
- **Embedded Signup** — FB JS SDK popup returns a `code`; the server
  exchanges it, verifies via `debug_token` that the token's granular
  scopes include the claimed WABA, lists numbers, subscribes the WABA,
  and parks the token in an encrypted `OAuthConnectionSession` for the
  number-selection step. Tokens never reach the browser.
- **Manual connect** — WABA id + phone number id + permanent
  system-user token, validated against the real WABA before storage.
- **Register / deregister** — `POST /{phone-number-id}/register` with
  the 6-digit two-step PIN (Meta errors, e.g. 133016 lockouts, surface
  verbatim).
- **Templates** — `GET /{waba-id}/message_templates`, APPROVED only,
  with BODY text + `{{n}}` placeholder count for the composer.

## Verification status

No real WhatsApp account exists in the development environment. The
provider is verified by `npm run test:phase6` (56 assertions) using
realistic webhook fixtures and an injected fake-fetch test double —
**not** against a live WABA.
