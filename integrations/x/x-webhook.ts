import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  DeliveryStatusUpdate,
  MessageType,
  NormalizedAttachment,
  NormalizedInboundMessage,
} from "@/types/messaging";

/**
 * X webhook security + payload translation (Phase 8).
 *
 * Pure functions — fixture-tested in scripts/test-phase8.ts with
 * payload shapes copied from X's official documentation examples
 * (cited inline; see docs/X-RESEARCH.md).
 *
 * SECURITY (official webhooks docs,
 * https://docs.x.com/x-api/webhooks/introduction):
 *  - CRC: X sends GET ?crc_token=…; the endpoint must answer
 *    {"response_token": "sha256=" + base64(HMAC-SHA256(crc_token, secret))}.
 *  - POST deliveries carry `x-twitter-webhooks-signature`:
 *    "sha256=" + base64(HMAC-SHA256(raw_body, secret)).
 *  - The classic docs key both with the app's consumer secret; X's
 *    updated (Nov 2026) docs recommend the OAuth 2.0 client secret.
 *    Verification therefore accepts a match against ANY configured
 *    app secret (see x-config.ts) and fails closed when none is set.
 *
 * PAYLOAD FAMILIES — two generations are parsed:
 *  1. Account Activity API (legacy, X marks it deprecated in favour
 *     of the X Activity API): top-level `for_user_id` +
 *     `direct_message_events` (`message_create`), a `users` map, and
 *     `direct_message_read_events` for receipts.
 *  2. X Activity API (current): envelope
 *     {data: {event_type, filter: {user_id}, payload}} where the DM
 *     payload follows the v2 DM event object shape.
 *
 * Deliberate choices:
 *  - Events sent BY the connected account itself are skipped — they
 *    are outbound echoes (AAA delivers both directions; XAA has a
 *    separate `dm.sent` event type), not customer inbound messages.
 *  - ParticipantsJoin / ParticipantsLeave and typing events are not
 *    messages and produce no normalized output.
 *  - 1:1 conversation ids follow X's documented format
 *    {smaller_user_id}-{larger_user_id} when a payload carries no
 *    explicit conversation id (AAA events don't).
 */

