import { redirect } from "next/navigation";

import { InboxShell } from "@/features/inbox/inbox-shell";
import type { RealInboxData } from "@/features/inbox/real-data";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { conversationService } from "@/services/conversation.service";
import { workspaceService } from "@/services/workspace.service";

/**
 * Inbox page (Phase 4 dual mode): if the active workspace has REAL
 * conversations, they are loaded server-side and the real inbox is
 * rendered. Workspaces without conversations keep the Phase 3 sample
 * preview (clearly badged, never written to the DB).
 */
interface InboxPageProps {
  searchParams: Promise<{ c?: string }>;
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  let realData: RealInboxData | undefined;
  const active = await getActiveWorkspace(user.id);
  if (active) {
    try {
      const { items } = await conversationService.listConversations(user.id, active.id, {
        limit: 30,
      });
      // Deep link (?c=<conversationId>, e.g. from a contact profile):
      // focus that conversation first when it exists in this workspace.
      let first = items[0];
      if (params.c && params.c !== first?.id) {
        try {
          first = await conversationService.getConversation(user.id, active.id, params.c);
        } catch {
          // Not found / not visible — fall back to the newest conversation.
        }
      }
      if (first) {
        const orderedItems = [first, ...items.filter((item) => item.id !== first.id)];
        const [messages, members] = await Promise.all([
          conversationService.listMessages(user.id, active.id, first.id, { limit: 100 }),
          workspaceService.listMembers(user.id, active.id),
        ]);
        realData = {
          workspaceId: active.id,
          currentUserId: user.id,
          conversations: orderedItems.map((item) => ({
            id: item.id,
            status: item.status,
            priority: item.priority,
            snoozedUntil: item.snoozedUntil?.toISOString() ?? null,
            awaitingReply: item.awaitingReply,
            unreadCount: item.unreadCount,
            lastMessageAt: item.lastMessageAt?.toISOString() ?? null,
            preview: item.preview,
            contact: item.contact,
            channel: item.channel,
            assignee: item.assignee,
            tags: item.tags.map((t) => ({ id: t.id, name: t.name })),
          })),
          initialMessages: {
            conversationId: first.id,
            messages: messages.items.map((m) => ({
              id: m.id,
              conversationId: m.conversationId,
              direction: m.direction,
              messageType: m.messageType,
              content: m.content,
              status: m.status,
              senderType: m.senderType,
              senderId: m.senderId,
              isPrivateNote: m.isPrivateNote,
              externalMessageId: m.externalMessageId,
              createdAt: m.createdAt.toISOString(),
              metadata: m.metadata,
              attachments: m.attachments.map((a) => ({
                id: a.id,
                url: a.url,
                mimeType: a.mimeType,
                fileName: a.fileName,
                size: a.size,
              })),
            })),
          },
          members: members.map((m) => ({ id: m.user.id, name: m.user.name })),
        };
      }
    } catch (error) {
      // Fall back to the sample preview rather than breaking the page.
      console.error("[inbox] failed to load real conversations:", error);
    }
  }

  return <InboxShell currentUserName={user.name} realData={realData} />;
}
