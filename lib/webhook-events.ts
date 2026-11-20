/**
 * Outgoing webhook events (Phase 12) — the product events a
 * workspace can subscribe an external HTTP endpoint to. Shared by
 * the server (validation, dispatch) and the Settings UI.
 */
export const OUTGOING_WEBHOOK_EVENTS = [
  "conversation.created",
  "conversation.resolved",
  "conversation.reopened",
  "conversation.assigned",
  "message.created",
] as const;

export type OutgoingWebhookEvent = (typeof OUTGOING_WEBHOOK_EVENTS)[number];

export const OUTGOING_WEBHOOK_EVENT_LABELS: Record<OutgoingWebhookEvent, string> = {
  "conversation.created": "Conversation created",
  "conversation.resolved": "Conversation resolved",
  "conversation.reopened": "Conversation reopened",
  "conversation.assigned": "Conversation assigned",
  "message.created": "Message created (inbound or agent reply)",
};
