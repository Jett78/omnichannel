import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  DeliveryStatusUpdate,
  MessageType,
  NormalizedAttachment,
  NormalizedInboundMessage,
} from "@/types/messaging";

/**
 * Shared Messenger-platform webhook translation (Phase 5).
 *
 * Facebook Page webhooks (`object: "page"`) and Instagram webhooks
 * (`object: "instagram"`) deliver the same `entry[].messaging[]`
 * event shape, so both Meta providers translate through here. Pure
 * functions — fixture-tested in scripts/test-phase5.ts.
 *
 * Deliberate choices:
 *  - `message.is_echo` events are SKIPPED: they are copies of messages
 *    the Page/account itself sent (e.g. from another tool), not
 *    customer inbound messages.
 *  - Postbacks have no `mid`; a deterministic synthetic id
 *    (`postback:<sender>:<timestamp>:<payload>`) keeps ingest
 *    idempotent across redeliveries.
 *  - delivery/read events are NOT messages — they are returned by
 *    parseMessengerStatusUpdates() and applied to outbound messages
 *    by the messaging engine.
 */

export interface MessengerAttachmentPayload {
  url?: string;
  coordinates?: { lat?: number; long?: number };
  sticker_id?: number;
}

export interface MessengerEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    sticker_id?: number;
    attachments?: Array<{ type?: string; payload?: MessengerAttachmentPayload }>;
    reply_to?: { mid?: string };
  };
  postback?: { title?: string; payload?: string; mid?: string };
  delivery?: { mids?: string[]; watermark?: number };
  read?: { watermark?: number; mid?: string };
}

export interface MessengerWebhookEntry {
  id?: string;
  time?: number;
  messaging?: MessengerEvent[];
}

export interface MessengerWebhookPayload {
  object?: string;
  entry?: MessengerWebhookEntry[];
}

/** Verify an `X-Hub-Signature-256: sha256=<hex>` header (HMAC-SHA256 over the raw body). */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match?.[1]) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const provided = Buffer.from(match[1], "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const MIME_HINT_BY_TYPE: Record<string, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/mpeg",
  file: "application/octet-stream",
};

function attachmentMessageType(rawType: string | undefined): MessageType {
  switch (rawType) {
    case "image":
      return "IMAGE";
    case "video":
    case "ig_reel":
    case "reel":
      return "VIDEO";
    case "audio":
      return "AUDIO";
    case "location":
      return "LOCATION";
    case "sticker":
      return "STICKER";
    default:
      // file, share, story_mention, template, fallback, unknown — the
      // original attachment type stays available in `raw`.
      return "FILE";
  }
}

function toPayload(value: unknown): MessengerWebhookPayload | null {
  if (!value || typeof value !== "object") return null;
  return value as MessengerWebhookPayload;
}

function entriesFor(
  payload: unknown,
  expectedObject: "page" | "instagram",
): MessengerWebhookEntry[] {
  const parsed = toPayload(payload);
  if (!parsed || parsed.object !== expectedObject || !Array.isArray(parsed.entry)) return [];
  return parsed.entry;
}

export function parseMessengerMessages(
  payload: unknown,
  expectedObject: "page" | "instagram",
): NormalizedInboundMessage[] {
  const messages: NormalizedInboundMessage[] = [];
  for (const entry of entriesFor(payload, expectedObject)) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      if (!senderId) continue;
      const sentAt = new Date(event.timestamp ?? Date.now());

      if (event.message) {
        if (event.message.is_echo) continue; // our own sends echoed back — not inbound
        const mid = event.message.mid;
        if (!mid) continue; // without a mid we cannot dedupe safely
        const attachments: NormalizedAttachment[] = (event.message.attachments ?? [])
          .filter((a) => typeof a.payload?.url === "string")
          .map((a) => ({
            url: a.payload?.url as string,
            ...(a.type && MIME_HINT_BY_TYPE[a.type] ? { mimeType: MIME_HINT_BY_TYPE[a.type] } : {}),
          }));
        const firstAttachmentType = event.message.attachments?.[0]?.type;
        const type: MessageType =
          event.message.sticker_id !== undefined
            ? "STICKER"
            : attachments.length > 0 || event.message.attachments?.length
              ? attachmentMessageType(firstAttachmentType)
              : "TEXT";
        messages.push({
          externalMessageId: mid,
          externalThreadId: senderId,
          senderExternalId: senderId,
          type,
          ...(event.message.text !== undefined ? { body: event.message.text } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          sentAt,
          raw: event,
        });
        continue;
      }

      if (event.postback) {
        messages.push({
          externalMessageId: `postback:${senderId}:${event.timestamp ?? 0}:${event.postback.payload ?? ""}`,
          externalThreadId: senderId,
          senderExternalId: senderId,
          type: "SYSTEM",
          body: event.postback.title ?? "Postback",
          sentAt,
          raw: event,
        });
      }
      // delivery / read / optin / referral events are not messages.
    }
  }
  return messages;
}

export function parseMessengerStatusUpdates(
  payload: unknown,
  expectedObject: "page" | "instagram",
): DeliveryStatusUpdate[] {
  const updates: DeliveryStatusUpdate[] = [];
  for (const entry of entriesFor(payload, expectedObject)) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      if (!senderId) continue;
      const at = new Date(event.timestamp ?? Date.now());
      const base = {
        at,
        contactExternalId: senderId,
        ...(entry.id ? { channelExternalAccountId: entry.id } : {}),
        raw: event,
      };

      if (event.delivery) {
        if (event.delivery.mids && event.delivery.mids.length > 0) {
          for (const mid of event.delivery.mids) {
            updates.push({ ...base, externalMessageId: mid, status: "DELIVERED" });
          }
        } else if (event.delivery.watermark !== undefined) {
          updates.push({
            ...base,
            externalMessageId: null,
            status: "DELIVERED",
            watermark: new Date(event.delivery.watermark),
          });
        }
      }

      if (event.read) {
        if (event.read.mid) {
          updates.push({ ...base, externalMessageId: event.read.mid, status: "READ" });
        } else if (event.read.watermark !== undefined) {
          updates.push({
            ...base,
            externalMessageId: null,
            status: "READ",
            watermark: new Date(event.read.watermark),
          });
        }
      }
    }
  }
  return updates;
}
