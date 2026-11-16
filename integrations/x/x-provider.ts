import { AppError } from "@/lib/errors";
import type {
  ChannelContext,
  ChannelCredentials,
  ConnectInput,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  ProviderCapabilities,
  WebhookVerificationRequest,
} from "@/integrations/types";
import type {
  DeliveryStatusUpdate,
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
} from "@/types/messaging";

import { getXConfig, xWebhookSigningSecrets } from "@/integrations/x/x-config";
import { XApiClient, XApiError, type FetchLike } from "@/integrations/x/x-api-client";
import {
  normalizeDmEvent,
  parseXStatusUpdates,
  parseXWebhookMessages,
  verifyXSignature,
  type XDmEvent,
  type XIncludes,
} from "@/integrations/x/x-webhook";

/**
 * X (Twitter) provider (Phase 8) — official X API v2 only.
 *
 * Access model (docs/X-RESEARCH.md, verdict A): Direct Messages are
 * self-serve on X's pay-per-use pricing. Every call acts on the
 * CONNECTED ACCOUNT'S OWN DMs with its OAuth 2.0 user token — X does
 * not support app-only DM access.
 *
 * Auth model: OAuth 2.0 Authorization Code + PKCE. The user
 * authorizes the app (scopes below), we exchange the code, resolve
 * the account via GET /2/users/me, and store the tokens ENCRYPTED as
 * the channel credential. Connecting happens through
 * services/x-connection.service.ts — `connectAccount` deliberately
 * refuses token-paste connects. Access tokens live 2 hours; the
 * offline.access scope yields a refresh token, and X ROTATES refresh
 * tokens on every refresh (the new one must be persisted).
 *
 * Platform rules honoured here:
 *  - No messaging window (unlike Meta) — sends are attempted whenever
 *    the agent replies; whether a recipient accepts the message is
 *    governed by THEIR DM settings, and X's 403 is surfaced verbatim
 *    on the failed message, never hidden or faked.
 *  - DM history via the API is limited to the last 30 days; our DB
 *    is the long-term record.
 *  - There is no conversation-list endpoint: getConversations groups
 *    GET /2/dm_events by dm_conversation_id.
 *  - Outbound media requires a media_id from X's separate Media
 *    Upload flow (not wired in this phase): an attachment send fails
 *    with a clear error instead of pretending.
 */

export const X_SCOPES = [
  "dm.read",
  "dm.write",
  "tweet.read",
  "users.read",
  "offline.access",
] as const;

const DM_EVENT_FIELDS =
  "created_at,sender_id,dm_conversation_id,participant_ids,attachments";
const DM_EXPANSIONS = "sender_id,participant_ids,attachments.media_keys";
const USER_FIELDS = "name,username,profile_image_url";
const MEDIA_FIELDS = "url,preview_image_url,type";

export interface XTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface XProfile {
  id: string;
  name: string;
  username: string;
  profileImageUrl?: string;
}

interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface XDataResponse<T> {
  data?: T;
  includes?: XIncludes;
  meta?: { next_token?: string; result_count?: number };
}

interface XDmEventsResponse {
  data?: XDmEvent[];
  includes?: XIncludes;
  meta?: { next_token?: string; result_count?: number };
}

interface XSendDmResponse {
  data?: { dm_conversation_id?: string; dm_event_id?: string };
}

interface XSubscriptionResponse {
  data?: { id?: string; subscription_id?: string };
}

function expiresAtFrom(expiresInSeconds: number | undefined): Date | undefined {
  return expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : undefined;
}

function toTokens(response: XTokenResponse): XTokens {
  return {
    accessToken: response.access_token,
    ...(response.refresh_token ? { refreshToken: response.refresh_token } : {}),
    ...(expiresAtFrom(response.expires_in)
      ? { expiresAt: expiresAtFrom(response.expires_in) }
      : {}),
    scopes: response.scope ? response.scope.split(" ").filter(Boolean) : [],
  };
}

