import { AppError } from "@/lib/errors";
import type { ProviderId } from "@/types/messaging";

import { mockProvider } from "@/integrations/mock/mock.provider";
import type { IMessagingProvider } from "@/integrations/types";

/**
 * Provider registry.
 *
 * Real adapters register here as they are built (Telegram first, then
 * Meta/Instagram, WhatsApp, X/TikTok spikes). The MOCK provider is
 * registered ONLY outside production, or when ENABLE_MOCK_PROVIDER=true
 * — it is a dev/test fake, never a real platform integration.
 */
const registry = new Map<ProviderId, IMessagingProvider>();

export function isMockProviderEnabled(): boolean {
  return process.env.ENABLE_MOCK_PROVIDER === "true" || process.env.NODE_ENV !== "production";
}

export function registerProvider(provider: IMessagingProvider): void {
  registry.set(provider.id, provider);
}

if (isMockProviderEnabled()) {
  registerProvider(mockProvider);
}

export function getProvider(id: ProviderId): IMessagingProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw AppError.notImplemented(`Provider "${id}"`);
  }
  return provider;
}

export function listRegisteredProviders(): ProviderId[] {
  return [...registry.keys()];
}
