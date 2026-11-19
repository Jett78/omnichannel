/**
 * Minimal Telegram Bot API client (Phase 10) — official Bot API only
 * (https://core.telegram.org/bots/api). Every call carries the bot
 * token in the URL path, per Telegram's scheme; tokens are channel
 * credentials and are never logged here.
 *
 * The fetch implementation is injectable so tests can run against a
 * labelled test double (see scripts/test-phase10.ts).
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A Telegram Bot API failure. `status` is Telegram's error_code. */
export class TelegramApiError extends Error {
  readonly status: number;

  constructor(status: number, description: string) {
    super(description);
    this.name = "TelegramApiError";
    this.status = status;
  }
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramFileInfo {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramSentMessage {
  message_id: number;
  chat: { id: number };
  photo?: TelegramPhotoSize[];
  video?: { file_id: string };
  audio?: { file_id: string };
  document?: { file_id: string };
}

export type TelegramMediaKind = "photo" | "video" | "audio" | "document";

/** Which Bot API media method a MIME type maps to. */
export function telegramMediaKind(mimeType: string | undefined): TelegramMediaKind {
  if (mimeType?.startsWith("image/")) return "photo";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  return "document";
}

const API_BASE = "https://api.telegram.org";

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export class TelegramClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private async api<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const envelope = (await response.json().catch(() => null)) as TelegramEnvelope<T> | null;
    if (!envelope || !envelope.ok) {
      throw new TelegramApiError(
        envelope?.error_code ?? response.status,
        envelope?.description ?? `Telegram ${method} failed with HTTP ${response.status}`,
      );
    }
    return envelope.result as T;
  }

  getMe(token: string): Promise<TelegramUser> {
    return this.api<TelegramUser>(token, "getMe");
  }

  setWebhook(token: string, url: string, secretToken: string): Promise<boolean> {
    return this.api<boolean>(token, "setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
    });
  }

  deleteWebhook(token: string): Promise<boolean> {
    return this.api<boolean>(token, "deleteWebhook", { drop_pending_updates: false });
  }

  sendMessage(token: string, chatId: string, text: string): Promise<TelegramSentMessage> {
    return this.api<TelegramSentMessage>(token, "sendMessage", { chat_id: chatId, text });
  }

  sendMediaByFileId(
    token: string,
    kind: TelegramMediaKind,
    chatId: string,
    fileId: string,
    caption?: string,
  ): Promise<TelegramSentMessage> {
    return this.api<TelegramSentMessage>(token, `send${kind[0]?.toUpperCase()}${kind.slice(1)}`, {
      chat_id: chatId,
      [kind]: fileId,
      ...(caption ? { caption } : {}),
    });
  }

  /** Multipart upload-and-send (Telegram has no standalone media upload). */
  async sendMediaBytes(
    token: string,
    kind: TelegramMediaKind,
    chatId: string,
    bytes: Buffer,
    fileName: string,
    caption?: string,
  ): Promise<TelegramSentMessage> {
    const form = new FormData();
    form.set("chat_id", chatId);
    if (caption) form.set("caption", caption);
    form.set(kind, new Blob([new Uint8Array(bytes)]), fileName);
    const response = await this.fetchImpl(
      `${API_BASE}/bot${token}/send${kind[0]?.toUpperCase()}${kind.slice(1)}`,
      { method: "POST", body: form },
    );
    const envelope = (await response.json().catch(() => null)) as TelegramEnvelope<TelegramSentMessage> | null;
    if (!envelope || !envelope.ok) {
      throw new TelegramApiError(
        envelope?.error_code ?? response.status,
        envelope?.description ?? `Telegram media send failed with HTTP ${response.status}`,
      );
    }
    return envelope.result as TelegramSentMessage;
  }

  getFile(token: string, fileId: string): Promise<TelegramFileInfo> {
    return this.api<TelegramFileInfo>(token, "getFile", { file_id: fileId });
  }

  async downloadFileBytes(token: string, filePath: string): Promise<Buffer> {
    const response = await this.fetchImpl(`${API_BASE}/file/bot${token}/${filePath}`);
    if (!response.ok) {
      throw new TelegramApiError(response.status, `Telegram file download failed with HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  getChat(
    token: string,
    chatId: string,
  ): Promise<{ first_name?: string; last_name?: string; username?: string; title?: string }> {
    return this.api(token, "getChat", { chat_id: chatId });
  }
}
