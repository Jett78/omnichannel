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

export interface GmailPollJobData {
  /** Absent = sweep every CONNECTED Gmail channel (the scheduled job). */
  channelId?: string;
}
