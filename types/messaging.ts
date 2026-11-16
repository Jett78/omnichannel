import type { Provider as PrismaProvider } from "@/generated/prisma/client";

/**
 * Normalized messaging types — the only shapes the messaging engine
 * and inbox UI ever see. Provider adapters translate platform payloads
 * into these (see integrations/types.ts).
 */

export type ProviderId =
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "telegram"
  | "x"
  | "tiktok"
  /** Dev/test-only provider (Phase 4). Never a real platform. */
  | "mock";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "facebook",
  "instagram",
  "whatsapp",
  "telegram",
  "x",
  "tiktok",
  "mock",
];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Map the lowercase adapter id ↔ the Prisma `Provider` enum value. */
export function providerIdToEnum(id: ProviderId): PrismaProvider {
  return id.toUpperCase() as PrismaProvider;
}

export function providerEnumToId(provider: PrismaProvider): ProviderId {
  return provider.toLowerCase() as ProviderId;
}

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

export type SenderType = "CONTACT" | "AGENT" | "SYSTEM";

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

/** A conversation as reported by a provider (used for future backfill/sync). */
export interface NormalizedConversation {
  externalThreadId: string;
  contactExternalId: string;
  contactName?: string;
  lastMessageAt?: Date;
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
  /**
   * The provider message id this update refers to, or null for a
   * watermark-only update (advance everything sent up to `watermark`).
   */
  externalMessageId: string | null;
  status: MessageStatus;
  at: Date;
  /** Watermark updates: messages sent at or before this time advance. */
  watermark?: Date;
  /** Channel-scoped external id of the contact (PSID / IGSID) — used to resolve watermark updates. */
  contactExternalId?: string;
  /** External account id of the receiving channel (Page id / IG account id). */
  channelExternalAccountId?: string;
  error?: string;
  raw: unknown;
}

// ─── Unified internal message (Phase 4) ───────────────────────────────────────
// The canonical shape of a message inside our system, regardless of which
// platform it came from. Platform-specific extras live in `metadata`,
// never in dedicated fields. Prisma Message rows are mapped to/from this
// shape by `toUnifiedMessage` in services/messaging.service.ts — the
// single mapper used by services, API routes and realtime payloads.

export interface UnifiedAttachment {
  id: string;
  url: string | null;
  storageKey: string | null;
  mimeType: string | null;
  fileName: string | null;
  size: number | null;
}

export interface UnifiedMessage {
  id: string;
  workspaceId: string;
  channelId: string;
  conversationId: string;
  externalMessageId: string | null;
  /** Contact identity external id for inbound; acting user id for agent messages. */
  senderId: string;
  senderType: SenderType;
  content: string | null;
  messageType: MessageType;
  attachments: UnifiedAttachment[];
  direction: MessageDirection;
  status: MessageStatus;
  /** Platform-specific metadata, kept separate from the unified fields. */
  metadata: Record<string, unknown> | null;
  /** True when this is an internal agent note (type PRIVATE_NOTE) — never sent to the customer. */
  isPrivateNote: boolean;
  createdAt: Date;
}
