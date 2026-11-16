# Unified Omnichannel Inbox

A multi-tenant SaaS that connects a business's messaging accounts — Facebook Messenger,
Instagram, WhatsApp, Telegram (X and TikTok as later spikes) — into one agent inbox.
Architecture: [`docs/PHASE-0-ARCHITECTURE.md`](docs/PHASE-0-ARCHITECTURE.md).

**Current status: Phase 3 — dashboard UI + design system.** Better Auth (email/password,
database sessions), workspace management with role-based permissions, teams,
conversation assignments and notifications are implemented and tested, and the full
SaaS shell (sidebar, top bar, overview, 3-column inbox, contacts, channels, team,
automation, analytics, settings) is built.
**No social integrations are implemented yet** — `integrations/` contains only the
`IMessagingProvider` contract and an empty registry.

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
