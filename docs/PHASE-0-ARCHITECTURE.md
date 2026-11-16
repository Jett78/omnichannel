# Unified Omnichannel Inbox — Phase 0 Architecture
Date: 2026-11-16 | Status: Planning — no implementation yet
Stack: Next.js App Router, TypeScript, PostgreSQL, Prisma, Tailwind + shadcn/ui, Redis, BullMQ, Socket.IO, Docker

## 1. Product Analysis

**What it is:** Multi-tenant SaaS where a business connects its messaging accounts once, and every customer conversation lands in one agent workspace where the team can reply without leaving the app.

**Actors:**
- Workspace Owner / Admin — billing, channels, team, settings
- Agent — handles conversations, assigned / unassigned queues
- Customer (Contact) — external person messaging on FB / IG / WhatsApp / etc. Never logs in.

**Core loop (must work end-to-end before anything else):**
Connect Channel → Customer messages on platform → Webhook arrives → Normalized Message created → Realtime push to inbox → Agent replies in UI → Provider API sends it → Delivery status returns → Thread updated.

Everything else (automation, AI replies, analytics, campaigns) is layered on this loop. If this loop is slow, lossy, or duplicates messages, the product fails regardless of UI.

**Non-goals for MVP:** Campaigns/broadcasts, voice/video calls, AI auto-reply, e-commerce orders, own mobile apps. Voice notes and media *display* are in scope; sending large media is phased.

**Chatwoot lesson:** Chatwoot's value is not the chat UI — it's reliable webhook ingestion, identity resolution, and assignment. We copy the *concepts*, not code/UI.

## 2. System Architecture — Key Decisions

### Decision 1: Modular monolith + 2 separate processes (NOT microservices)
One codebase (Turborepo monorepo, your established pattern) deployed as 3 processes:

```
[ Next.js Web ]      — UI + REST API + webhook ingress (fast ACK only)
[ Worker ]           — BullMQ consumers: webhook processing, outbound send, media, retries
[ Realtime Gateway ] — standalone Node + Socket.IO server
        |                    |                     |
        +------ PostgreSQL (Prisma) ---- Redis ----+
                             |
                      S3-compatible storage (media)
```

Why: Next.js / Vercel-style request handling cannot reliably host long-lived Socket.IO or queue workers. Separating worker + realtime from web from Day 1 avoids a painful rewrite later. But splitting into microservices now would slow you down for zero benefit at this scale — shared Prisma schema and shared `core` package keep it coherent.

Hosting implication: Web can go to Vercel, but Worker + Realtime + Redis need a long-running host (Render / Fly.io / VPS via Docker). Plan Docker Compose for local + prod parity from Phase 1.

### Decision 2: Provider Adapter pattern with a strict common engine
No platform code leaks into inbox/conversation logic. Every platform implements the same `IMessagingProvider` interface (Section 5). The Messaging Engine only knows normalized types: `NormalizedInboundMessage`, `OutboundMessage`, `DeliveryStatus`.

### Decision 3: Webhooks are logged raw, processed async, never handled inline
Ingress does 3 things only: verify signature → persist raw event → enqueue job → return 200 in <200ms. All parsing/resolution happens in workers. This is non-negotiable — Meta retries aggressively and drops webhooks if you are slow, and you need the raw log for replay/debugging.

### Decision 4: Tenant isolation by `workspaceId` on every tenant row
Every query is workspace-scoped in a service layer (never raw Prisma in route handlers). Add Postgres Row-Level Security later as defence-in-depth, not as v1 crutch.

### Decision 5: Telegram first in code, Meta first in business value
Build order ≠ launch order. Telegram Bot API needs no app review and validates the whole loop in days. Meta (Messenger/IG/WhatsApp) needs business verification + App Review — start that paperwork in Phase 1 in parallel, build it second.

## 3. Database Entities

Core ER (Prisma models):

