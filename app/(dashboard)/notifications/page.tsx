import { redirect } from "next/navigation";

import { NotificationsList } from "@/features/notifications/notifications-list";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { notificationService } from "@/services/notification.service";

/**
 * Notifications page (Phase 13E) — the signed-in user's notifications
 * in the active workspace: new conversations, new messages,
 * assignments, mentions and automation notices.
 */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const items = await notificationService.listForUser(user.id, active.id, 100);
  return <NotificationsList workspaceId={active.id} initialItems={items} />;
}
