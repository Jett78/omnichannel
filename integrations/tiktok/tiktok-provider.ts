import type {
  DeliveryStatusUpdate,
  NormalizedConversation,
  NormalizedInboundMessage,
} from "@/types/messaging";

import type {
  ChannelCredentials,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  ProviderCapabilities,
} from "@/integrations/types";

import { TikTokAccessError } from "./tiktok-config";

/**
 * TikTok provider adapter (Phase 7) — ACCESS-GATED SCAFFOLD.
 *
 * TikTok's Business Messaging API is real (TikTok API for Business
 * v1.3) but NOT self-serve: the developer must pass TikTok's Data
 * Security & Privacy Review (plus the US Data Security Review + USDS
 * Addendum for US-registered accounts) before any Business Messaging
 * call can succeed, and only Advanced Access / Verified Business
 * Accounts are eligible. This deployment has not been approved —
 * see docs/TIKTOK-RESEARCH.md for the evidence and
 * docs/TIKTOK-ACCESS.md for the approval steps.
 *
 * Therefore this adapter deliberately does NOTHING operational:
 *  - every operational method throws TikTokAccessError with the
 *    gating reason (never a generic "not implemented");
 *  - verifyWebhook returns false, so the webhook route rejects
 *    inbound posts with 401 instead of recording events we could
 *    not authenticate;
 *  - capabilities are all off — nothing about this provider may be
 *    presented as working.
 *
 * Method parameters are omitted (the interface in
 * integrations/types.ts defines the full signatures) because every
 * method refuses before touching its arguments — the same stub
 * shape the mock provider uses for its no-op methods.
 *
 * NO TikTok endpoint is called, NO payload shape is parsed, and no
 * behaviour is faked. When TikTok approves this app, this file is
 * replaced by a real adapter built to the documented contract
 * (research doc §4) — the interface is the exact surface it will
 * implement.
 */
export class TikTokProvider implements IMessagingProvider {
  readonly id = "tiktok" as const;

  readonly capabilities: ProviderCapabilities = {
    supportsTyping: false,
    supportsReadReceipts: false,
    supportsMedia: [],
    messagingWindowHours: null,
    requiresTemplateOutsideWindow: false,
  };

  private gated(): never {
    throw new TikTokAccessError();
  }

  async connectAccount(): Promise<ConnectResult> {
    this.gated();
  }

  async disconnectAccount(): Promise<void> {
    this.gated();
  }

  getAuthUrl(): string {
    this.gated();
  }

  async exchangeCode(): Promise<ChannelCredentials> {
    this.gated();
  }

  async refreshToken(): Promise<ChannelCredentials> {
    this.gated();
  }

  verifyWebhook(): boolean {
    // We hold no approved TikTok app secret to verify the documented
    // TikTok-Signature HMAC against, and an unverifiable webhook must
    // never be trusted — reject everything until approval lands.
    return false;
  }

  parseWebhook(): NormalizedInboundMessage[] {
    this.gated();
  }

  parseStatusUpdates(): DeliveryStatusUpdate[] {
    this.gated();
  }

  async sendMessage(): Promise<{ externalMessageId: string }> {
    this.gated();
  }

  async getConversations(): Promise<NormalizedConversation[]> {
    this.gated();
  }

  async getMessages(): Promise<NormalizedInboundMessage[]> {
    this.gated();
  }

  async sendTyping(): Promise<void> {
    this.gated();
  }

  async markAsRead(): Promise<void> {
    this.gated();
  }

  async getContactProfile(): Promise<ContactProfile> {
    this.gated();
  }

  async downloadMedia(): Promise<Buffer> {
    this.gated();
  }
}

export const tiktokProvider = new TikTokProvider();
