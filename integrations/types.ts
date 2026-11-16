import type { NormalizedInboundMessage, OutboundMessage, ProviderId } from "@/types/messaging";

/**
 * Provider adapter contract (Phase 0, Section 5).
 *
 * Every social platform implements this interface in its own folder
 * under `integrations/`. The messaging engine only ever talks to this
 * interface — platform quirks never leak into inbox/conversation code.
 *
 * Phase 1 ships the contract ONLY. No adapter is implemented yet and
 * nothing here makes network calls.
 */

export interface ProviderCapabilities {
  supportsTyping: boolean;
  supportsReadReceipts: boolean;
  supportsMedia: Array<"image" | "video" | "audio" | "file">;
  /** Hours a business may reply freely after the customer's last message. null = no window. */
  messagingWindowHours: number | null;
  /** WhatsApp: outside the window only pre-approved templates may be sent. */
  requiresTemplateOutsideWindow: boolean;
}

export interface ChannelCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface ChannelContext {
  channelId: string;
  workspaceId: string;
  provider: ProviderId;
  externalAccountId: string;
  credentials: ChannelCredentials;
}

export interface ContactProfile {
  name?: string;
  avatarUrl?: string;
  username?: string;
}

export interface WebhookVerificationRequest {
  headers: Headers;
  rawBody: string;
  searchParams: URLSearchParams;
}

export interface IMessagingProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  /** Start of the connect flow (OAuth URL, or bot-token form for Telegram). */
  getAuthUrl(workspaceId: string): string;
  /** Exchange an OAuth code for credentials to encrypt and store. */
  exchangeCode(code: string): Promise<ChannelCredentials>;
  refreshToken?(credentials: ChannelCredentials): Promise<ChannelCredentials>;

  /** Verify the provider's webhook signature over the RAW body. */
  verifyWebhook(req: WebhookVerificationRequest): boolean;
  /** Pure translation of a raw webhook payload — fixture-tested per provider. */
  parseWebhook(payload: unknown): NormalizedInboundMessage[];

  sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }>;
  sendTyping?(channel: ChannelContext, toExternalId: string): Promise<void>;
  markAsRead?(channel: ChannelContext, externalMessageId: string): Promise<void>;
  getContactProfile(channel: ChannelContext, externalUserId: string): Promise<ContactProfile>;
  downloadMedia?(url: string, channel: ChannelContext): Promise<Buffer>;
}
