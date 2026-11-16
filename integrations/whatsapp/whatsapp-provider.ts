import { AppError } from "@/lib/errors";
import type {
  ChannelContext,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  ProviderCapabilities,
  WebhookVerificationRequest,
} from "@/integrations/types";
import type {
  DeliveryStatusUpdate,
  MessageType,
  NormalizedAttachment,
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
} from "@/types/messaging";

import {
  getWhatsAppConfig,
  requireWhatsAppEmbeddedConfig,
  whatsappAppSecret,
} from "@/integrations/meta/meta-config";
import {
  MetaGraphClient,
  MetaGraphError,
  type FetchLike,
} from "@/integrations/meta/meta-graph-client";
import { verifyMetaSignature } from "@/integrations/meta/messenger-webhook";

/**
 * WhatsApp Business Platform — Cloud API provider (Phase 6).
 *
 * Official Meta Graph API only (graph.facebook.com). A WhatsApp
 * channel is one registered phone number: Channel.externalAccountId
 * is the phone_number_id and Channel.config.wabaId identifies the
 * WhatsApp Business Account (WABA). The channel credential is either
 * the business token returned by Embedded Signup or a permanent
 * system-user token supplied through manual connect — both are stored
 * encrypted by the caller and never reach the browser.
 *
 * Platform rules honoured here / in the engine:
 *  - 24-hour customer service window: free-form messages only inside
 *    it; approved TEMPLATE messages are the outside-window path.
 *  - No Cloud API endpoints exist for listing conversations/messages
 *    or fetching a contact profile by wa_id — getConversations /
 *    getMessages return [] and getContactProfile returns {} rather
 *    than inventing endpoints. Our database is the source of truth;
 *    contact names arrive in webhook `contacts` payloads.
 */

const GRAPH_HOST = "graph.facebook.com" as const;

export const WHATSAPP_SCOPES = [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
] as const;

export const WHATSAPP_MEDIA_PREFIX = "whatsapp-media:";

// ─── Graph response shapes ────────────────────────────────────────────────────

interface GraphSuccessResponse {
  success?: boolean;
}

interface GraphTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface DebugTokenGranularScope {
  scope?: string;
  target_ids?: string[];
}

interface DebugTokenResponse {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    granular_scopes?: DebugTokenGranularScope[];
  };
}

export interface WhatsAppBusinessAccount {
  id: string;
  name: string;
  currency?: string;
  timezoneId?: string;
}

interface GraphWaba {
  id: string;
  name?: string;
  currency?: string;
  timezone_id?: string;
}

export interface WhatsAppPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  status?: string;
  codeVerificationStatus?: string;
  nameStatus?: string;
  qualityRating?: string;
  messagingLimit?: string;
  eligible: boolean;
  ineligibleReason?: string;
}

interface GraphPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
  name_status?: string;
  status?: string;
  quality_rating?: string;
  messaging_limit?: string;
}

export interface WhatsAppTemplateComponent {
  type: string;
  text?: string;
  format?: string;
}

export interface WhatsAppTemplate {
  id?: string;
  name: string;
  status: string;
  language: string;
  category: string;
  components: WhatsAppTemplateComponent[];
}

interface GraphTemplate {
  id?: string;
  name: string;
  status?: string;
  language?: string;
  category?: string;
  components?: Array<{ type?: string; text?: string; format?: string }>;
}

interface GraphListResponse<T> {
  data: T[];
}

interface SendMessageResponse {
  messages?: Array<{ id?: string }>;
}

interface GraphMediaLookup {
  url?: string;
  mime_type?: string;
  file_size?: number;
}

// ─── Webhook payload shapes ───────────────────────────────────────────────────

interface WhatsAppMediaObject {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

interface WhatsAppWebhookMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WhatsAppMediaObject;
  video?: WhatsAppMediaObject;
  audio?: WhatsAppMediaObject;
  document?: WhatsAppMediaObject;
  sticker?: WhatsAppMediaObject;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string } }>;
  reaction?: { message_id?: string; emoji?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  referral?: { headline?: string; body?: string; source_type?: string };
  order?: { catalog_id?: string; product_items?: unknown[] };
  system?: { body?: string; type?: string };
  context?: unknown;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface WhatsAppStatusError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { messaging_product?: string; details?: string };
}

