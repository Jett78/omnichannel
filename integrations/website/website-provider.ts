import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/errors";
import type {
  ChannelContext,
  ConnectInput,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  WebhookVerificationRequest,
} from "@/integrations/types";
import type {
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
} from "@/types/messaging";

/**
 * Website live-chat provider (Phase 11) — our OWN channel, not an
 * external platform. The "platform" is this product: visitors chat
 * through the widget embedded on the workspace's website, and the
 * widget's public API (services/widget.service.ts) ingests their
 * messages directly into the engine. Agent replies are therefore
 * delivered by persistence itself — the visitor's widget polls the
 * conversation and renders new rows — so sendMessage simply
 * acknowledges the row with a generated id. Nothing here calls an
 * external service, and there is no webhook (verifyWebhook fails
 * closed; the widget API authenticates visitors with HMAC-signed
 * tokens instead).
 *
 * Media: agent attachments go through the engine's upload-first
 * flow; uploadMedia returns a `website-file:` reference and the
 * engine stores the bytes in StoredMedia, which the widget media
 * route serves to the visitor. Visitor uploads take the same
 * StoredMedia path in the widget service.
 */

export const WEBSITE_FILE_PREFIX = "website-file:";

export class WebsiteProvider implements IMessagingProvider {
  readonly id = "website" as const;
  readonly capabilities = {
    supportsTyping: false,
    supportsReadReceipts: false,
    supportsMedia: ["image", "video", "audio", "file"] as Array<
      "image" | "video" | "audio" | "file"
    >,
    messagingWindowHours: null,
    requiresTemplateOutsideWindow: false,
  };

  async connectAccount(_input: ConnectInput): Promise<ConnectResult> {
    void _input;
    throw new AppError(
      "Website channels are created from the Channels page — there is no external account to connect.",
      "WEBSITE_CHANNEL_FLOW_REQUIRED",
      400,
    );
  }

  async disconnectAccount(_channel: ChannelContext): Promise<void> {
    void _channel;
    // Nothing external to revoke: disconnecting marks the channel
    // DISCONNECTED and the widget API stops serving it.
  }

  verifyWebhook(_req: WebhookVerificationRequest): boolean {
    void _req;
    return false;
  }

  parseWebhook(_payload: unknown): NormalizedInboundMessage[] {
    void _payload;
    return [];
  }

  async sendMessage(_input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }> {
    void _input;
    // Delivery = the persisted message row, which the visitor's
    // widget fetches. The id is our own delivery reference.
    return { externalMessageId: `website-${randomUUID()}` };
  }

  async uploadMedia(_input: {
    channel: ChannelContext;
    media: { bytes: Buffer; mimeType: string; fileName: string };
  }): Promise<{ ref: string }> {
    void _input;
    // The engine stores the bytes in StoredMedia right after this
    // returns; the reference only needs to be unique and routable
    // to the media route (which serves the stored copy first).
    return { ref: `${WEBSITE_FILE_PREFIX}${randomUUID()}` };
  }

  async getContactProfile(
    _channel: ChannelContext,
    _externalUserId: string,
  ): Promise<ContactProfile> {
    void _channel;
    void _externalUserId;
    return {}; // The visitor's name comes from the pre-chat form at ingest.
  }

  async getConversations(
    _channel: ChannelContext,
    _options?: { limit?: number },
  ): Promise<NormalizedConversation[]> {
    void _channel;
    void _options;
    return [];
  }

  async getMessages(
    _channel: ChannelContext,
    _externalThreadId: string,
    _options?: { limit?: number },
  ): Promise<NormalizedInboundMessage[]> {
    void _channel;
    void _externalThreadId;
    void _options;
    return [];
  }
}

export const websiteProvider = new WebsiteProvider();
