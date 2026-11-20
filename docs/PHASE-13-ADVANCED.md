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
