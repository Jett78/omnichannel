# Unified Omnichannel Inbox

A multi-tenant SaaS that connects a business's messaging accounts — Facebook Messenger,
Instagram, WhatsApp, Telegram (X and TikTok as later spikes) — into one agent inbox.
Architecture: [`docs/PHASE-0-ARCHITECTURE.md`](docs/PHASE-0-ARCHITECTURE.md).

**Current status: Phase 8 — X (Twitter) Direct Messages implemented per research verdict (A) SELF-SERVE.**
Better Auth (email/password, database sessions), workspace management with
role-based permissions, teams, conversation assignments and notifications are
implemented and tested, and the full SaaS shell (sidebar, top bar, overview,
3-column inbox, contacts, channels, team, automation, analytics, settings) is
built. Phase 4 added the real messaging engine (webhook ingest → normalized
messages → Socket.IO realtime → agent replies through BullMQ), a real-data
inbox, and a **dev-only mock provider** for exercising the loop. Phase 5 adds
the first real platform adapters — Facebook Messenger and Instagram — against
the official Meta APIs (see below). Phase 6 adds WhatsApp on the official
Cloud API (see below). Phase 7 researched TikTok and shipped access-gated
scaffolding only — TikTok's Business Messaging API requires TikTok's own
approval before it can be called (see below). Phase 8 adds X Direct
Messages on the official X API v2 — research found it self-serve on
pay-per-use pricing, so it shipped as a full implementation (see
below). Remaining adapters (Telegram, …) plug into the same
`IMessagingProvider` contract in later phases.

## X integration (Phase 8)

- **Research verdict: (A) SELF-SERVE (paid, pay-per-use).** Since
  6 Feb 2026 the X API is pay-per-usage with prepaid credits — no
  subscriptions, no manual product approval for DMs. The DM endpoints
  (X API v2), OAuth 2.0 scopes (`dm.read`/`dm.write`) and the X
  Activity API webhooks are documented and available to any app with
  an approved developer account and credits: DM reads **$0.010/resource**,
  DM sends **$0.015/request**, `dm.received` webhook events
  **$0.010/event**. Evidence and citations:
  [`docs/X-RESEARCH.md`](docs/X-RESEARCH.md); activation playbook:
  [`docs/X-ACCESS.md`](docs/X-ACCESS.md).
- **What shipped**: `integrations/x/` (config, typed API client, pure
  webhook helpers, provider), an OAuth 2.0 + PKCE connect flow on the
  Phase 5 session pattern (tokens encrypted, never in the browser),
  CRC + signature-verified webhooks (XAA `dm.received`; legacy AAA
  payloads also parsed), per-account XAA subscriptions recorded
  honestly on the channel, and a working **token-refresh chain** —
  X access tokens live 2 hours and refresh tokens rotate, so the
  previously-stub processor now refreshes, persists rotated tokens,
  re-arms itself, and marks channels EXPIRED when a refresh token is
  rejected. Platform rules are surfaced, never faked: recipient DM
  settings 403s land on the message as FAILED with X's own error text;
  history is 30 days; outbound media is not wired (needs a
  pre-uploaded `media_id`) and fails with a clear error.
- **Tests**: `npm run test:phase8` (config states, CRC/signature,
  OAuth round-trip, provider + pipeline against a labelled fake-fetch
  double using official-doc payload shapes, token-refresh chain,
  cross-workspace isolation) + Phase 2/4/5/6/7 regressions. **No real
  X account, app, credits or network calls were used.**

## TikTok integration (Phase 7) — access-gated scaffolding

- **Research verdict: GATED.** TikTok's Business Messaging API (TikTok API
  for Business v1.3) is real and documented, but not self-serve: the
  developer must pass TikTok's manual **Data Security & Privacy Review**
  (plus the **US Data Security Review** + USDS Addendum for US-registered
  accounts) before any messaging call can succeed, and only **Advanced
  Access / Verified Business Accounts** are eligible — accounts signed up
  in the EEA, Switzerland or the UK are excluded entirely. Evidence and
  citations: [`docs/TIKTOK-RESEARCH.md`](docs/TIKTOK-RESEARCH.md);
  approval playbook: [`docs/TIKTOK-ACCESS.md`](docs/TIKTOK-ACCESS.md).
