import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { WEBSITE_FILE_PREFIX } from "@/integrations/website/website-provider";
import { messagingService, MAX_MEDIA_BYTES } from "@/services/messaging.service";
import { DEFAULT_WIDGET_COLOR } from "@/services/website-channel.service";
import type { Channel } from "@/generated/prisma/client";
import type { MessageType } from "@/types/messaging";

/**
 * Website widget public API logic (Phase 11). Everything here is
 * reachable WITHOUT a dashboard login, so the security model is:
 *
 *  - The website token (channel externalAccountId) is public — it
 *    only identifies which site's widget is calling.
 *  - A visitor's access is an HMAC-signed token issued when their
 *    conversation starts: `v1.{payload}.{signature}` where the
 *    payload binds the channel id + the visitor's identity id. It
 *    is unguessable, tamper-evident, and scoped to exactly one
 *    visitor on one channel. The widget stores it in localStorage.
 *  - Every read/write resolves the token → channel + contact and
 *    only ever touches that visitor's own conversation.
 *  - Creation and sending are rate-limited per channel/IP/visitor
 *    via Redis fixed windows (see the route handlers).
 */

const VISITOR_TOKEN_VERSION = "v1";

function visitorSigningKey(): Buffer {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update("uoi-widget-visitor").digest();
}

export function signVisitorToken(channelId: string, externalUserId: string): string {
  const payload = Buffer.from(JSON.stringify({ c: channelId, u: externalUserId }), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", visitorSigningKey()).update(payload).digest("base64url");
  return `${VISITOR_TOKEN_VERSION}.${payload}.${signature}`;
}

export function verifyVisitorToken(token: string): { channelId: string; externalUserId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VISITOR_TOKEN_VERSION) return null;
  const payload = parts[1] as string;
  const presented = Buffer.from(parts[2] as string, "base64url");
  const expected = createHmac("sha256", visitorSigningKey()).update(payload).digest();
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      c?: unknown;
      u?: unknown;
    };
    if (typeof parsed.c !== "string" || typeof parsed.u !== "string") return null;
    return { channelId: parsed.c, externalUserId: parsed.u };
  } catch {
    return null;
  }
}

