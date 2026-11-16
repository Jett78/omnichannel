import { AppError } from "@/lib/errors";

/**
 * X (Twitter) configuration (Phase 8) — SERVER ONLY.
 *
 * Values come exclusively from environment variables, read lazily on
 * every call (no import-time parsing, no caching), mirroring
 * integrations/meta/meta-config.ts. Nothing here ever returns a secret
 * to the browser.
 *
 * ACCESS MODEL (docs/X-RESEARCH.md, verdict A): X API v2 Direct
 * Messages are SELF-SERVE on X's pay-per-use pricing — any approved
 * developer account with credits in the Developer Console can call
 * them; there is no manual product approval. What a deployment needs:
 *
 *  - X_CLIENT_ID / X_CLIENT_SECRET — the app's OAuth 2.0 credentials
 *    (confidential client: app type "Web App" or "Automated App or
 *    bot" in the Developer Console, OAuth 2.0 enabled). Used for the
 *    user connect flow (Authorization Code + PKCE) and token refresh.
 *  - X_CONSUMER_KEY / X_CONSUMER_SECRET — the app's OAuth 1.0a keys.
 *    Optional: only needed as the fallback webhook CRC/signature key
 *    (X's classic webhook docs key HMAC with the consumer secret;
 *    X's updated docs recommend the OAuth 2.0 client secret — see
 *    x-webhook.ts) and for any future OAuth 1.0a user-context calls.
 *  - X_BEARER_TOKEN — the app's Bearer <redacted> Optional: only used
 *    by the operator when registering the webhook (POST /2/webhooks)
 *    during setup (docs/X-ACCESS.md); the runtime never needs it.
 *  - X_WEBHOOK_ID — the id returned when the webhook was registered.
 *    Optional: when set, connecting an account also creates its
 *    X Activity API subscriptions (dm.received / dm.sent) against
 *    that webhook; when unset, subscription creation is skipped and
 *    the channel config records why.
 */

export interface XConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  consumerKey: string | undefined;
  consumerSecret: string | undefined;
  bearerToken: string | undefined;
  webhookId: string | undefined;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function missingConfigError(missing: string[]): AppError {
  return new AppError(
    `X integration is not configured on this deployment. Missing environment variables: ${missing.join(", ")}. Set them (see docs/X-ACCESS.md) and restart the app.`,
    "X_NOT_CONFIGURED",
    503,
  );
}

function missingEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.X_CLIENT_ID?.trim()) missing.push("X_CLIENT_ID");
  if (!process.env.X_CLIENT_SECRET?.trim()) missing.push("X_CLIENT_SECRET");
  return missing;
}

export function getXConfig(): XConfig {
  const missing = missingEnvVars();
  if (missing.length > 0) throw missingConfigError(missing);
  return {
    clientId: process.env.X_CLIENT_ID?.trim() as string,
    clientSecret: process.env.X_CLIENT_SECRET?.trim() as string,
    redirectUri: xRedirectUri(),
    consumerKey: process.env.X_CONSUMER_KEY?.trim() || undefined,
    consumerSecret: process.env.X_CONSUMER_SECRET?.trim() || undefined,
    bearerToken: process.env.X_BEARER_TOKEN?.trim() || undefined,
    webhookId: process.env.X_WEBHOOK_ID?.trim() || undefined,
  };
}

/** True when the OAuth 2.0 app credentials needed to connect accounts exist. */
export function isXConfigured(): boolean {
  return missingEnvVars().length === 0;
}

/** OAuth redirect URI to register in the X app — safe to display (no secrets). */
export function xRedirectUri(): string {
  return process.env.X_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/x/callback`;
}

/** Webhook callback URL to register with X — safe to display (no secrets). */
export function xWebhookUrl(): string {
  return `${appUrl()}/api/webhooks/x`;
}

/**
 * Secrets accepted for webhook POST signature verification, in
 * preference order: the OAuth 2.0 client secret (X's updated webhook
 * docs recommend it) then the OAuth 1.0a consumer secret (the classic
 * Account Activity API docs key HMAC with it). Either may be the one
 * X signs with depending on the app's setup, so verification accepts
 * a match against any configured secret — and fails closed when none
 * is configured. Secrets are never returned to the browser.
 */
export function xWebhookSigningSecrets(): string[] {
  const secrets: string[] = [];
  const clientSecret = process.env.X_CLIENT_SECRET?.trim();
  const consumerSecret = process.env.X_CONSUMER_SECRET?.trim();
  if (clientSecret) secrets.push(clientSecret);
  if (consumerSecret && consumerSecret !== clientSecret) secrets.push(consumerSecret);
  return secrets;
}

/**
 * The secret used to ANSWER CRC challenges. A CRC response can only
 * carry one signature, so we must pick: the OAuth 2.0 client secret
 * first (current docs), falling back to the consumer secret for
 * OAuth 1.0a-only apps. Undefined when neither is configured.
 */
export function xCrcSecret(): string | undefined {
  return xWebhookSigningSecrets()[0];
}

export interface XAccessState {
  /** OAuth 2.0 app credentials present — the connect flow can run. */
  configured: boolean;
  /** Env vars still missing, by name only. */
  missingEnv: string[];
  /** Whether an XAA webhook id is set (subscriptions possible at connect). */
  webhookIdSet: boolean;
  redirectUri: string;
  webhookUrl: string;
}

/** Dashboard/test view of the X integration state (no secrets). */
export function getXAccessState(): XAccessState {
  const missingEnv = missingEnvVars();
  return {
    configured: missingEnv.length === 0,
    missingEnv,
    webhookIdSet: Boolean(process.env.X_WEBHOOK_ID?.trim()),
    redirectUri: xRedirectUri(),
    webhookUrl: xWebhookUrl(),
  };
}
