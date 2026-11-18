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
  ImportedThread,
  MessageType,
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
} from "@/types/messaging";

import {
  facebookAppSecret,
  getFacebookConfig,
  metaGraphApiVersion,
  type FacebookMetaConfig,
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
 * Facebook Messenger provider (Phase 5) — official Meta Graph API /
 * Messenger Platform only.
 *
 * Auth model: Facebook Login for Business-style OAuth. The user
 * authorizes the app, we exchange the code for a user token, upgrade
 * it to a long-lived token, list the user's Pages via /me/accounts,
 * and store the selected Page's access token (encrypted, server-only)
 * as the channel credential. Connecting happens through
 * services/meta-connection.service.ts — `connectAccount` deliberately
 * refuses token-paste connects.
 *
 * Messaging window: Messenger enforces a 24h standard messaging
 * window; the messaging engine refuses out-of-window sends for this
 * provider before any API call is made.
 */

const GRAPH_HOST = "graph.facebook.com" as const;

export const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_messaging",
  "pages_manage_metadata",
] as const;

export const FACEBOOK_SUBSCRIBED_FIELDS =
  "messages,messaging_postbacks,message_deliveries,message_reads";

export interface MetaInstagramAccountSummary {
  id: string;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
}

export interface MetaPageAccount {
  id: string;
  name: string;
  category?: string;
  /** SERVER ONLY — the Page access token. Never serialize to the browser. */
  pageAccessToken: string;
  tasks: string[];
  eligible: boolean;
  ineligibleReason?: string;
  instagramAccount?: MetaInstagramAccountSummary;
}

interface GraphTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface GraphPage {
  id: string;
  name?: string;
  category?: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  };
}

interface GraphListResponse<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface GraphSuccessResponse {
  success?: boolean;
}

interface SendMessageResponse {
  recipient_id?: string;
  message_id: string;
}

interface GraphConversation {
  id: string;
  updated_time?: string;
  participants?: { data?: Array<{ id: string; name?: string }> };
}

interface GraphThreadMessage {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id: string; name?: string };
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

interface GraphProfile {
  first_name?: string;
  last_name?: string;
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

export class FacebookProvider implements IMessagingProvider {
  readonly id = "facebook" as const;
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

  /** appsecret_proof options when the deployment enables them; {} otherwise. */
  private proofOptions(config?: FacebookMetaConfig): {
    appSecret?: string;
    appsecretProof?: boolean;
  } {
    const cfg = config ?? this.tryConfig();
    return cfg?.appsecretProof ? { appSecret: cfg.appSecret, appsecretProof: true } : {};
  }

  private tryConfig(): FacebookMetaConfig | null {
    try {
      return getFacebookConfig();
    } catch {
      return null;
    }
  }

  // ─── OAuth (used by services/meta-connection.service.ts) ──────────────────