/**
 * Redis fixed-window rate limit. Returns false when over the limit.
 *
 * Fails OPEN on Redis errors: a broken Redis (e.g. the 2026-11-24
 * Upstash command cap, which made every widget send return "Something
 * went wrong") must not take the public widget down with it. The
 * visitor's message matters more than the anti-spam count; the
 * failure is logged, and limiting resumes by itself once Redis
 * answers again.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const redis = getRedis();
    // Bounded wait: a Redis that never answers (connection dead, not
    // just erroring) must not hang the visitor's request either.
    const count = await Promise.race([
      redis.incr(key),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("rate-limit check timed out")), 2000),
      ),
    ]);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= limit;
  } catch (error) {
    console.warn(
      `[widget] rate-limit check failed, allowing the request: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return true;
  }
}

// ─── Channel + visitor resolution ─────────────────────────────────

export interface WidgetPublicConfig {
  displayName: string;
  widgetColor: string;
  welcomeTitle: string;
  welcomeTagline: string;
  preChatForm: boolean;
}

function configOf(channel: Channel): Record<string, unknown> {
  return channel.config && typeof channel.config === "object" && !Array.isArray(channel.config)
    ? (channel.config as Record<string, unknown>)
    : {};
}

export async function getWidgetChannel(websiteToken: string): Promise<Channel> {
  const channel = await prisma.channel.findFirst({
    where: { provider: "WEBSITE", externalAccountId: websiteToken, status: "CONNECTED" },
  });
  if (!channel) throw AppError.notFound("This chat widget is not available.");
  return channel;
}

export function publicConfigOf(channel: Channel): WidgetPublicConfig {
  const config = configOf(channel);
  return {
    displayName: channel.displayName,
    widgetColor: typeof config.widgetColor === "string" ? config.widgetColor : DEFAULT_WIDGET_COLOR,
    welcomeTitle: typeof config.welcomeTitle === "string" ? config.welcomeTitle : "Chat with us",
    welcomeTagline:
      typeof config.welcomeTagline === "string"
        ? config.welcomeTagline
        : "We usually reply within a few minutes.",
    preChatForm: config.preChatForm !== false,
  };
}

interface ResolvedVisitor {
  channel: Channel;
  contactId: string;
  externalUserId: string;
  displayName: string;
}

async function resolveVisitor(websiteToken: string, visitorToken: string): Promise<ResolvedVisitor> {
  const verified = verifyVisitorToken(visitorToken);
  if (!verified) throw AppError.unauthorized("Invalid visitor token");
  const channel = await getWidgetChannel(websiteToken);
  if (channel.id !== verified.channelId) throw AppError.unauthorized("Invalid visitor token");
  const identity = await prisma.contactIdentity.findUnique({
    where: {
      channelId_externalUserId: { channelId: channel.id, externalUserId: verified.externalUserId },
    },
    include: { contact: true },
  });
  if (!identity) throw AppError.unauthorized("Invalid visitor token");
  return {
    channel,
    contactId: identity.contactId,
    externalUserId: verified.externalUserId,
    displayName: identity.contact.displayName,
  };
}

// ─── Visitor flows ────────────────────────────────────────────────

export const widgetService = {
  async startConversation(
    websiteToken: string,
    input: { name?: string; email?: string },
  ): Promise<{ visitorToken: string }> {
    const channel = await getWidgetChannel(websiteToken);
    const externalUserId = `visitor_${randomUUID()}`;
    const contact = await prisma.contact.create({
      data: {
        workspaceId: channel.workspaceId,
        displayName: input.name?.trim() ? input.name.trim() : "Website visitor",
        email: input.email?.trim() ? input.email.trim() : null,
      },
    });
    await prisma.contactIdentity.create({
      data: { contactId: contact.id, channelId: channel.id, externalUserId },
    });
    return { visitorToken: signVisitorToken(channel.id, externalUserId) };
  },

  async listMessages(websiteToken: string, visitorToken: string) {
    const visitor = await resolveVisitor(websiteToken, visitorToken);
    const conversation = await prisma.conversation.findFirst({
      where: { channelId: visitor.channel.id, contactId: visitor.contactId },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation) return { conversationId: null, messages: [] };
    const rows = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        type: { notIn: ["PRIVATE_NOTE", "SYSTEM"] },
        status: { not: "FAILED" },
      },
      include: { attachments: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return {
      conversationId: conversation.id,
      messages: rows.map((row) => ({
        id: row.id,
        fromVisitor: row.direction === "INBOUND",
        type: row.type,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        attachments: row.attachments.map((attachment, index) => ({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          url: `/api/widget/${websiteToken}/media/${row.id}/${index}?t=${encodeURIComponent(visitorToken)}`,
        })),
      })),
    };
  },

  async sendTextMessage(websiteToken: string, visitorToken: string, content: string) {
    const visitor = await resolveVisitor(websiteToken, visitorToken);
    const result = await messagingService.ingestInboundMessage(
      visitor.channel.workspaceId,
      visitor.channel.id,
      {
        externalMessageId: `web-${randomUUID()}`,
        externalThreadId: visitor.externalUserId,
        senderExternalId: visitor.externalUserId,
        senderName: visitor.displayName,
        type: "TEXT",
        body: content,
        sentAt: new Date(),
        raw: { source: "website-widget" },
      },
    );
    return { messageId: result.message.id, conversationId: result.conversationId };
  },

  async sendMediaMessage(
    websiteToken: string,
    visitorToken: string,
    input: { bytes: Buffer; fileName: string; mimeType: string; caption?: string },
  ) {
    const visitor = await resolveVisitor(websiteToken, visitorToken);
    if (input.bytes.length === 0) throw AppError.badRequest("The file is empty.");
    if (input.bytes.length > MAX_MEDIA_BYTES) {
      throw AppError.badRequest("File is too large — the limit is 16 MB.");
    }
    if (!isWidgetMediaMime(input.mimeType)) {
      throw AppError.badRequest("That file type is not supported.");
    }
    const type: MessageType = input.mimeType.startsWith("image/")
      ? "IMAGE"
      : input.mimeType.startsWith("video/")
        ? "VIDEO"
        : input.mimeType.startsWith("audio/")
          ? "AUDIO"
          : "FILE";
    const result = await messagingService.ingestInboundMessage(
      visitor.channel.workspaceId,
      visitor.channel.id,
      {
        externalMessageId: `web-${randomUUID()}`,
        externalThreadId: visitor.externalUserId,
        senderExternalId: visitor.externalUserId,
        senderName: visitor.displayName,
        type,
        ...(input.caption?.trim() ? { body: input.caption.trim() } : {}),
        attachments: [
          {
            url: `${WEBSITE_FILE_PREFIX}${randomUUID()}`,
            mimeType: input.mimeType,
            fileName: input.fileName,
            size: input.bytes.length,
          },
        ],
        sentAt: new Date(),
        raw: { source: "website-widget" },
      },
    );
    const attachment = await prisma.messageAttachment.findFirst({
      where: { messageId: result.message.id },
      orderBy: { createdAt: "asc" },
    });
    if (!attachment) throw new AppError("Attachment was not stored", "INTERNAL_ERROR", 500);
    await prisma.storedMedia.create({
      data: {
        attachmentId: attachment.id,
        mimeType: input.mimeType,
        data: Uint8Array.from(input.bytes),
      },
    });
    return { messageId: result.message.id, conversationId: result.conversationId };
  },

  /** Bytes for one attachment of one of the visitor's own messages. */
  async getMediaBytes(
    websiteToken: string,
    visitorToken: string,
    messageId: string,
    index: number,
  ): Promise<{ bytes: Buffer; mimeType: string; fileName: string | null }> {
    const visitor = await resolveVisitor(websiteToken, visitorToken);
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversation: { channelId: visitor.channel.id, contactId: visitor.contactId },
      },
      include: { attachments: { include: { storedMedia: true } } },
    });
    const attachment = message?.attachments[index];
    if (!message || !attachment) throw AppError.notFound("Media not found");
    if (!attachment.storedMedia) throw AppError.notFound("Media not found");
    return {
      bytes: Buffer.from(attachment.storedMedia.data),
      mimeType: attachment.storedMedia.mimeType,
      fileName: attachment.fileName,
    };
  },
};

/** Mirrors the inbox composer allowlist (services/messaging.service). */
const WIDGET_MEDIA_MIME_PATTERNS: readonly RegExp[] = [
  /^image\//,
  /^video\/(mp4|3gpp)$/,
  /^audio\//,
  /^application\/pdf$/,
  /^text\/plain$/,
  /^application\/msword$/,
  /^application\/vnd\.ms-/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/zip$/,
];

export function isWidgetMediaMime(mimeType: string): boolean {
  return WIDGET_MEDIA_MIME_PATTERNS.some((pattern) => pattern.test(mimeType));
}
