import { Queue } from "bullmq";

import { createRedisConnection } from "@/lib/redis";
import type {
  GmailPollJobData,
  MediaJobData,
  OutboundJobData,
  OutgoingWebhookJobData,
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
  gmailPoll: "gmail-poll",
  outgoingWebhook: "outgoing-webhook",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let queues: {
  webhook: Queue<WebhookJobData>;
  outbound: Queue<OutboundJobData>;
  media: Queue<MediaJobData>;
  tokenRefresh: Queue<TokenRefreshJobData>;
  gmailPoll: Queue<GmailPollJobData>;
  outgoingWebhook: Queue<OutgoingWebhookJobData>;
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
    outgoingWebhook: new Queue<OutgoingWebhookJobData>(QUEUE_NAMES.outgoingWebhook, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    }),
    gmailPoll: new Queue<GmailPollJobData>(QUEUE_NAMES.gmailPoll, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        // The sweep is periodic and self-healing — a failed tick is
        // simply retried by the next one, so no per-job retries.
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    }),
  };
}

export function getQueues() {
  if (!queues) queues = buildQueues();
  return queues;
}
