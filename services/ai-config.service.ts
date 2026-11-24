import { isIP } from "node:net";

import { aiProviderPreset } from "@/lib/ai-providers";
import { encryptText } from "@/lib/encryption";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isLoopbackIp, isPublicIp } from "@/lib/webhook-url";
import { requireWorkspacePermission } from "@/lib/workspace-auth";

/**
 * Per-workspace AI provider configuration (Dograh-style BYOK).
 *
 * A workspace admin picks a provider + model and pastes their OWN API
 * key; the key is stored AES-256-GCM-encrypted and NEVER returned to
 * a browser (views expose only `hasKey`). Saving with a new key runs
 * the provider's credential check first (GET /models): a REJECTED key
 * (401/403) leaves the existing config untouched; an inconclusive
 * check (network/404) saves with a warning. Saving without a key
 * keeps the previously stored one (keep-or-replace, like Dograh).
 */

export interface AiConfigView {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  updatedAt: string;
}

function toView(row: {
  provider: string;
  model: string;
  baseUrl: string;
  encryptedApiKey: string;
  updatedAt: Date;
}): AiConfigView {
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    hasKey: row.encryptedApiKey.length > 0,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** String-level base-URL validation (same rules as the store URL). */
function validateAiBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw AppError.badRequest("That base URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw AppError.badRequest("The base URL must start with http:// or https://.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw AppError.badRequest("The base URL must use https in production.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw AppError.badRequest("The base URL must be a public address.");
  }
  if (isIP(host) !== 0) {
    const loopbackAllowed = isLoopbackIp(host) && process.env.NODE_ENV !== "production";
    if (!loopbackAllowed && !isPublicIp(host)) {
      throw AppError.badRequest("The base URL must point at a public address.");
    }
  }
  return url.toString().replace(/\/+$/, "");
}

type KeyCheck =
  | { ok: true }
  | { ok: false; rejected: boolean; message: string };

async function checkApiKey(baseUrl: string, apiKey: string): Promise<KeyCheck> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false,
      rejected: false,
      message: error instanceof Error ? `provider unreachable (${error.message})` : "provider unreachable",
    };
  }
  if (response.ok) return { ok: true };
  if (response.status === 401 || response.status === 403) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      rejected: true,
      message: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`,
    };
  }
  return { ok: false, rejected: false, message: `key check returned HTTP ${response.status}` };
}

export const aiConfigService = {
  async get(actorUserId: string, workspaceId: string): Promise<AiConfigView | null> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const row = await prisma.aiConfig.findUnique({ where: { workspaceId } });
    return row ? toView(row) : null;
  },

  async upsert(
    actorUserId: string,
    workspaceId: string,
    input: { provider: string; model: string; baseUrl?: string; apiKey?: string },
  ): Promise<{ config: AiConfigView; warning?: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const preset = aiProviderPreset(input.provider);
    if (!preset) throw AppError.badRequest("Unknown AI provider.");
    const baseUrl =
      input.provider === "custom"
        ? validateAiBaseUrl(input.baseUrl ?? "")
        : preset.baseUrl.replace(/\/+$/, "");

    const existing = await prisma.aiConfig.findUnique({ where: { workspaceId } });
    let encryptedApiKey = existing?.encryptedApiKey;
    let warning: string | undefined;
    const newKey = input.apiKey?.trim();
    if (newKey) {
      const check = await checkApiKey(baseUrl, newKey);
      if (!check.ok && check.rejected) {
        throw AppError.badRequest(
          `The provider rejected that API key, so nothing was saved. (${check.message})`,
        );
      }
      if (!check.ok) warning = `Saved, but the key check could not be completed: ${check.message}.`;
      encryptedApiKey = encryptText(newKey);
    }
    if (!encryptedApiKey) {
      throw AppError.badRequest("An API key is required — paste your provider key.");
    }

    const row = await prisma.aiConfig.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        provider: input.provider,
        model: input.model.trim(),
        baseUrl,
        encryptedApiKey,
        createdById: actorUserId,
      },
      update: {
        provider: input.provider,
        model: input.model.trim(),
        baseUrl,
        encryptedApiKey,
      },
    });
    return { config: toView(row), ...(warning ? { warning } : {}) };
  },

  async remove(actorUserId: string, workspaceId: string): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    await prisma.aiConfig.deleteMany({ where: { workspaceId } });
  },
};