- **What shipped**: env config (`integrations/tiktok/tiktok-config.ts`), a
  registered provider adapter whose operational methods all throw
  `TikTokAccessError` and whose `verifyWebhook` returns false, and a
  Channels card that honestly shows "Access restricted by TikTok" with
  the approval steps — **no connect flow, no endpoint calls, no parsed
  payloads, nothing faked**. Setting `TIKTOK_CLIENT_KEY` /
  `TIKTOK_CLIENT_SECRET` prepares the deployment; it does not grant
  access.
- **Tests**: `npm run test:phase7` (config states, gated provider
  behaviour, webhook pipeline records the access failure terminally,
  workspace scoping) + Phase 2/4/5/6 regressions.

## WhatsApp integration (Phase 6)

- **Provider** (`integrations/whatsapp/whatsapp-provider.ts`): official
  WhatsApp Business Platform **Cloud API** only — text/template/media sends,
  read receipts, two-step media download, full webhook parsing (all message
  types; unknown types surface as SYSTEM, never dropped) and delivery
  statuses including **failed** receipts with Meta's error text.
- **Connections** (`services/whatsapp-connection.service.ts`): **Embedded
  Signup** (FB JS SDK popup → server-side code exchange → `debug_token`
  granular-scope verification → number picker; tokens never reach the
  browser) and **manual connect** (system-user token validated against the
  real WABA before encrypted storage), plus phone **registration** with the
  6-digit PIN and APPROVED-template listing for the composer.
- **Platform rules enforced in the engine**: the **24-hour customer service
  window** for free-form sends (templates are the sanctioned outside-window
  path), and a **template opt-in gate** — template sends require
  `optInConfirmed` and record who confirmed (v1 consent minimum; no CRM
  consent database yet).
- **Media**: inbound media IDs are downloaded by the media worker and
  stored in S3 **when configured**; without S3 the bytes are fetched and
  discarded with a plain log line — never fake-stored.
- **Honest status**: no real WhatsApp account exists in the development
  environment; verification is fixtures + an injected fake-fetch test double
  (`npm run test:phase6`, 56 assertions + Phase 2/4/5 regressions). The
  manual setup (Meta app, Embedded Signup configuration, App Review,
  templates, PIN) is documented in
  [`docs/WHATSAPP-SETUP.md`](docs/WHATSAPP-SETUP.md).

## Meta integration (Phase 5)

- **Facebook Messenger** (`integrations/meta/facebook-provider.ts`): Facebook
  Login OAuth (code → user token → long-lived token), Page picker from
  `/me/accounts` (MANAGE/MODERATE task required), Page token stored encrypted,
  webhook subscription via `/{page-id}/subscribed_apps`, Send API replies,
  delivery/read receipts.
- **Instagram** (`integrations/meta/instagram-provider.ts`): the **Instagram
  API with Instagram Login** model (no Facebook Page required) — OAuth at
  `instagram.com/oauth/authorize`, tokens via `api.instagram.com` /
  `graph.instagram.com`, long-lived tokens refreshed with
  `ig_refresh_token`. Only professional accounts (Business/Creator) are
  eligible; personal accounts are rejected with a clear reason.
- **Connection flow** (`services/meta-connection.service.ts`): an
  `OAuthConnectionSession` (state hash + AES-256-GCM-encrypted payload,
  15-minute TTL, single-use) bridges the OAuth redirect; the dashboard only
  ever sees sanitized account metadata — **tokens never reach the browser**.
  A failed webhook subscription keeps the channel but surfaces a
  `subscriptionWarning` instead of pretending everything worked.
- **Platform rules enforced in the engine**: Meta's **24h messaging window**
  (out-of-window sends settle FAILED before any API call), delivery/read
  receipts advance outbound statuses monotonically (SENT → DELIVERED → READ,
  watermark updates supported), webhook signatures verified with
  HMAC-SHA256 per product secret, tokens sent only as Bearer headers.
- **Honest status**: no real Meta app/account exists in the development
  environment, so the integration is verified against payload fixtures and
  an injected HTTP test double (`npm run test:phase5`, 56 assertions +
  Phase 2/4 regressions) — **not** against a live Meta account. The manual
  steps still required (app creation, Advanced Access/App Review, Business
  Verification, data-deletion callback TODO) are documented in
  [`docs/META-APP-REVIEW.md`](docs/META-APP-REVIEW.md). Without the `META_*` /
  `INSTAGRAM_*` env vars, the connect flow returns a clear 503 naming the
  missing variables and the Channels page explains exactly what to set.

## Messaging engine (Phase 4)

