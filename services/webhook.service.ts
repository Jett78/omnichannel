import { getQueues } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import type { Provider, Prisma, WebhookEvent } from "@/generated/prisma/client";
import { providerEnumToId } from "@/types/messaging";

/**
 * Webhook ingress persistence (Phase 0 §6): the raw event is stored
 * FIRST and processed asynchronously by the webhook worker. If the
 * payload carries an external event id we have already recorded for
 * this provider, the delivery is a duplicate — it is ACKed without
 * storing or enqueueing a second copy.
 */
export const webhookService = {
  async recordAndEnqueue(
    provider: Provider,
    payload: unknown,
    options: { externalEventId?: string | null; channelId?: string | null } = {},
  ): Promise<{ event: WebhookEvent; duplicate: boolean }> {
    if (options.externalEventId) {
      const existing = await prisma.webhookEvent.findFirst({
        where: { provider, externalEventId: options.externalEventId },
      });
      if (existing) return { event: existing, duplicate: true };
    }

    const event = await prisma.webhookEvent.create({
      data: {
        provider,
        payload: payload as Prisma.InputJsonValue,
        externalEventId: options.externalEventId ?? null,
        channelId: options.channelId ?? null,
      },
    });
    await getQueues().webhook.add("webhook", {
      webhookEventId: event.id,
      provider: providerEnumToId(provider),
    });
    return { event, duplicate: false };
  },

  /**
   * Recovery sweep: events whose row persisted but whose queue job
   * was never added — e.g. when Redis is unavailable at ingress time
   * (the 2026-11-24 Upstash cap: record succeeded, enqueue threw, the
   * route 500s and platforms retry for a while, but rows that landed
   * sit in RECEIVED forever without this). Re-enqueues RECEIVED
   * events older than `olderThanMinutes`; processing is idempotent,
   * and a deterministic job id keeps a second sweep from piling up
   * duplicates while a recovery job is still queued.
   */
  async requeueStuckEvents(olderThanMinutes = 10): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
    const stuck = await prisma.webhookEvent.findMany({
      where: { status: "RECEIVED", receivedAt: { lt: cutoff } },
      select: { id: true, provider: true },
      orderBy: { receivedAt: "asc" },
      take: 500,
    });
    let requeued = 0;
    for (const event of stuck) {
      await getQueues().webhook.add(
        "webhook",
        { webhookEventId: event.id, provider: providerEnumToId(event.provider) },
        { jobId: `recovery-${event.id}` },
      );
      requeued += 1;
    }
    return requeued;
  },
};
