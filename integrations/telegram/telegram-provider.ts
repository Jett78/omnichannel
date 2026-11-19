import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/errors";
import { getRedis } from "@/lib/redis";
import {
  TelegramApiError,
  TelegramClient,
  telegramMediaKind,
  type FetchLike,
  type TelegramSentMessage,
  type TelegramUser,
} from "@/integrations/telegram/telegram-client";
import type {
  ChannelContext,
  ConnectInput,
  ConnectResult,
  ContactProfile,
  IMessagingProvider,
  WebhookVerificationRequest,
} from "@/integrations/types";
import type {
  MessageType,
  NormalizedAttachment,
  NormalizedConversation,
  NormalizedInboundMessage,
  OutboundMessage,
} from "@/types/messaging";

/**
 * Telegram provider (Phase 10) — real adapter against the official
 * Telegram Bot API. ACCESS MODEL (docs/TELEGRAM-SETUP.md): fully
 * self-serve, no app review — each workspace connects its OWN bot by
 * pasting the BotFather token (services/telegram-connection.service
 * validates it with getMe, stores it encrypted, and registers this
 * deployment's per-channel webhook with a secret token).
 *
 * Platform rules honoured here:
 *  - Bots cannot initiate conversations; only users who messaged the
 *    bot (or groups the bot belongs to) can be replied to.
 *  - No messaging window: a bot may reply at any time after the user
 *    started the chat (unless the user blocked the bot).
 *  - No history API: getConversations/getMessages return [] and
 *    there is no history import — the Bot API only delivers new
 *    updates.
 *  - Media: Telegram has no standalone upload endpoint — a file is
 *    uploaded BY sending it to a chat. The engine's upload-first
 *    contract is bridged by stashing the bytes in Redis at
 *    uploadMedia time (1h TTL) and performing the real multipart
 *    send in sendMessage, seconds later, in the worker.
 *
 * Webhook verification is per-channel (each bot has its own secret
 * token), so it happens in app/api/webhooks/telegram/[channelId],
 * which checks the X-Telegram-Bot-Api-Secret-Token header against
 * the channel's stored secret BEFORE persisting the event. The
 * generic verifyWebhook below therefore fails closed.
 */

export const TELEGRAM_FILE_PREFIX = "telegram-file:";
export const TELEGRAM_PENDING_PREFIX = "telegram-pending:";
const PENDING_MEDIA_TTL_SECONDS = 3600;

// ─── Raw update shapes (subset of the Bot API we consume) ────────

interface TelegramChatRef {
  id: number;
  type: string;
}

interface TelegramFromRef {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramFileRef {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

interface TelegramMessageRef {
  message_id: number;
  date: number;
  chat: TelegramChatRef;
  from?: TelegramFromRef;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  video?: TelegramFileRef;
  audio?: TelegramFileRef;
  voice?: TelegramFileRef;
  document?: TelegramFileRef;
  sticker?: TelegramFileRef;
  location?: { latitude: number; longitude: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessageRef;
}

/**
 * Translate one Telegram update into the engine's normalized inbound
 * shape. Returns null for updates that must not enter the inbox:
 * non-message updates (joins, pins, edits), messages without a
 * sender, messages from other bots, and service messages with no
 * text or media payload.
 *
 * Identity model: private chats key the contact by Telegram user id.
 * In groups, several people share one chat, so the identity is the
 * composite `{chatId}:{userId}` — each sender in each group gets
 * their own conversation thread, and replies still go to the group
 * chat (externalThreadId is always the chat id).
 */
export function normalizeTelegramUpdate(update: TelegramUpdate): NormalizedInboundMessage | null {
  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return null;

  const chatId = String(msg.chat.id);
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  const senderExternalId = isGroup ? `${chatId}:${msg.from.id}` : String(msg.from.id);
  const senderName =
    [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username;

  let type: MessageType = "TEXT";
  let body: string | undefined = msg.text ?? msg.caption;
  let attachments: NormalizedAttachment[] | undefined;

  const fileAttachment = (
    file: TelegramFileRef,
    fallbackMime: string,
  ): NormalizedAttachment => ({
    url: `${TELEGRAM_FILE_PREFIX}${file.file_id}`,
    mimeType: file.mime_type ?? fallbackMime,
    ...(file.file_name ? { fileName: file.file_name } : {}),
    ...(typeof file.file_size === "number" ? { size: file.file_size } : {}),
  });

  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1] as { file_id: string; file_size?: number };
    type = "IMAGE";
    attachments = [
      {
        url: `${TELEGRAM_FILE_PREFIX}${largest.file_id}`,
        mimeType: "image/jpeg",
        ...(typeof largest.file_size === "number" ? { size: largest.file_size } : {}),
      },
    ];
  } else if (msg.video) {
    type = "VIDEO";
    attachments = [fileAttachment(msg.video, "video/mp4")];
  } else if (msg.voice) {
    type = "AUDIO";
    attachments = [fileAttachment(msg.voice, "audio/ogg")];
  } else if (msg.audio) {
    type = "AUDIO";
    attachments = [fileAttachment(msg.audio, "audio/mpeg")];
  } else if (msg.document) {
    type = "FILE";
    attachments = [fileAttachment(msg.document, "application/octet-stream")];
  } else if (msg.sticker) {
    type = "STICKER";
    attachments = [fileAttachment(msg.sticker, "image/webp")];
  } else if (msg.location) {
    type = "LOCATION";
    body = `${msg.location.latitude}, ${msg.location.longitude}`;
  } else if (!msg.text) {
    return null;
  }