- **Provider interface v2** (`integrations/types.ts`): `connectAccount`,
  `disconnectAccount`, `sendMessage`, `getConversations`, `getMessages`,
  `verifyWebhook`, `parseWebhook` (+ optional OAuth helpers). Everything above the
  adapters speaks one canonical shape, `UnifiedMessage` (`types/messaging.ts`);
  platform specifics live in `Message.metadata` (new `Json?` column).
- **Ingest:** `POST /api/webhooks/[provider]` verifies the provider signature,
  stores the raw `WebhookEvent`, ACKs fast and enqueues a BullMQ **webhook** job.
  The worker parses the payload and calls `messagingService.ingestInboundMessage`,
  which resolves/creates the contact + channel identity, find-or-creates the
  conversation (a new inbound **reopens** a RESOLVED one) and stores the message
  **idempotently** on `[conversationId, externalMessageId]` — redeliveries never
  duplicate messages or inflate `unreadCount`.
- **Outbound:** replies are stored as `QUEUED` and sent by the **outbound** worker
  through the provider adapter (3 attempts, exponential backoff) → `SENT` with the
  provider's external id, or `FAILED` with the error in `metadata.error`.
- **Conversation ops** (`services/conversation.service.ts`, all workspace- and
  permission-checked): list/search with cursor pagination, mark-as-read, assign
  (assignment history + notification + audit log), resolve/reopen with status
  guards, internal notes (`PRIVATE_NOTE`, never sent to the customer), tags.
  Thin API routes live under `/api/workspaces/[workspaceId]/conversations/**`.
- **Realtime:** standalone Socket.IO gateway (`realtime/server.ts`, port
  `SOCKET_PORT`, default 4001) with the Redis adapter. Web/worker publish events
  (`message.created`, `message.status_updated`, `conversation.created`,
  `conversation.updated`) to a Redis channel via `lib/realtime.ts`; the gateway
  fans them out to `workspace:{id}` / `conversation:{id}` rooms. Sockets
  authenticate with the Better Auth session token (validated against the
  `Session` table) and room joins re-check workspace membership server-side.
  The browser gets its token from `GET /api/realtime/token`.
- **Inbox dual mode:** `/inbox` renders the **real** inbox (API + realtime) when
  the active workspace has conversations, and keeps the Phase 3 sample preview
  (badged) for empty workspaces. The real inbox has Reply / Private-note composer
  tabs, assignment, tags, resolve/reopen and a live connection dot.
- **Mock provider (dev only):** `integrations/mock/` implements the full
  interface against nothing — it simulates sends (content containing `[fail]`
  throws, to exercise retries) and parses signed test webhooks
  (`x-mock-signature: $MOCK_WEBHOOK_SECRET`). It registers only when
  `NODE_ENV !== "production"` or `ENABLE_MOCK_PROVIDER=true`. Connect it from
  the Channels page (“Connect mock channel (dev only)”) or
  `POST /api/workspaces/[workspaceId]/channels/mock-connect`, then inject a
  customer message with `npm run simulate:inbound`. **It is not a social
  integration: no external account is connected and no real message is ever
  sent or received through it.**
- **Tests:** `npm run test:phase4` — 34 assertions against real PostgreSQL +
  Redis with the real worker + realtime gateway spawned as child processes
  (ingest, idempotency, unread, assignment, notes, tags, resolve/reopen,
  outbound success/failure, socket delivery, cross-workspace isolation).

## Dashboard UI (Phase 3)

- **Design system:** Inter (via `next/font`), indigo primary + chart tokens in
  `app/globals.css` (Tailwind v4 `@theme`), expanded shadcn-style components in
  `components/ui/` (badge, avatar, dialog, dropdown-menu, scroll-area, select, switch,
  tabs, textarea, separator, skeleton, tooltip) and shared pieces: `PageHeader`,
  `ChannelIcon`/`ChannelBadge` (provider tiles + avatar badges), `AvatarWithBadge`,
  `EmptyState`, `SampleBadge`.
- **Shell:** persistent sidebar — workspace switcher, Overview, Inbox, Contacts,
  Channels, Automation, Team, Analytics, Settings, user card + sign-out; top bar with
  page title, global search (⌘K dialog over pages + sample conversations/contacts),
  real notifications dropdown (empty until something creates notifications), help and
  account menus. Sidebar collapses to a drawer below `lg`.
- **Overview:** stat cards use **real** database counts for the active workspace
  (total / open / unassigned / resolved; average response time shows “No data yet”).
  Charts, recent conversations and the analytics/automation pages render **sample
  data**, always labeled with a “Sample preview” badge.