```
User ──< WorkspaceMember >── Workspace ──< Channel
                                  │             │
                                  │             └──< ChannelCredential (1:1, encrypted)
                                  │
                                  ├──< Contact ──< ContactIdentity >── Channel
                                  │                                   (unique: channelId + externalId)
                                  │
                                  ├──< Conversation ──< Message ──< MessageAttachment
                                  │        │               └──< MessageDelivery (status history)
                                  │        ├──< ConversationTag >── Tag
                                  │        └── assignee: User?
                                  │
                                  ├──< CannedResponse, InternalNote (Message with visibility=PRIVATE)
                                  ├──< WebhookEvent (raw, provider, externalEventId unique)
                                  ├──< Invitation, AuditLog
                                  └─── Subscription / Plan (Phase 8)
```

**Key tables in detail:**

| Model | Critical fields | Notes |
|---|---|---|
| `Workspace` | id, name, slug (unique), timezone, plan | The tenant. Everything hangs off it. |
| `User` | id, email (unique), name, passwordHash / authId | Global user; can belong to many workspaces. |
| `WorkspaceMember` | workspaceId, userId, role OWNER/ADMIN/AGENT/VIEWER | Unique [workspaceId, userId]. All permission checks go through this. |
| `Channel` | workspaceId, provider (enum), externalAccountId, displayName, status CONNECTED/EXPIRED/DISCONNECTED, config Json | One row per connected Page / IG account / WA number / Telegram bot. Unique [provider, externalAccountId, workspaceId]. |
| `ChannelCredential` | channelId (unique), encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, scopes | Encrypted at app level (AES-256-GCM), never returned to client. |
| `Contact` | workspaceId, displayName, avatarUrl, phone?, email?, customAttrs Json | The unified person inside a workspace. |
| `ContactIdentity` | contactId, channelId, externalUserId, username | **The most important join.** Same human on FB and WhatsApp = 2 identities, 1 Contact (merge is manual/suggested in MVP, never auto-merge on name alone). Unique [channelId, externalUserId]. |
| `Conversation` | workspaceId, channelId, contactId, status OPEN/RESOLVED/PENDING/SNOOZED, assigneeId?, lastMessageAt, unreadCount, externalThreadId? | Unique thread per Contact+Channel in MVP (matches how all 6 platforms model it). |
| `Message` | conversationId, direction INBOUND/OUTBOUND, type TEXT/IMAGE/VIDEO/AUDIO/FILE/LOCATION/STICKER/SYSTEM/PRIVATE_NOTE, body?, senderType CONTACT/AGENT/SYSTEM, externalMessageId (unique per channel), status, sentAt | Dedupe on externalMessageId. Snapshot sender name/avatar at send time. |
| `MessageAttachment` | messageId, storageKey, mimeType, size, originalUrl? | Store in S3, never hotlink expiring platform URLs. |
| `WebhookEvent` | provider, externalEventId?, payload Json (raw), status RECEIVED/PROCESSED/FAILED, receivedAt | Idempotency + replay source of truth. |
| `AuditLog` | workspaceId, actorId, action, entity, entityId, meta Json | Channel connect/disconnect, assignment, exports. |

Indexes that matter on Day 1: `Conversation [workspaceId, status, lastMessageAt desc]`, `Message [conversationId, createdAt]`, `Message [externalMessageId]`, `ContactIdentity [channelId, externalUserId]`, `WebhookEvent [provider, externalEventId]`.

## 4. Folder Structure (Turborepo)

```
unified-omnichannel-inbox/
├── apps/
│   ├── web/                  # Next.js App Router
│   │   ├── src/app/
│   │   │   ├── (auth)/login, register
│   │   │   ├── (dashboard)/[workspaceSlug]/inbox, contacts, channels, settings, team
│   │   │   ├── api/webhooks/[provider]/route.ts   # ingress ONLY
│   │   │   ├── api/workspaces/... , api/conversations/... , api/messages/...
│   │   │   └── api/auth/[...nextauth]/
│   │   ├── src/components/ (shadcn/ui + inbox components)
│   │   └── src/lib/ (client utils, socket client)
│   ├── worker/               # BullMQ processors (plain Node + TS)
│   │   └── src/processors/ webhook.processor.ts, outbound.processor.ts, media.processor.ts, token-refresh.processor.ts
│   └── realtime/             # Socket.IO gateway (plain Node + TS)
│       └── src/ server.ts, auth.ts, rooms.ts
├── packages/
│   ├── db/                   # Prisma schema, client, migrations — single source of truth
│   ├── core/                 # Messaging Engine: conversation.service, message.service, contact-resolver, assignment — framework-free, tested
│   ├── providers/            # One folder per platform, zero cross-imports
│   │   ├── types.ts          # IMessagingProvider + normalized types
│   │   ├── telegram/  facebook/  instagram/  whatsapp/  x/  tiktok/
│   ├── queue/                # BullMQ queue definitions + job payload types (shared web↔worker contract)
│   ├── ui/                   # Shared shadcn/ui components, theme
│   └── config/               # eslint, tsconfig, tailwind presets
├── docker-compose.yml        # postgres, redis, minio (local S3), web, worker, realtime
└── .env.example              # per-provider app id/secret, ENCRYPTION_KEY, DATABASE_URL, REDIS_URL
```

