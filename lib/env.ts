import { z } from "zod";

/**
 * Server environment validation.
 *
 * Parsed lazily (on first access) so importing this module during
 * `next build` never crashes when services are not running — values are
 * only *read*, never connected to, at import time.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().min(1).default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://uoi:uoi_password@localhost:5432/uoi?schema=public"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  // Better Auth (primary auth config)
  BETTER_AUTH_SECRET: z.string().min(1).default("dev-only-better-auth-secret-change-me"),
  BETTER_AUTH_URL: z.string().min(1).default("http://localhost:3000"),
  // Legacy names kept for backwards compatibility with Phase 1 scripts
  AUTH_SECRET: z.string().min(1).default("dev-only-secret"),
  NEXTAUTH_SECRET: z.string().min(1).default("dev-only-secret"),
  NEXTAUTH_URL: z.string().min(1).default("http://localhost:3000"),
  ENCRYPTION_KEY: z.string().min(1).default("0".repeat(64)),
  // Mail (dev mailer logs; SMTP plugs in here later)
  MAIL_FROM: z.string().default("Unified Inbox <no-reply@uoi.local>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Realtime (Phase 4) — standalone Socket.IO gateway
  SOCKET_PORT: z.coerce.number().default(4001),
  NEXT_PUBLIC_SOCKET_URL: z.string().min(1).default("http://localhost:4001"),
  // Mock provider (Phase 4, dev/test only)
  MOCK_WEBHOOK_SECRET: z.string().min(1).default("dev-mock-secret"),
  ENABLE_MOCK_PROVIDER: z.string().optional(),
  // Meta — Facebook Messenger (Phase 5). Read lazily by
  // integrations/meta/meta-config.ts; all optional here so the app
  // boots unconfigured and the connect flow fails with a clear 503.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().optional(),
  META_FACEBOOK_REDIRECT_URI: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_APPSECRET_PROOF: z.string().optional(),
  // Meta — Instagram API with Instagram Login (Phase 5)
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: z.string().optional(),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  // WhatsApp Business Platform Cloud API (Phase 6). The app secret /
  // verify token fall back to the Meta values in meta-config.ts.
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().optional(),
  // S3-compatible media storage (used by the WhatsApp media processor)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  cached = parsed.data;
  return cached;
}