- **Inbox:** full-bleed 3-column preview — filter tabs (All / Unread / Waiting /
  Assigned to me) + status filter + live search over the sample list, thread view with
  bubbles and Seen states, a composer that appends locally (captioned “Preview only —
  connect a channel to send real messages”), and a contact panel with assignment,
  editable tags and previous interactions.
- **Sample-data honesty rule:** all sample data lives in
  `features/<module>/sample-data.ts`, is typed, is never imported by `services/` or
  `lib/`, and is never written to the database. Channels always show “Not connected”
  until a real adapter ships; nothing in the UI claims a message was sent.
- **Team page** (`/team`) hosts the real Phase 2 member/role/invite/team management
  (`features/team/team-management.tsx`), reused by Settings. Settings also has profile
  (with email-verification state), notification-preference previews and a disabled
  danger zone.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · PostgreSQL 16 + Prisma 7 ·
Better Auth 1.7 · Tailwind CSS 4 + shadcn/ui · Redis 7 + BullMQ · Docker

## Authentication & workspaces (Phase 2)

- **Auth:** Better Auth with the Prisma adapter — registration, login, logout, database
  sessions, forgot/reset password, and email verification. Passwords are hashed by
  Better Auth (scrypt) and live in `Account.password`; there is no password column on `User`.
- **Email in development:** no SMTP is configured, so verification / reset / invitation
  links are printed to the server console by the dev mailer (`lib/mail.ts`). Set `SMTP_*`
  env vars to plug in a real transport later.
- **Email verification** is sent on sign-up but not required to sign in during development
  (`requireEmailVerification: false`).
- **Route protection:** `proxy.ts` does an optimistic session-cookie check; the real gate
  is the server-side session check in `app/(dashboard)/layout.tsx` and in every API route.
- **Workspaces:** create (slug auto-generated), update, switch (active-workspace cookie,
  membership-validated), invite members by email (7-day token, `/accept-invite`), change
  roles, remove members. Roles: `OWNER > ADMIN > AGENT > VIEWER` with a permission matrix
  in `lib/permissions.ts`; every service call re-checks membership + permission
  server-side (`lib/workspace-auth.ts`). Guards: the last OWNER can neither be removed
  nor demoted, and only an OWNER can act on another OWNER.
- **Channel credentials:** OAuth tokens are stored AES-256-GCM-encrypted
  (`lib/encryption.ts`, `ENCRYPTION_KEY`) via `services/channel-credential.service.ts`;
  API responses only ever expose metadata (hasToken / expiry / scopes), never tokens.
- **Seeded login:** `demo@uoi.local` / `demo-password-123` (owner of `demo-workspace`)
  after `npm run db:seed`.

API routes: `GET/POST /api/workspaces`, `GET/PATCH /api/workspaces/[id]`,
`GET/POST /api/workspaces/[id]/members`, `PATCH/DELETE /api/workspaces/[id]/members/[memberId]`,
`GET/POST /api/workspaces/[id]/teams`, `POST /api/workspaces/active`,
`POST /api/invitations/accept`, plus Better Auth under `/api/auth/*`.

### Authorization tests

```bash
npm run test:phase2   # 28 assertions against the real DB: cross-workspace
                      # isolation, RBAC matrix, invite flow, last-owner
                      # guards, credential encryption. Exits non-zero on failure.
```

## Project structure

```
app/            App Router routes: (auth) login/register, (dashboard) shell with
                dashboard / inbox / contacts / channels / automation / team /
                analytics / settings / onboarding, api/health
components/     ui/ (shadcn-style set incl. Dialog, DropdownMenu, Select, Switch, Tabs,
                Avatar, Badge) + layout/ (AppShell, Sidebar, Header, PageHeader) +
                channel-icon, avatar-with-badge, empty-state, sample-badge
features/       Feature modules: auth, dashboard (stat cards + recharts), inbox
                (3-column shell), contacts, channels, team, automation, analytics,
                settings — each with sample-data.ts where previews are shown
lib/            prisma.ts, redis.ts, queue.ts (BullMQ), env.ts (Zod), errors.ts (AppError),
                validations.ts, auth.ts (Better Auth) + auth-client.ts, mail.ts (dev mailer),
                encryption.ts (AES-256-GCM), permissions.ts (RBAC matrix), workspace-auth.ts,
                active-workspace.ts, api.ts, utils.ts (cn)
services/       Framework-free, workspace-scoped data services (workspace + members/teams,
                channel-credential, conversation, contact)
scripts/        test-phase2.ts — authorization-boundary test suite
integrations/   Provider contract (types.ts) + registry.ts + one folder per platform (README only)
workers/        Standalone BullMQ worker process (processors are Phase 1 stubs)
prisma/         schema.prisma, migrations/, seed.ts (dev-only demo user/workspace)
types/          Normalized messaging + queue job payload types
generated/      Prisma client output (git-ignored, created by `prisma generate`)
```

