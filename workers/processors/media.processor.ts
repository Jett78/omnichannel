import type { Job } from "bullmq";

import type { MediaJobData } from "@/types/queue";

/**
 * Media processor — HONEST STUB (Phase 4). Attachment downloading to
 * S3-compatible storage lands with the first real provider (media URLs
 * are provider-authenticated and short-lived). Today the job is
 * accepted and logged so the queue contract exists end-to-end; no
 * download is performed and nothing is marked as processed.
 */
export async function processMediaJob(job: Job<MediaJobData>): Promise<void> {
  console.log(
    `[worker:media] job ${job.id} for message ${job.data.messageId} attachment ${job.data.attachmentUrl} — TODO: download to storage when real providers land (stub, nothing downloaded)`,
  );
}
