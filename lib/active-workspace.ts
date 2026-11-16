import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import type { Workspace } from "@/generated/prisma/client";

export const ACTIVE_WORKSPACE_COOKIE = "uoi-active-workspace";

/**
 * The user's active workspace: the cookie-selected workspace when the
 * user is still a member of it, otherwise their first workspace,
 * otherwise null (→ onboarding).
 */
export async function getActiveWorkspace(userId: string): Promise<Workspace | null> {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;

  if (cookieWorkspaceId) {
    const fromCookie = await prisma.workspace.findFirst({
      where: { id: cookieWorkspaceId, members: { some: { userId } } },
    });
    if (fromCookie) return fromCookie;
  }

  return prisma.workspace.findFirst({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getActiveWorkspaceId(userId: string): Promise<string | null> {
  const workspace = await getActiveWorkspace(userId);
  return workspace?.id ?? null;
}
