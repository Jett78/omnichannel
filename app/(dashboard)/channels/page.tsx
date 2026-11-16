import { redirect } from "next/navigation";

import { ChannelsCatalog } from "@/features/channels/channels-catalog";
import { isMockProviderEnabled } from "@/integrations/registry";
import {
  facebookRedirectUri,
  instagramRedirectUri,
  isFacebookConfigured,
  isInstagramConfigured,
} from "@/integrations/meta/meta-config";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

interface ChannelsPageProps {
  searchParams: Promise<{
    meta_session?: string;
    meta_provider?: string;
    meta_error?: string;
  }>;
}

export default async function ChannelsPage({ searchParams }: ChannelsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const channels = await prisma.channel.findMany({
    where: { workspaceId: active.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true, displayName: true, status: true },
  });

  const params = await searchParams;
  const appUrl = getEnv().APP_URL.replace(/\/+$/, "");
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
    />
  );
}
