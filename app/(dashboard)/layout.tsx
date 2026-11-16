import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workspaceService } from "@/services/workspace.service";

/**
 * The REAL auth gate for the dashboard group (the proxy is only an
 * optimistic cookie check): no session → /login.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [workspaces, activeWorkspace, notifications] = await Promise.all([
    workspaceService.listWorkspacesForUser(user.id),
    getActiveWorkspace(user.id),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
      activeWorkspaceId={activeWorkspace?.id ?? null}
      notifications={notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        isRead: n.isRead,
        createdAtLabel: n.createdAt.toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      }))}
    >
      {children}
    </AppShell>
  );
}