Rule: `apps/web` never imports a provider directly — it calls `core` or enqueues a job. Providers never import Next.js.

## 5. Messaging Provider Interface

```ts
// packages/providers/types.ts
export type ProviderId = 'facebook' | 'instagram' | 'whatsapp' | 'telegram' | 'x' | 'tiktok';

export interface ProviderCapabilities {
  supportsTyping: boolean; supportsReadReceipts: boolean;
  supportsMedia: ('image'|'video'|'audio'|'file')[];
  messagingWindowHours: number | null; // 24 for Meta/WA, null = none (Telegram)
  requiresTemplateOutsideWindow: boolean; // true only for WhatsApp
}

export interface NormalizedInboundMessage {
  externalMessageId: string; externalThreadId?: string;
  senderExternalId: string; senderName?: string; senderAvatarUrl?: string;
  type: MessageType; body?: string;
  attachments?: { url: string; mimeType?: string }[];
  sentAt: Date; raw: unknown;
}

export interface IMessagingProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  getAuthUrl(workspaceId: string): string;                       // OAuth / connect flow start (Telegram: bot token form instead)
  exchangeCode(code: string): Promise<ChannelCredentials>;        // → tokens to encrypt & store
  refreshToken?(cred: ChannelCredentials): Promise<ChannelCredentials>;
  verifyWebhook(req: { headers: Headers; rawBody: string }): boolean; // signature check, per-provider
  parseWebhook(payload: unknown): NormalizedInboundMessage[];     // pure function, heavily unit-tested per provider with real fixtures
  sendMessage(input: { channel: ChannelContext; toExternalId: string; message: OutboundMessage }): Promise<{ externalMessageId: string }>;
  sendTyping?(channel: ChannelContext, toExternalId: string): Promise<void>;
  markAsRead?(channel: ChannelContext, externalMessageId: string): Promise<void>;
  getContactProfile(channel: ChannelContext, externalUserId: string): Promise<{ name?: string; avatarUrl?: string }>;
  downloadMedia?(url: string, channel: ChannelContext): Promise<Buffer>; // WA/FB media needs auth headers
}
```

Design points: `parseWebhook` is pure + fixture-tested (platforms change payloads silently; fixtures catch it). Optional methods reflect reality — don't fake typing/read support where a platform has none.

## 6. Webhook Processing Architecture

```
Platform ──POST──> /api/webhooks/[provider]
  1. Read RAW body (disable body parsing — signature is over raw bytes)
  2. provider.verifyWebhook() → 401 if invalid, log attempt
  3. INSERT WebhookEvent (raw payload) — if duplicate externalEventId, ACK & stop
  4. queue.add('webhook', { webhookEventId }) 
  5. return 200 immediately

Worker: webhook.processor
  1. Load event → provider.parseWebhook() → NormalizedInboundMessage[]
  2. Resolve Channel by externalAccountId (unknown channel → mark event IGNORED, alert)
  3. Resolve ContactIdentity [channelId + senderExternalId] → create Contact if new, fetch profile async
  4. Find-or-create Conversation (OPEN), INSERT Message — unique externalMessageId makes retries safe
  5. Enqueue media-download jobs for attachments; update conversation.lastMessageAt + unreadCount
  6. Publish realtime event → Redis → Socket.IO room `workspace:{id}`
  7. Mark WebhookEvent PROCESSED. On error: BullMQ retry (exponential, 5 attempts) → DLQ + alert, event stays FAILED for manual replay
```

