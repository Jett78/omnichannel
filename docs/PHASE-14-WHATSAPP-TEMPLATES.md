# Phase 14 — WhatsApp message template management (2026-11-25)

Jeet's pick after the Sambad.io competitor check ("WhatsApp templates
first"): Sambad lets businesses create, sync and send templates from
the inbox; our Phase 6 build could only SEND approved templates. This
phase adds the management half.

## What shipped

- **Provider** (`integrations/whatsapp/whatsapp-provider.ts`):
  `createTemplate` (POST /{waba}/message_templates with HEADER/BODY/
  FOOTER components and example values) and `deleteTemplate`
  (DELETE /{waba}/message_templates?name=… — Meta removes every
  language of that name). `listTemplates` already existed.
- **Service** (`whatsapp-connection.service.ts`), all gated on
  `channels.manage` (owners/admins; agents keep the APPROVED-only
  composer list):
  - `listAllTemplates` — every template on the WABA with its review
    status, category, language, header/body/footer text and body
    variable count.
  - `createTemplate` — cross-checks Meta's creation rules BEFORE any
    Graph call: one example value per body variable, variables
    numbered {{1}}, {{2}}… in order, a header may use at most {{1}}
    and then needs an example. Refused payloads never reach Meta.
  - `deleteTemplate`.
- **Validation** (`createWhatsAppTemplateSchema`): name must match
  Meta's rule (lowercase letters, numbers, underscores), category is
  UTILITY or MARKETING. AUTHENTICATION templates follow stricter
  component rules and are not creatable from the form yet — they
  still list and send normally.
- **Routes** (existing templates route): `GET ?view=manage`,
  `POST` (201, returns Meta's initial status — normally PENDING),
  `DELETE ?name=`.
- **UI** (`features/channels/whatsapp-templates-panel.tsx`, rendered
  on the Channels page when a WhatsApp channel is connected): the
  template list with status badges (APPROVED / PENDING / REJECTED),
  a channel picker when several WhatsApp channels exist, Refresh,
  Delete with a confirmation dialog (spells out the 30-day name
  lockout), and a New-template dialog — name (auto-sanitised to
  Meta's alphabet), language code with suggestions, category,
  optional header/footer, body with per-variable example inputs that
  appear as {{n}} placeholders are typed. Nothing is stored locally:
  Meta is the source of truth, the panel reads it live.

## Sending (unchanged, Phase 6)

The inbox composer's template mode lists APPROVED templates only,
takes the variable values, requires the agent to confirm the
customer opted in, and sends through the normal outbound path. The
24-hour window rule is enforced server-side.

## Verification

- Phase-6 suite: **77 passed, 0 failed** — §9b adds 12 checks:
  manage list (all statuses, header derived), schema rejections,
  create happy path + exact Graph payload (body examples, footer),
  example-count / numbering / header-example refusals with NO Graph
  call made, Meta's 132000 rejection surfacing, delete by name, and
  cross-workspace isolation for list + create.
- tsc, eslint (touched files) and a clean production build green.

## Honest limits

- Templates are created against the real WABA only when a workspace
  admin uses the panel — there is no local draft state.
- The production WhatsApp channel still routes no real customer
  messages (Embedded Signup coexistence is gated on Jeet's Business
  Verification — Path B), and outbound sends queue through Redis,
  which is capped until the 1 Dec Upstash reset; neither blocks
  creating or listing templates.
