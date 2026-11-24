"use client";

import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_PROVIDER_PRESETS, aiProviderPreset } from "@/lib/ai-providers";

export interface AiConfigView {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  updatedAt: string;
}

interface AiModelConfigProps {
  workspaceId: string;
  initialConfig: AiConfigView | null;
  envConfigured: boolean;
  envLabel: string | null;
  canManage: boolean;
}

type Notice = { kind: "ok" | "warn" | "error"; text: string } | null;

const CUSTOM_MODEL = "__custom__";
const selectClassName =
  "border-input bg-transparent h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AiModelConfig({
  workspaceId,
  initialConfig,
  envConfigured,
  envLabel,
  canManage,
}: AiModelConfigProps) {
  const [config, setConfig] = useState<AiConfigView | null>(initialConfig);
  const [provider, setProvider] = useState(initialConfig?.provider ?? "groq");
  const preset = aiProviderPreset(provider);
  const initialModelIsPreset = initialConfig
    ? (aiProviderPreset(initialConfig.provider)?.models.includes(initialConfig.model) ?? false)
    : false;
  const [modelChoice, setModelChoice] = useState(
    initialConfig ? (initialModelIsPreset ? initialConfig.model : CUSTOM_MODEL) : (preset?.models[0] ?? CUSTOM_MODEL),
  );
  const [customModel, setCustomModel] = useState(initialModelIsPreset ? "" : (initialConfig?.model ?? ""));
  const [baseUrl, setBaseUrl] = useState(
    initialConfig?.provider === "custom" ? initialConfig.baseUrl : "",
  );
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const effectiveModel = modelChoice === CUSTOM_MODEL ? customModel.trim() : modelChoice;

  function changeProvider(next: string) {
    setProvider(next);
    const nextPreset = aiProviderPreset(next);
    setModelChoice(nextPreset?.models[0] ?? CUSTOM_MODEL);
    if (next !== "custom") setBaseUrl("");
  }

  async function save() {
    setBusy("save");
    setNotice(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: effectiveModel,
          ...(provider === "custom" ? { baseUrl: baseUrl.trim() } : {}),
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        config?: AiConfigView;
        warning?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.config) {
        throw new Error(data?.error ?? "Something went wrong.");
      }
      setConfig(data.config);
      setApiKeyInput("");
      setNotice(
        data.warning
          ? { kind: "warn", text: data.warning }
          : {
              kind: "ok",
              text: "Saved — this workspace now runs on its own AI key.",
            },
      );
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setNotice(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai-config`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not remove the workspace key.");
      setConfig(null);
      setApiKeyInput("");
      setConfirmRemove(false);
      setNotice({
        kind: "ok",
        text: envConfigured
          ? "Workspace key removed — the platform default applies again."
          : "Workspace key removed — AI is now off for this workspace.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          AI model — this workspace&apos;s own key
          {config ? <Badge variant="secondary">Workspace key</Badge> : null}
          {!config && envConfigured ? <Badge variant="outline">Platform default</Badge> : null}
        </CardTitle>
        <CardDescription>
          Like other multi-tenant AI tools, each workspace brings its own provider key: pick a
          provider, pick a model, paste your key. Your key is stored encrypted, is never shown
          again, and is only ever sent to your provider. Usage is billed to your own provider
          account — not shared with other workspaces.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {config ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            Active: {aiProviderPreset(config.provider)?.label ?? config.provider} · {config.model}
            {" — "}running on this workspace&apos;s own key.
          </p>
        ) : envConfigured ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Currently using the platform default ({envLabel}) — a shared key provided by the
            platform operator. Add your own key below to make this workspace independent.
          </p>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            AI is off for this workspace. Add your own provider key below — Groq and Gemini both
            have free tiers.
          </p>
        )}

        {canManage ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-provider">Provider</Label>
                <select
                  id="ai-provider"
                  className={selectClassName}
                  value={provider}
                  onChange={(event) => changeProvider(event.target.value)}
                >
                  {AI_PROVIDER_PRESETS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-model">Model</Label>
                <select
                  id="ai-model"
                  className={selectClassName}
                  value={modelChoice}
                  onChange={(event) => setModelChoice(event.target.value)}
                >
                  {(preset?.models ?? []).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL}>Custom model name…</option>
                </select>
              </div>
            </div>

            {modelChoice === CUSTOM_MODEL ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-model-custom">Custom model name</Label>
                <Input
                  id="ai-model-custom"
                  value={customModel}
                  onChange={(event) => setCustomModel(event.target.value)}
                  placeholder="e.g. openai/gpt-oss-120b"
                />
              </div>
            ) : null}

            {provider === "custom" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-base-url">Base URL (OpenAI-compatible endpoint)</Label>
                <Input
                  id="ai-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://your-server.example.com/v1"
                  inputMode="url"
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-api-key">API key</Label>
              <Input
                id="ai-api-key"
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder={
                  config?.hasKey
                    ? "•••••••• saved — paste a new key only to replace it"
                    : (preset?.keyPlaceholder ?? "Your API key")
                }
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                New keys are checked with the provider before saving — a rejected key changes
                nothing. Leaving this empty keeps the saved key.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={busy !== null || effectiveModel === ""}>
                {busy === "save" ? "Saving…" : "Save AI settings"}
              </Button>
              {config ? (
                confirmRemove ? (
                  <>
                    <Button variant="destructive" onClick={remove} disabled={busy !== null}>
                      {busy === "remove" ? "Removing…" : "Confirm remove key"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmRemove(false)}
                      disabled={busy !== null}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setConfirmRemove(true)}
                    disabled={busy !== null}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Remove workspace key
                  </Button>
                )
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Only workspace owners and admins can change the AI model settings.
          </p>
        )}

        {notice ? (
          <p
            className={
              notice.kind === "ok"
                ? "text-sm text-emerald-600"
                : notice.kind === "warn"
                  ? "text-sm text-amber-600"
                  : "text-sm text-red-600"
            }
          >
            {notice.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
