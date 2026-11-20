# Outgoing Webhooks (Phase 12)

Workspace admins can register HTTP endpoints that receive product
events as signed JSON POSTs — the same idea as Chatwoot's automation
webhooks. Use them to connect Zapier, Make, a CRM, a spreadsheet or
your own server.

Manage them in **Settings → Outgoing webhooks** (Owner/Admin only).

## Events

| Event | Fires when |
| --- | --- |
| `conversation.created` | A customer starts a new conversation on any channel |
| `conversation.resolved` | An agent resolves a conversation |
| `conversation.reopened` | A resolved conversation is reopened (by an agent, or because the customer wrote again) |
| `conversation.assigned` | A conversation is assigned or unassigned |
| `message.created` | A message is created — inbound from the customer, or an agent reply (check `data.message.direction`) |
| `webhook.test` | The **Test** button in Settings (not subscribable; sent to that one webhook only) |

Private notes and system/activity messages are **never** sent.

## Delivery format

Every delivery is a POST with `Content-Type: application/json`:

```json
{
  "id": "0f6c…(delivery uuid)",
  "event": "message.created",
  "timestamp": "2026-11-20T07:00:00.000Z",
  "data": {
    "workspace": { "id": "…", "name": "NepalTech Workspace" },
    "conversation": {
      "id": "…",
      "status": "OPEN",
      "priority": null,
      "assigneeId": null,
      "externalThreadId": "…",
      "createdAt": "…",
      "channel": { "provider": "facebook", "displayName": "Biolife MarketPlace" },
      "contact": { "id": "…", "name": "…", "email": null, "phone": null }
    },
    "message": {
      "id": "…",
      "direction": "INBOUND",
      "type": "TEXT",
      "body": "Hello!",
      "senderType": "CONTACT",
      "status": "RECEIVED",
      "externalMessageId": "…",
      "createdAt": "…",
      "attachments": [{ "fileName": null, "mimeType": null, "size": null }]
    }
  }
}
```

`data.message` is present only for `message.created`. Headers:

- `x-uoi-event` — the event name
- `x-uoi-delivery` — the delivery id (same as the body's `id`)
- `x-uoi-signature` — HMAC-SHA256 (hex) of the **raw request body**,
  keyed with the webhook's signing secret (shown in Settings when
  you edit the webhook)

Verify a delivery (Node.js):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function isGenuine(rawBody, signatureHeader, secret) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Use the raw body bytes — re-serializing parsed JSON can change the
bytes and break the signature.

## Delivery behaviour

- The worker delivers within seconds; expect a `2xx` response.
- Non-2xx responses, timeouts (10s) and network errors are retried
  up to **3 attempts** with exponential backoff. Redirects are not
  followed (a 3xx counts as a failed attempt).
- Every attempt is recorded; Settings shows the most recent result
  on each webhook ("Last delivery").
- Disabling a webhook stops deliveries immediately; deleting it
  removes its delivery history too.
- Events are snapshots taken when the event happened — a retried
  delivery carries the original data, not the current state.

## URL safety rules

Because our server POSTs to admin-supplied URLs, targets are
restricted (SSRF protection), checked when the webhook is saved
**and** again at delivery time:

- http/https only; **HTTPS is required in production**.
- The host must resolve only to **public** IP addresses — private,
  loopback, link-local (including cloud metadata addresses),
  multicast and documentation ranges are rejected.
- Outside production, literal loopback URLs (e.g.
  `http://127.0.0.1:4000/hook`) are allowed for local testing.

## Zapier / Make quick start

1. In Zapier, create a Zap with the **Webhooks by Zapier → Catch
   Hook** trigger; copy the hook URL.
2. Here: Settings → Outgoing webhooks → Add webhook → paste the
   URL, pick `message.created` (and any others), save.
3. Click **Test** — Zapier should show the test payload; then send
   a real message to one of your channels to see a live event.

Make works the same way with a **Webhooks → Custom webhook** module.
