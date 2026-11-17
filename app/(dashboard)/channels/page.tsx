import { redirect } from "next/navigation";

import { ChannelsCatalog } from "@/features/channels/channels-catalog";
import { isMockProviderEnabled } from "@/integrations/registry";
import {
  facebookRedirectUri,
  getWhatsAppConfig,
  instagramRedirectUri,
  isFacebookConfigured,
  isInstagramConfigured,
} from "@/integrations/meta/meta-config";
import { isTikTokConfigured, tiktokRedirectUri } from "@/integrations/tiktok/tiktok-config";
import { getXAccessState } from "@/integrations/x/x-config";
import type { RealChannelConfig } from "@/features/channels/channels-catalog";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

interface ChannelsPageProps {
  searchParams: Promise<{
    meta_session?: string;
    meta_provider?: string;
    meta_error?: string;
    x_connected?: string;
    x_warning?: string;
    x_error?: string;
  }>;
}

export default async function ChannelsPage({ searchParams }: ChannelsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const channelRows = await prisma.channel.findMany({
    where: { workspaceId: active.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      displayName: true,
      status: true,
      config: true,
      externalAccountId: true,
    },
  });
  const channels = channelRows.map((channel) => ({
    id: channel.id,
    provider: channel.provider,
    displayName: channel.displayName,
    status: channel.status,
    config: toRealChannelConfig(channel.config),
    externalAccountId: channel.externalAccountId,
  }));
  const whatsapp = getWhatsAppConfig();

  const params = await searchParams;
  const appUrl = getEnv().APP_URL.replace(/\/+$/, "");
  const xState = getXAccessState();
  const metaSession: { id: string; provider: "facebook" | "instagram" } | null =
    params.meta_session &&
    (params.meta_provider === "facebook" || params.meta_provider === "instagram")
      ? { id: params.meta_session, provider: params.meta_provider }
      : null;

  return (
    <ChannelsCatalog
      realChannels={channels}
      workspaceId={active.id}
      mockEnabled={isMockProviderEnabled()}
      metaConfig={{
        facebookConfigured: isFacebookConfigured(),
        instagramConfigured: isInstagramConfigured(),
        facebookRedirectUri: facebookRedirectUri(),
        instagramRedirectUri: instagramRedirectUri(),
        facebookWebhookUrl: `${appUrl}/api/webhooks/facebook`,
        instagramWebhookUrl: `${appUrl}/api/webhooks/instagram`,
      }}
      metaSession={metaSession}
      metaError={params.meta_error ?? null}
      whatsappConfig={{
        embeddedSignupReady: whatsapp.embeddedSignupReady,
        manualReady: whatsapp.manualConnectReady,
      }}
      tiktokConfig={{
        configured: isTikTokConfigured(),
        redirectUri: tiktokRedirectUri(),
        webhookUrl: `${appUrl}/api/webhooks/tiktok`,
      }}
      xConfig={{
        configured: xState.configured,
        redirectUri: xState.redirectUri,
        webhookUrl: xState.webhookUrl,
        webhookIdSet: xState.webhookIdSet,
      }}
      xConnected={params.x_connected ?? null}
      xWarning={params.x_warning ?? null}
      xError={params.x_error ?? null}
    />
  );
}

/** Picks the client-safe subset out of a channel's JSON config. */
function toRealChannelConfig(config: unknown): RealChannelConfig | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const record = config as Record<string, unknown>;
  const pick = (key: string): string | undefined =>
    typeof record[key] === "string" ? (record[key] as string) : undefined;
  const subscription =
    record.webhookSubscription && typeof record.webhookSubscription === "object"
      ? (record.webhookSubscription as Record<string, unknown>)
      : null;
  return {
    ...(pick("lastError") ? { lastError: pick("lastError") } : {}),
    ...(pick("lastErrorAt") ? { lastErrorAt: pick("lastErrorAt") } : {}),
    ...(pick("username") ? { username: pick("username") } : {}),
    ...(pick("displayPhoneNumber") ? { displayPhoneNumber: pick("displayPhoneNumber") } : {}),
    ...(pick("verifiedName") ? { verifiedName: pick("verifiedName") } : {}),
    ...(pick("connectionMethod") ? { connectionMethod: pick("connectionMethod") } : {}),
    ...(pick("wabaId") ? { wabaId: pick("wabaId") } : {}),
    ...(pick("qualityRating") ? { qualityRating: pick("qualityRating") } : {}),
    ...(subscription
      ? {
          webhookSubscription: {
            ...(typeof subscription.status === "string" ? { status: subscription.status } : {}),
            ...(typeof subscription.error === "string" ? { error: subscription.error } : {}),
          },
        }
      : {}),
  };
}
