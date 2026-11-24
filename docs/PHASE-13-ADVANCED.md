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
