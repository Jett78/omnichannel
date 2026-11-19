# Telegram integration

Status: **implemented (Phase 10)** — real adapter against the official
Telegram Bot API.

- `telegram-client.ts` — Bot API client (injectable fetch for tests),
  `TelegramApiError` carrying Telegram's error_code.
- `telegram-provider.ts` — `IMessagingProvider` implementation:
  webhook update normalization (private + group chats, text / photo /
  video / audio / voice / document / sticker / location), text and
  media sends, media download via getFile, contact profile via
  getChat. Outbound media bridges the engine's upload-first contract
  with a Redis-stashed deferred upload (Telegram uploads by sending
  to a chat; see the provider's header comment).
- Connection is per-workspace by BotFather token:
  `services/telegram-connection.service.ts`; webhooks arrive at
  `app/api/webhooks/telegram/[channelId]` and are verified against
  the channel's per-bot secret token before persistence.

Setup and platform rules: `docs/TELEGRAM-SETUP.md`.
