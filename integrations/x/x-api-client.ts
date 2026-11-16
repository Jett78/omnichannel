/**
 * Typed client for the X API v2 (Phase 8).
 *
 * All X provider HTTP goes through this wrapper:
 *  - host: api.x.com, paths under /2.
 *  - user access tokens travel ONLY in the `Authorization: Bearer`
 *    header — never in URLs, never in logs, never in error messages.
 *  - OAuth 2.0 token endpoints use form-encoded bodies; confidential
 *    clients authenticate with HTTP Basic (client_id:client_secret),
 *    per X's OAuth 2.0 documentation.
 *  - X error bodies are parsed into XApiError carrying the v2 problem
 *    fields (title / detail / type) plus the rate-limit headers
 *    (x-rate-limit-limit / -remaining / -reset) so callers can see
 *    exactly why a call failed and when the window resets.
 *  - 429 responses and 5xx/network failures are classified
 *    `retryable` — the same classification the outbound worker's
 *    retry policy acts on for other providers.
 *  - 15s default timeout via AbortSignal.
 *
 * The fetch implementation is injectable so tests can substitute a
 * labelled test double; production always uses real fetch against
 * api.x.com.
 */

/** Minimal fetch surface the client needs (real `fetch` satisfies it). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface XRateLimitInfo {
  limit: number;
  remaining: number;
  /** Epoch seconds when the current window resets. */
  reset: number;
}

export class XApiError extends Error {
  readonly status: number;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  readonly type: string | undefined;
  readonly rateLimit: XRateLimitInfo | undefined;
  /** True when retrying later can succeed (429, 5xx, network/timeout). */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      title?: string;
      detail?: string;
      type?: string;
      rateLimit?: XRateLimitInfo;
    },
  ) {
    super(message);
    this.name = "XApiError";
    this.status = options.status;
    this.title = options.title;
    this.detail = options.detail;
    this.type = options.type;
    this.rateLimit = options.rateLimit;
    this.retryable =
      options.status === 429 || options.status >= 500 || options.status === 0;
  }
}

export interface XRequestOptions {
  /** OAuth 2.0 user access token (Bearer). Omit for token-endpoint calls. */
  accessToken?: string;
  params?: Record<string, string | number | boolean | undefined>;
  /** JSON request body (POST). */
  body?: unknown;
  /** application/x-www-form-urlencoded body (OAuth 2.0 token endpoints). */
  form?: Record<string, string>;
  /** HTTP Basic credentials (confidential-client token requests). */
  basicAuth?: { username: string; password: string };
  timeoutMs?: number;
}

interface XProblemBody {
  title?: string;
  detail?: string;
  type?: string;
  status?: number;
  errors?: Array<{ message?: string; parameters?: Record<string, string[]> }>;
}

const API_HOST = "api.x.com";
const DEFAULT_TIMEOUT_MS = 15_000;

function parseRateLimit(headers: Headers): XRateLimitInfo | undefined {
  const limit = headers.get("x-rate-limit-limit");
  const remaining = headers.get("x-rate-limit-remaining");
  const reset = headers.get("x-rate-limit-reset");
  if (limit === null || remaining === null || reset === null) return undefined;
  const parsed: XRateLimitInfo = {
    limit: Number(limit),
    remaining: Number(remaining),
    reset: Number(reset),
  };
  return Number.isFinite(parsed.limit) &&
    Number.isFinite(parsed.remaining) &&
    Number.isFinite(parsed.reset)
    ? parsed
    : undefined;
}

export class XApiClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async get<T>(path: string, options: XRequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T>(path: string, options: XRequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  async del<T>(path: string, options: XRequestOptions = {}): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: XRequestOptions,
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const query = params.toString();
    const url = `https://${API_HOST}${path}${query ? `?${query}` : ""}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.basicAuth) {
      const raw = `${options.basicAuth.username}:${options.basicAuth.password}`;
      headers.Authorization = `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
    }

    let body: string | undefined;
    if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(options.form).toString();
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      // Network/timeout failure — no response body to parse. The
      // message deliberately excludes the URL and any credential.
      throw new XApiError(
        `X API request failed: ${error instanceof Error ? error.message : "network error"}`,
        { status: 0 },
      );
    }

    const rateLimit = parseRateLimit(response.headers);
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const problem = (parsed ?? {}) as XProblemBody;
      const legacyMessage = problem.errors?.find((e) => e.message)?.message;
      const title = problem.title ?? legacyMessage;
      const message =
        problem.detail ??
        title ??
        (response.status === 429
          ? `X API rate limit exceeded (HTTP 429)${rateLimit ? ` — window resets at ${new Date(rateLimit.reset * 1000).toISOString()}` : ""}`
          : `X API HTTP ${response.status}`);
      throw new XApiError(message, {
        status: response.status,
        ...(title ? { title } : {}),
        ...(problem.detail ? { detail: problem.detail } : {}),
        ...(problem.type ? { type: problem.type } : {}),
        ...(rateLimit ? { rateLimit } : {}),
      });
    }
    return parsed as T;
  }
}