## Prerequisites

- Node.js 20+ (developed on Node 24)
- Docker + Docker Compose (for PostgreSQL and Redis)

## Run it locally

```bash
# 1. Environment
cp .env.example .env        # defaults already match docker-compose

# 2. Infrastructure (PostgreSQL :5432, Redis :6379)
docker compose up -d
docker compose ps           # both services should become healthy

# 3. App dependencies + database
npm install
npx prisma generate
npx prisma migrate dev      # applies prisma/migrations (or: npm run db:migrate)
npm run db:seed             # optional dev seed: demo@uoi.local / demo-password-123

# 4. Web app
npm run dev                 # http://localhost:3000  → redirects to /dashboard

# 5. Background worker (separate terminal)
npm run worker

# 6. Realtime gateway (separate terminal, Phase 4)
npm run realtime            # Socket.IO on :4001 (SOCKET_PORT)

# 7. (Optional, dev only) exercise the messaging loop with the mock provider:
#    connect the mock channel on /channels, then:
npm run simulate:inbound    # injects a simulated customer message via the webhook pipeline
```

Health check (reports each dependency independently):

```bash
curl http://localhost:3000/api/health
# {"status":"ok","dependencies":{"database":"ok","redis":"ok"}, ...}
```

Routes: `/login` `/register` `/forgot-password` `/reset-password` `/verify-email`
`/accept-invite` `/onboarding` `/dashboard` `/inbox` `/contacts` `/channels`
`/automation` `/team` `/analytics` `/settings` `/api/health` `/api/auth/*`
`/api/workspaces/*`

Deployment: `package.json` has `"postinstall": "prisma generate"` so Vercel builds
generate the Prisma client (`generated/` is git-ignored). No build step needs
`DATABASE_URL`/Redis — clients stay lazy and dashboard pages are dynamic.

Auth env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (see `.env.example`).
Phase 4 env vars: `SOCKET_PORT` (default 4001), `NEXT_PUBLIC_SOCKET_URL`
(default `http://localhost:4001`), `MOCK_WEBHOOK_SECRET` (default
`dev-mock-secret`), `ENABLE_MOCK_PROVIDER` (set `true` to allow the dev-only
mock provider in production builds — local dev enables it automatically).

Optional: run web + worker in Docker too — `docker compose --profile app up --build`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run format` / `format:check` | Prettier |
| `npm run worker` | BullMQ worker process (tsx) |
| `npm run realtime` | Socket.IO realtime gateway (tsx, port `SOCKET_PORT`) |
| `npm run simulate:inbound` | Inject a simulated inbound message (mock provider, dev only) |
| `npm run test:phase4` | Phase 4 messaging-engine tests (real DB + Redis + child processes) |
| `npm run test:phase5` | Phase 5 Meta tests (real DB + Redis; providers use an injected fake-fetch test double — no real Meta account) |
| `npm run test:phase6` | Phase 6 WhatsApp tests (real DB + Redis; provider uses an injected fake-fetch test double — no real WhatsApp account) |
| `npm run test:phase7` | Phase 7 TikTok tests (real DB + Redis; gated scaffold — no TikTok account or network call exists) |
| `npm run test:phase8` | Phase 8 X tests (real DB + Redis; provider uses an injected fake-fetch test double with official-doc payload shapes — no real X account or network call exists) |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Seed demo user/workspace (`tsx prisma/seed.ts`) |
| `npm run db:validate` | `prisma validate` |
| `npm run test:phase2` | Authorization-boundary tests against the real DB |

## Design rules (from Phase 0)

- Tenant isolation: every tenant row has `workspaceId`; services scope every query by it.
- Webhooks (Phase 2) are logged raw, ACKed fast, and processed async in workers — never inline.
- Platform code lives only behind `IMessagingProvider`; the engine sees normalized types only.
- Channel credentials are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`) and never reach the browser.
- DB and Redis clients are lazy — importing them never connects, so builds pass without services running.
