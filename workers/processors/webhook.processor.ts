import type { Job } from "bullmq";

import { prisma } from "@/lib/prisma";
import { getProvider } from "@/integrations/registry";
import { messagingService } from "@/services/messaging.service";
import type { WebhookJobData } from "@/types/queue";
import { providerEnumToId } from "@/types/messaging";

/**
 * Webhook processor (Phase 4, Phase 0 §6): load the persisted raw
 * WebhookEvent → provider.parseWebhook() → ingest each normalized
 * message through the messaging engine (which resolves channel /
 * contact identity / conversation and dedupes on externalMessageId)
 * → mark the event PROCESSED. Already-PROCESSED events are skipped,
 * so BullMQ retries and duplicate enqueues are safe.
 */
export async function processWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: job.data.webhookEventId } });
  if (!event) {
    console.warn(`[worker:webhook] event ${job.data.webhookEventId} not found — skipping`);
    return;
  }
  if (event.status === "PROCESSED") {
    console.log(`[worker:webhook] event ${event.id} already PROCESSED — skipping`);
    return;
  }

  try {
    const provider = getProvider(providerEnumToId(event.provider));
    const messages = provider.parseWebhook(event.payload);

    const payload = (event.payload ?? {}) as Record<string, unknown>;
    let channel = event.channelId
      ? await prisma.channel.findUnique({ where: { id: event.channelId } })
      : null;
    if (!channel && typeof payload.channelId === "string") {
      channel = await prisma.channel.findUnique({ where: { id: payload.channelId } });
    }
    if (!channel && typeof payload.channelExternalAccountId === "string") {
      channel = await prisma.channel.findFirst({
        where: { provider: event.provider, externalAccountId: payload.channelExternalAccountId },
      });
    }
    if (!channel) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: "IGNORED",
          processedAt: new Date(),
          error: "No matching channel for webhook payload",
        },
      });
      console.warn(`[worker:webhook] event ${event.id} IGNORED — no matching channel`);
      return;
    }

    for (const message of messages) {
      const result = await messagingService.ingestInboundMessage(
        channel.workspaceId,
        channel.id,
        message,
      );
      if (result.deduplicated) {
        console.log(
          `[worker:webhook] duplicate inbound ${message.externalMessageId} ignored (idempotent)`,
        );
      }
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date(), error: null },
    });
  } catch (error) {
    await prisma.webhookEvent
      .update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Unknown webhook processing error",
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
