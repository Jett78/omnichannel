import type { Job } from "bullmq";

import type { MediaJobData } from "@/types/queue";

/**
 * TODO Phase 2: download the platform media URL (authenticated, before
 * it expires) and store it in S3, updating MessageAttachment.storageKey.
 * Stub for now: logs and acknowledges the job.
 */
export async function processMediaJob(job: Job<MediaJobData>): Promise<void> {
  console.log(
    `[worker:media] job ${job.id} for message ${job.data.messageId} — stub, Phase 2 will download media`,
  );
}
