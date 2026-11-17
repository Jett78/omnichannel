import { AppError } from "@/lib/errors";
import type {
  ChannelContext,
  ChannelCredentials,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  ProviderCapabilities,
  WebhookVerificationRequest,
} from "@/integrations/types";
import type {
  DeliveryStatusUpdate,
  ImportedThread,
  MessageType,
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
} from "@/types/messaging";

import {
  getInstagramConfig,
  instagramAppSecret,
  metaGraphApiVersion,
  type InstagramMetaConfig,
} from "@/integrations/meta/meta-config";
import {
  MetaGraphClient,
  MetaGraphError,
  type FetchLike,
} from "@/integrations/meta/meta-graph-client";
import {
  parseMessengerMessages,
  parseMessengerStatusUpdates,
  verifyMetaSignature,
} from "@/integrations/meta/messenger-webhook";

/**
 * Instagram provider (Phase 5) — the **Instagram API with Instagram
 * Login**: the currently supported Meta model. The account authorizes
 * directly with Instagram (no Facebook Page required), tokens are
 * issued by api.instagram.com / graph.instagram.com, and messaging
 * uses the Graph `/{ig-id}/messages` edge.
 *
 * Only Instagram *professional* accounts (Business or Creator) are
 * eligible for messaging; personal accounts are rejected at connect
 * time with a clear reason.
 *
 * The INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET used here are the
 * Instagram product's own credentials from the Meta app dashboard —
 * NOT the Facebook app secret.
 *
 * Messaging window: 24h standard window, enforced by the engine.
 */

const GRAPH_HOST = "graph.instagram.com" as const;
const API_HOST = "api.instagram.com" as const;

export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
] as const;

export const INSTAGRAM_SUBSCRIBED_FIELDS = "messages,messaging_postbacks,messaging_seen";

export const INSTAGRAM_PERSONAL_INELIGIBLE_REASON =
  "Personal Instagram accounts are not eligible — switch the account to a Business or Creator professional account.";

export interface MetaInstagramAccount {
  /** IGID — the account id used for Graph API calls and as the channel's externalAccountId. */
  id: string;
  userId: string;
  username?: string;
  name?: string;
  accountType: string;
  avatarUrl?: string;
  /** SERVER ONLY — long-lived access token. Never serialize to the browser. */
  accessToken: string;
  expiresAt?: Date;
  eligible: boolean;
  ineligibleReason?: string;
}

interface InstagramShortTokenResponse {
  access_token: string;
  user_id: number | string;
  permissions?: string[];
}

interface InstagramLongTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface InstagramProfileResponse {
  id: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
}

interface GraphSuccessResponse {
  success?: boolean;
}

interface SendMessageResponse {
  recipient_id?: string;
  message_id: string;
}

interface GraphListResponse<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface GraphConversation {
  id: string;
  updated_time?: string;
  participants?: { data?: Array<{ id: string; username?: string; name?: string }> };
}

interface GraphThreadMessage {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id: string; username?: string; name?: string };
  attachments?: {
    data?: Array<{
      id?: string;
      mime_type?: string;
      name?: string;
      size?: number;
      image_data?: { url?: string };
      video_data?: { url?: string };
      file_url?: string;
    }>;
  };
}

interface GraphConversationWithMessages extends GraphConversation {
  messages?: { data?: GraphThreadMessage[] };
}

interface GraphContactProfile {
  name?: string;
  username?: string;
  profile_pic?: string;
}

function expiresAtFrom(expiresInSeconds: number | undefined): Date | undefined {
  return expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : undefined;
}

/** originalUrl prefix for attachments uploaded via uploadMedia. */
export const META_ATTACHMENT_PREFIX = "meta-attachment:";

function attachmentSendType(message: OutboundMessage, mimeType?: string): string {
  const major = mimeType?.split("/")[0];
  if (major === "image" || major === "video" || major === "audio") return major;
  switch (message.type) {
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "AUDIO":
      return "audio";
    default:
      return "file";
  }
}

