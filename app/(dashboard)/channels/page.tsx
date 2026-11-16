import { redirect } from "next/navigation";

import { ChannelsCatalog } from "@/features/channels/channels-catalog";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ChannelsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const channels = await prisma.channel.findMany({
    where: { workspaceId: active.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true, displayName: true, status: true },
  });

  return <ChannelsCatalog realChannels={channels} />;
}
