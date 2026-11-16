import { getQueues } from "@/lib/queue";

/**
 * Token-refresh scheduling (Phase 8).
 *
 * Providers whose access tokens expire and rotate (today: X, whose
 * OAuth 2.0 access tokens live 2 hours) need a refresh job armed for
 * shortly before each expiry. The job id embeds the expiry timestamp
 * so re-arming for the same cycle dedupes instead of stacking jobs.
 * The worker side lives in workers/processors/token-refresh.processor.ts
 * and re-arms after every successful refresh, forming a chain that
 * runs until the channel disconnects or the refresh token dies.
 */

/** Refresh this long before the access token expires. */
export const TOKEN_REFRESH_LEAD_MS = 10 * 60 * 1000;

export async function scheduleTokenRefreshJob(
  channelId: string,
  workspaceId: string,
  expiresAt: Date,
): Promise<void> {
  const delay = Math.max(0, expiresAt.getTime() - Date.now() - TOKEN_REFRESH_LEAD_MS);
  await getQueues().tokenRefresh.add(
    "refresh",
    { channelId, workspaceId },
    { delay, jobId: `token-refresh-${channelId}-${expiresAt.getTime()}` },
  );
}
