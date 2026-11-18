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
 *  - Instagram via Unified Login (newer Meta apps, where Instagram
 *    Login is not offered at all): INSTAGRAM_LOGIN_CONFIG_ID — the
 *    Facebook Login for Business configuration created in the
 *    Instagram use case. Reuses META_APP_ID / META_APP_SECRET; the
 *    Instagram professional account must be linked to a Facebook Page.
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

export interface InstagramUnifiedConfig {
  appId: string;
  appSecret: string;
  /** Facebook Login for Business configuration id (Instagram use case). */
  loginConfigId: string;
  graphApiVersion: string;
  redirectUri: string;
  webhookVerifyToken: string | undefined;
  appsecretProof: boolean;
}

export type InstagramAuthModel = "unified" | "instagram-login";

/**
 * Which Instagram auth model this deployment uses. Unified Login wins
 * when its configuration id is present: newer Meta apps cannot use
 * Instagram Login at all (the dashboard states this explicitly), so a
 * deployment that has both configured is a newer app.
 */
export function instagramAuthModel(): InstagramAuthModel | null {
  if (
    process.env.INSTAGRAM_LOGIN_CONFIG_ID?.trim() &&
    process.env.META_APP_ID?.trim() &&
    process.env.META_APP_SECRET?.trim()
  ) {
    return "unified";
  }
  if (process.env.INSTAGRAM_APP_ID?.trim() && process.env.INSTAGRAM_APP_SECRET?.trim()) {
    return "instagram-login";
  }
  return null;
}

export function getInstagramUnifiedConfig(): InstagramUnifiedConfig {
  const missing: string[] = [];
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const loginConfigId = process.env.INSTAGRAM_LOGIN_CONFIG_ID?.trim();
  if (!appId) missing.push("META_APP_ID");
  if (!appSecret) missing.push("META_APP_SECRET");
  if (!loginConfigId) missing.push("INSTAGRAM_LOGIN_CONFIG_ID");
  if (missing.length > 0) throw missingConfigError("Instagram (Unified Login)", missing);
  return {
    appId: appId as string,
    appSecret: appSecret as string,
    loginConfigId: loginConfigId as string,
    graphApiVersion: graphApiVersion(),
    redirectUri: instagramRedirectUri(),
    webhookVerifyToken:
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() ||
      process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
      undefined,
    appsecretProof: appsecretProofEnabled(),
  };
}

export function isInstagramConfigured(): boolean {
  return instagramAuthModel() !== null;
}

/** Redirect URI to register in the Meta app — safe to display (no secrets). */
export function instagramRedirectUri(): string {
  return process.env.INSTAGRAM_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/instagram/callback`;
}

/**
 * App secret for webhook signature checks; undefined when unconfigured.
 * Instagram Login signs with the Instagram product's own secret;
 * Unified Login webhooks are signed with the Facebook app secret
 * (same fallback pattern as WhatsApp), so fall back to it.
 */
export function instagramAppSecret(): string | undefined {
  return (
    process.env.INSTAGRAM_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || undefined
  );
}

/** Webhook verify token for the GET handshake, per provider. */
export function webhookVerifyToken(
  providerId: "facebook" | "instagram" | "whatsapp",
): string | undefined {
  if (providerId === "instagram") {
    return (
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() ||
      process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
      undefined
    );
  }
  if (providerId === "whatsapp") {
    return (
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ||
      process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
      undefined
    );
  }
  return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || undefined;
}

// ─── WhatsApp Business Platform (Cloud API) ──────────────────────────────────

export interface WhatsAppMetaConfig {
  /** Meta app id — required only to exchange Embedded Signup codes. */
  appId: string | undefined;
  /** Meta app secret — required only to exchange Embedded Signup codes. */
  appSecret: string | undefined;
  /** Secret used to verify X-Hub-Signature-256 on WhatsApp webhooks. */
  signatureSecret: string | undefined;
  webhookVerifyToken: string | undefined;
  /** Facebook Login for Business configuration id for Embedded Signup. */
  embeddedSignupConfigId: string | undefined;
  graphApiVersion: string;
  appsecretProof: boolean;
  embeddedSignupReady: boolean;
  manualConnectReady: boolean;
}

export interface WhatsAppEmbeddedConfig {
  appId: string;
  appSecret: string;
  embeddedSignupConfigId: string;
  graphApiVersion: string;
  appsecretProof: boolean;
}

function whatsappGraphApiVersion(): string {
  return process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || graphApiVersion();
}

/** Graph version for WhatsApp calls without requiring full app configuration. */
export function metaWhatsAppGraphApiVersion(): string {
  return whatsappGraphApiVersion();
}

export function getWhatsAppConfig(): WhatsAppMetaConfig {
  const appId = process.env.META_APP_ID?.trim() || undefined;
  const appSecret = process.env.META_APP_SECRET?.trim() || undefined;
  const signatureSecret =
    process.env.WHATSAPP_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || undefined;
  const embeddedSignupConfigId =
    process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || undefined;
  return {
    appId,
    appSecret,
    signatureSecret,
    webhookVerifyToken:
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ||
      process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
      undefined,
    embeddedSignupConfigId,
    graphApiVersion: whatsappGraphApiVersion(),
    appsecretProof: appsecretProofEnabled(),
    embeddedSignupReady: Boolean(appId && appSecret && embeddedSignupConfigId),
    manualConnectReady: Boolean(signatureSecret),
  };
}

/** True when the Meta app credentials needed for Embedded Signup code exchange exist. */
export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim());
}

export function requireWhatsAppEmbeddedConfig(): WhatsAppEmbeddedConfig {
  const config = getWhatsAppConfig();
  const missing: string[] = [];
  if (!config.appId) missing.push("META_APP_ID");
  if (!config.appSecret) missing.push("META_APP_SECRET");
  if (!config.embeddedSignupConfigId) missing.push("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID");
  if (missing.length > 0) throw missingConfigError("WhatsApp Embedded Signup", missing);
  return {
    appId: config.appId as string,
    appSecret: config.appSecret as string,
    embeddedSignupConfigId: config.embeddedSignupConfigId as string,
    graphApiVersion: config.graphApiVersion,
    appsecretProof: config.appsecretProof,
  };
}

/** App secret for WhatsApp webhook signature checks; undefined when unconfigured. */
export function whatsappAppSecret(): string | undefined {
  return getWhatsAppConfig().signatureSecret;
}
