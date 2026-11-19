import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { webhookService } from "@/services/webhook.service";

interface RouteContext {
  params: Promise<{ channelId: string }>;
}

/**
 * POST /api/webhooks/telegram/[channelId] — Telegram Bot API webhook
 * ingress (Phase 10). Each connected bot has its own URL (registered
 * via setWebhook at connect time) and its own secret token, which
 * Telegram echoes in the X-Telegram-Bot-Api-Secret-Token header.
 *
 * The secret is verified BEFORE anything is persisted (Phase 0 §6):
 * a wrong or missing secret gets a 401 and no WebhookEvent row. On
 * success the raw update is stored and enqueued for the webhook
 * worker, and we ACK 200 fast. Updates for a DISCONNECTED channel
 * are ACKed and dropped (Telegram retries non-200 responses; the
 * channel's webhook is deleted at disconnect, so this is only a
 * race guard).
 */
export async function POST(request: Request, context: RouteContext) {
  const { channelId } = await context.params;

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.provider !== "TELEGRAM") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Unknown Telegram channel" } },
      { status: 404 },
    );
  }

  const config =
    channel.config && typeof channel.config === "object" && !Array.isArray(channel.config)
      ? (channel.config as Record<string, unknown>)
      : {};
  const expectedSecret = typeof config.webhookSecret === "string" ? config.webhookSecret : null;
  const presentedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expectedSecret || !presentedSecret || presentedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Webhook secret verification failed" } },
      { status: 401 },
    );
  }

  if (channel.status === "DISCONNECTED") {
    return NextResponse.json({ received: true, dropped: "channel disconnected" });
  }

  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Webhook body must be valid JSON" } },
      { status: 400 },
    );
  }

  const updateId =
    payload && typeof payload === "object" && typeof (payload as { update_id?: unknown }).update_id === "number"
      ? String((payload as { update_id: number }).update_id)
      : null;

  const { duplicate } = await webhookService.recordAndEnqueue("TELEGRAM", payload, {
    externalEventId: updateId,
    channelId: channel.id,
  });
  return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}) });
}