export class InstagramProvider implements IMessagingProvider {
  readonly id = "instagram" as const;
  readonly capabilities: ProviderCapabilities = {
    supportsTyping: true,
    supportsReadReceipts: true,
    supportsMedia: ["image", "video", "audio", "file"],
    messagingWindowHours: 24,
    requiresTemplateOutsideWindow: false,
  };

  private readonly client: MetaGraphClient;

  constructor(fetchImpl: FetchLike = fetch) {
    this.client = new MetaGraphClient(fetchImpl);
  }

  private version(): string {
    return metaGraphApiVersion();
  }

  private proofOptions(config?: InstagramMetaConfig): {
    appSecret?: string;
    appsecretProof?: boolean;
  } {
    let cfg = config;
    if (!cfg) {
      try {
        cfg = getInstagramConfig();
      } catch {
        return {};
      }
    }
    return cfg.appsecretProof ? { appSecret: cfg.appSecret, appsecretProof: true } : {};
  }

  // ─── Instagram Login OAuth (used by services/meta-connection.service.ts) ──

  buildAuthUrl(state: string): string {
    const config = getInstagramConfig();
    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: INSTAGRAM_SCOPES.join(","),
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  /** Step 1: authorization code → short-lived token + Instagram user id. */
  async exchangeCodeForShortToken(
    code: string,
  ): Promise<{ accessToken: string; userId: string; permissions: string[] }> {
    const config = getInstagramConfig();
    const response = await this.client.post<InstagramShortTokenResponse>(
      API_HOST,
      "/oauth/access_token",
      {
        form: {
          client_id: config.appId,
          client_secret: config.appSecret,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
          code,
        },
      },
    );
    return {
      accessToken: response.access_token,
      userId: String(response.user_id),
      permissions: response.permissions ?? [],
    };
  }

  /** Step 2: short-lived token → long-lived token (~60 days, refreshable). */
  async exchangeLongLivedToken(
    shortLivedToken: string,
  ): Promise<{ accessToken: string; expiresAt?: Date }> {
    const config = getInstagramConfig();
    const response = await this.client.get<InstagramLongTokenResponse>(
      GRAPH_HOST,
      "/access_token",
      {
        params: {
          grant_type: "ig_exchange_token",
          client_secret: config.appSecret,
          access_token: shortLivedToken,
        },
      },
    );
    return {
      accessToken: response.access_token,
      ...(expiresAtFrom(response.expires_in)
        ? { expiresAt: expiresAtFrom(response.expires_in) }
        : {}),
    };
  }

  async fetchProfile(accessToken: string): Promise<InstagramProfileResponse> {
    return this.client.get<InstagramProfileResponse>(GRAPH_HOST, `/${this.version()}/me`, {
      accessToken,
      ...this.proofOptions(),
      params: {
        fields: "id,user_id,username,name,account_type,profile_picture_url",
      },
    });
  }

  /** Full Instagram Login flow: code → long-lived token → profile + eligibility. */
  async authorizeWithCode(code: string): Promise<MetaInstagramAccount> {
    const short = await this.exchangeCodeForShortToken(code);
    const long = await this.exchangeLongLivedToken(short.accessToken);
    const profile = await this.fetchProfile(long.accessToken);
    const accountType = profile.account_type ?? "";
    const eligible = accountType === "BUSINESS" || accountType === "MEDIA_CREATOR";
    return {
      id: profile.id,
      userId: profile.user_id ?? short.userId,
      ...(profile.username ? { username: profile.username } : {}),
      ...(profile.name ? { name: profile.name } : {}),
      accountType,
      ...(profile.profile_picture_url ? { avatarUrl: profile.profile_picture_url } : {}),
      accessToken: long.accessToken,
      ...(long.expiresAt ? { expiresAt: long.expiresAt } : {}),
      eligible,
      ...(!eligible ? { ineligibleReason: INSTAGRAM_PERSONAL_INELIGIBLE_REASON } : {}),
    };
  }

  async subscribeAccount(accessToken: string): Promise<void> {
    const response = await this.client.post<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/me/subscribed_apps`,
      {
        accessToken,
        ...this.proofOptions(),
        params: { subscribed_fields: INSTAGRAM_SUBSCRIBED_FIELDS },
      },
    );
    if (response.success !== true) {
      throw new MetaGraphError("Instagram webhook subscription was not confirmed by Meta", {
        status: 502,
      });
    }
  }

  async unsubscribeAccount(accessToken: string): Promise<void> {
    await this.client.del<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/me/subscribed_apps`,
      { accessToken, ...this.proofOptions() },
    );
  }