Outbound path is symmetric: Agent UI → API creates Message (status QUEUED) → `outbound` queue → worker calls `provider.sendMessage()` → status SENT/DELIVERED/READ/FAILED updated from provider response + later delivery webhooks. **Never call a platform API synchronously from the Next.js request** — a slow Meta API must not hang the agent's UI; optimistic UI + status ticks handle it.

Verification handshake: Meta/X require GET verification (`hub.challenge`) on the same route — implement alongside POST.

## 7. Real-time Architecture

- Standalone Socket.IO server, **Redis adapter** (`@socket.io/redis-adapter`) so multiple gateway instances stay in sync.
- Auth: short-lived JWT issued by Next.js, verified in Socket.IO handshake middleware. Client never connects unauthenticated.
- Rooms: `workspace:{id}` (new conversation, assignments), `conversation:{id}` (messages, typing), `user:{id}` (mentions, notifications). Join only after server-side membership check — client-supplied room names are never trusted.
- Events: `message.created`, `message.status_updated`, `conversation.assigned`, `conversation.status_changed`, `typing.start/stop`, `presence.updated`, `contact.updated`.
- Workers publish via Redis pub/sub → gateway emits. Web app never emits directly.
- Fallback: if socket drops, client refetches conversation on reconnect (socket is a *hint* to update, DB is truth). Typing/presence are ephemeral in Redis with TTL, never in Postgres.

## 8. Security Requirements

- **Auth:** Auth.js (NextAuth) with httpOnly, Secure, SameSite cookies; bcrypt/argon2 if credentials provider; OAuth for Google login optional. Session → WorkspaceMember check on *every* API route (middleware + service layer).
- **Tenant isolation:** workspaceId scoping enforced in `core` services; integration tests that prove Workspace A cannot read B's conversations by ID guessing (IDOR is the #1 SaaS inbox bug).
- **Token storage:** Channel tokens encrypted AES-256-GCM with key from env/KMS, per-record IV. Tokens never sent to browser, never logged, never in error messages. Token-refresh worker rotates before expiry.
- **Webhook security:** Per-provider signature verification (Meta: `X-Hub-Signature-256` HMAC-SHA256; Telegram: secret token header; X: CRC challenge). Reject unsigned.
- **Platform secrets:** App secrets only in server env; separate Meta app per environment (dev/staging/prod have different webhook URLs).
- **General:** Rate limiting on API + webhook ingress (Redis), Zod validation on all inputs, file-type/size checks + AV scan before storing inbound media, signed S3 URLs for media access, audit log for channel/team changes, GDPR-style contact deletion + workspace data export, secrets rotation plan, dependency + Prisma query logging with PII redaction.
- **Compliance note:** You are storing *other businesses' customer conversations* — you become a data processor. Privacy policy, DPA, and data-retention settings are product requirements, not legal afterthoughts.

## 9. API Limitations & External Dependencies — Reality Check

| Platform | Access path | Hard limits / blockers | MVP verdict |
|---|---|---|---|
| **Telegram** | Bot API, self-serve | Bot can't message a user who never started the bot; no review needed. Webhook or polling. | ✅ **Build first** — validates whole engine |
| **Facebook Messenger** | Meta Graph API, Page token | Needs Meta App Review (`pages_messaging`), Business Verification, demo video. **24-hour messaging window** (after that, only tagged/template messages). Page must be connected by its admin. | ✅ MVP — start review paperwork Phase 1 |
| **Instagram DMs** | Messenger API for Instagram | Business/Creator account linked to a FB Page. Same App Review + `instagram_manage_messages`. 24h window (7 days with Human Agent tag in some cases). Stories/mentions have separate payloads. | ✅ MVP, after Messenger (shared Meta plumbing) |
| **WhatsApp Business** | WhatsApp Cloud API (direct, no BSP needed) | Phone number registration + display name review. **24h service window; outside it only pre-approved template messages** (utility/marketing, each template reviewed). Per-conversation pricing by Meta. Quality rating can throttle/ban a number. Media needs authenticated download. | ✅ MVP, most valuable for Nepal/SMB — but template UX must be designed in, not bolted on |
| **X (Twitter) DMs** | X API v2 + Account Activity API | DM read/send is on expensive paid tiers, very low rate limits, webhook access restricted; policy has changed repeatedly. Cost/effort disproportionate to SMB demand. | ⚠️ **Spike only (Phase 7)** — do not promise in MVP |
| **TikTok** | TikTok Business Messaging API | **Partner/invite-only in most markets**, requires TikTok Business Center approval, limited regions, DM scope rarely granted to new apps. | ⚠️ **Spike only (Phase 7)** — architect supports it, product must not depend on it |

