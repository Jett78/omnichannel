import type { Job } from "bullmq";

import type { OutboundJobData } from "@/types/queue";

/**
 * TODO Phase 2/3: load the QUEUED Message, call the channel provider's
 * sendMessage(), then persist the external id and SENT status.
 * Stub for now: logs and acknowledges the job.
 */
export async function processOutboundJob(job: Job<OutboundJobData>): Promise<void> {
  console.log(
    `[worker:outbound] job ${job.id} for message ${job.data.messageId} — stub, Phase 2/3 will send it`,
  );
}
