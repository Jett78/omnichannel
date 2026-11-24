import { decryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";

/**
 * AI provider client (OpenAI-compatible chat API) — multi-tenant.
 *
 * Configuration resolves PER WORKSPACE (Dograh-style bring-your-own-key):
 *   1. The workspace's own AiConfig row (Settings → AI model): the
 *      workspace admin picks a provider + model and pastes their own
 *      API key. The key is stored AES-256-GCM-encrypted and is never
 *      returned to a browser.
 *   2. Fallback: the platform default from server env — AI_API_KEY,
 *      AI_BASE_URL (default https://api.groq.com/openai/v1), AI_MODEL
 *      (default openai/gpt-oss-120b) — the operator's key, for
 *      workspaces that have not added their own.
 * With neither, every AI feature reports "not configured"; nothing is
 * ever faked.
 *
 * Do NOT use llama-3.3-70b-versatile or llama-3.1-8b-instant on Groq:
 * Groq retired both from its free/developer tiers on 2026-08-16 (calls
 * return 404 model_not_found).
 *
 * Keys are server secrets: sent only as the Bearer token to the
 * configured provider, never logged, never sent to clients.
 */

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured for this workspace (no workspace key and no platform default)");
    this.name = "AiNotConfiguredError";
  }
}

export class AiProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
  }
}

export interface EnvAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** The platform-default config from server env, or null. */
export function getEnvAiConfig(): EnvAiConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.AI_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(
      /\/+$/,
      "",
    ),
    model: process.env.AI_MODEL?.trim() || "openai/gpt-oss-120b",
  };
}

export interface ResolvedAiConfig extends EnvAiConfig {
  source: "workspace" | "env";
  provider: string | null;
}

/** The effective AI config for one workspace: its own key first. */
export async function resolveAiConfig(
  workspaceId: string,
): Promise<ResolvedAiConfig | null> {
  const row = await prisma.aiConfig.findUnique({ where: { workspaceId } }).catch(() => null);
  if (row) {
    try {
      return {
        apiKey: decryptText(row.encryptedApiKey),
        baseUrl: row.baseUrl,
        model: row.model,
        source: "workspace",
        provider: row.provider,
      };
    } catch {
      // An undecryptable key (e.g. ENCRYPTION_KEY was rotated) must not
      // crash the AI features — fall through to the platform default.
    }
  }
  const env = getEnvAiConfig();
  return env ? { ...env, source: "env", provider: null } : null;
}

export interface AiStatus {
  configured: boolean;
  /** Human label for the effective backend, safe to show in the UI. */
  label: string | null;
  source: "workspace" | "env" | null;
}

export async function getAiStatus(workspaceId: string): Promise<AiStatus> {
  const config = await resolveAiConfig(workspaceId);
  if (!config) return { configured: false, label: null, source: null };
  let host = config.baseUrl;
  try {
    host = new URL(config.baseUrl).hostname;
  } catch {
    // Keep the raw base URL in the label.
  }
  return { configured: true, label: `${config.model} via ${host}`, source: config.source };
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * One chat completion for a workspace. Throws AiNotConfiguredError
 * when the workspace has no key and no platform default exists, and
 * AiProviderError for any provider/network failure — callers must
 * surface those honestly, never substitute canned text.
 */
export async function aiChat(
  messages: AiChatMessage[],
  workspaceId: string,
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const config = await resolveAiConfig(workspaceId);
  if (!config) throw new AiNotConfiguredError();

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 700,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new AiProviderError(
      error instanceof Error ? `AI provider unreachable: ${error.message}` : "AI provider unreachable",
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AiProviderError(
      `AI provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      response.status,
    );
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new AiProviderError("AI provider returned an empty response");
  return content;
}
