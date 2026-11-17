import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workspaceService } from "@/services/workspace.service";

/**
 * The REAL auth gate for the dashboard group (the proxy is only an
 * optimistic cookie check): no session → /api/session-expired (clears the stale cookie, then /login).
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const activeWorkspace = await getActiveWorkspace(user.id);
  const [workspaces, notifications, inboxOpenCount, searchContacts, searchConversations] =
    await Promise.all([
      workspaceService.listWorkspacesForUser(user.id),
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      activeWorkspace
        ? prisma.conversation.count({
            where: { workspaceId: activeWorkspace.id, status: "OPEN" },
          })
        : Promise.resolve(0),
      // Real rows for the header ⌘K search (contacts + recent threads).
      activeWorkspace
        ? prisma.contact.findMany({
            where: { workspaceId: activeWorkspace.id },
            orderBy: { updatedAt: "desc" },
            take: 100,
            select: { id: true, displayName: true, email: true },
          })
        : Promise.resolve([]),
      activeWorkspace
        ? prisma.conversation.findMany({
            where: { workspaceId: activeWorkspace.id },
            orderBy: { lastMessageAt: "desc" },
            take: 50,
            select: {
              id: true,
              contact: { select: { displayName: true } },
              messages: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { body: true },
              },
            },
          })
        : Promise.resolve([]),
    ]);

  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      inboxOpenCount={inboxOpenCount}
      searchContacts={searchContacts.map((c) => ({
        id: c.id,
        name: c.displayName,
        email: c.email,
      }))}
      searchConversations={searchConversations.map((c) => ({
        id: c.id,
        contactName: c.contact.displayName,
        snippet: c.messages[0]?.body ?? "Attachment",
      }))}
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
