# Phase 13 — Advanced Features & Automation

Jeet's spec (sent 2026-11-20, titled "PHASE 9" in his message; our
sequence continues at 13 after Phases 9–12 shipped). Reference
screenshots: ReplyFront (AI performance + knowledge base) and a
node-canvas flow builder.

## Audit — what already exists (verified 2026-11-20)

| Spec item | State today |
| --- | --- |
| Canned responses | Core built: model (title/body/shortcut), create + delete routes, composer `/` picker + manager dialog. Missing: **categories, edit (PATCH), admin page** |
| Analytics | Fully real since 2026-11-17: totals, conversations/day, first response, channel share, leaderboard. Missing: **avg resolution time, incoming/outgoing message counts** |
| Notifications | `Notification` model + header bell exist; only MENTION + SYSTEM types are produced today. Missing: **new conversation / new message / assignment notifications, list page** |
| Customer profile | Contacts list (real) + inbox side panel + previous conversations. Missing: **dedicated profile page** (identities across channels, full history, attributes) |
| Smart assignment | Nothing — no rules, no round-robin, no availability flag |
| Automation builder | Automation page is still the Phase-3 SAMPLE mock — nothing real |
| AI assistant | Nothing — no provider, no env vars, no UI |

## Design decisions

- **One rule engine for §3 + §4.** `AutomationRule`: workspaceId,
  name, enabled, trigger (conversation.created / message.created /
  conversation.assigned / conversation.resolved / tag.added),
  conditions (JSON: channel providers, tag ids, only-first-message,
  unassigned-only…), actions (JSON array: assign / add_tag /
  send_canned / notify / set_status / set_priority), plus a
  round-robin cursor. Smart assignment = assign actions with a
  strategy: `specific` | `round_robin` | `least_busy`, over members
  with the new `WorkspaceMember.isAvailable` flag (AGENT+ roles).
- **Automated sends go through the normal outbound path**
  (`sendOutboundMessage` as the rule's actor = a chosen agent or the
  workspace owner), so Meta 24h windows, WhatsApp template rules and
  website SENT semantics all apply unchanged. A send that violates a
  window fails honestly and is logged on the rule run, never faked.
  Every automation firing writes an `AutomationRun` row (rule,
  conversation, action results) — visible in the builder UI.
- **AI (§1) is provider-gated, never faked.** `lib/ai.ts` speaks to
  an OpenAI-compatible chat API via env (`AI_API_KEY`, `AI_BASE_URL`,
  `AI_MODEL`). Without a key every AI surface shows "AI is not
  configured for this deployment". Suggestions are inserted into the
  composer only on agent click — nothing is ever auto-sent.
  Knowledge = `KnowledgeEntry` (title + content, admin-managed);
  suggest-reply includes relevant entries + recent thread context.
- **No identity auto-merge (§5).** The profile page groups by the
  existing Contact + ContactIdentity rows only.

## Build order

1. **13A** Canned completion: category column + PATCH + Settings/
   Automation-adjacent manager UI with search + categories.
2. **13B** Automation engine + smart assignment (schema, engine
   hooks in ingest/assign/resolve/tag paths, run log, tests).
3. **13C** Automation builder UI (visual flow: trigger → conditions
   → action steps; rule list with enable toggle + run history) —
   replaces the sample Automation page.
4. **13D** Unified customer profile page `/contacts/[contactId]`.
5. **13E** Notifications expansion (producers + list page + header
   wiring for all types).
6. **13F** Analytics additions (avg resolution time, in/out counts).
7. **13G** AI assistant (provider, endpoints, composer AI panel:
   suggest / rewrite / summarize / sentiment / translate; knowledge
   entries admin + AI performance counters on Analytics).

Each sub-phase: tests + lint/typecheck/build gates, then one push.

## Follow-up: `ai_reply` action — AI auto-reply (2026-11-22)

