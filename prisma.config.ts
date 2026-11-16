import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration. The datasource URL lives here (not in the
 * schema). Prisma CLI loads `.env` automatically; the fallback keeps
 * `prisma generate` / `prisma validate` working offline in a fresh clone
 * after `cp .env.example .env`.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ?? "postgresql://uoi:uoi_password@localhost:5432/uoi?schema=public",
  },
});
