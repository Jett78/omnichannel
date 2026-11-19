# Telegram channel — setup (Phase 10)

Telegram is the simplest channel in this product: the official
**Telegram Bot API** is fully self-serve. There is no developer app,
no app review, no business verification and no messaging window.

## How connection works

Each workspace connects **its own bot**:

1. In Telegram, message **@BotFather** and send `/newbot`.
2. Choose a display name and a username ending in `bot`.
3. BotFather replies with a **bot token** (looks like
   `123456789:AA…`). Treat it like a password — anyone holding it
   controls the bot.
4. In this app: **Channels → Telegram → Connect now**, paste the
   token. The server validates it with Telegram (`getMe`) before
   storing it **encrypted**, then registers this deployment's
   webhook for that bot (`setWebhook`) with a per-bot secret token.

A workspace can connect several bots; each bot is its own channel.

## Platform rules (Telegram's, not ours)

- **Bots cannot start conversations.** A customer must message the
  bot first (or the bot must be in their group). After that, replies
  from the inbox can be sent at any time — there is **no 24-hour
  window**. If a user blocks the bot, sends fail with Telegram's
  error and are shown as failed.
- **Groups:** the bot can be added to groups. By default BotFather
  bots run with *privacy mode* on: in groups they only see commands
  and replies to the bot. Disable privacy mode in BotFather
  (`/setprivacy`) if the bot should receive every group message.
  Each sender in a group gets their own inbox thread; replies go to
  the group.
- **No history.** The Bot API has no message-history endpoints, so
  there is nothing to import — conversations start when the first
  message arrives after connecting.
- **Text limit:** one Telegram message holds up to 4096 characters;
  longer inbox replies are rejected by Telegram and marked failed.
- **Avatars:** Telegram exposes user photos only as files behind
  the bot token, so contacts show initials (or a name) in the inbox
  rather than a photo.

## Rotating a token

BotFather → `/mybots` → your bot → **API Token → Revoke current
token** issues a fresh token and kills the old one. Then in this
app: Channels → the bot's **Reconnect** → paste the new token. The
stored credential is replaced and the webhook re-registered with a
new secret.

## Disconnecting

Channels → **Disconnect** deletes the webhook at Telegram
(`deleteWebhook`), deletes the stored token, and keeps the
conversation history.

## Troubleshooting

- *"Telegram rejected this bot token"* — the token is wrong or was
  revoked. Copy it exactly from BotFather (or revoke + re-issue).
- *Connected but no messages arrive* — the webhook registration
  warning appears at connect time if `setWebhook` failed; use
  **Reconnect** to register it again. Also check the customer
  actually messaged the bot (not the bot's BotFather page), and for
  groups, the privacy-mode note above.
- *Sends failing with 403* — the user blocked the bot, or (groups)
  the bot was removed from the group.