interface WhatsAppWebhookStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: WhatsAppStatusError[];
}

interface WhatsAppWebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: WhatsAppWebhookMessage[];
  statuses?: WhatsAppWebhookStatus[];
  errors?: WhatsAppStatusError[];
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: WhatsAppWebhookValue }>;
  }>;
}

function toPayload(value: unknown): WhatsAppWebhookPayload | null {
  if (!value || typeof value !== "object") return null;
  return value as WhatsAppWebhookPayload;
}

function messageChanges(
  payload: unknown,
): Array<{ wabaId: string | undefined; value: WhatsAppWebhookValue }> {
  const parsed = toPayload(payload);
  if (!parsed || parsed.object !== "whatsapp_business_account" || !Array.isArray(parsed.entry)) {
    return [];
  }
  const changes: Array<{ wabaId: string | undefined; value: WhatsAppWebhookValue }> = [];
  for (const entry of parsed.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field === "messages" && change.value) {
        changes.push({ wabaId: entry.id, value: change.value });
      }
    }
  }
  return changes;
}

function sentAtFromSeconds(timestamp: string | undefined): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function mediaAttachment(
  media: WhatsAppMediaObject | undefined,
): NormalizedAttachment[] | undefined {
  if (!media?.id) return undefined;
  return [
    {
      url: `${WHATSAPP_MEDIA_PREFIX}${media.id}`,
      ...(media.mime_type ? { mimeType: media.mime_type } : {}),
      ...(media.filename ? { fileName: media.filename } : {}),
    },
  ];
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class WhatsAppProvider implements IMessagingProvider {
  readonly id = "whatsapp" as const;
  readonly capabilities: ProviderCapabilities = {
    supportsTyping: true,
    supportsReadReceipts: true,
    supportsMedia: ["image", "video", "audio", "file"],
    messagingWindowHours: 24,
    requiresTemplateOutsideWindow: true,
  };

  private readonly client: MetaGraphClient;

  constructor(fetchImpl: FetchLike = fetch) {
    this.client = new MetaGraphClient(fetchImpl);
  }

  private version(): string {
    return getWhatsAppConfig().graphApiVersion;
  }

  private proofOptions(accessToken: string | undefined): {
    appSecret?: string;
    appsecretProof?: boolean;
  } {
    const config = getWhatsAppConfig();
    return config.appsecretProof && config.appSecret && accessToken
      ? { appSecret: config.appSecret, appsecretProof: true }
      : {};
  }

  // ─── IMessagingProvider: connect / disconnect ─────────────────────────────

  async connectAccount(): Promise<ConnectResult> {
    throw new AppError(
      "WhatsApp numbers connect through Embedded Signup or the manual system-user-token flow on the Channels page (services/whatsapp-connection.service.ts). Direct token-paste connects through the generic provider contract are not supported.",
      "WHATSAPP_CONNECT_FLOW_REQUIRED",
      400,
    );
  }

  async disconnectAccount(channel: ChannelContext): Promise<void> {
    // Best-effort: remove the app's WABA webhook subscription. Local
    // disconnect must succeed even if Meta is unreachable or the token
    // is already invalid.
    try {
      const wabaId =
        channel.config && typeof channel.config.wabaId === "string"
          ? channel.config.wabaId
          : undefined;
      if (wabaId && channel.credentials.accessToken) {
        await this.client.del<GraphSuccessResponse>(
          GRAPH_HOST,
          `/${this.version()}/${wabaId}/subscribed_apps`,
          {
            accessToken: channel.credentials.accessToken,
            ...this.proofOptions(channel.credentials.accessToken),
          },
        );
      }
    } catch (error) {
      console.warn(
        `[whatsapp] unsubscribe on disconnect failed for channel ${channel.channelId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(req: WebhookVerificationRequest): boolean {
    return verifyMetaSignature(
      req.rawBody,
      req.headers.get("x-hub-signature-256"),
      whatsappAppSecret(),
    );
  }

  parseWebhook(payload: unknown): NormalizedInboundMessage[] {
    const messages: NormalizedInboundMessage[] = [];
    for (const { value } of messageChanges(payload)) {
      const nameByWaId = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) nameByWaId.set(contact.wa_id, contact.profile.name);
      }
      if ((value.errors ?? []).length > 0) {
        console.warn(
          "[whatsapp] webhook value carried errors (delivery problems surface via statuses):",
          JSON.stringify(value.errors),
        );
      }
      for (const message of value.messages ?? []) {
        const parsed = this.parseOneMessage(message, nameByWaId);
        if (parsed) messages.push(parsed);
      }
    }
    return messages;
  }

  private parseOneMessage(
    message: WhatsAppWebhookMessage,
    nameByWaId: Map<string, string>,
  ): NormalizedInboundMessage | null {
    if ((message.errors ?? []).length > 0) {
      // A message-level error entry is a delivery problem, not content.
      console.warn(
        "[whatsapp] skipping message event with errors:",
        JSON.stringify(message.errors),
      );
      return null;
    }
    if (!message.from || !message.id) return null;
    const base = {
      externalMessageId: message.id,
      externalThreadId: message.from,
      senderExternalId: message.from,
      ...(nameByWaId.get(message.from) ? { senderName: nameByWaId.get(message.from) } : {}),
      sentAt: sentAtFromSeconds(message.timestamp),
      raw: message,
    };

    switch (message.type) {
      case "text":
        return { ...base, type: "TEXT", ...(message.text?.body !== undefined ? { body: message.text.body } : {}) };
      case "image": {
        const attachments = mediaAttachment(message.image);
        return {
          ...base,
          type: "IMAGE",
          ...(message.image?.caption ? { body: message.image.caption } : {}),
          ...(attachments ? { attachments } : {}),
        };
      }
      case "video": {
        const attachments = mediaAttachment(message.video);
        return {
          ...base,
          type: "VIDEO",
          ...(message.video?.caption ? { body: message.video.caption } : {}),
          ...(attachments ? { attachments } : {}),
        };
      }
      case "audio": {
        const attachments = mediaAttachment(message.audio);
        return { ...base, type: "AUDIO", ...(attachments ? { attachments } : {}) };
      }
      case "document": {
        const attachments = mediaAttachment(message.document);
        return {
          ...base,
          type: "FILE",
          ...(message.document?.caption ? { body: message.document.caption } : {}),
          ...(attachments ? { attachments } : {}),
        };
      }
      case "sticker": {
        const attachments = mediaAttachment(message.sticker);
        return { ...base, type: "STICKER", ...(attachments ? { attachments } : {}) };
      }
      case "location": {
        const parts = [message.location?.name, message.location?.address].filter(
          (part): part is string => Boolean(part),
        );
        return {
          ...base,
          type: "LOCATION",
          ...(parts.length > 0 ? { body: parts.join(" — ") } : {}),
        };
      }
      case "contacts": {
        const name = message.contacts?.[0]?.name?.formatted_name;
        return {
          ...base,
          type: "SYSTEM",
          body: name ? `Shared contact: ${name}` : "Shared a contact",
        };
      }
      case "reaction":
        return {
          ...base,
          type: "SYSTEM",
          body: message.reaction?.emoji
            ? `Reacted ${message.reaction.emoji} to a message`
            : "Removed a reaction",
        };
      case "order":
        return { ...base, type: "SYSTEM", body: "Sent an order" };
      case "button":
        return { ...base, type: "SYSTEM", body: message.button?.text ?? "Button tap" };
      case "referral":
        return {
          ...base,
          type: "SYSTEM",
          body: message.referral?.headline ?? message.referral?.body ?? "Referral",
        };
      case "interactive": {
        const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
        if (reply?.title) {
          // Agents should see exactly what the customer tapped.
          return { ...base, type: "TEXT", body: reply.title };
        }
        return { ...base, type: "SYSTEM", body: "Interactive reply" };
      }
      case "system":
        return { ...base, type: "SYSTEM", body: message.system?.body ?? "System event" };
      default:
        // Never drop an unknown type silently — surface it as a system
        // message so agents can see something arrived.
        return {
          ...base,
          type: "SYSTEM" as MessageType,
          body: `Unsupported WhatsApp message type: ${message.type ?? "unknown"}`,
        };
    }
  }

  parseStatusUpdates(payload: unknown): DeliveryStatusUpdate[] {
    const updates: DeliveryStatusUpdate[] = [];
    const statusByName: Record<string, DeliveryStatusUpdate["status"]> = {
      sent: "SENT",
      delivered: "DELIVERED",
      read: "READ",
      failed: "FAILED",
    };
    for (const { value } of messageChanges(payload)) {
      const phoneNumberId = value.metadata?.phone_number_id;
      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        const mapped = statusByName[status.status];
        if (!mapped) continue;
        const firstError = status.errors?.[0];
        const errorText = firstError
          ? [firstError.title, firstError.error_data?.details ?? firstError.message]
              .filter((part): part is string => Boolean(part))
              .join(": ")
          : undefined;
        updates.push({
          externalMessageId: status.id,
          status: mapped,
          at: sentAtFromSeconds(status.timestamp),
          ...(status.recipient_id ? { contactExternalId: status.recipient_id } : {}),
          ...(phoneNumberId ? { channelExternalAccountId: phoneNumberId } : {}),
          ...(errorText ? { error: errorText } : {}),
          raw: status,
        });
      }
    }
    return updates;
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  async sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }> {
    const { channel, toExternalId, message } = input;
    const phoneNumberId = channel.externalAccountId;
    const sendBody = async (body: Record<string, unknown>): Promise<string> => {
      const response = await this.client.post<SendMessageResponse>(
        GRAPH_HOST,
        `/${this.version()}/${phoneNumberId}/messages`,
        {
          accessToken: channel.credentials.accessToken,
          ...this.proofOptions(channel.credentials.accessToken),
          body: { messaging_product: "whatsapp", recipient_type: "individual", to: toExternalId, ...body },
        },
      );
      const id = response.messages?.[0]?.id;
      if (!id) {
        throw new MetaGraphError("WhatsApp send response did not include a message id", {
          status: 502,
        });
      }
      return id;
    };

    // Template messages — the approved outside-window path.
    if (message.type === "TEMPLATE" || message.templateName) {
      if (!message.templateName) {
        throw new MetaGraphError("Template send requires a template name", { status: 400 });
      }
      const params = message.templateParams ?? [];
      return {
        externalMessageId: await sendBody({
          type: "template",
          template: {
            name: message.templateName,
            language: { code: message.templateLanguage ?? "en_US" },
            ...(params.length > 0
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: params.map((text) => ({ type: "text", text })),
                    },
                  ],
                }
              : {}),
          },
        }),
      };
    }

    if (message.type === "LOCATION") {
      throw new MetaGraphError(
        "Location messages cannot be sent from the inbox composer yet",
        { status: 400 },
      );
    }

    let lastMessageId: string | undefined;
    if (message.body && (message.type === "TEXT" || (message.attachments ?? []).length === 0)) {
      lastMessageId = await sendBody({
        type: "text",
        text: { body: message.body, preview_url: /https?:\/\/\S+/.test(message.body) },
      });
    }
    for (const attachment of message.attachments ?? []) {
      const kind =
        message.type === "IMAGE"
          ? "image"
          : message.type === "VIDEO"
            ? "video"
            : message.type === "AUDIO"
              ? "audio"
              : "document";
      const mediaRef = attachment.url.startsWith(WHATSAPP_MEDIA_PREFIX)
        ? { id: attachment.url.slice(WHATSAPP_MEDIA_PREFIX.length) }
        : { link: attachment.url };
      const caption =
        message.body && kind !== "audio" ? { caption: message.body } : {};
      lastMessageId = await sendBody({
        type: kind,
        [kind]: {
          ...mediaRef,
          ...caption,
          ...(kind === "document" && attachment.fileName ? { filename: attachment.fileName } : {}),
        },
      });
    }
    if (!lastMessageId) {
      throw new MetaGraphError("Cannot send an empty WhatsApp message (no text or attachments)", {
        status: 400,
      });
    }
    return { externalMessageId: lastMessageId };
  }

  /** WhatsApp read receipt: POST messages with status:"read" + the wamid. */
  async markAsRead(channel: ChannelContext, externalMessageId: string): Promise<void> {
    await this.client.post<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/${channel.externalAccountId}/messages`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(channel.credentials.accessToken),
        body: { messaging_product: "whatsapp", status: "read", message_id: externalMessageId },
      },
    );
  }

  // sendTyping is deliberately NOT implemented: WhatsApp's typing
  // indicator requires the message_id of a specific inbound message as
  // context, which the optional interface signature (channel +
  // recipient only) cannot supply.

  async getContactProfile(): Promise<ContactProfile> {
    // WhatsApp exposes no profile lookup by wa_id. Names arrive with
    // each webhook's `contacts` array and are stored at ingest time.
    return {};
  }

  async getConversations(): Promise<NormalizedConversation[]> {
    // The Cloud API has no conversation-list endpoint. Our database is
    // the source of truth — do not invent one.
    return [];
  }

  async getMessages(): Promise<NormalizedInboundMessage[]> {
    // The Cloud API has no message-history endpoint (see above).
    return [];
  }

  /**
   * Two-step media download: resolve the media id to a short-lived
   * download URL, then fetch the bytes — both Bearer-authenticated.
   * Accepts a `whatsapp-media:<id>` ref, a raw media id, or a direct
   * URL (returned as-is via an authenticated GET).
   */
  async downloadMedia(mediaRef: string, channel: ChannelContext): Promise<Buffer> {
    const token = channel.credentials.accessToken;
    if (/^https?:\/\//.test(mediaRef)) {
      return this.client.getBuffer(mediaRef, token);
    }
    const mediaId = mediaRef.startsWith(WHATSAPP_MEDIA_PREFIX)
      ? mediaRef.slice(WHATSAPP_MEDIA_PREFIX.length)
      : mediaRef;
    const lookup = await this.client.get<GraphMediaLookup>(
      GRAPH_HOST,
      `/${this.version()}/${mediaId}`,
      { accessToken: token, ...this.proofOptions(token) },
    );
    if (!lookup.url) {
      throw new MetaGraphError(`Media ${mediaId} did not resolve to a download URL`, {
        status: 502,
      });
    }
    return this.client.getBuffer(lookup.url, token);
  }

  // ─── Management API (used by services/whatsapp-connection.service.ts) ─────

  async exchangeEmbeddedSignupCode(code: string): Promise<{ accessToken: string }> {
    const config = requireWhatsAppEmbeddedConfig();
    const response = await this.client.get<GraphTokenResponse>(
      GRAPH_HOST,
      `/${config.graphApiVersion}/oauth/access_token`,
      {
        params: {
          client_id: config.appId,
          client_secret: config.appSecret,
          code,
        },
      },
    );
    return { accessToken: response.access_token };
  }

  async debugToken(
    token: string,
  ): Promise<{ isValid: boolean; expiresAt: Date | null; wabaIds: string[]; scopes: string[] }> {
    const config = requireWhatsAppEmbeddedConfig();
    const response = await this.client.get<DebugTokenResponse>(
      GRAPH_HOST,
      `/${config.graphApiVersion}/debug_token`,
      {
        params: {
          input_token: token,
          access_token: `${config.appId}|${config.appSecret}`,
        },
      },
    );
    const data = response.data;
    const wabaIds = new Set<string>();
    for (const granular of data?.granular_scopes ?? []) {
      if (
        granular.scope === "whatsapp_business_management" ||
        granular.scope === "whatsapp_business_messaging"
      ) {
        for (const targetId of granular.target_ids ?? []) wabaIds.add(targetId);
      }
    }
    return {
      isValid: data?.is_valid === true,
      expiresAt: data?.expires_at ? new Date(data.expires_at * 1000) : null,
      wabaIds: [...wabaIds],
      scopes: data?.scopes ?? [],
    };
  }

  async getWaba(wabaId: string, accessToken: string): Promise<WhatsAppBusinessAccount> {
    const response = await this.client.get<GraphWaba>(GRAPH_HOST, `/${this.version()}/${wabaId}`, {
      accessToken,
      ...this.proofOptions(accessToken),
      params: { fields: "id,name,currency,timezone_id" },
    });
    return {
      id: response.id,
      name: response.name ?? response.id,
      ...(response.currency ? { currency: response.currency } : {}),
      ...(response.timezone_id ? { timezoneId: response.timezone_id } : {}),
    };
  }

  async listPhoneNumbers(wabaId: string, accessToken: string): Promise<WhatsAppPhoneNumber[]> {
    const response = await this.client.get<GraphListResponse<GraphPhoneNumber>>(
      GRAPH_HOST,
      `/${this.version()}/${wabaId}/phone_numbers`,
      {
        accessToken,
        ...this.proofOptions(accessToken),
        params: {
          fields:
            "id,display_phone_number,verified_name,code_verification_status,name_status,status,quality_rating,messaging_limit",
        },
      },
    );
    return (response.data ?? []).map((number) => {
      const eligible =
        number.status === "CONNECTED" || number.code_verification_status === "VERIFIED";
      return {
        id: number.id,
        displayPhoneNumber: number.display_phone_number ?? number.id,
        verifiedName: number.verified_name ?? number.display_phone_number ?? number.id,
        ...(number.status ? { status: number.status } : {}),
        ...(number.code_verification_status
          ? { codeVerificationStatus: number.code_verification_status }
          : {}),
        ...(number.name_status ? { nameStatus: number.name_status } : {}),
        ...(number.quality_rating ? { qualityRating: number.quality_rating } : {}),
        ...(number.messaging_limit ? { messagingLimit: number.messaging_limit } : {}),
        eligible,
        ...(!eligible
          ? {
              ineligibleReason: `This number is not connected/verified yet (status: ${number.status ?? "unknown"}, code verification: ${number.code_verification_status ?? "unknown"}). Finish registration/verification in WhatsApp Manager first.`,
            }
          : {}),
      };
    });
  }

  async subscribeWaba(wabaId: string, accessToken: string): Promise<void> {
    const response = await this.client.post<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/${wabaId}/subscribed_apps`,
      { accessToken, ...this.proofOptions(accessToken), body: {} },
    );
    if (response.success !== true) {
      throw new MetaGraphError(
        `Webhook subscription for WhatsApp Business Account ${wabaId} was not confirmed by Meta`,
        { status: 502 },
      );
    }
  }

  async registerPhoneNumber(
    phoneNumberId: string,
    accessToken: string,
    pin: string,
  ): Promise<void> {
    const response = await this.client.post<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/${phoneNumberId}/register`,
      {
        accessToken,
        ...this.proofOptions(accessToken),
        body: { messaging_product: "whatsapp", pin },
      },
    );
    if (response.success !== true) {
      throw new MetaGraphError(
        `Registration for phone number ${phoneNumberId} was not confirmed by Meta`,
        { status: 502 },
      );
    }
  }

  async deregisterPhoneNumber(phoneNumberId: string, accessToken: string): Promise<void> {
    const response = await this.client.post<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/${phoneNumberId}/deregister`,
      {
        accessToken,
        ...this.proofOptions(accessToken),
        body: { messaging_product: "whatsapp" },
      },
    );
    if (response.success !== true) {
      throw new MetaGraphError(
        `Deregistration for phone number ${phoneNumberId} was not confirmed by Meta`,
        { status: 502 },
      );
    }
  }

  async listTemplates(wabaId: string, accessToken: string): Promise<WhatsAppTemplate[]> {
    const response = await this.client.get<GraphListResponse<GraphTemplate>>(
      GRAPH_HOST,
      `/${this.version()}/${wabaId}/message_templates`,
      {
        accessToken,
        ...this.proofOptions(accessToken),
        params: {
          fields: "name,status,language,category,components",
          limit: 100,
        },
      },
    );
    return (response.data ?? []).map((template) => ({
      ...(template.id ? { id: template.id } : {}),
      name: template.name,
      status: template.status ?? "UNKNOWN",
      language: template.language ?? "en_US",
      category: template.category ?? "UTILITY",
      components: (template.components ?? []).map((component) => ({
        type: component.type ?? "BODY",
        ...(component.text ? { text: component.text } : {}),
        ...(component.format ? { format: component.format } : {}),
      })),
    }));
  }
}

/** Shared singleton used by the registry and the WhatsApp connection service. */
export const whatsappProvider = new WhatsAppProvider();