/** "sha256=" + base64(HMAC-SHA256(value, secret)) — the X webhook HMAC format. */
export function xHmacSha256Base64(value: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(value, "utf8").digest("base64")}`;
}

/** CRC answer for a challenge token (official webhooks docs example). */
export function computeCrcResponseToken(crcToken: string, secret: string): string {
  return xHmacSha256Base64(crcToken, secret);
}

/**
 * Verify an `x-twitter-webhooks-signature` header over the RAW body
 * against any of the configured app secrets. Fails closed: no secrets
 * configured, missing/malformed header, or no match → false.
 */
export function verifyXSignature(
  rawBody: string,
  signatureHeader: string | null,
  secrets: readonly string[],
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=") || secrets.length === 0) {
    return false;
  }
  const provided = Buffer.from(signatureHeader, "utf8");
  for (const secret of secrets) {
    const expected = Buffer.from(xHmacSha256Base64(rawBody, secret), "utf8");
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return true;
    }
  }
  return false;
}

// ─── v2 DM event objects (REST responses + X Activity payloads) ──────────────

export interface XDmEvent {
  id?: string;
  event_type?: string;
  text?: string;
  sender_id?: string;
  dm_conversation_id?: string;
  participant_ids?: string[];
  created_at?: string;
  attachments?: { media_keys?: string[] };
  referenced_tweets?: Array<{ id?: string }>;
}

export interface XUserObject {
  id?: string;
  name?: string;
  username?: string;
  profile_image_url?: string;
}

export interface XMediaObject {
  media_key?: string;
  type?: string;
  url?: string;
  preview_image_url?: string;
}

export interface XIncludes {
  users?: XUserObject[];
  media?: XMediaObject[];
}

/** X snowflake ids exceed Number.MAX_SAFE_INTEGER — compare as BigInt. */
export function compareXIds(a: string, b: string): number {
  try {
    const ai = BigInt(a);
    const bi = BigInt(b);
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

/** Documented 1:1 conversation id: {smaller_user_id}-{larger_user_id}. */
export function oneToOneConversationId(userIdA: string, userIdB: string): string {
  return compareXIds(userIdA, userIdB) <= 0 ? `${userIdA}-${userIdB}` : `${userIdB}-${userIdA}`;
}

function mediaTypeToMessageType(mediaType: string | undefined): MessageType {
  switch (mediaType) {
    case "photo":
      return "IMAGE";
    case "video":
    case "animated_gif":
      return "VIDEO";
    default:
      return "FILE";
  }
}

function attachmentsFromMediaKeys(
  event: XDmEvent,
  includes: XIncludes | undefined,
): NormalizedAttachment[] {
  const keys = event.attachments?.media_keys ?? [];
  if (keys.length === 0) return [];
  const byKey = new Map<string, XMediaObject>();
  for (const media of includes?.media ?? []) {
    if (media.media_key) byKey.set(media.media_key, media);
  }
  const attachments: NormalizedAttachment[] = [];
  for (const key of keys) {
    const media = byKey.get(key);
    const url = media?.url ?? media?.preview_image_url;
    if (url) attachments.push({ url });
  }
  return attachments;
}

/**
 * Normalize one v2 DM event object into the internal inbound shape.
 * Returns null for non-message events, events missing the fields
 * ingest requires, and messages sent by the connected account itself
 * (outbound echoes are not inbound).
 */
export function normalizeDmEvent(
  event: XDmEvent,
  includes: XIncludes | undefined,
  ownUserId: string,
): NormalizedInboundMessage | null {
  if (event.event_type !== "MessageCreate") return null;
  if (!event.id || !event.sender_id) return null;
  if (event.sender_id === ownUserId) return null;

  const attachments = attachmentsFromMediaKeys(event, includes);
  const firstMediaKey = event.attachments?.media_keys?.[0];
  const firstMedia = (includes?.media ?? []).find((m) => m.media_key === firstMediaKey);
  const sender = (includes?.users ?? []).find((u) => u.id === event.sender_id);

  let threadId = event.dm_conversation_id;
  if (!threadId && event.participant_ids && event.participant_ids.length === 2) {
    const [a, b] = event.participant_ids as [string, string];
    threadId = oneToOneConversationId(a, b);
  }

  return {
    externalMessageId: event.id,
    ...(threadId ? { externalThreadId: threadId } : {}),
    senderExternalId: event.sender_id,
    ...(sender?.name ? { senderName: sender.name } : {}),
    ...(sender?.profile_image_url ? { senderAvatarUrl: sender.profile_image_url } : {}),
    type: attachments.length > 0 ? mediaTypeToMessageType(firstMedia?.type) : "TEXT",
    ...(event.text !== undefined ? { body: event.text } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    sentAt: event.created_at ? new Date(event.created_at) : new Date(),
    raw: event,
  };
}

// ─── Account Activity API payloads (legacy) ──────────────────────────────────

export interface AaaMedia {
  media_url_https?: string;
  type?: string;
  video_info?: {
    variants?: Array<{ url?: string; content_type?: string; bitrate?: number }>;
  };
}

export interface AaaDirectMessageEvent {
  type?: string;
  id?: string;
  created_timestamp?: string;
  message_create?: {
    sender_id?: string;
    target?: { recipient_id?: string };
    message_data?: {
      text?: string;
      attachment?: { type?: string; media?: AaaMedia };
    };
  };
}

export interface AaaUser {
  id?: string;
  name?: string;
  screen_name?: string;
  profile_image_url_https?: string;
  profile_image_url?: string;
}

export interface AaaReadEvent {
  id?: string;
  created_timestamp?: string;
  message_read?: {
    sender_id?: string;
    target?: { recipient_id?: string };
    last_read_event_id?: string;
  };
}

export interface AaaPayload {
  for_user_id?: string;
  direct_message_events?: AaaDirectMessageEvent[];
  direct_message_read_events?: AaaReadEvent[];
  users?: Record<string, AaaUser>;
}

function aaaAttachment(media: AaaMedia | undefined): NormalizedAttachment[] {
  if (!media) return [];
  if (media.type === "video" || media.type === "animated_gif") {
    const variants = (media.video_info?.variants ?? [])
      .filter((v) => v.content_type === "video/mp4" && typeof v.url === "string")
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    const url = variants[0]?.url ?? media.media_url_https;
    return url ? [{ url }] : [];
  }
  return media.media_url_https ? [{ url: media.media_url_https }] : [];
}

function normalizeAaaEvent(
  event: AaaDirectMessageEvent,
  payload: AaaPayload,
): NormalizedInboundMessage | null {
  if (event.type !== "message_create" || !event.id) return null;
  const messageCreate = event.message_create;
  const senderId = messageCreate?.sender_id;
  const recipientId = messageCreate?.target?.recipient_id;
  if (!senderId || !recipientId) return null;
  if (payload.for_user_id && senderId === payload.for_user_id) return null; // own echo

  const media = messageCreate.message_data?.attachment?.media;
  const attachments = aaaAttachment(media);
  const sender = payload.users?.[senderId];
  const timestampMs = Number(event.created_timestamp);

  return {
    externalMessageId: event.id,
    externalThreadId: oneToOneConversationId(senderId, recipientId),
    senderExternalId: senderId,
    ...(sender?.name ? { senderName: sender.name } : {}),
    ...(sender?.profile_image_url_https ?? sender?.profile_image_url
      ? { senderAvatarUrl: sender?.profile_image_url_https ?? sender?.profile_image_url }
      : {}),
    type: attachments.length > 0 ? mediaTypeToMessageType(media?.type) : "TEXT",
    ...(messageCreate.message_data?.text !== undefined
      ? { body: messageCreate.message_data.text }
      : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    sentAt: Number.isFinite(timestampMs) && timestampMs > 0 ? new Date(timestampMs) : new Date(),
    raw: event,
  };
}

// ─── X Activity API payloads (current) ───────────────────────────────────────

export interface XaaPayload {
  data?: {
    event_type?: string;
    filter?: { user_id?: string };
    payload?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the XAA envelope's DM payload, which follows the v2 DM event shape. */
function normalizeXaaDm(payload: XaaPayload): NormalizedInboundMessage[] {
  const data = payload.data;
  if (!data || data.event_type !== "dm.received") return [];
  const ownUserId = data.filter?.user_id;
  if (!ownUserId || !isRecord(data.payload)) return [];
  const inner = data.payload as XDmEvent & { includes?: XIncludes };
  const normalized = normalizeDmEvent(inner, inner.includes, ownUserId);
  return normalized ? [normalized] : [];
}

// ─── Provider-facing parsers ─────────────────────────────────────────────────

/**
 * Translate any supported X webhook payload into normalized inbound
 * messages. Unknown/other event families produce an empty list (the
 * event is still recorded by the webhook pipeline).
 */
export function parseXWebhookMessages(payload: unknown): NormalizedInboundMessage[] {
  if (!isRecord(payload)) return [];

  // X Activity API envelope.
  if (isRecord(payload.data) && typeof payload.data.event_type === "string") {
    return normalizeXaaDm(payload as XaaPayload);
  }

  // Account Activity API family.
  const aaa = payload as AaaPayload;
  if (Array.isArray(aaa.direct_message_events)) {
    const messages: NormalizedInboundMessage[] = [];
    for (const event of aaa.direct_message_events) {
      const normalized = normalizeAaaEvent(event, aaa);
      if (normalized) messages.push(normalized);
    }
    return messages;
  }

  return [];
}

/**
 * Delivery/read receipts. Only the AAA family carries them in a
 * documented shape we map today: `direct_message_read_events` →
 * watermark READ updates (every outbound message to that contact sent
 * at or before the read timestamp advances). XAA `dm.read` events are
 * not mapped yet — their per-message semantics need a live account to
 * confirm (docs/X-RESEARCH.md §6).
 */
export function parseXStatusUpdates(payload: unknown): DeliveryStatusUpdate[] {
  if (!isRecord(payload)) return [];
  const aaa = payload as AaaPayload;
  if (!Array.isArray(aaa.direct_message_read_events)) return [];
  const updates: DeliveryStatusUpdate[] = [];
  for (const event of aaa.direct_message_read_events) {
    const read = event.message_read;
    const readerId = read?.sender_id;
    const timestampMs = Number(event.created_timestamp);
    if (!readerId || !Number.isFinite(timestampMs) || timestampMs <= 0) continue;
    const at = new Date(timestampMs);
    updates.push({
      externalMessageId: null,
      status: "READ",
      at,
      watermark: at,
      contactExternalId: readerId,
      ...(aaa.for_user_id ? { channelExternalAccountId: aaa.for_user_id } : {}),
      raw: event,
    });
  }
  return updates;
}
