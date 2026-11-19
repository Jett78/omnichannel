/**
 * Minimal Gmail API + Google OAuth HTTP client (Phase 9).
 *
 * Plain fetch against googleapis.com endpoints with an injectable
 * FetchLike so tests can substitute a labelled test double — the same
 * approach as the Meta and X clients. Errors surface as GmailApiError
 * carrying the HTTP status (the token-refresh chain treats 400/401 as
 * "refresh token dead → channel EXPIRED", mirroring X).
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GmailApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, options: { status: number; body?: unknown }) {
    super(message);
    this.name = "GmailApiError";
    this.status = options.status;
    this.body = options.body;
  }
}

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

interface GoogleErrorBody {
  error?: { message?: string; status?: string } | string;
  error_description?: string;
}

function errorMessage(body: unknown, fallback: string): string {
  const parsed = (body ?? {}) as GoogleErrorBody;
  if (typeof parsed.error === "object" && parsed.error?.message) return parsed.error.message;
  if (typeof parsed.error === "string") {
    return parsed.error_description ? `${parsed.error}: ${parsed.error_description}` : parsed.error;
  }
  return fallback;
}

export class GmailClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  /** Authenticated Gmail API call against users/me. Returns parsed JSON (or undefined for 204). */
  async api<T>(
    accessToken: string,
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${GMAIL_API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    const parsed: unknown = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) {
      throw new GmailApiError(errorMessage(parsed, `Gmail API error (HTTP ${response.status})`), {
        status: response.status,
        body: parsed,
      });
    }
    return parsed as T;
  }

  /** POST to Google's OAuth token endpoint (form-encoded). */
  async tokenRequest<T>(form: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const text = await response.text();
    const parsed: unknown = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) {
      throw new GmailApiError(errorMessage(parsed, `Google token error (HTTP ${response.status})`), {
        status: response.status,
        body: parsed,
      });
    }
    return parsed as T;
  }

  /** Best-effort token revocation on disconnect — failures are swallowed by the caller. */
  async revoke(token: string): Promise<void> {
    await this.fetchImpl(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  }
}
