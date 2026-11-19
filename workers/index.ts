import { Worker } from "bullmq";

import { getQueues, QUEUE_NAMES } from "@/lib/queue";
import { createRedisConnection } from "@/lib/redis";
import type {
  GmailPollJobData,
  MediaJobData,
  OutboundJobData,
  TokenRefreshJobData,
  WebhookJobData,
} from "@/types/queue";

import { processGmailPollJob } from "@/workers/processors/gmail-poll.processor";
import { processMediaJob } from "@/workers/processors/media.processor";
import { processOutboundJob } from "@/workers/processors/outbound.processor";
import { processTokenRefreshJob } from "@/workers/processors/token-refresh.processor";
import { processWebhookJob } from "@/workers/processors/webhook.processor";

/**
 * Standalone BullMQ worker process — run with `npm run worker`.
 * Kept separate from Next.js request handling by design (Phase 0).
 * Each worker gets its own Redis connection, as BullMQ requires.
 */
function registerWorker<TData>(name: string, processor: (job: never) => Promise<void>) {
  const worker = new Worker<TData>(name, processor as never, {
    connection: createRedisConnection(),
  });
  worker.on("completed", (job) => {
    console.log(`[worker:${name}] job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker:${name}] job ${job?.id} failed:`, err.message);
  });
  worker.on("error", (err) => {
    console.error(`[worker:${name}] error:`, err.message);
  });
  return worker;
}

const workers = [
  registerWorker<WebhookJobData>(QUEUE_NAMES.webhook, processWebhookJob),
  registerWorker<OutboundJobData>(QUEUE_NAMES.outbound, processOutboundJob),
  registerWorker<MediaJobData>(QUEUE_NAMES.media, processMediaJob),
  registerWorker<TokenRefreshJobData>(QUEUE_NAMES.tokenRefresh, processTokenRefreshJob),
  registerWorker<GmailPollJobData>(QUEUE_NAMES.gmailPoll, processGmailPollJob),
];

// Gmail inbound is polling-based (Phase 9): arm the recurring sweep
// (every 60s) that polls every CONNECTED Gmail channel's history
// feed. upsertJobScheduler is idempotent across worker restarts.
void (async () => {
  try {
    await getQueues().gmailPoll.upsertJobScheduler(
      "gmail-poll-sweep",
      { every: 60_000 },
      { name: "sweep", data: {} },
    );
    console.log("[worker] gmail-poll sweep scheduled (every 60s)");
  } catch (error) {
    console.error(
      `[worker] could not schedule the gmail-poll sweep: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
})();

console.log(
  `[worker] listening on queues: ${Object.values(QUEUE_NAMES).join(", ")} (webhook + outbound live; token-refresh live since Phase 8; gmail-poll live since Phase 9; media still a stub)`,
);

async function shutdown(): Promise<void> {
  console.log("[worker] shutting down…");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