A rule action that generates a reply with the 13G assistant (thread
context + keyword-matched knowledge) and sends it through the normal
outbound path. Guardrails: automation sends are marked
`metadata.viaAutomation` (canned sends too, from this change on), and
the action SKIPS — recorded on the run — once any outbound agent
message exists that was NOT sent by an automation, so a human agent
replying in a conversation permanently silences the AI there, while
the AI can still continue conversations it handles alone. Without
`AI_API_KEY` the run records the not-configured failure and nothing is
sent. DEPLOYMENT NOTE: inbound processing runs in the WORKER process,
so the worker needs `AI_API_KEY` in its own environment for
auto-replies (the composer panel runs web-side). Suite: test:phase13 =
51 (section 15: 6 asserts); test:phase4 regression 62/62.

## Follow-up: store connection + live product lookup (2026-11-24)

Jeet's pick: connect his ecommerce store so the AI answers product
questions from the LIVE store API instead of static knowledge, and
sends product PHOTOS, not just text. Schema: `StoreConnection`
(workspaceId unique, baseUrl, name?, enabled) — one store per
workspace, managed in Settings → "Store connection — live products"
(OWNER/ADMIN; test button hits the store). `services/store.service.ts`:
GET {baseUrl}/products?take=N&search=Q (the verified Multi-Ecommerce
shape; a bare array also parses), normalized to name / price range /
total stock / variant labels / primary image URL. URL validation is
string-level (https in production, no localhost/.local/.internal or
literal private IPs; no DNS resolution — resolvers differ per host).
`suggestReply` now also runs `searchForMessage` (significant words →
phrase search, longest-word fallback) and injects a LIVE PRODUCTS
block into the prompt as ground truth; the result carries `products`
(the composer panel shows "Live from your store: …"). The `ai_reply`
automation action sends up to 2 product photos via sendOutboundMedia
after its text (marked viaAutomation/aiGenerated; a failed photo never
fails the reply; the run detail names the products + photos sent).
sendOutboundMedia gained the same optional metadata passthrough as
sendOutboundMessage. Order taking (POST /orders/checkout — guest COD
checkout verified to exist in the store's OpenAPI spec) is the agreed
next step, NOT built here. Suite: test:phase13 = 60 (section 16: 9
asserts); phase-4 regression 62/62.

## Follow-up: per-workspace AI config — Dograh-style BYOK (2026-11-24)

Jeet's requirement: AI credentials in server env made one key serve
every workspace — wrong for a multi-tenant SaaS. Modelled on Dograh
AI's Model Configurations (per-organization provider connections +
named model configs): schema `AiConfig` (workspaceId unique,
provider, model, baseUrl, encryptedApiKey — AES-256-GCM via
lib/encryption, NEVER returned to a browser; views expose only
hasKey). `lib/ai-providers.ts` catalog: groq / gemini / openai /
openrouter / custom (any OpenAI-compatible endpoint), each with
curated models + custom model names allowed. `lib/ai.ts` now resolves
PER WORKSPACE: `resolveAiConfig(workspaceId)` → the workspace's own
key first, the platform env key (AI_API_KEY/…) only as a fallback
default; `aiChat(messages, workspaceId)`; `getAiStatus(workspaceId)`
feeds Settings + the inbox flag. `aiConfigService.upsert` runs
Dograh's save-time credential check (GET {baseUrl}/models): a
provider-REJECTED key (401/403) saves nothing; an inconclusive check
saves with a warning; saving without a key keeps the stored one
(keep-or-replace). Settings gained the "AI model — this workspace's
own key" card (provider/model dropdowns, password key field,
own-key vs platform-default status, remove). Embeddings for the
Dograh-style knowledge base will slot into this same per-workspace
config when chunked search is built. Suite: test:phase13 = 67
(section 17: 7 asserts); phase-4 regression 62/62.

## Follow-up: Dograh-style knowledge base — document uploads, Full Document mode (2026-11-24)

