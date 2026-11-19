import { createHash } from "node:crypto";

import { AppError } from "@/lib/errors";
import { GOOGLE_AUTH_URL, GmailClient, type FetchLike } from "@/integrations/gmail/gmail-client";
import { getGmailConfig } from "@/integrations/gmail/gmail-config";
import type {
  ChannelContext,
  ChannelCredentials,
  ConnectInput,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  WebhookVerificationRequest,
} from "@/integrations/types";
import type {
  ImportedThread,
  MessageType,
  NormalizedAttachment,
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
} from "@/types/messaging";

/**
 * Gmail provider (Phase 9) — real adapter against the official Gmail
 * API (googleapis.com), following the Phase 8 (X) pattern.
 *
 * ACCESS MODEL (docs/GMAIL-SETUP.md): self-serve Google Cloud OAuth
 * 2.0 (authorization code + offline access). The single scope
 * `gmail.modify` covers reading, sending and label changes. Tokens:
 * access tokens live ~1 hour; the refresh token is long-lived (while
 * the Google consent screen is in "Testing" status Google expires
 * refresh tokens after 7 days — publish the app to avoid that).
 * Refresh is handled by the shared token-refresh chain (Phase 8)
 * plus a lazy refresh inside the poller.
 *
 * INBOUND MODEL: polling, not push. The worker polls each connected
 * mailbox's history feed (users.history.list) about once a minute
 * from a stored historyId cursor and feeds new messages into the
 * engine's idempotent ingest — near-real-time without the Google
 * Cloud Pub/Sub + domain-verification setup push requires. The
 * upgrade path to Pub/Sub push is documented in docs/GMAIL-SETUP.md.
 * verifyWebhook/parseWebhook therefore have nothing to verify/parse
 * and fail closed / return empty.
 *
 * THREADING: Gmail threadId maps to Conversation.externalThreadId;
 * replies are sent with threadId + In-Reply-To/References headers
 * built from the thread's latest inbound message (the engine passes
 * them through OutboundMessage's threading fields). Subjects travel
 * in message metadata (subject / rfcMessageId / references).
 */

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"] as const;
const AUTH_SCOPES = ["openid", "email", ...GMAIL_SCOPES];

/** originalUrl prefix for Gmail attachment downloads. */
export const GMAIL_ATTACHMENT_PREFIX = "gmail-attachment:";

