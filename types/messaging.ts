/**
 * Normalized messaging types — the only shapes the messaging engine
 * and inbox UI ever see. Provider adapters translate platform payloads
 * into these (see integrations/types.ts).
 */

export type ProviderId = "facebook" | "instagram" | "whatsapp" | "telegram" | "x" | "tiktok";

export type MessageType =
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "FILE"
  | "LOCATION"
  | "STICKER"
  | "SYSTEM"
  | "PRIVATE_NOTE";

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type MessageStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";

export interface NormalizedAttachment {
  url: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
}

export interface NormalizedInboundMessage {
  externalMessageId: string;
  externalThreadId?: string;
  senderExternalId: string;
  senderName?: string;
  senderAvatarUrl?: string;
  type: MessageType;
  body?: string;
  attachments?: NormalizedAttachment[];
  sentAt: Date;
  raw: unknown;
}

export interface OutboundMessage {
  type: MessageType;
  body?: string;
  attachments?: NormalizedAttachment[];
  /** WhatsApp only: pre-approved template to use outside the 24h window. */
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}

export interface DeliveryStatusUpdate {
  externalMessageId: string;
  status: MessageStatus;
  at: Date;
  error?: string;
  raw: unknown;
}