export class XProvider implements IMessagingProvider {
  readonly id = "x" as const;
  readonly capabilities: ProviderCapabilities = {
    // Typing can be RECEIVED as an event but not sent via the v2 DM
    // REST endpoints, so the composer must not offer it.
    supportsTyping: false,
    // Read receipts are mapped from Account Activity read events
    // (parseXStatusUpdates). XAA dm.read mapping is a follow-up.
    supportsReadReceipts: true,
    // Inbound media is normalized from DM event expansions. Outbound
    // media needs a pre-uploaded media_id (see class comment).
    supportsMedia: ["image", "video", "audio", "file"],
    // X has no reply window.
    messagingWindowHours: null,
    requiresTemplateOutsideWindow: false,
  };

  private readonly client: XApiClient;

  constructor(fetchImpl: FetchLike = fetch) {
    this.client = new XApiClient(fetchImpl);
  }

  // ─── OAuth (used by services/x-connection.service.ts) ─────────────────────

  buildAuthUrl(state: string, codeChallenge: string): string {
    const config = getXConfig();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: X_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<XTokens> {
    const config = getXConfig();
    const response = await this.client.post<XTokenResponse>("/2/oauth2/token", {
      basicAuth: { username: config.clientId, password: config.clientSecret },
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier,
      },
    });
    return toTokens(response);
  }

  async refreshUserTokens(refreshToken: string): Promise<XTokens> {
    const config = getXConfig();
    const response = await this.client.post<XTokenResponse>("/2/oauth2/token", {
      basicAuth: { username: config.clientId, password: config.clientSecret },
      form: { grant_type: "refresh_token", refresh_token: refreshToken },
    });
    return toTokens(response);
  }

  async getOwnProfile(accessToken: string): Promise<XProfile> {
    const response = await this.client.get<XDataResponse<XProfileRaw>>("/2/users/me", {
      accessToken,
      params: { "user.fields": USER_FIELDS },
    });
    const data = response.data;
    if (!data?.id) {
      throw new XApiError("X did not return the authorized account profile", { status: 502 });
    }
    return {
      id: data.id,
      name: data.name ?? data.username ?? data.id,
      username: data.username ?? data.id,
      ...(data.profile_image_url ? { profileImageUrl: data.profile_image_url } : {}),
    };
  }