  buildAuthUrl(state: string): string {
    const config = getFacebookConfig();
    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.redirectUri,
      state,
      response_type: "code",
      scope: FACEBOOK_SCOPES.join(","),
    });
    return `https://www.facebook.com/${config.graphApiVersion}/dialog/oauth?${params.toString()}`;
  }

  /** The authorizing user's own id + name (GET /me). Diagnostic aid. */
  async getUserIdentity(
    userAccessToken: string,
  ): Promise<{ id: string; name?: string }> {
    const me = await this.client.get<{ id: string; name?: string }>(
      GRAPH_HOST,
      `/${this.version()}/me`,
      { accessToken: userAccessToken, params: { fields: "id,name" } },
    );
    return { id: me.id, ...(me.name ? { name: me.name } : {}) };
  }

  /**
   * Classic Facebook Login authorization URL with an explicit scope
   * set and redirect URI. Used by the Instagram connect flow, which
   * presents instagram scopes but returns to the Instagram callback.
   */
  buildScopedAuthUrl(state: string, scopes: readonly string[], redirectUri: string): string {
    const config = getFacebookConfig();
    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: scopes.join(","),
    });
    return `https://www.facebook.com/${config.graphApiVersion}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForUserToken(
    code: string,
    redirectUriOverride?: string,
  ): Promise<{ accessToken: string; expiresAt?: Date }> {
    const config = getFacebookConfig();
    const response = await this.client.post<GraphTokenResponse>(
      GRAPH_HOST,
      `/${config.graphApiVersion}/oauth/access_token`,
      {
        body: {
          client_id: config.appId,
          client_secret: config.appSecret,
          redirect_uri: redirectUriOverride ?? config.redirectUri,
          code,
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

  async exchangeLongLivedUserToken(
    shortLivedToken: string,
  ): Promise<{ accessToken: string; expiresAt?: Date }> {
    const config = getFacebookConfig();
    const response = await this.client.get<GraphTokenResponse>(
      GRAPH_HOST,
      `/${config.graphApiVersion}/oauth/access_token`,
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: config.appId,
          client_secret: config.appSecret,
          fb_exchange_token: shortLivedToken,
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

  /**
   * Pages the authorized user can access. Follows /me/accounts paging
   * (cursor-based, max 5 result pages). Page access tokens in the
   * result are SERVER-ONLY.
   */
  async listAccessiblePages(userAccessToken: string): Promise<MetaPageAccount[]> {
    const pages: MetaPageAccount[] = [];
    let after: string | undefined;
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      const response = await this.client.get<GraphListResponse<GraphPage>>(
        GRAPH_HOST,
        `/${this.version()}/me/accounts`,
        {
          accessToken: userAccessToken,
          ...this.proofOptions(),
          params: {
            fields:
              "id,name,category,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url}",
            limit: 100,
            ...(after ? { after } : {}),
          },
        },
      );
      for (const page of response.data ?? []) {
        const tasks = page.tasks ?? [];
        const canManage = tasks.includes("MANAGE") || tasks.includes("MODERATE");
        const eligible = Boolean(page.access_token) && canManage;
        pages.push({
          id: page.id,
          name: page.name ?? page.id,
          ...(page.category ? { category: page.category } : {}),
          pageAccessToken: page.access_token ?? "",
          tasks,
          eligible,
          ...(!eligible
            ? {
                ineligibleReason: !page.access_token
                  ? "Meta did not return a Page access token for this Page — your Facebook user may not administer it."
                  : "Your Facebook user does not have a Page role that can manage Messenger for this Page (a MANAGE or MODERATE task is required).",
              }
            : {}),
          ...(page.instagram_business_account
            ? {
                instagramAccount: {
                  id: page.instagram_business_account.id,
                  ...(page.instagram_business_account.username
                    ? { username: page.instagram_business_account.username }
                    : {}),
                  ...(page.instagram_business_account.name
                    ? { name: page.instagram_business_account.name }
                    : {}),
                  ...(page.instagram_business_account.profile_picture_url
                    ? { profilePictureUrl: page.instagram_business_account.profile_picture_url }
                    : {}),
                },
              }
            : {}),
        });
      }
      if (!response.paging?.next || !response.paging.cursors?.after) break;
      after = response.paging.cursors.after;
    }
    return pages;
  }

  async subscribePage(pageId: string, pageAccessToken: string): Promise<void> {
    const response = await this.client.post<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/${pageId}/subscribed_apps`,
      {
        accessToken: pageAccessToken,
        ...this.proofOptions(),
        params: { subscribed_fields: FACEBOOK_SUBSCRIBED_FIELDS },
      },
    );
    if (response.success !== true) {
      throw new MetaGraphError(
        `Webhook subscription for Page ${pageId} was not confirmed by Meta`,
        {
          status: 502,
        },
      );
    }
  }

  async unsubscribePage(pageId: string, pageAccessToken: string): Promise<void> {
    await this.client.del<GraphSuccessResponse>(
      GRAPH_HOST,
      `/${this.version()}/${pageId}/subscribed_apps`,
      { accessToken: pageAccessToken, ...this.proofOptions() },
    );
  }

  // ─── IMessagingProvider ───────────────────────────────────────────────────

  async connectAccount(): Promise<ConnectResult> {
    throw new AppError(
      "Facebook Pages connect through the official OAuth flow — use the Connect button on the Channels page (it stores the Page token via the meta connection service). Token-paste connects are not supported.",
      "OAUTH_FLOW_REQUIRED",
      400,
    );
  }

  async disconnectAccount(channel: ChannelContext): Promise<void> {
    // Best-effort: local disconnect must succeed even if Meta is
    // unreachable or the token is already invalid.
    try {
      if (channel.credentials.accessToken) {
        await this.unsubscribePage(channel.externalAccountId, channel.credentials.accessToken);
      }
    } catch (error) {
      console.warn(
        `[facebook] unsubscribe on disconnect failed for page ${channel.externalAccountId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  verifyWebhook(req: WebhookVerificationRequest): boolean {
    return verifyMetaSignature(
      req.rawBody,
      req.headers.get("x-hub-signature-256"),
      facebookAppSecret(),
    );
  }

  parseWebhook(payload: unknown): NormalizedInboundMessage[] {
    return parseMessengerMessages(payload, "page");
  }

  parseStatusUpdates(payload: unknown): DeliveryStatusUpdate[] {
    return parseMessengerStatusUpdates(payload, "page");
  }

  /**
   * Upload media bytes to the Page (POST /{page-id}/message_attachments)
   * and return the "meta-attachment:{id}" reference sendMessage delivers
   * by attachment_id.
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
    const pageId = channel.externalAccountId;
    const sendOne = async (messageBody: Record<string, unknown>): Promise<string> => {
      const response = await this.client.post<SendMessageResponse>(
        GRAPH_HOST,
        `/${this.version()}/${pageId}/messages`,
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
      throw new MetaGraphError("Cannot send an empty Messenger message (no text or attachments)", {
        status: 400,
      });
    }
    return { externalMessageId: lastMessageId };
  }

  async getConversations(
    channel: ChannelContext,
    options?: { limit?: number },
  ): Promise<NormalizedConversation[]> {
    const pageId = channel.externalAccountId;
    const response = await this.client.get<GraphListResponse<GraphConversation>>(
      GRAPH_HOST,
      `/${this.version()}/${pageId}/conversations`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        params: {
          platform: "messenger",
          fields: "id,participants{id,name},updated_time,snippet",
          limit: options?.limit ?? 25,
        },
      },
    );
    const conversations: NormalizedConversation[] = [];
    for (const conversation of response.data ?? []) {
      const contact = (conversation.participants?.data ?? []).find((p) => p.id !== pageId);
      if (!contact) continue;
      conversations.push({
        externalThreadId: conversation.id,
        contactExternalId: contact.id,
        ...(contact.name ? { contactName: contact.name } : {}),
        ...(conversation.updated_time
          ? { lastMessageAt: new Date(conversation.updated_time) }
          : {}),
        raw: conversation,
      });
    }
    return conversations;
  }

  /**
   * History import: read the Page's recent conversation threads WITH
   * their messages (both directions) from the conversations edge.
   * Meta returns messages newest-first; threads are returned with
   * messages oldest-first for ingest. Bounded by the caller's limits —
   * this is a recent-history backfill, not a full archive export.
   */
  async fetchRecentConversations(input: {
    channel: ChannelContext;
    conversationLimit: number;
    messageLimit: number;
  }): Promise<ImportedThread[]> {
    const { channel, conversationLimit, messageLimit } = input;
    const pageId = channel.externalAccountId;
    const response = await this.client.get<GraphListResponse<GraphConversationWithMessages>>(
      GRAPH_HOST,
      `/${this.version()}/${pageId}/conversations`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        params: {
          platform: "messenger",
          fields: `id,participants{id,name},messages.limit(${messageLimit}){id,message,from{id,name},created_time,attachments{data{id,mime_type,name,size,image_data{url},video_data{url},file_url}}}`,
          limit: conversationLimit,
        },
      },
    );
    const threads: ImportedThread[] = [];
    for (const thread of response.data ?? []) {
      const participant = (thread.participants?.data ?? []).find((p) => p.id !== pageId);
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
          direction: (item.from?.id === pageId ? "OUTBOUND" : "INBOUND") as
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
        ...(participant.name ? { participantName: participant.name } : {}),
        messages,
      });
    }
    return threads;
  }

  async getMessages(
    channel: ChannelContext,
    externalThreadId: string,
    options?: { limit?: number },
  ): Promise<NormalizedInboundMessage[]> {
    const pageId = channel.externalAccountId;
    const response = await this.client.get<GraphListResponse<GraphThreadMessage>>(
      GRAPH_HOST,
      `/${this.version()}/${externalThreadId}/messages`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        params: {
          fields:
            "id,message,from{id,name},created_time,attachments{image_data,video_data,file_url}",
          limit: options?.limit ?? 25,
        },
      },
    );
    const messages: NormalizedInboundMessage[] = [];
    for (const item of response.data ?? []) {
      if (!item.from || item.from.id === pageId) continue; // inbound only
      const attachmentData = item.attachments?.data?.[0];
      const attachmentUrl =
        attachmentData?.image_data?.url ?? attachmentData?.file_url ?? undefined;
      messages.push({
        externalMessageId: item.id,
        externalThreadId,
        senderExternalId: item.from.id,
        ...(item.from.name ? { senderName: item.from.name } : {}),
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
    const profile = await this.client.get<GraphProfile>(
      GRAPH_HOST,
      `/${this.version()}/${externalUserId}`,
      {
        accessToken: channel.credentials.accessToken,
        ...this.proofOptions(),
        params: { fields: "first_name,last_name,profile_pic" },
      },
    );
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
    return {
      ...(name ? { name } : {}),
      ...(profile.profile_pic ? { avatarUrl: profile.profile_pic } : {}),
    };
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
export const facebookProvider = new FacebookProvider();
