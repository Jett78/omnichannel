import { AppError } from "@/lib/errors";
import type { ProviderId } from "@/types/messaging";

import { gmailProvider } from "@/integrations/gmail/gmail-provider";
import { mockProvider } from "@/integrations/mock/mock.provider";
import { telegramProvider } from "@/integrations/telegram/telegram-provider";
import { websiteProvider } from "@/integrations/website/website-provider";
import { facebookProvider } from "@/integrations/meta/facebook-provider";
import { instagramProvider } from "@/integrations/meta/instagram-provider";
import { tiktokProvider } from "@/integrations/tiktok/tiktok-provider";
import { whatsappProvider } from "@/integrations/whatsapp/whatsapp-provider";
import type { IMessagingProvider } from "@/integrations/types";

/**
 * Provider registry.
 *
 * Real adapters register here as they are built. Facebook Messenger
 * and Instagram (Phase 5) are real adapters against the official Meta
 * Graph API — they register unconditionally, but every operation
 * fails with a clear configuration error until the deployment sets
 * the Meta env vars (see integrations/meta/meta-config.ts). TikTok
 * (Phase 7) registers unconditionally too, but it is an ACCESS-GATED
 * scaffold: TikTok's Business Messaging API requires TikTok's Data
 * Security & Privacy Review approval, which this deployment does not
 * have, so every TikTok operation throws TikTokAccessError (see
 * integrations/tiktok/tiktok-config.ts and docs/TIKTOK-RESEARCH.md).
 * The MOCK provider is registered ONLY outside production, or when
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
registerProvider(tiktokProvider);
registerProvider(gmailProvider);
registerProvider(telegramProvider);
registerProvider(websiteProvider);

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
