# TikTok integration

Status: **access-gated scaffold (Phase 7)** — the provider is
registered, but TikTok has not approved this deployment, so nothing
operational is implemented and nothing is faked.

## Why gated

TikTok's Business Messaging API (TikTok API for Business v1.3) is real
and documented, but it is not self-serve: the developer must pass
TikTok's manual **Data Security & Privacy Review** (plus the **US Data
Security Review** + USDS Addendum for US-registered accounts) before
any messaging call can succeed, and only TikTok accounts with
**Advanced Access** or **Verified Business Account** status are
eligible. Accounts signed up in the EEA, Switzerland or the UK are
excluded entirely. Full evidence: `docs/TIKTOK-RESEARCH.md`.
Approval steps: `docs/TIKTOK-ACCESS.md`.

## What exists here

- `tiktok-config.ts` — env-driven configuration
  (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, optional
  `TIKTOK_REDIRECT_URI`, `TIKTOK_WEBHOOK_SECRET`), read lazily like
  the Meta config. `getTikTokConfig()` throws a 503 naming missing
  variables; `getTikTokAccessState()` reports the honest dashboard
  state (`configured` + always-`gated`, with the reason). Also defines
  `TikTokAccessError` (`TIKTOK_ACCESS_REQUIRED`, 403).
- `tiktok-provider.ts` — `TikTokProvider implements IMessagingProvider`
  as a deliberate scaffold: every operational method throws
  `TikTokAccessError`, `verifyWebhook` returns `false` (so the webhook
  route rejects posts with 401 rather than trusting events we cannot
  authenticate), and capabilities are all off. **No TikTok endpoint is
  called and no payload is parsed.**
- Registered unconditionally in `integrations/registry.ts`, like the
  Meta/WhatsApp adapters.
- The Channels dashboard shows TikTok as "Access restricted by
  TikTok" with a dialog listing the approval steps — there is no
  connect button, because connecting is impossible until TikTok
  approves the app.
- The `TIKTOK` value has existed in the Prisma `Provider` enum since
  the Phase 1 init migration, so channels can be stored the day access
  lands; no migration was needed in Phase 7.

## When access is granted

Replace `tiktok-provider.ts`'s gated methods with a real adapter built
to the documented contract (research doc §4): TikTok-account OAuth via
the `OAuthConnectionSession` pattern, `TikTok-Signature` HMAC
verification, `im_receive_msg` parsing, `/business/message/send/`,
48-hour window enforcement in the messaging engine, and backfill from
the conversation/content list endpoints. The checklist lives at the
end of `docs/TIKTOK-ACCESS.md`.
