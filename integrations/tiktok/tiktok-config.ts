import { AppError } from "@/lib/errors";

/**
 * TikTok configuration (Phase 7) — SERVER ONLY.
 *
 * Values come exclusively from environment variables, read lazily on
 * every call (no import-time parsing, no caching), mirroring
 * integrations/meta/meta-config.ts. Nothing here ever returns a secret
 * to the browser.
 *
 * ⚠️ ACCESS VERDICT (docs/TIKTOK-RESEARCH.md): TikTok's Business
 * Messaging API is GATED. A real API exists (TikTok API for Business
 * v1.3), but a developer may only call it after passing TikTok's
 * manual Data Security & Privacy Review — and, for US-registered
 * accounts, the US Data Security Review + USDS Addendum. TikTok states
 * that Business Messaging calls fail even for authorized accounts when
 * the developer has not passed those reviews. This deployment has not
 * been approved, so:
 *
 *  - Setting TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (the TikTok API
 *    for Business developer app's ID/secret) configures the *future*
 *    integration; it does NOT grant messaging access.
 *  - Every operational provider method throws TikTokAccessError until
 *    TikTok approval exists and the real adapter is built
 *    (docs/TIKTOK-ACCESS.md lists the approval steps).
 */

export interface TikTokConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  webhookSecret: string | undefined;
}

/** The one-sentence reason TikTok cannot be connected yet. */
export const TIKTOK_ACCESS_REASON =
  "TikTok Business Messaging requires TikTok's approval of the developer: the Data Security & Privacy Review (plus the US Data Security Review and USDS Addendum for US-registered accounts) must be passed before the Business Messaging API can be called. This deployment has not been approved, so no TikTok account can be connected and no messages can be sent or received.";

/**
 * Thrown by every operational TikTok provider method while access is
 * gated. Distinct code so the webhook processor, API routes and tests
 * can recognise the (permanent, until-approval) failure mode.
 */
export class TikTokAccessError extends AppError {
  constructor(message: string = TIKTOK_ACCESS_REASON) {
    super(message, "TIKTOK_ACCESS_REQUIRED", 403);
    this.name = "TikTokAccessError";
  }
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function missingConfigError(missing: string[]): AppError {
  return new AppError(
    `TikTok integration is not configured on this deployment. Missing environment variables: ${missing.join(", ")}. Set them (see docs/TIKTOK-ACCESS.md) and restart the app. Note: configuration alone does not grant TikTok Business Messaging access — TikTok's Data Security & Privacy Review approval is also required.`,
    "TIKTOK_NOT_CONFIGURED",
    503,
  );
}

function missingEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.TIKTOK_CLIENT_KEY?.trim()) missing.push("TIKTOK_CLIENT_KEY");
  if (!process.env.TIKTOK_CLIENT_SECRET?.trim()) missing.push("TIKTOK_CLIENT_SECRET");
  return missing;
}

export function getTikTokConfig(): TikTokConfig {
  const missing = missingEnvVars();
  if (missing.length > 0) throw missingConfigError(missing);
  return {
    clientKey: process.env.TIKTOK_CLIENT_KEY?.trim() as string,
    clientSecret: process.env.TIKTOK_CLIENT_SECRET?.trim() as string,
    redirectUri: tiktokRedirectUri(),
    webhookSecret: process.env.TIKTOK_WEBHOOK_SECRET?.trim() || undefined,
  };
}

/** True when the TikTok developer app credentials exist in env. Access stays gated regardless. */
export function isTikTokConfigured(): boolean {
  return missingEnvVars().length === 0;
}

/** OAuth redirect URI to register in the TikTok developer app — safe to display (no secrets). */
export function tiktokRedirectUri(): string {
  return process.env.TIKTOK_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/tiktok/callback`;
}

export interface TikTokAccessState {
  /** Env credentials present (necessary, never sufficient). */
  configured: boolean;
  /** Env vars still missing, by name only. */
  missingEnv: string[];
  /** Always "gated" in Phase 7 — approval is granted by TikTok out-of-band, not by config. */
  access: "gated";
  /** Why the integration cannot operate yet. */
  reason: string;
  /** Where the approval steps live. */
  accessDoc: string;
}

/**
 * Dashboard/test view of the TikTok integration state. Deliberately
 * has no "approved" outcome: TikTok approval cannot be detected from
 * configuration, and claiming it from env alone would be a lie. When
 * TikTok actually approves this app, the real adapter replaces the
 * gated provider and this state function is revisited.
 */
export function getTikTokAccessState(): TikTokAccessState {
  const missingEnv = missingEnvVars();
  return {
    configured: missingEnv.length === 0,
    missingEnv,
    access: "gated",
    reason: TIKTOK_ACCESS_REASON,
    accessDoc: "docs/TIKTOK-ACCESS.md",
  };
}
