import type {
  DeliveryStatusUpdate,
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
  ProviderId,
} from "@/types/messaging";

/**
 * Provider adapter contract (Phase 0 §5, evolved in Phase 4).
 *
 * Every social platform implements this interface in its own folder
 * under `integrations/`. The messaging engine only ever talks to this
 * interface — platform quirks never leak into inbox/conversation code.
 *
 * Required surface (Phase 4): connectAccount, disconnectAccount,
 * sendMessage, getConversations, getMessages, verifyWebhook,
 * parseWebhook. OAuth helpers (getAuthUrl / exchangeCode /
 * refreshToken) stay optional — only providers with an OAuth flow
 * implement them.
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

/** Input for a provider connect flow (OAuth code exchange, bot token, …). */
export interface ConnectInput {
  workspaceId: string;
  displayName?: string;
  /** Provider-specific secrets supplied by the user (e.g. Telegram bot token). Never persisted raw. */
  credentials?: Record<string, string>;
}

export interface ConnectResult {
  externalAccountId: string;
  displayName: string;
  credentials: ChannelCredentials;
  config?: Record<string, unknown>;
}

export interface WebhookVerificationRequest {
  headers: Headers;
  rawBody: string;
  searchParams: URLSearchParams;
}

export interface IMessagingProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  /** Connect an account and return its identity + credentials (stored encrypted by the caller). */
  connectAccount(input: ConnectInput): Promise<ConnectResult>;
  /** Disconnect / deauthorize an account at the provider, if it supports it. */
  disconnectAccount(channel: ChannelContext): Promise<void>;

  /** OAuth flow helpers — implemented only by providers that use OAuth. */
  getAuthUrl?(workspaceId: string): string;
  exchangeCode?(code: string): Promise<ChannelCredentials>;
  refreshToken?(credentials: ChannelCredentials): Promise<ChannelCredentials>;

  /** Verify the provider's webhook signature over the RAW body. */
  verifyWebhook(req: WebhookVerificationRequest): boolean;
  /** Pure translation of a raw webhook payload — fixture-tested per provider. */
  parseWebhook(payload: unknown): NormalizedInboundMessage[];
  /**
   * Optional: translate delivery/read receipts in a webhook payload
   * into status updates for previously sent outbound messages.
   * Providers without receipts omit this; the engine treats that as
   * "no status updates in this event".
   */
  parseStatusUpdates?(payload: unknown): DeliveryStatusUpdate[];

  sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }>;

  /** Provider-side conversation list (backfill/sync). Our DB stays the source of truth. */
  getConversations(
    channel: ChannelContext,
    options?: { limit?: number },
  ): Promise<NormalizedConversation[]>;
  /** Provider-side message history for one thread (backfill/sync). */
  getMessages(
    channel: ChannelContext,
    externalThreadId: string,
    options?: { limit?: number },
  ): Promise<NormalizedInboundMessage[]>;

  sendTyping?(channel: ChannelContext, toExternalId: string): Promise<void>;
  markAsRead?(channel: ChannelContext, externalMessageId: string): Promise<void>;
  getContactProfile(channel: ChannelContext, externalUserId: string): Promise<ContactProfile>;
  downloadMedia?(url: string, channel: ChannelContext): Promise<Buffer>;
}
