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
  /** "true" for implicit TLS (port 465); STARTTLS otherwise. */
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Realtime (Phase 4) — standalone Socket.IO gateway. When SOCKET_PORT is
  // not set explicitly, getEnv() falls back to the platform-provided PORT
  // (e.g. Render) so hosted web services bind the port health checks expect.
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
  // Meta — Instagram via Facebook Login. INSTAGRAM_LOGIN_CONFIG_ID is
  // legacy/unused (the configuration dialog's token cannot access the
  // user's Pages — see meta-config.ts); kept so existing deployments
  // that set it do not break validation.
  INSTAGRAM_LOGIN_CONFIG_ID: z.string().optional(),
  // WhatsApp Business Platform Cloud API (Phase 6). The app secret /
  // verify token fall back to the Meta values in meta-config.ts.
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().optional(),
  // X (Twitter) Direct Messages (Phase 8). Self-serve on X's
  // pay-per-use pricing (docs/X-RESEARCH.md). X_CLIENT_ID /
  // X_CLIENT_SECRET are the app's OAuth 2.0 confidential-client
  // credentials; the consumer key/secret are the OAuth 1.0a fallback
  // webhook-signing keys; X_BEARER_TOKEN is only for the operator's
  // one-time webhook registration; X_WEBHOOK_ID enables X Activity
  // subscriptions at connect time. Read lazily by
  // integrations/x/x-config.ts.
  // Gmail channel (Phase 9). GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  // are the Google Cloud OAuth 2.0 web client used by the Gmail
  // connect flow and token refresh; read lazily by
  // integrations/gmail/gmail-config.ts (docs/GMAIL-SETUP.md).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_CONSUMER_KEY: z.string().optional(),
  X_CONSUMER_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  X_WEBHOOK_ID: z.string().optional(),
  X_REDIRECT_URI: z.string().optional(),
  // TikTok Business Messaging (Phase 7). ACCESS-GATED: these hold the
  // TikTok API for Business developer app's credentials, but TikTok's
  // Data Security & Privacy Review approval is additionally required
  // before any messaging call can succeed (docs/TIKTOK-RESEARCH.md).
  // Read lazily by integrations/tiktok/tiktok-config.ts.
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().optional(),
  TIKTOK_WEBHOOK_SECRET: z.string().optional(),
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
  // Hosted platforms (Render etc.) inject PORT and expect the service to
  // bind it; an explicit SOCKET_PORT always wins.
  if (process.env.SOCKET_PORT === undefined && process.env.PORT) {
    const platformPort = Number(process.env.PORT);
    if (Number.isFinite(platformPort) && platformPort > 0) {
      parsed.data.SOCKET_PORT = platformPort;
    }
  }
  cached = parsed.data;
  return cached;
}
