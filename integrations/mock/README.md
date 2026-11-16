# Mock integration (dev/test only)

Status: **implemented (Phase 4)** — a fake `IMessagingProvider` for local
development and automated tests. It makes **no network calls** and is not
connected to any social platform; messages through it are simulated and
must never be presented as real social media messages.

- Registered in `integrations/registry.ts` only when
  `NODE_ENV !== "production"` or `ENABLE_MOCK_PROVIDER=true`.
- Connect: `POST /api/workspaces/[workspaceId]/channels/mock-connect`
  (or the "Connect mock channel (dev only)" button on the Channels page).
- Webhooks: `POST /api/webhooks/mock` with header
  `x-mock-signature: $MOCK_WEBHOOK_SECRET` (default `dev-mock-secret`).
- Simulate an inbound customer message: `npm run simulate:inbound`.
- Test hook: an outbound message whose content contains `[fail]` makes
  `sendMessage` throw, exercising the BullMQ retry → FAILED path.