Jeet picked phase 1 of the Dograh KB design: uploads + Full Document
mode (chunked semantic search is the designed phase 2). Schema
`KnowledgeDocument`: workspaceId, title, fileName, mimeType,
sizeBytes, original bytes (kept for future re-processing), extracted
text, charCount, mode (FULL_DOCUMENT | CHUNKED_SEARCH — enum ready
for phase 2), status (PROCESSING | READY | FAILED) + error.
`lib/knowledge-extract.ts` mirrors Dograh's library: PDF (unpdf),
DOCX (mammoth), TXT, Markdown, JSON — kind by extension, ≤5 MB,
legacy .doc rejected with an explanation. Upload (workspace.update)
creates the row as PROCESSING and enqueues the new
`knowledge-processing` BullMQ queue; the worker extracts and settles
the row READY or FAILED with the reason (extraction errors are
recorded, not retried — a corrupt file fails identically). Settings
gained a "Knowledge documents" card: upload, per-file status badges
(polls every 3 s while processing), two-step delete; views never
expose bytes or text. Grounding: `suggestReply` (and therefore the
`ai_reply` automation action) adds matching READY documents —
keyword-scored like typed entries, whole text filled into a 12,000
character budget in relevance order — under an "Uploaded knowledge
documents" prompt block, and the audit line (`knowledgeUsed`) names
the files used. Suite: test:phase13 = 76 (section 18: 9 asserts,
including a byte-built minimal PDF and a corrupt-PDF FAILED case);
phase-4 regression 62/62.

## Follow-up: configurable store API shape — any custom store API (2026-11-24)

At Jeet's request ("the params might be diff… make it flexible so in
future we can connect with any custom api url"), the store
connection's API contract is now per-workspace configuration instead
of code. `StoreConnection` gained eight shape columns (migration
`20261124083419_add_store_api_shape`, applied to Neon): productsPath
(default `/products`), searchParam (`search`), limitParam (`take`),
responsePath (`data`; null = the response IS the array), nameField
(`name`), priceField (`price`), stockField (`stock`), imageField
(`images`). The defaults ARE Jeet's Multi-Ecommerce shape, so his
live connection behaves exactly as before (verified in production
after deploy).

`resolveStoreApiShape` (services/store.service.ts) resolves partial
input over the saved shape or the defaults; empty strings clear the
nullable knobs; invalid values (endpoint without a leading `/`,
illegal parameter/field names) are a clear 400. Normalization also
grew: prices accept numeric strings ("4999"), the image field accepts
a URL string, an array (of URLs or `{url, isPrimary, sortOrder}`
objects), or a single `{url}` object, and stock accepts a flat count
or an in-stock boolean. Products whose API reports no stock get
`stockKnown: false`, and the AI prompt then says the store does not
report stock instead of claiming in/out of stock. The `variants`
layer (price/stock/option labels from an active-variants array)
still applies opportunistically when a product carries one.

Settings → Store connection gained a collapsed "Advanced — custom
API shape" section with the eight fields; Save and Test both send
the full form. Test now runs against the form's unsaved shape and
names a sample product AS PARSED ("Store reached — read 3
product(s). First: … — price … — in stock."), so a wrong mapping is
visible before saving. Suite: test:phase13 = 85 (section 20: 6
asserts against a differently-shaped fake API — `/items?q=&limit=`,
`catalog.items` envelope, title/cost/qty/pic fields); phase-4
regression 62/62.

Not yet supported (deliberate): APIs that need an auth header/API
key, and nested field paths (field names are single keys). Both are
additive when a real custom store needs them.

---

## Channel-scoped rules + Settings cleanup (2026-11-24, follow-up)

- **Per-channel rule condition:** `AutomationConditions.channelIds` — when
  non-empty, a rule only runs for conversations on those channels (any
  trigger/action; the main use is scoping "Reply with AI" so auto-reply
  can be allowed on chosen channels and kept off others). Empty/absent =
  every channel, so existing rules are unchanged. The builder's "Only
  if…" step gained an "Only on these channels" chip picker (channel
  display name + provider), fed by a new `channels` prop from the
  automation page; rule cards summarize the scope as `channels: <names>`.
  Covered by test-phase13 §21 (a rule scoped to a second channel does
  not fire on the main channel and does fire on its own).