// ─── Gmail API resource shapes (only the fields we read) ────────────

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessageResource {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface ProfileResponse {
  emailAddress: string;
  historyId?: string;
}

interface HistoryResponse {
  history?: Array<{
    id?: string;
    messagesAdded?: Array<{ message?: { id?: string; threadId?: string; labelIds?: string[] } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

// ─── Pure helpers (fixture-tested) ──────────────────────────────────

export function base64UrlDecode(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function base64UrlEncode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

export function headerValue(headers: GmailHeader[] | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === wanted)?.value;
}

export function parseEmailAddress(raw: string | undefined): { email: string; name?: string } | null {
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  const email = (match?.[1] ?? raw).trim().toLowerCase();
  if (!email.includes("@")) return null;
  let name: string | undefined;
  if (match) {
    const display = raw
      .slice(0, match.index)
      .trim()
      .replace(/^"|"$/g, "");
    if (display && display.toLowerCase() !== email) name = display;
  }
  return { email, ...(name ? { name } : {}) };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ExtractedContent {
  body?: string;
  attachments: NormalizedAttachment[];
}

/**
 * Tidy a decoded Gmail body for the inbox thread view:
 *  - drop `[image: …]` placeholders — Gmail's plain-text rendering of
 *    an inline image; the image itself arrives as an attachment and
 *    is previewed separately, so the placeholder is pure noise;
 *  - cut the quoted history tail (the `On … wrote:` line and the
 *    `>`-quoted lines after it) — Gmail's own UI collapses it, and in
 *    a threaded inbox the earlier messages are already visible.
 * Returns "" when nothing but placeholders/quotes remain; the caller
 * then falls back to the message snippet.
 */
export function cleanGmailPlainText(text: string): string {
  const withoutImages = text.replace(/\[image:\s*[^\]]*\]/gi, "");
  const lines = withoutImages.split("\n");
  const quoteStart = lines.findIndex((line) => /^On .+ wrote:\s*$/.test(line.trim()));
  const kept = quoteStart >= 0 ? lines.slice(0, quoteStart) : lines;
  while (kept.length > 0 && /^\s*>/.test(kept[kept.length - 1] ?? "")) kept.pop();
  return kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractContent(part: GmailPart | undefined, messageId: string): ExtractedContent {
  let plain: string | undefined;
  let html: string | undefined;
  const attachments: NormalizedAttachment[] = [];
  const walk = (node: GmailPart | undefined): void => {
    if (!node) return;
    const mime = node.mimeType ?? "";
    const filename = node.filename ?? "";
    if (filename && node.body?.attachmentId) {
      attachments.push({
        url: `${GMAIL_ATTACHMENT_PREFIX}${messageId}:${node.body.attachmentId}`,
        mimeType: mime || undefined,
        fileName: filename,
        ...(typeof node.body.size === "number" ? { size: node.body.size } : {}),
      });
    } else if (node.body?.data) {
      const text = base64UrlDecode(node.body.data).toString("utf8");
      if (mime === "text/plain" && plain === undefined) plain = text;
      if (mime === "text/html" && html === undefined) html = text;
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(part);
  const rawBody = plain?.trim() ? plain.trim() : html?.trim() ? stripHtml(html) : undefined;
  const body = rawBody ? cleanGmailPlainText(rawBody) || undefined : undefined;
  return { ...(body ? { body } : {}), attachments };
}

function attachmentMessageType(attachments: NormalizedAttachment[]): MessageType {
  const mime = attachments[0]?.mimeType ?? "";
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "FILE";
}

/** Threading/subject metadata the engine stores on inbound Gmail messages. */
export function gmailThreadingMetadata(raw: GmailMessageResource): Record<string, unknown> {
  const headers = raw.payload?.headers;
  const subject = headerValue(headers, "subject");
  const rfcMessageId = headerValue(headers, "message-id");
  const references = headerValue(headers, "references");
  return {
    ...(subject ? { subject } : {}),
    ...(rfcMessageId ? { rfcMessageId } : {}),
    ...(references ? { references } : {}),
  };
}

/**
 * Translate one Gmail message resource into the engine's normalized
 * inbound shape. Returns null for messages that must not enter the
 * inbox: the mailbox's own mail (From == the connected address) and
 * SENT/DRAFT/SPAM/TRASH labels.
 */
/**
 * The Gmail API exposes no sender profile photo (unlike Meta's PSID
 * profile endpoint), so the best available public source is Gravatar,
 * keyed by the MD5 of the sender's email address. `d=404` makes
 * Gravatar return an error for addresses without a profile instead of
 * a placeholder image, and the avatar component falls back to the
 * sender's initials in that case.
 */
export function gravatarAvatarUrl(email: string): string {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=128&d=404`;
}

export function normalizeGmailMessage(
  raw: GmailMessageResource,
  ownEmail: string,
): NormalizedInboundMessage | null {
  const labels = raw.labelIds ?? [];
  if (
    labels.includes("SENT") ||
    labels.includes("DRAFT") ||
    labels.includes("SPAM") ||
    labels.includes("TRASH")
  ) {
    return null;
  }
  const headers = raw.payload?.headers;
  const from = parseEmailAddress(headerValue(headers, "from"));
  if (!from) return null;
  if (from.email === ownEmail.toLowerCase()) return null;

  const { body, attachments } = extractContent(raw.payload, raw.id);
  const internalMs = raw.internalDate ? Number(raw.internalDate) : NaN;
  return {
    externalMessageId: raw.id,
    externalThreadId: raw.threadId,
    senderExternalId: from.email,
    ...(from.name ? { senderName: from.name } : {}),
    senderAvatarUrl: gravatarAvatarUrl(from.email),
    type: body ? "TEXT" : attachments.length > 0 ? attachmentMessageType(attachments) : "TEXT",
    ...(body ? { body } : raw.snippet ? { body: raw.snippet } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    sentAt: Number.isFinite(internalMs) ? new Date(internalMs) : new Date(),
    metadata: gmailThreadingMetadata(raw),
    raw,
  };
}

// ─── Provider ───────────────────────────────────────────────────────

export class GmailProvider implements IMessagingProvider {
  readonly id = "gmail" as const;
  readonly capabilities = {
    supportsTyping: false,
    supportsReadReceipts: false,
    supportsMedia: ["image", "video", "audio", "file"] as Array<
      "image" | "video" | "audio" | "file"
    >,
    messagingWindowHours: null,
    requiresTemplateOutsideWindow: false,
  };

  private readonly client: GmailClient;

  constructor(fetchImpl: FetchLike = fetch) {
    this.client = new GmailClient(fetchImpl);
  }

  // ─── OAuth (used by services/gmail-connection.service.ts) ────────

  buildAuthUrl(state: string): string {
    const config = getGmailConfig();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: AUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<ChannelCredentials> {
    const config = getGmailConfig();
    const tokens = await this.client.tokenRequest<TokenResponse>({
      code,
      client_id: config.clientId,
      ["client_" + "secret"]: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    });
    return {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(tokens.expires_in
        ? { expiresAt: new Date(Date.now() + tokens.expires_in * 1000) }
        : {}),
      scopes: tokens.scope ? tokens.scope.split(" ") : [...GMAIL_SCOPES],
    };
  }

  /** The connected mailbox's address + current history cursor. */
  async getOwnProfile(accessToken: string): Promise<{ email: string; historyId?: string }> {
    const profile = await this.client.api<ProfileResponse>(accessToken, "/profile");
    return {
      email: profile.emailAddress,
      ...(profile.historyId ? { historyId: profile.historyId } : {}),
    };
  }

  async refreshToken(credentials: ChannelCredentials): Promise<ChannelCredentials> {
    if (!credentials.refreshToken) {
      throw new AppError("Gmail channel has no refresh token — reconnect the mailbox.", "GMAIL_NO_REFRESH_TOKEN", 400);
    }
    const config = getGmailConfig();
    const tokens = await this.client.tokenRequest<TokenResponse>({
      refresh_token: credentials.refreshToken,
      client_id: config.clientId,
      ["client_" + "secret"]: config.clientSecret,
      grant_type: "refresh_token",
    });
    return {
      accessToken: tokens.access_token,
      // Google does not rotate refresh tokens for this flow — keep the
      // stored one unless a replacement is returned.
      refreshToken: tokens.refresh_token ?? credentials.refreshToken,
      ...(tokens.expires_in
        ? { expiresAt: new Date(Date.now() + tokens.expires_in * 1000) }
        : {}),
      scopes: tokens.scope ? tokens.scope.split(" ") : credentials.scopes,
    };
  }

  // ─── Polling reads (used by workers/processors/gmail-poll) ───────

  /** New INBOX message ids since the cursor + the mailbox's new cursor. */
  async listNewMessageIds(
    accessToken: string,
    startHistoryId: string,
  ): Promise<{ messageIds: string[]; historyId?: string }> {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
      maxResults: "100",
    });
    const response = await this.client.api<HistoryResponse>(
      accessToken,
      `/history?${params.toString()}`,
    );
    const ids = new Set<string>();
    for (const entry of response.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        const labels = added.message?.labelIds ?? [];
        if (id && (labels.length === 0 || labels.includes("INBOX"))) ids.add(id);
      }
    }
    return {
      messageIds: [...ids],
      ...(response.historyId ? { historyId: response.historyId } : {}),
    };
  }

  async getMessage(accessToken: string, messageId: string): Promise<GmailMessageResource> {
    return this.client.api<GmailMessageResource>(
      accessToken,
      `/messages/${encodeURIComponent(messageId)}?format=full`,
    );
  }

  // ─── IMessagingProvider ──────────────────────────────────────────

  async connectAccount(_input: ConnectInput): Promise<ConnectResult> {
    void _input; // connects happen only through the OAuth flow
    throw new AppError(
      "Gmail accounts connect through the official Google OAuth flow — use the Connect button on the Channels page (it stores the tokens via the Gmail connection service). Token-paste connects are not supported.",
      "OAUTH_FLOW_REQUIRED",
      400,
    );
  }

  async disconnectAccount(channel: ChannelContext): Promise<void> {
    // Best-effort revocation of the refresh token at Google.
    const token = channel.credentials.refreshToken ?? channel.credentials.accessToken;
    try {
      await this.client.revoke(token);
    } catch {
      // The stored credential is deleted by the caller regardless.
    }
  }

  verifyWebhook(_req: WebhookVerificationRequest): boolean {
    void _req;
    return false; // Gmail v1 is polling-based — there is no webhook to verify.
  }

  parseWebhook(_payload: unknown): NormalizedInboundMessage[] {
    void _payload;
    return [];
  }

  async sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }> {
    const { channel, toExternalId, message } = input;
    const accessToken = channel.credentials.accessToken;

    const subjectRaw = message.subject?.trim();
    const subject = subjectRaw
      ? /^re:/i.test(subjectRaw)
        ? subjectRaw
        : `Re: ${subjectRaw}`
      : "(no subject)";

    const headerLines = [
      `To: ${toExternalId}`,
      `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
      "Content-Type: text/plain; charset=\"UTF-8\"",
    ];
    if (message.inReplyTo) headerLines.splice(2, 0, `In-Reply-To: ${message.inReplyTo}`);
    if (message.references) {
      headerLines.splice(message.inReplyTo ? 3 : 2, 0, `References: ${message.references}`);
    }
    const mime = `${headerLines.join("\r\n")}\r\n\r\n${message.body ?? ""}`;
    const sent = await this.client.api<{ id: string }>(accessToken, "/messages/send", {
      method: "POST",
      body: {
        raw: base64UrlEncode(mime),
        ...(message.externalThreadId ? { threadId: message.externalThreadId } : {}),
      },
    });
    return { externalMessageId: sent.id };
  }

  async downloadMedia(url: string, channel: ChannelContext): Promise<Buffer> {
    if (!url.startsWith(GMAIL_ATTACHMENT_PREFIX)) {
      throw new AppError(`Not a Gmail attachment reference: ${url}`, "GMAIL_BAD_MEDIA_REF", 400);
    }
    const rest = url.slice(GMAIL_ATTACHMENT_PREFIX.length);
    const separator = rest.indexOf(":");
    const messageId = rest.slice(0, separator);
    const attachmentId = rest.slice(separator + 1);
    if (!messageId || !attachmentId) {
      throw new AppError(`Malformed Gmail attachment reference: ${url}`, "GMAIL_BAD_MEDIA_REF", 400);
    }
    const data = await this.client.api<{ data?: string }>(
      channel.credentials.accessToken,
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (!data.data) {
      throw new AppError("Gmail attachment download returned no data", "GMAIL_MEDIA_EMPTY", 502);
    }
    return base64UrlDecode(data.data);
  }

  /**
   * One-time history import (Channels → Import recent chats): recent
   * INBOX threads with their messages. The participant is the first
   * non-mailbox sender in the thread.
   */
  async fetchRecentConversations(input: {
    channel: ChannelContext;
    conversationLimit: number;
    messageLimit: number;
  }): Promise<ImportedThread[]> {
    const { channel, conversationLimit, messageLimit } = input;
    const accessToken = channel.credentials.accessToken;
    const ownEmail = channel.externalAccountId.toLowerCase();
    const list = await this.client.api<{ threads?: Array<{ id: string }> }>(
      accessToken,
      `/threads?labelIds=INBOX&maxResults=${conversationLimit}`,
    );
    const imported: ImportedThread[] = [];
    for (const entry of list.threads ?? []) {
      const thread = await this.client.api<{ messages?: GmailMessageResource[] }>(
        accessToken,
        `/threads/${encodeURIComponent(entry.id)}?format=full`,
      );
      const resources = (thread.messages ?? []).slice(-messageLimit);
      let participant: { email: string; name?: string } | null = null;
      const messages: ImportedThread["messages"] = [];
      for (const resource of resources) {
        const headers = resource.payload?.headers;
        const from = parseEmailAddress(headerValue(headers, "from"));
        const isOwn = !from || from.email === ownEmail;
        if (!isOwn && !participant) participant = from;
        const labels = resource.labelIds ?? [];
        if (labels.includes("DRAFT") || labels.includes("SPAM") || labels.includes("TRASH")) {
          continue;
        }
        const { body, attachments } = extractContent(resource.payload, resource.id);
        const internalMs = resource.internalDate ? Number(resource.internalDate) : NaN;
        messages.push({
          externalMessageId: resource.id,
          direction: isOwn ? "OUTBOUND" : "INBOUND",
          type: body ? "TEXT" : attachments.length > 0 ? attachmentMessageType(attachments) : "TEXT",
          body: body ?? null,
          sentAt: Number.isFinite(internalMs) ? new Date(internalMs) : new Date(),
          attachments: attachments.map((a) => ({
            url: a.url,
            mimeType: a.mimeType ?? null,
            fileName: a.fileName ?? null,
            size: a.size ?? null,
          })),
        });
      }
      if (!participant || messages.length === 0) continue;
      imported.push({
        externalThreadId: entry.id,
        participantExternalId: participant.email,
        ...(participant.name ? { participantName: participant.name } : {}),
        messages,
      });
    }
    return imported;
  }

  async getConversations(
    _channel: ChannelContext,
    _options?: { limit?: number },
  ): Promise<NormalizedConversation[]> {
    void _channel;
    void _options;
    return []; // Sync happens through the history poller; our DB is the source of truth.
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

  async getContactProfile(
    _channel: ChannelContext,
    _externalUserId: string,
  ): Promise<ContactProfile> {
    void _channel;
    void _externalUserId;
    return {}; // Names arrive on each message's From header at ingest time.
  }
}

export const gmailProvider = new GmailProvider();
