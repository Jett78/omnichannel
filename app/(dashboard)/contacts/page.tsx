import { redirect } from "next/navigation";

import { ContactsExplorer } from "@/features/contacts/contacts-explorer";
import type { RealContact } from "@/features/contacts/real-data";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Provider } from "@/generated/prisma/client";

/**
 * Contacts — REAL data. Contacts are created automatically when a
 * customer messages a connected channel; this page lists the active
 * workspace's contacts with their channel identities, conversation
 * counts, tags and last activity.
 */
export default async function ContactsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const rows = await prisma.contact.findMany({
    where: { workspaceId: active.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      phone: true,
      email: true,
      updatedAt: true,
      identities: { select: { channel: { select: { provider: true } } } },
      conversations: {
        select: {
          lastMessageAt: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      },
      _count: { select: { conversations: true } },
    },
  });

  const contacts: RealContact[] = rows.map((row) => {
    const providers = [...new Set(row.identities.map((i) => i.channel.provider))] as Provider[];
    const tags = [
      ...new Set(row.conversations.flatMap((c) => c.tags.map((t) => t.tag.name))),
    ].sort();
    const lastMessageAt = row.conversations.reduce<Date | null>((latest, c) => {
      if (!c.lastMessageAt) return latest;
      return !latest || c.lastMessageAt > latest ? c.lastMessageAt : latest;
    }, null);
    return {
      id: row.id,
      name: row.displayName,
      avatarUrl: row.avatarUrl,
      providers,
      email: row.email,
      phone: row.phone,
      tags,
      lastActiveAt: (lastMessageAt ?? row.updatedAt).toISOString(),
      conversationsCount: row._count.conversations,
    };
  });

  return <ContactsExplorer contacts={contacts} />;
}