- **Settings no longer embeds team management:** the full TeamManagement
  section (members, teams, invitations) was removed from
  `/settings` — it lives only on `/team`, which renders the identical
  component. Settings keeps Profile, Workspace, Outgoing webhooks, AI
  model, Knowledge (entries + documents), Store connection,
  Notifications and the danger zone; its header now points readers to
  the Team page. Settings still resolves the viewer's membership
  server-side for its permission flags.

## AI sections moved from Settings to Automation (2026-11-24, follow-up)

- At the owner's request, the three AI sections — **AI model** (per-workspace
  key), **AI assistant & knowledge base**, and **Knowledge documents** — moved
  from `/settings` to the bottom of `/automation`, since they power the
  automation rules ("Reply with AI") and the composer assistant. Same
  components, same data, same permissions (OWNER/ADMIN manage; the
  automation page's canManage flag is equivalent to the workspace.update
  permission Settings used). Settings now holds Profile, Workspace,
  Outgoing webhooks, Store connection, Notification preferences and the
  danger zone.

## Automation page redesign — Dograh-inspired (2026-11-24, follow-up)

- Researched from Dograh's open-source product UI (their in-app
  Automation page is an unbuilt "Coming Soon" stub, so the models were
  their Voice Agents list and workflow node cards). Applied, scoped to
  this page only:
  - One restrained amber CTA (#E39A2E light / #F0B24A dark) reserved
    for "New rule"; everything else stays monochrome/outline.
  - Rules are now a single-card row list (was a two-column card grid):
    status dot (green/grey) + name + a coloured trigger pill in
    Dograh's node-badge palette (created emerald, message blue,
    assigned amber, resolved rose, tag purple) + Enabled/Disabled text,
    conditions as an "Only if:" line, actions as neutral pills,
    labelled outline Edit / ghost Delete; disabled rows fade like
    Dograh's archived rows.
  - Uppercase tracking-wider micro-labels head each section (My
    availability / Rules / Recent activity / AI configuration);
    availability became a pill bar with a status dot, echoing their
    sidebar footer pill.
  - The builder's three steps are now Dograh node-style cards: neutral
    surface, coloured type badge overlapping the top edge (When
    emerald, Only if amber, Then do blue); condition chips switched
    from indigo to monochrome foreground/background.
  - Behaviour is unchanged — same handlers, API and permissions; the
    app's no-shadow rule is respected (borders carry the structure).

## UI polish batch (2026-11-24, Jeet's requests, GitHub 088a9aaf + 6ea2e628)

- Automation: "New rule" CTA is now the app's blue (bg-blue-500) instead
  of Dograh amber; Recent activity moved to the LAST section (after AI
  configuration) with pagination — 15 runs per page, run fetch raised to
  100; the AI knowledge form is Dograh-style (labelled Title/Facts, Facts
  textarea at 8 rows); all Automation sections are full width.
- App-wide: default font is Manrope (Google Fonts via next/font, Geist
  Mono kept for mono); navbar search stretches full width; every modal
  is bigger — Dialog base sm:max-w-3xl, AlertDialog sm:max-w-2xl, the
  rule builder and channel connect panels at 3xl, the ⌘K palette at 2xl.
- Sign out now asks first: a shadcn AlertDialog ("Sign out?") guards
  both the header account menu and the sidebar logout button.
- Sidebar Inbox is an expandable group (open by default) with the four
  assignee views — All / Mine / Unassigned / Mentions — linking to
  /inbox?view=…; the inbox opens on that tab (initialView plumbed
  page → shell; the shell's filter effect refetches the view) and the
  in-inbox assignee segmented control was removed (views live only in
  the sidebar). Status chips, sort and channel filters stay in-inbox.
- Contacts pagination: 20 per page. Notifications pagination: 10 per
  page. Settings sections are full width (max-w-4xl removed). The
  Team page's create-team form was removed (existing teams still list;
  the POST /teams API route is unchanged).
