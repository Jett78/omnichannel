/**
 * Phase 13G — AI provider client (OpenAI-compatible chat API).
 *
 * Configuration is env-only and read at CALL time:
 *   AI_API_KEY   — required; without it every AI feature reports
 *                  "not configured" (nothing is ever faked).
 *   AI_BASE_URL  — default https://api.groq.com/openai/v1 (Groq free
 *                  tier). Gemini's OpenAI-compatible endpoint works
 *                  too: https://generativelanguage.googleapis.com/v1beta/openai
 *   AI_MODEL     — default llama-3.3-70b-versatile (Groq). For Gemini
 *                  use e.g. gemini-2.0-flash.
 *
 * The key is a server secret: it is only ever sent as the Bearer token
 * to the configured provider, never logged and never sent to clients.
 */

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured for this deployment (AI_API_KEY is not set)");
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

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getAiConfig(): AiConfig | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.AI_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(
      /\/+$/,
      "",
    ),
    model: process.env.AI_MODEL?.trim() || "llama-3.3-70b-versatile",
  };
}

export function isAiConfigured(): boolean {
  return getAiConfig() !== null;
}

/** Human label for the configured backend, safe to show in the UI. */
export function aiProviderLabel(): string | null {
  const config = getAiConfig();
  if (!config) return null;
  return `${config.model} via ${new URL(config.baseUrl).hostname}`;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * One chat completion. Throws AiNotConfiguredError when unconfigured
 * and AiProviderError for any provider/network failure — callers must
 * surface those honestly, never substitute canned text.
 */
export async function aiChat(
  messages: AiChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const config = getAiConfig();
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
