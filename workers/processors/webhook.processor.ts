import type { Job } from "bullmq";

import type { WebhookJobData } from "@/types/queue";

/**
 * TODO Phase 2: load the raw WebhookEvent, resolve the provider adapter
 * from the registry, parse → resolve Channel / ContactIdentity /
 * Conversation → persist normalized Messages idempotently → publish a
 * realtime event. Stub for now: logs and acknowledges the job.
 */
export async function processWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  console.log(
    `[worker:webhook] job ${job.id} for event ${job.data.webhookEventId} (${job.data.provider}) — stub, Phase 2 will process it`,
  );
}