  /** Best-effort token revocation (disconnect). Never throws. */
  async revokeAccessToken(accessToken: string): Promise<void> {
    try {
      const config = getXConfig();
      await this.client.post("/2/oauth2/revoke", {
        basicAuth: { username: config.clientId, password: config.clientSecret },
        form: { token: accessToken, token_type_hint: "access_token" },
      });
    } catch (error) {
      console.warn(
        "[x] token revoke failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Create one X Activity API subscription for the connected account
   * (docs/X-RESEARCH.md §3). Authorized with the account's own user
   * token (dm.read scope). Returns the subscription id.
   */
  async createActivitySubscription(
    accessToken: string,
    input: { userId: string; webhookId: string; eventType: "dm.received" | "dm.sent" },
  ): Promise<string> {
    const response = await this.client.post<XSubscriptionResponse>("/2/activity/subscriptions", {
      accessToken,
      body: {
        event_type: input.eventType,
        filter: { user_id: input.userId },
        webhook_id: input.webhookId,
        tag: `uoi-${input.eventType}`,
      },
    });
    const id = response.data?.id ?? response.data?.subscription_id;
    if (!id) {
      throw new XApiError("X did not return an activity subscription id", { status: 502 });
    }
    return id;
  }

  /** Best-effort subscription removal (disconnect). Never throws. */
  async deleteActivitySubscription(accessToken: string, subscriptionId: string): Promise<void> {
    try {
      await this.client.del(`/2/activity/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        accessToken,
      });
    } catch (error) {
      console.warn(
        `[x] activity subscription ${subscriptionId} delete failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // ─── IMessagingProvider ───────────────────────────────────────────────────

  async connectAccount(_input: ConnectInput): Promise<ConnectResult> {
    void _input; // connects happen only through the OAuth flow below
    throw new AppError(
      "X accounts connect through the official OAuth 2.0 flow — use the Connect button on the Channels page (it stores the tokens via the X connection service). Token-paste connects are not supported.",
      "OAUTH_FLOW_REQUIRED",
      400,
    );
  }

  async disconnectAccount(channel: ChannelContext): Promise<void> {
    // Best-effort: local disconnect must succeed even if X is
    // unreachable or the token is already invalid.
    const subscriptionIds = channel.config?.xaaSubscriptionIds;
    if (Array.isArray(subscriptionIds)) {
      for (const id of subscriptionIds) {
        if (typeof id === "string" && channel.credentials.accessToken) {
          await this.deleteActivitySubscription(channel.credentials.accessToken, id);
        }
      }
    }
    if (channel.credentials.accessToken) {
      await this.revokeAccessToken(channel.credentials.accessToken);
    }
  }

  async refreshToken(credentials: ChannelCredentials): Promise<ChannelCredentials> {
    if (!credentials.refreshToken) {
      throw new AppError(
        "This X channel has no refresh token (the offline.access scope was not granted) — reconnect the account to restore access.",
        "X_REFRESH_TOKEN_MISSING",
        400,
      );
    }
    const tokens = await this.refreshUserTokens(credentials.refreshToken);
    return {
      accessToken: tokens.accessToken,
      // X rotates refresh tokens: persist the new one. If X ever
      // omits it, keep the previous token rather than losing access.
      refreshToken: tokens.refreshToken ?? credentials.refreshToken,
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
      scopes: tokens.scopes.length > 0 ? tokens.scopes : credentials.scopes,
    };
  }

  verifyWebhook(req: WebhookVerificationRequest): boolean {
    return verifyXSignature(
      req.rawBody,
      req.headers.get("x-twitter-webhooks-signature"),
      xWebhookSigningSecrets(),
    );
  }

  parseWebhook(payload: unknown): NormalizedInboundMessage[] {
    return parseXWebhookMessages(payload);
  }

  parseStatusUpdates(payload: unknown): DeliveryStatusUpdate[] {
    return parseXStatusUpdates(payload);
  }

  async sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }> {
    const { channel, toExternalId, message } = input;
    if ((message.attachments ?? []).length > 0) {
      throw new XApiError(
        "Sending media in X DMs requires a media_id from X's Media Upload endpoint, which is not wired yet — send text only, or attach media from x.com directly.",
        { status: 400 },
      );
    }
    if (!message.body) {
      throw new XApiError("Cannot send an empty X direct message (no text)", { status: 400 });
    }
    // The engine addresses sends by the contact's user id; the
    // participant endpoint targets the 1:1 conversation with that
    // user and creates it if none exists (official manage guide).
    const response = await this.client.post<XSendDmResponse>(
      `/2/dm_conversations/with/${encodeURIComponent(toExternalId)}/messages`,
      {
        accessToken: channel.credentials.accessToken,
        body: { text: message.body },
      },
    );
    const eventId = response.data?.dm_event_id;
    if (!eventId) {
      throw new XApiError("X did not return a DM event id for the sent message", { status: 502 });
    }
    return { externalMessageId: eventId };
  }

  async getConversations(
    channel: ChannelContext,
    options?: { limit?: number },
  ): Promise<NormalizedConversation[]> {
    const ownUserId = channel.externalAccountId;
    const byConversation = new Map<
      string,
      { latest: XDmEvent; participants: Set<string>; senderNames: Map<string, string> }
    >();

    let paginationToken: string | undefined;
    // 3 pages × 100 events bounds the sync cost (each event read is
    // billed per resource on pay-per-use); the DB accumulates the
    // rest over time via webhooks.
    for (let page = 0; page < 3; page += 1) {
      const response = await this.client.get<XDmEventsResponse>("/2/dm_events", {
        accessToken: channel.credentials.accessToken,
        params: {
          max_results: 100,
          "dm.fields": DM_EVENT_FIELDS,
          expansions: DM_EXPANSIONS,
          "user.fields": USER_FIELDS,
          "media.fields": MEDIA_FIELDS,
          ...(paginationToken ? { pagination_token: paginationToken } : {}),
        },
      });
      for (const event of response.data ?? []) {
        if (event.event_type !== "MessageCreate" || !event.dm_conversation_id) continue;
        const entry = byConversation.get(event.dm_conversation_id) ?? {
          latest: event,
          participants: new Set<string>(),
          senderNames: new Map<string, string>(),
        };
        // Events arrive newest-first: the first sighting of a
        // conversation is its latest event.
        if (!byConversation.has(event.dm_conversation_id)) entry.latest = event;
        for (const participant of event.participant_ids ?? []) entry.participants.add(participant);
        if (event.sender_id) entry.participants.add(event.sender_id);
        for (const user of response.includes?.users ?? []) {
          if (user.id && user.name) entry.senderNames.set(user.id, user.name);
        }
        byConversation.set(event.dm_conversation_id, entry);
      }
      paginationToken = response.meta?.next_token;
      if (!paginationToken) break;
    }

    const conversations: NormalizedConversation[] = [];
    for (const [conversationId, entry] of byConversation) {
      const contactId = [...entry.participants].find((id) => id !== ownUserId);
      if (!contactId) continue;
      conversations.push({
        externalThreadId: conversationId,
        contactExternalId: contactId,
        ...(entry.senderNames.get(contactId)
          ? { contactName: entry.senderNames.get(contactId) }
          : {}),
        ...(entry.latest.created_at
          ? { lastMessageAt: new Date(entry.latest.created_at) }
          : {}),
        raw: entry.latest,
      });
    }
    conversations.sort(
      (a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0),
    );
    return conversations.slice(0, options?.limit ?? 25);
  }

  async getMessages(
    channel: ChannelContext,
    externalThreadId: string,
    options?: { limit?: number },
  ): Promise<NormalizedInboundMessage[]> {
    const response = await this.client.get<XDmEventsResponse>(
      `/2/dm_conversations/${encodeURIComponent(externalThreadId)}/dm_events`,
      {
        accessToken: channel.credentials.accessToken,
        params: {
          max_results: Math.min(options?.limit ?? 25, 100),
          "dm.fields": DM_EVENT_FIELDS,
          expansions: DM_EXPANSIONS,
          "user.fields": USER_FIELDS,
          "media.fields": MEDIA_FIELDS,
        },
      },
    );
    const messages: NormalizedInboundMessage[] = [];
    for (const event of response.data ?? []) {
      const normalized = normalizeDmEvent(event, response.includes, channel.externalAccountId);
      if (normalized) messages.push({ ...normalized, externalThreadId });
    }
    return messages;
  }

  async getContactProfile(
    channel: ChannelContext,
    externalUserId: string,
  ): Promise<ContactProfile> {
    const response = await this.client.get<XDataResponse<XProfileRaw>>(
      `/2/users/${encodeURIComponent(externalUserId)}`,
      {
        accessToken: channel.credentials.accessToken,
        params: { "user.fields": USER_FIELDS },
      },
    );
    const data = response.data;
    if (!data) return {};
    return {
      ...(data.name ? { name: data.name } : {}),
      ...(data.username ? { username: data.username } : {}),
      ...(data.profile_image_url ? { avatarUrl: data.profile_image_url } : {}),
    };
  }
}

interface XProfileRaw {
  id?: string;
  name?: string;
  username?: string;
  profile_image_url?: string;
}

/** Shared singleton used by the registry and the X connection service. */
export const xProvider = new XProvider();
