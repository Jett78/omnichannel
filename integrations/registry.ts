import { AppError } from "@/lib/errors";
import type { ProviderId } from "@/types/messaging";

import type { IMessagingProvider } from "@/integrations/types";

/**
 * Provider registry — intentionally EMPTY in Phase 1.
 * Adapters are registered here as they are built:
 * Telegram (Phase 2), Facebook (Phase 4), Instagram (Phase 5),
 * WhatsApp (Phase 6), X / TikTok (Phase 7 spikes).
 */
const registry = new Map<ProviderId, IMessagingProvider>();

export function registerProvider(provider: IMessagingProvider): void {
  registry.set(provider.id, provider);
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
