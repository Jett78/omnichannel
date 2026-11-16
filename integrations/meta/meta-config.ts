import { AppError } from "@/lib/errors";

/**
 * Meta platform configuration (Phase 5) — SERVER ONLY.
 *
 * Values come exclusively from environment variables. This module
 * reads `process.env` lazily on every call (no import-time parsing,
 * no caching), so a deployment can be (re)configured without code
 * changes and tests can set env per-process.
 *
 * Two separate Meta products are configured:
 *  - Facebook Login / Messenger: META_APP_ID / META_APP_SECRET — the
 *    app id/secret of the Meta app that has the Messenger product.
 *  - Instagram API with Instagram Login: INSTAGRAM_APP_ID /
 *    INSTAGRAM_APP_SECRET — the Instagram product's OWN app id/secret
 *    from the Meta dashboard (distinct from the Facebook app secret).
 *
 * Nothing in this module ever returns a secret to the browser; the
 * `*Configured()` helpers and redirect URIs are the only pieces the
 * dashboard needs.
 */

export const DEFAULT_GRAPH_API_VERSION = "v25.0";

export interface FacebookMetaConfig {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  redirectUri: string;
  webhookVerifyToken: string | undefined;
  appsecretProof: boolean;
}

export interface InstagramMetaConfig {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  redirectUri: string;
  webhookVerifyToken: string | undefined;
  appsecretProof: boolean;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function graphApiVersion(): string {
  return process.env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
}

/** Graph API version without requiring full configuration (used for read-only URL building). */
export function metaGraphApiVersion(): string {
  return graphApiVersion();
}

function appsecretProofEnabled(): boolean {
  return process.env.META_APPSECRET_PROOF === "true";
}

function missingConfigError(product: string, missing: string[]): AppError {
  return new AppError(
    `${product} integration is not configured on this deployment. Missing environment variables: ${missing.join(", ")}. Set them (see docs/META-APP-REVIEW.md) and restart the app.`,
    "META_NOT_CONFIGURED",
    503,
  );
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

export function getFacebookConfig(): FacebookMetaConfig {
  const missing: string[] = [];
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId) missing.push("META_APP_ID");
  if (!appSecret) missing.push("META_APP_SECRET");
  if (missing.length > 0) throw missingConfigError("Facebook Messenger", missing);
  return {
    appId: appId as string,
    appSecret: appSecret as string,
    graphApiVersion: graphApiVersion(),
    redirectUri:
      process.env.META_FACEBOOK_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/facebook/callback`,
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || undefined,
    appsecretProof: appsecretProofEnabled(),
  };
}

export function isFacebookConfigured(): boolean {
  return Boolean(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim());
}

/** Redirect URI to register in the Meta app — safe to display (no secrets). */
export function facebookRedirectUri(): string {
  return (
    process.env.META_FACEBOOK_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/facebook/callback`
  );
}

/** App secret for webhook signature checks; undefined when unconfigured. */
export function facebookAppSecret(): string | undefined {
  return process.env.META_APP_SECRET?.trim() || undefined;
}

// ─── Instagram ────────────────────────────────────────────────────────────────

export function getInstagramConfig(): InstagramMetaConfig {
  const missing: string[] = [];
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  if (!appId) missing.push("INSTAGRAM_APP_ID");
  if (!appSecret) missing.push("INSTAGRAM_APP_SECRET");
  if (missing.length > 0) throw missingConfigError("Instagram", missing);
  return {
    appId: appId as string,
    appSecret: appSecret as string,
    graphApiVersion: graphApiVersion(),
    redirectUri:
      process.env.INSTAGRAM_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/instagram/callback`,
    webhookVerifyToken:
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() ||
      process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
      undefined,
    appsecretProof: appsecretProofEnabled(),
  };
}

export function isInstagramConfigured(): boolean {
  return Boolean(process.env.INSTAGRAM_APP_ID?.trim() && process.env.INSTAGRAM_APP_SECRET?.trim());
}

/** Redirect URI to register in the Meta app — safe to display (no secrets). */
export function instagramRedirectUri(): string {
  return process.env.INSTAGRAM_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/instagram/callback`;
}

/** App secret for webhook signature checks; undefined when unconfigured. */
export function instagramAppSecret(): string | undefined {
  return process.env.INSTAGRAM_APP_SECRET?.trim() || undefined;
}

/** Webhook verify token for the GET handshake, per provider. */
export function webhookVerifyToken(providerId: "facebook" | "instagram"): string | undefined {
  if (providerId === "instagram") {
    return (
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() ||
      process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
      undefined
    );
  }
  return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || undefined;
}