Cross-cutting: Meta token types (User → Page long-lived tokens, ~60 days / system-user tokens for WhatsApp), rate limits are per-Page/per-number and undocumented at the edges (handle 429/`(#613)` with backoff), platform payloads change without versioning notice (fixture tests + raw event log are your early-warning system).

## 10. Risks (ranked)

1. **Meta App Review is the schedule.** Business verification + review can take weeks and can be rejected for demo/privacy gaps. Mitigation: start Phase 1, use test Pages/users in dev mode meanwhile, build Telegram first so progress never blocks on Meta.
2. **TikTok/X may never be grantable** to a new SaaS. Mitigation: sell MVP on Meta + WhatsApp + Telegram; keep X/TikTok behind the adapter interface as research tracks.
3. **24h windows confuse businesses** ("why can't I reply?"). Mitigation: UI counts down the window per conversation and offers WhatsApp templates inline — this is a UX feature, not an error state.
4. **Message loss/duplication.** Mitigation: raw WebhookEvent log + idempotent inserts + replay tooling from Phase 2, not later.
5. **Token expiry silently killing a channel.** Mitigation: health check + token-refresh worker + "reconnect" banner; channel status is a first-class UI state.
6. **Media storage cost & expiring URLs.** Platform media URLs expire (WhatsApp especially). Download to S3 at ingest, always.
7. **Scope creep** — automation/AI/campaigns before the core loop is rock-solid. Mitigation: phase gates below; no phase starts until the previous one's exit criteria pass.

## 11. Phase-by-Phase Implementation Plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Architecture (this doc)** | Decisions above, schema, interfaces | You approve architecture + MVP channel order |
| **1 — Foundation** | Turborepo scaffold, Docker Compose (PG/Redis/MinIO), Prisma schema + migrations, Auth.js, Workspace CRUD + invitations + RBAC, app shell (shadcn/ui), **submit Meta Business Verification + create Meta app** | User can register, create workspace, invite agent; CI builds all 3 apps |
| **2 — Core Engine + Telegram** | `core` services, provider interface, webhook ingress + worker, Telegram adapter end-to-end, S3 media, WebhookEvent replay | Real Telegram bot conversation appears in inbox and reply from UI reaches phone |
| **3 — Inbox UI (full)** | 3-pane inbox, conversation list filters (Mine/Unassigned/All, Open/Resolved), Socket.IO realtime, typing, assignment, internal notes, contact panel | 2 agents work same workspace live without refresh; no cross-workspace leakage in tests |
| **4 — Facebook Messenger** | Meta OAuth connect flow, Messenger adapter, profile sync, delivery/read webhooks | Real Page conversation end-to-end in production-mode Meta app (test users) |
| **5 — Instagram** | Reuse Meta plumbing, IG adapter, story mention/reply handling | IG DM end-to-end |
| **6 — WhatsApp Cloud API** | Number registration flow, adapter, template message library + sending outside window, window countdown UI, media handling | WA conversation + template send end-to-end |
| **7 — Hardening + X/TikTok Spike** | Rate-limit/backoff polish, audit logs, channel health, time-boxed (1 week) X + TikTok access spikes with go/no-go report | Load test: 100 msg/min sustained, no dupes/loss; spike report delivered |
| **8 — SaaS Layer** | Plans/billing (Stripe or local gateway later), usage limits, analytics (response time, volume by channel), canned responses, tags, data export/deletion | Workspace can subscribe; admin sees team analytics |

**Recommended immediate decision for you:** Approve MVP channel order — Telegram (build) → Messenger → Instagram → WhatsApp — and X/TikTok as Phase 7 spikes only. That one decision unblocks Phase 1.
