import { AppError } from "@/lib/errors";
import type { ProviderId } from "@/types/messaging";

import { mockProvider } from "@/integrations/mock/mock.provider";
import { facebookProvider } from "@/integrations/meta/facebook-provider";
import { instagramProvider } from "@/integrations/meta/instagram-provider";
import { whatsappProvider } from "@/integrations/whatsapp/whatsapp-provider";
import type { IMessagingProvider } from "@/integrations/types";

/**
 * Provider registry.
 *
 * Real adapters register here as they are built. Facebook Messenger
 * and Instagram (Phase 5) are real adapters against the official Meta
 * Graph API — they register unconditionally, but every operation
 * fails with a clear configuration error until the deployment sets
 * the Meta env vars (see integrations/meta/meta-config.ts). The MOCK
 * provider is registered ONLY outside production, or when
 * ENABLE_MOCK_PROVIDER=true — it is a dev/test fake, never a real
 * platform integration.
 */
const registry = new Map<ProviderId, IMessagingProvider>();

export function isMockProviderEnabled(): boolean {
  return process.env.ENABLE_MOCK_PROVIDER === "true" || process.env.NODE_ENV !== "production";
}

export function registerProvider(provider: IMessagingProvider): void {
  registry.set(provider.id, provider);
}

registerProvider(facebookProvider);
registerProvider(instagramProvider);
registerProvider(whatsappProvider);

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
