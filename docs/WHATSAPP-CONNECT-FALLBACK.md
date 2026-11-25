# WhatsApp manual connect — messaging-only token fallback (2026-11-25)

## Problem

Connecting a WhatsApp **test number** with the temporary token from the
Meta dashboard's "Try it out" page failed with a generic
"Something went wrong". Production runtime logs showed the real cause:

```
MetaGraphError: Authorization Error (OAuthException, code 100)
  at provider.getWaba → whatsappConnectionService.connectManually
```

The dashboard-generated token carries the messaging scope only. It can
send/receive for its number, but Meta refuses WABA management reads
(`GET /{waba-id}`, `GET /{waba-id}/phone_numbers`) without
`whatsapp_business_management`. Manual connect validated the token with
exactly those reads, and the raw `MetaGraphError` fell into the API
route's catch-all, hiding the reason from the UI.

## Fix

`services/whatsapp-connection.service.ts`:

- New `resolveWabaAndPhoneNumber()` helper used by both
  `connectManually` and `updateManualCredentials`. Strict path first
  (WABA read + number list). On a Graph **authorization** error
  (OAuthException, code 100/200/10) it falls back to reading the phone
  number node directly — allowed with the messaging scope — and takes
  the WABA name from the number's verified name.
- Any other Graph failure is converted to an `AppError.badRequest`
  carrying Meta's own message, so the connect dialog shows the real
  reason instead of "Something went wrong".

`integrations/whatsapp/whatsapp-provider.ts`:

- New `getPhoneNumber(phoneNumberId, accessToken)` — single-number
  read with the same field mapping as `listPhoneNumbers`.

## Tests

Phase-6 suite §6c (fake Graph: WABA read returns the exact
code-100 OAuthException; the number node reads fine):

- test number connects via the fallback, channel CONNECTED with the
  WABA id + verified name in config, token stored;
- a number the token cannot read is rejected and creates no channel.

Suite: **81 passed, 0 failed** (was 77).

## Notes for operators

- Dashboard test tokens expire (~24 h). When sends start failing,
  generate a fresh token and paste it via the channel's Edit
  (update credentials) — the same fallback validates it.
- Webhook subscription (`subscribed_apps`) also needs the management
  scope; with a messaging-only token it stays best-effort and the
  connect result carries the subscription warning. The app-level
  webhook configured in the Meta app dashboard still delivers events
  for the test WABA.
