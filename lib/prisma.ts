import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

/**
 * Prisma client singleton (globalForPrisma pattern).
 *
 * Prisma 7 connects through the pg driver adapter. Creating the client
 * does NOT open a connection — the pg pool connects lazily on the first
 * query, so importing this module during `next build` is safe even when
 * PostgreSQL is not running.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: getEnv().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

/** Convenience default export for service modules. Still lazy under the hood. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value: unknown = Reflect.get(client as object, prop, receiver);
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value;
  },
});
