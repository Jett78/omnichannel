import { AppError } from "@/lib/errors";

/**
 * Gmail configuration (Phase 9) — SERVER ONLY.
 *
 * Values come exclusively from environment variables, read lazily on
 * every call. Nothing here ever returns a secret to the browser.
 *
 * ACCESS MODEL: Gmail API access is self-serve — the operator creates
 * a Google Cloud project, enables the Gmail API, configures an OAuth
 * consent screen and a Web application OAuth client (docs/GMAIL-SETUP.md).
 * While the consent screen is in "Testing" publishing status, only
 * listed test users can connect (up to 100) and refresh tokens expire
 * after 7 days; publishing the app removes that limit, and Google
 * requires OAuth verification (plus a security assessment for
 * restricted Gmail scopes) before the app serves the general public.
 *
 *  - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — the OAuth 2.0 web
 *    client credentials. Used by the connect flow and token refresh
 *    (web app AND worker — the worker polls Gmail and sends replies).
 *  - GOOGLE_REDIRECT_URI — optional override; defaults to
 *    {APP_URL}/api/oauth/gmail/callback. The value must EXACTLY match
 *    an Authorized redirect URI on the Google OAuth client.
 */

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function missingEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET?.trim()) missing.push("GOOGLE_CLIENT_SECRET");
  return missing;
}

export function getGmailConfig(): GmailConfig {
  const missing = missingEnvVars();
  if (missing.length > 0) {
    throw new AppError(
      `Gmail integration is not configured on this deployment. Missing environment variables: ${missing.join(", ")}. Set them (see docs/GMAIL-SETUP.md) and restart the app.`,
      "GMAIL_NOT_CONFIGURED",
      503,
    );
  }
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() as string,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() as string,
    redirectUri: gmailRedirectUri(),
  };
}

/** True when the Google OAuth credentials needed to connect mailboxes exist. */
export function isGmailConfigured(): boolean {
  return missingEnvVars().length === 0;
}

/** OAuth redirect URI to register in Google Cloud — safe to display (no secrets). */
export function gmailRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || `${appUrl()}/api/oauth/gmail/callback`;
}

export interface GmailAccessState {
  configured: boolean;
  missingEnv: string[];
  redirectUri: string;
}

/** Dashboard/test view of the Gmail integration state (no secrets). */
export function getGmailAccessState(): GmailAccessState {
  const missingEnv = missingEnvVars();
  return { configured: missingEnv.length === 0, missingEnv, redirectUri: gmailRedirectUri() };
}