  return {
    externalMessageId: String(msg.message_id),
    externalThreadId: chatId,
    senderExternalId,
    ...(senderName ? { senderName } : {}),
    type,
    ...(body ? { body } : {}),
    ...(attachments ? { attachments } : {}),
    sentAt: new Date(msg.date * 1000),
    raw: update,
  };
}

// ─── Provider ─────────────────────────────────────────────────────

export class TelegramProvider implements IMessagingProvider {
  readonly id = "telegram" as const;
  readonly capabilities = {
    supportsTyping: false,
    supportsReadReceipts: false,
    supportsMedia: ["image", "video", "audio", "file"] as Array<
      "image" | "video" | "audio" | "file"
    >,
    messagingWindowHours: null,
    requiresTemplateOutsideWindow: false,
  };

  private readonly client: TelegramClient;

  constructor(fetchImpl: FetchLike = fetch) {
    this.client = new TelegramClient(fetchImpl);
  }

  // ─── Helpers used by services/telegram-connection.service.ts ────

  getBotInfo(botToken: string): Promise<TelegramUser> {
    return this.client.getMe(botToken);
  }

  registerWebhook(botToken: string, webhookUrl: string, secretToken: string): Promise<boolean> {
    return this.client.setWebhook(botToken, webhookUrl, secretToken);
  }

  removeWebhook(botToken: string): Promise<boolean> {
    return this.client.deleteWebhook(botToken);
  }

  // ─── IMessagingProvider ─────────────────────────────────────────

  async connectAccount(_input: ConnectInput): Promise<ConnectResult> {
    void _input;
    throw new AppError(
      "Telegram channels connect with a bot token — use the Telegram connect endpoint.",
      "TELEGRAM_TOKEN_FLOW_REQUIRED",
      400,
    );
  }

