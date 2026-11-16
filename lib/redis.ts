import Redis from "ioredis";

import { getEnv } from "@/lib/env";

/**
 * ioredis singleton with lazyConnect — importing this module never
 * opens a connection and never crashes the build when Redis is down.
 * Call `getRedis()` when you actually need the client; call
 * `pingRedis()` for health checks.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    const client = new Redis(getEnv().REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    client.on("error", (err: Error) => {
      // Never crash the process because Redis is unavailable.
      console.error("[redis] connection error:", err.message);
    });
    globalForRedis.redis = client;
  }
  return globalForRedis.redis;
}

/** Creates a *separate* connection — BullMQ requires dedicated clients. */
export function createRedisConnection(): Redis {
  const client = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  client.on("error", (err: Error) => {
    console.error("[redis] connection error:", err.message);
  });
  return client;
}

export async function pingRedis(): Promise<boolean> {
  const client = getRedis();
  try {
    if (client.status === "wait") await client.connect();
    const res = await client.ping();
    return res === "PONG";
  } catch {
    return false;
  }
}
