import { connection, NextResponse } from "next/server";

import { getPrisma } from "@/lib/prisma";
import { pingRedis } from "@/lib/redis";

/**
 * Health check — always returns 200 when the app itself is up, with a
 * per-dependency status so degraded DB/Redis is visible, not fatal.
 *   curl http://localhost:3000/api/health
 */
export async function GET() {
  // Opt out of static prerendering (Cache Components): health is live data.
  await connection();
  let database: "ok" | "error" = "error";
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    database = "ok";
  } catch {
    database = "error";
  }

  const redisOk = await pingRedis().catch(() => false);

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    dependencies: {
      database,
      redis: redisOk ? "ok" : "error",
    },
  });
}
