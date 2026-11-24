/**
 * AI provider catalog — shared by the Settings UI and the server-side
 * AI config service. Every preset speaks the OpenAI-compatible chat
 * API, so a workspace's own key (Dograh-style BYOK) is just
 * { provider, model, baseUrl, encrypted key }.
 *
 * The model lists are conveniences, not cages: the UI always allows a
 * custom model name, and "custom" allows any OpenAI-compatible
 * endpoint (Ollama, vLLM, a router, …).
 */
export interface AiProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  keyPlaceholder: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "groq",
    label: "Groq — free tier available",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
    keyPlaceholder: "gsk_…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    keyPlaceholder: "AIza…",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5-mini", "gpt-4o-mini", "gpt-4o"],
    keyPlaceholder: "sk-…",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    keyPlaceholder: "sk-or-…",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    models: [],
    keyPlaceholder: "Your API key",
  },
];

export function aiProviderPreset(id: string): AiProviderPreset | null {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}