  async disconnectAccount(channel: ChannelContext): Promise<void> {
    const token = channel.credentials.accessToken;
    if (!token) return;
    try {
      await this.client.deleteWebhook(token);
    } catch (error) {
      // Best-effort: a dead token must not block the disconnect.
      console.warn(
        `[telegram] deleteWebhook failed for channel ${channel.channelId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  verifyWebhook(_req: WebhookVerificationRequest): boolean {
    void _req;
    // Real verification is per-channel in the dedicated Telegram
    // webhook route (secret token per bot). Fail closed here.
    return false;
  }

  parseWebhook(payload: unknown): NormalizedInboundMessage[] {
    if (!payload || typeof payload !== "object") return [];
    const normalized = normalizeTelegramUpdate(payload as TelegramUpdate);
    return normalized ? [normalized] : [];
  }

  async sendMessage(input: {
    channel: ChannelContext;
    toExternalId: string;
    message: OutboundMessage;
  }): Promise<{ externalMessageId: string }> {
    const token = input.channel.credentials.accessToken;
    if (!token) throw new AppError("Telegram channel has no bot token", "TELEGRAM_NO_TOKEN", 400);
    // Replies go to the CHAT (externalThreadId), not the user: in
    // groups the identity is the composite {chatId}:{userId}.
    const chatId =
      input.message.externalThreadId ??
      (input.toExternalId.includes(":")
        ? (input.toExternalId.split(":")[0] as string)
        : input.toExternalId);

    const attachment = input.message.attachments?.[0];
    if (attachment) {
      const kind = telegramMediaKind(attachment.mimeType);
      const caption = input.message.body;
      if (attachment.url.startsWith(TELEGRAM_PENDING_PREFIX)) {
        const stashKey = `telegram:pending-media:${input.channel.channelId}:${attachment.url.slice(TELEGRAM_PENDING_PREFIX.length)}`;
        const stashed = await getRedis().get(stashKey);
        if (!stashed) {
          throw new AppError(
            "The uploaded file is no longer available to send (it expired before delivery). Please attach it again.",
            "TELEGRAM_MEDIA_EXPIRED",
            502,
          );
        }
        const bytes = Buffer.from(stashed, "base64");
        const fileName = attachment.fileName ?? "file";
        let sent: TelegramSentMessage;
        try {
          sent = await this.client.sendMediaBytes(token, kind, chatId, bytes, fileName, caption);
        } catch (error) {
          // Telegram's sendPhoto rejects photos whose width + height
          // exceed 10,000 px ("PHOTO_INVALID_DIMENSIONS") — every
          // full-resolution phone portrait hits this. Deliver the
          // same bytes as a document instead: no dimension limits,
          // and the customer gets the full-quality original.
          if (
            kind !== "photo" ||
            !(error instanceof TelegramApiError) ||
            !error.message.includes("PHOTO_INVALID_DIMENSIONS")
          ) {
            throw error;
          }
          sent = await this.client.sendMediaBytes(
            token,
            "document",
            chatId,
            bytes,
            fileName,
            caption,
          );
        }
        await getRedis().del(stashKey);
        return { externalMessageId: String(sent.message_id) };
      }
      if (attachment.url.startsWith(TELEGRAM_FILE_PREFIX)) {
        const sent = await this.client.sendMediaByFileId(
          token,
          kind,
          chatId,
          attachment.url.slice(TELEGRAM_FILE_PREFIX.length),
          caption,
        );
        return { externalMessageId: String(sent.message_id) };
      }
      throw new AppError(
        `Unsupported Telegram media reference: ${attachment.url}`,
        "TELEGRAM_BAD_MEDIA_REF",
        400,
      );
    }

    const sent = await this.client.sendMessage(token, chatId, input.message.body ?? "");
    return { externalMessageId: String(sent.message_id) };
  }

  /**
   * Telegram uploads happen by sending to a chat, which the engine's
   * upload-first flow cannot do yet (no recipient is known here).
   * The bytes are stashed in Redis (1h TTL) and the real multipart
   * send happens in sendMessage, in the worker, seconds later.
   */
  async uploadMedia(input: {
    channel: ChannelContext;
    media: { bytes: Buffer; mimeType: string; fileName: string };
  }): Promise<{ ref: string }> {
    const stashId = randomUUID();
    await getRedis().set(
      `telegram:pending-media:${input.channel.channelId}:${stashId}`,
      input.media.bytes.toString("base64"),
      "EX",
      PENDING_MEDIA_TTL_SECONDS,
    );
    return { ref: `${TELEGRAM_PENDING_PREFIX}${stashId}` };
  }

  async downloadMedia(url: string, channel: ChannelContext): Promise<Buffer> {
    if (!url.startsWith(TELEGRAM_FILE_PREFIX)) {
      throw new AppError(`Not a Telegram file reference: ${url}`, "TELEGRAM_BAD_MEDIA_REF", 400);
    }
    const token = channel.credentials.accessToken;
    if (!token) throw new AppError("Telegram channel has no bot token", "TELEGRAM_NO_TOKEN", 400);
    const info = await this.client.getFile(token, url.slice(TELEGRAM_FILE_PREFIX.length));
    if (!info.file_path) {
      throw new AppError("Telegram did not return a file path for this media", "TELEGRAM_MEDIA_EMPTY", 502);
    }
    return this.client.downloadFileBytes(token, info.file_path);
  }

  async getContactProfile(
    channel: ChannelContext,
    externalUserId: string,
  ): Promise<ContactProfile> {
    const token = channel.credentials.accessToken;
    if (!token) return {};
    const userId = externalUserId.includes(":")
      ? (externalUserId.split(":")[1] as string)
      : externalUserId;
    try {
      const chat = await this.client.getChat(token, userId);
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username;
      // Telegram exposes profile photos only as files behind the bot
      // token — there is no public avatar URL to hand the browser,
      // so avatars stay on the initials fallback for this provider.
      return name ? { name } : {};
    } catch {
      return {};
    }
  }

  async getConversations(
    _channel: ChannelContext,
    _options?: { limit?: number },
  ): Promise<NormalizedConversation[]> {
    void _channel;
    void _options;
    return []; // The Bot API has no conversation history endpoints.
  }

  async getMessages(
    _channel: ChannelContext,
    _externalThreadId: string,
    _options?: { limit?: number },
  ): Promise<NormalizedInboundMessage[]> {
    void _channel;
    void _externalThreadId;
    void _options;
    return []; // The Bot API has no message history endpoints.
  }
}

export const telegramProvider = new TelegramProvider();
