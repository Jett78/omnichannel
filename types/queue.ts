import type { ProviderId } from "@/types/messaging";

/** BullMQ job payload contracts — shared by producers (web) and workers. */

export interface WebhookJobData {
  /** Row id of the persisted raw WebhookEvent. */
  webhookEventId: string;
  provider: ProviderId;
}

export interface OutboundJobData {
  /** Row id of the Message created by the agent (status QUEUED). */
  messageId: string;
  workspaceId: string;
  channelId: string;
}

export interface MediaJobData {
  messageId: string;
  attachmentUrl: string;
  workspaceId: string;
}

export interface TokenRefreshJobData {
  channelId: string;
  workspaceId: string;
}

/** Outgoing webhook delivery (Phase 12) — one job per webhook per event. */
export interface OutgoingWebhookJobData {
  webhookId: string;
  workspaceId: string;
  /** An OutgoingWebhookEvent, or "webhook.test" for the Settings test ping. */
  event: string;
  /** Unique id of this delivery, echoed in the payload envelope. */
  deliveryId: string;
  /** Event data snapshot, built at dispatch time. */
  payload: Record<string, unknown>;
}

export interface GmailPollJobData {
  /** Absent = sweep every CONNECTED Gmail channel (the scheduled job). */
  channelId?: string;
}

/** Knowledge document processing — extract text from an uploaded file. */
export interface KnowledgeJobData {
  documentId: string;
  workspaceId: string;
}
