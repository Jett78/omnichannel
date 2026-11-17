import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getEnv } from "@/lib/env";
import type {
  ChannelContext,
  ConnectInput,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  ProviderCapabilities,
  WebhookVerificationRequest,
} from "@/integrations/types";
import type {
  DeliveryStatusUpdate,
  MessageType,
  NormalizedConversation,
  NormalizedInboundMessage,
} from "@/types/messaging";

/**
 * MOCK provider — DEV/TEST ONLY (Phase 4).
 *
 * Implements the full IMessagingProvider contract against nothing: no
 * network calls, no real platform. It exists so the messaging engine,
 * webhook pipeline, queues and realtime can be exercised end-to-end
 * before real adapters (Telegram, Meta, …) land. It is registered
 * only outside production (or with ENABLE_MOCK_PROVIDER=true) and its
 * messages must never be presented as real social media messages.
 *
 * Test hooks:
 * - sendMessage throws when the content contains "[fail]", to exercise
 *   the outbound retry → FAILED path.
 * - Webhooks are authenticated with the `x-mock-signature` header,
 *   which must equal MOCK_WEBHOOK_SECRET (default "dev-mock-secret").
 */

const MESSAGE_TYPES: readonly MessageType[] = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "FILE",
  "LOCATION",
  "STICKER",
  "SYSTEM",
];

const mockEventSchema = z.object({
  externalMessageId: z.string().min(1),
  senderExternalId: z.string().min(1),
  senderName: z.string().optional(),
  senderAvatarUrl: z.string().optional(),
  text: z.string().optional(),
  type: z.string().optional(),
  sentAt: z.string().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string(),
        mimeType: z.string().optional(),
        fileName: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .optional(),
});

const mockPayloadSchema = z.object({
  eventId: z.string().optional(),
  channelId: z.string().optional(),
  channelExternalAccountId: z.string().optional(),
  events: z.array(mockEventSchema),
});

function toMessageType(raw: string | undefined): MessageType {
  if (!raw) return "TEXT";
  const upper = raw.toUpperCase();
  return (MESSAGE_TYPES as readonly string[]).includes(upper) ? (upper as MessageType) : "TEXT";
}

export const mockProvider: IMessagingProvider = {
  id: "mock",
  capabilities: {
    supportsTyping: false,
    supportsReadReceipts: false,
    supportsMedia: ["image", "video", "audio", "file"],
    messagingWindowHours: null,
    requiresTemplateOutsideWindow: false,
  } satisfies ProviderCapabilities,

  async connectAccount(input: ConnectInput): Promise<ConnectResult> {
    return {
      // Globally unique per workspace so webhook channel resolution is unambiguous.
      externalAccountId: `mock-${input.workspaceId}`,
      displayName: input.displayName ?? "Mock Channel (dev only)",
      credentials: { accessToken: "mock-token", scopes: [] },
      config: { mock: true },
    };
  },

  async disconnectAccount(channel: ChannelContext): Promise<void> {
    console.log(
      `[mock] disconnectAccount channel=${channel.channelId} account=${channel.externalAccountId} (no-op, dev provider)`,
    );
  },

  verifyWebhook(req: WebhookVerificationRequest): boolean {
    const expected = getEnv().MOCK_WEBHOOK_SECRET;
    return req.headers.get("x-mock-signature") === expected;
  },

  parseWebhook(payload: unknown): NormalizedInboundMessage[] {
    const parsed = mockPayloadSchema.parse(payload);
    return parsed.events.map((event) => ({
      externalMessageId: event.externalMessageId,
      senderExternalId: event.senderExternalId,
      ...(event.senderName ? { senderName: event.senderName } : {}),
      ...(event.senderAvatarUrl ? { senderAvatarUrl: event.senderAvatarUrl } : {}),
      type: toMessageType(event.type),
      ...(event.text !== undefined ? { body: event.text } : {}),
      ...(event.attachments ? { attachments: event.attachments } : {}),
      sentAt: event.sentAt ? new Date(event.sentAt) : new Date(),
      raw: event,
    }));
  },

  parseStatusUpdates(): DeliveryStatusUpdate[] {
    // The mock platform emits no delivery/read receipts.
    return [];
  },

  async sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: { type: MessageType; body?: string };
  }): Promise<{ externalMessageId: string }> {
    if (input.message.body?.includes("[fail]")) {
      throw new Error("Mock provider send failure (simulated via [fail] marker)");
    }
    const externalMessageId = `mock-out-${randomUUID()}`;
    console.log(
      `[mock] sendMessage channel=${input.channel.channelId} to=${input.toExternalId} → ${externalMessageId} (simulated, nothing was delivered to a real platform)`,
    );
    return { externalMessageId };
  },

  async uploadMedia(input: {
    media: { bytes: Buffer; mimeType: string; fileName: string };
  }): Promise<{ ref: string }> {
    return { ref: `mock-media:${input.media.fileName}` };
  },

  async getConversations(): Promise<NormalizedConversation[]> {
    // Conversation state lives in our database; the mock has no remote side.
    return [];
  },

  async getMessages(): Promise<NormalizedInboundMessage[]> {
    return [];
  },

  async getContactProfile(): Promise<ContactProfile> {
    // Profiles arrive inside mock webhook payloads (senderName).
    return {};
  },
};
