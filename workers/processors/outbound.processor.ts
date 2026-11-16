import type { Job } from "bullmq";

import { messagingService } from "@/services/messaging.service";
import type { OutboundJobData } from "@/types/queue";

/**
 * Outbound processor (Phase 4): delivers one QUEUED message through
 * its channel's provider via the messaging engine. Provider errors
 * rethrow so BullMQ retries with exponential backoff; on the final
 * attempt the engine marks the message FAILED (with the error in
 * metadata) instead of throwing.
 */
export async function processOutboundJob(job: Job<OutboundJobData>): Promise<void> {
  const attempts = job.opts.attempts ?? 3;
  const isFinalAttempt = job.attemptsMade + 1 >= attempts;
  const result = await messagingService.deliverOutboundMessage(job.data.messageId, {
    isFinalAttempt,
  });
  console.log(`[worker:outbound] message ${job.data.messageId} → ${result.status}`);
}
