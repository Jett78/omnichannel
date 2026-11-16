import { Queue } from "bullmq";

import { createRedisConnection } from "@/lib/redis";
import type {
  MediaJobData,
  OutboundJobData,
  TokenRefreshJobData,
  WebhookJobData,
} from "@/types/queue";

/**
 * BullMQ queue registry. Queues are created lazily — importing this
 * module does not connect to Redis. Workers live in `workers/`.
 */
export const QUEUE_NAMES = {
  webhook: "webhook",
  outbound: "outbound",
  media: "media",
  tokenRefresh: "token-refresh",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let queues: {
  webhook: Queue<WebhookJobData>;
  outbound: Queue<OutboundJobData>;
  media: Queue<MediaJobData>;
  tokenRefresh: Queue<TokenRefreshJobData>;
} | null = null;

function buildQueues() {
  return {
    webhook: new Queue<WebhookJobData>(QUEUE_NAMES.webhook, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }),
    outbound: new Queue<OutboundJobData>(QUEUE_NAMES.outbound, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }),
    media: new Queue<MediaJobData>(QUEUE_NAMES.media, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }),
    tokenRefresh: new Queue<TokenRefreshJobData>(QUEUE_NAMES.tokenRefresh, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "fixed", delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    }),
  };
}

export function getQueues() {
  if (!queues) queues = buildQueues();
  return queues;
}
