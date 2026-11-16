import type { Job } from "bullmq";

import type { TokenRefreshJobData } from "@/types/queue";

/**
 * TODO Phase 4+: refresh a channel's access token before expiry via the
 * provider adapter and persist the rotated credential (encrypted).
 * Stub for now: logs and acknowledges the job.
 */
export async function processTokenRefreshJob(job: Job<TokenRefreshJobData>): Promise<void> {
  console.log(
    `[worker:token-refresh] job ${job.id} for channel ${job.data.channelId} — stub, Phase 4+ will refresh tokens`,
  );
}