  // ─── IMessagingProvider ───────────────────────────────────────────────────

  async connectAccount(): Promise<ConnectResult> {
    throw new AppError(
      "Instagram accounts connect through the official Instagram Login flow — use the Connect button on the Channels page (it stores the token via the meta connection service). Token-paste connects are not supported.",
      "OAUTH_FLOW_REQUIRED",
      400,
    );
  }

  async disconnectAccount(channel: ChannelContext): Promise<void> {
    // Best-effort: local disconnect must succeed even if Meta is
    // unreachable or the token is already invalid.
    try {
      if (channel.credentials.accessToken) {
        await this.unsubscribeAccount(channel.credentials.accessToken);
      }
    } catch (error) {
      console.warn(
        `[instagram] unsubscribe on disconnect failed for account ${channel.externalAccountId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Long-lived Instagram tokens are refreshed in place (ig_refresh_token). */
  async refreshToken(credentials: ChannelCredentials): Promise<ChannelCredentials> {
    const response = await this.client.get<InstagramLongTokenResponse>(
      GRAPH_HOST,
      "/refresh_access_token",
      {
        params: { grant_type: "ig_refresh_token", access_token: credentials.accessToken },
      },
    );
    return {
      accessToken: response.access_token,
      scopes: credentials.scopes,
      ...(expiresAtFrom(response.expires_in)
        ? { expiresAt: expiresAtFrom(response.expires_in) }
        : {}),
    };
  }

  verifyWebhook(req: WebhookVerificationRequest): boolean {
    return verifyMetaSignature(
      req.rawBody,
      req.headers.get("x-hub-signature-256"),
      instagramAppSecret(),
    );
  }

  parseWebhook(payload: unknown): NormalizedInboundMessage[] {
    return parseMessengerMessages(payload, "instagram");
  }

  parseStatusUpdates(payload: unknown): DeliveryStatusUpdate[] {
    return parseMessengerStatusUpdates(payload, "instagram");
  }

  /**
   * Upload media bytes (POST /{ig-id}/message_attachments) and return
   * the "meta-attachment:{id}" reference sendMessage delivers by
   * attachment_id — same Send API pattern as Messenger.
   */
  async uploadMedia(input: {
    channel: ChannelContext;
    media: { bytes: Buffer; mimeType: string; fileName: string };
  }): Promise<{ ref: string }> {
    const { channel, media } = input;
    const kind = media.mimeType.startsWith("image/")
      ? "image"
      : media.mimeType.startsWith("video/")
        ? "video"
        : media.mimeType.startsWith("audio/")
          ? "audio"
          : "file";
    const formData = new FormData();
    formData.set(
      "message",
      JSON.stringify({ attachment: { type: kind, payload: { is_reusable: true } } }),
    );
    formData.set(
      "filedata",
      new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }),
      media.fileName,
    );
    const response = await this.client.postMultipart<{ attachment_id?: string }>(
      GRAPH_HOST,
      `/${this.version()}/${channel.externalAccountId}/message_attachments`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        formData,
      },
    );
    if (!response.attachment_id) {
      throw new MetaGraphError("Meta attachment upload did not return an attachment id", {
        status: 502,
      });
    }
    return { ref: `${META_ATTACHMENT_PREFIX}${response.attachment_id}` };
  }

  async sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }> {
    const { channel, toExternalId, message } = input;
    const igAccountId = channel.externalAccountId;
    const sendOne = async (messageBody: Record<string, unknown>): Promise<string> => {
      const response = await this.client.post<SendMessageResponse>(
        GRAPH_HOST,
        `/${this.version()}/${igAccountId}/messages`,
        {
          accessToken: channel.credentials.accessToken,
          ...this.proofOptions(),
          body: {
            recipient: { id: toExternalId },
            messaging_type: "RESPONSE",
            message: messageBody,
          },
        },
      );
      return response.message_id;
    };

    let lastMessageId: string | undefined;
    if (message.body) {
      lastMessageId = await sendOne({ text: message.body });
    }
    for (const attachment of message.attachments ?? []) {
      lastMessageId = await sendOne({
        attachment: {
          type: attachmentSendType(message, attachment.mimeType),
          payload: attachment.url.startsWith(META_ATTACHMENT_PREFIX)
            ? { attachment_id: attachment.url.slice(META_ATTACHMENT_PREFIX.length) }
            : { url: attachment.url, is_reusable: false },
        },
      });
    }
    if (!lastMessageId) {
      throw new MetaGraphError("Cannot send an empty Instagram message (no text or attachments)", {
        status: 400,
      });
    }
    return { externalMessageId: lastMessageId };
  }

  /**
   * History import: read the account's recent conversation threads WITH
   * their messages (both directions) from the conversations edge —
   * same pattern as Messenger. Messages are returned oldest-first.
   */
  async fetchRecentConversations(input: {
    channel: ChannelContext;
    conversationLimit: number;
    messageLimit: number;
  }): Promise<ImportedThread[]> {
    const { channel, conversationLimit, messageLimit } = input;
    const igAccountId = channel.externalAccountId;
    const response = await this.client.get<GraphListResponse<GraphConversationWithMessages>>(
      GRAPH_HOST,
      `/${this.version()}/${igAccountId}/conversations`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        params: {
          platform: "instagram",
          fields: `id,participants{id,username,name},messages.limit(${messageLimit}){id,message,from{id,username,name},created_time,attachments{data{id,mime_type,name,size,image_data{url},video_data{url},file_url}}}`,
          limit: conversationLimit,
        },
      },
    );
    const threads: ImportedThread[] = [];
    for (const thread of response.data ?? []) {
      const participant = (thread.participants?.data ?? []).find((p) => p.id !== igAccountId);
      if (!participant) continue;
      const messages = [...(thread.messages?.data ?? [])].reverse().map((item) => {
        const attachments = (item.attachments?.data ?? []).map((a) => ({
          url: a.image_data?.url ?? a.video_data?.url ?? a.file_url ?? null,
          mimeType: a.mime_type ?? null,
          fileName: a.name ?? null,
          size: a.size ?? null,
        }));
        const firstMime = attachments[0]?.mimeType ?? "";
        const type: MessageType =
          attachments.length === 0
            ? "TEXT"
            : firstMime.startsWith("image/")
              ? "IMAGE"
              : firstMime.startsWith("video/")
                ? "VIDEO"
                : firstMime.startsWith("audio/")
                  ? "AUDIO"
                  : "FILE";
        return {
          externalMessageId: item.id,
          direction: (item.from?.id === igAccountId ? "OUTBOUND" : "INBOUND") as
            | "INBOUND"
            | "OUTBOUND",
          type,
          body: item.message ? item.message : null,
          sentAt: item.created_time ? new Date(item.created_time) : new Date(),
          attachments,
        };
      });
      threads.push({
        externalThreadId: thread.id,
        participantExternalId: participant.id,
        ...(participant.name
          ? { participantName: participant.name }
          : participant.username
            ? { participantName: participant.username }
            : {}),
        messages,
      });
    }
    return threads;
  }

  async getConversations(
    channel: ChannelContext,
    options?: { limit?: number },
  ): Promise<NormalizedConversation[]> {
    const igAccountId = channel.externalAccountId;
    const response = await this.client.get<GraphListResponse<GraphConversation>>(
      GRAPH_HOST,
      `/${this.version()}/${igAccountId}/conversations`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        params: {
          platform: "instagram",
          fields: "id,participants{id,username},updated_time",
          limit: options?.limit ?? 25,
        },
      },
    );
    const conversations: NormalizedConversation[] = [];
    for (const conversation of response.data ?? []) {
      const contact = (conversation.participants?.data ?? []).find((p) => p.id !== igAccountId);
      if (!contact) continue;
      conversations.push({
        externalThreadId: conversation.id,
        contactExternalId: contact.id,
        ...(contact.username
          ? { contactName: contact.username }
          : contact.name
            ? { contactName: contact.name }
            : {}),
        ...(conversation.updated_time
          ? { lastMessageAt: new Date(conversation.updated_time) }
          : {}),
        raw: conversation,
      });
    }
    return conversations;
  }

  async getMessages(
    channel: ChannelContext,
    externalThreadId: string,
    options?: { limit?: number },
  ): Promise<NormalizedInboundMessage[]> {
    const igAccountId = channel.externalAccountId;
    const response = await this.client.get<GraphListResponse<GraphThreadMessage>>(
      GRAPH_HOST,
      `/${this.version()}/${externalThreadId}/messages`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        params: {
          fields: "id,message,from{id,username},created_time,attachments",
          limit: options?.limit ?? 25,
        },
      },
    );
    const messages: NormalizedInboundMessage[] = [];
    for (const item of response.data ?? []) {
      if (!item.from || item.from.id === igAccountId) continue; // inbound only
      const attachmentData = item.attachments?.data?.[0];
      const attachmentUrl =
        attachmentData?.image_data?.url ?? attachmentData?.file_url ?? undefined;
      messages.push({
        externalMessageId: item.id,
        externalThreadId,
        senderExternalId: item.from.id,
        ...(item.from.username
          ? { senderName: item.from.username }
          : item.from.name
            ? { senderName: item.from.name }
            : {}),
        type: attachmentData ? (attachmentData.image_data ? "IMAGE" : "FILE") : "TEXT",
        ...(item.message !== undefined ? { body: item.message } : {}),
        ...(attachmentUrl ? { attachments: [{ url: attachmentUrl }] } : {}),
        sentAt: item.created_time ? new Date(item.created_time) : new Date(),
        raw: item,
      });
    }
    return messages;
  }

  async getContactProfile(
    channel: ChannelContext,
    externalUserId: string,
  ): Promise<ContactProfile> {
    // Best-effort: Instagram profile lookups can fail for users who
    // have not messaged recently; a failed lookup must not break ingest.
    try {
      const profile = await this.client.get<GraphContactProfile>(
        GRAPH_HOST,
        `/${this.version()}/${externalUserId}`,
        {
          accessToken: channel.credentials.accessToken,
          ...this.proofOptions(),
          params: { fields: "name,username,profile_pic" },
        },
      );
      return {
        ...(profile.name ? { name: profile.name } : {}),
        ...(profile.username ? { username: profile.username } : {}),
        ...(profile.profile_pic ? { avatarUrl: profile.profile_pic } : {}),
      };
    } catch {
      return {};
    }
  }

  async sendTyping(channel: ChannelContext, toExternalId: string): Promise<void> {
    await this.client.post<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/${channel.externalAccountId}/messages`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        body: { recipient: { id: toExternalId }, sender_action: "typing_on" },
      },
    );
  }

  async downloadMedia(url: string, channel: ChannelContext): Promise<Buffer> {
    return this.client.getBuffer(url, channel.credentials.accessToken);
  }
}

/** Shared singleton used by the registry and the meta connection service. */
export const instagramProvider = new InstagramProvider();
