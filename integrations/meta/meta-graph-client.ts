import { createHmac } from "node:crypto";

/**
 * Typed client for the Meta Graph API (Phase 5).
 *
 * All Facebook/Instagram provider HTTP goes through this wrapper:
 *  - hosts: graph.facebook.com, graph.instagram.com, api.instagram.com
 *  - access tokens travel ONLY in the `Authorization: Bearer` header —
 *    never in URLs, never in logs, never in error messages.
 *  - Meta error bodies are parsed into MetaGraphError carrying
 *    code / subcode / type / fbtrace_id for support correlation.
 *  - 15s default timeout via AbortSignal.
 *  - optional appsecret_proof (HMAC-SHA256 of the token, keyed by the
 *    app secret) when the deployment enables it.
 *
 * The fetch implementation is injectable so unit/integration tests can
 * substitute a labelled test double; production always uses real fetch
 * against the real Meta endpoints.
 */

export type MetaGraphHost = "graph.facebook.com" | "graph.instagram.com" | "api.instagram.com";

/** Minimal fetch surface the client needs (real `fetch` satisfies it). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class MetaGraphError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly type: string | undefined;
  readonly fbtraceId: string | undefined;

  constructor(
    message: string,
    options: {
      status: number;
      code?: number;
      subcode?: number;
      type?: string;
      fbtraceId?: string;
    },
  ) {
    super(message);
    this.name = "MetaGraphError";
    this.status = options.status;
    this.code = options.code;
    this.subcode = options.subcode;
    this.type = options.type;
    this.fbtraceId = options.fbtraceId;
  }
}

export interface GraphRequestOptions {
  accessToken?: string;
  /** When set together with `appsecretProof`, the proof is computed from this secret. */
  appSecret?: string;
  appsecretProof?: boolean;
  params?: Record<string, string | number | boolean | undefined>;
  /** JSON request body (POST). */
  body?: unknown;
  /** application/x-www-form-urlencoded body (POST) — used by api.instagram.com token exchange. */
  form?: Record<string, string>;
  timeoutMs?: number;
}

interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class MetaGraphClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async get<T>(host: MetaGraphHost, path: string, options: GraphRequestOptions = {}): Promise<T> {
    return this.request<T>("GET", host, path, options);
  }

  async post<T>(host: MetaGraphHost, path: string, options: GraphRequestOptions = {}): Promise<T> {
    return this.request<T>("POST", host, path, options);
  }

  async del<T>(host: MetaGraphHost, path: string, options: GraphRequestOptions = {}): Promise<T> {
    return this.request<T>("DELETE", host, path, options);
  }

  /** Multipart POST (media uploads) — fetch sets the multipart boundary. */
  async postMultipart<T>(
    host: MetaGraphHost,
    path: string,
    options: GraphRequestOptions & { formData: FormData },
  ): Promise<T> {
    return this.request<T>("POST", host, path, options, options.formData);
  }

  /** Raw download (media) — returns the bytes, still Bearer-authenticated. */
  async getBuffer(
    url: string,
    accessToken: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Buffer> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new MetaGraphError(`Media download failed with HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    host: MetaGraphHost,
    path: string,
    options: GraphRequestOptions,
    formData?: FormData,
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    if (options.appsecretProof && options.accessToken && options.appSecret) {
      params.set(
        "appsecret_proof",
        createHmac("sha256", options.appSecret).update(options.accessToken).digest("hex"),
      );
    }
    const query = params.toString();
    const url = `https://${host}${path}${query ? `?${query}` : ""}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

    let body: string | FormData | undefined;
    if (formData) {
      body = formData;
    } else if (options.form) {
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
      // Network/timeout failure — no response body to parse. The message
      // deliberately excludes the URL (query strings may carry cursors).
      throw new MetaGraphError(
        `Meta Graph API request failed: ${error instanceof Error ? error.message : "network error"}`,
        { status: 0 },
      );
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }

    const errorBody = (parsed as MetaErrorBody | null)?.error;
    if (!response.ok || errorBody) {
      throw new MetaGraphError(errorBody?.message ?? `Meta Graph API HTTP ${response.status}`, {
        status: response.status,
        ...(errorBody?.code !== undefined ? { code: errorBody.code } : {}),
        ...(errorBody?.error_subcode !== undefined ? { subcode: errorBody.error_subcode } : {}),
        ...(errorBody?.type !== undefined ? { type: errorBody.type } : {}),
        ...(errorBody?.fbtrace_id !== undefined ? { fbtraceId: errorBody.fbtrace_id } : {}),
      });
    }
    return parsed as T;
  }
}
