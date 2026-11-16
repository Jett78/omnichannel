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
};
