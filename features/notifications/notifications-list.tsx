"use client";

import {
  AtSign,
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { NotificationView } from "@/services/notification.service";

function relativeTime(iso: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function TypeIcon({ type }: { type: string }) {
  const className = "size-4";
  switch (type) {
    case "ASSIGNMENT":
      return <UserPlus className={`${className} text-violet-600`} />;
    case "MENTION":
      return <AtSign className={`${className} text-amber-600`} />;
    case "INVITATION":
      return <Mail className={`${className} text-sky-600`} />;
    default:
      return <MessageSquare className={`${className} text-indigo-600`} />;
  }
}

interface NotificationsListProps {
  workspaceId: string;
  initialItems: NotificationView[];
}

export function NotificationsList({ workspaceId, initialItems }: NotificationsListProps) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const router = useRouter();

  // Pagination: 10 notifications per page.
  const PER_PAGE = 10;
  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = items.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);
  const apiBase = `/api/workspaces/${workspaceId}/notifications`;
  const unreadCount = items.filter((item) => !item.isRead).length;

  async function open(item: NotificationView) {
    if (!item.isRead) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      void fetch(`${apiBase}/${item.id}`, { method: "PATCH" }).catch(() => null);
    }
    if (item.entity?.toLowerCase() === "conversation" && item.entityId) {
      router.push(`/inbox?c=${item.entityId}`);
    }
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await fetch(`${apiBase}/read-all`, { method: "POST" }).catch(() => null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="New conversations, messages, assignments and mentions in this workspace."
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" onClick={() => void markAllRead()}>
              <CheckCheck className="size-4" /> Mark all read
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Bell className="text-muted-foreground size-8" />
            <p className="text-sm font-medium">Nothing here yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              When customers start conversations, teammates assign you work, or someone
              mentions you in a note, it will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-2">
            <div className="flex flex-col divide-y">
              {pageItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void open(item)}
                  className="hover:bg-accent/50 -mx-2 flex items-start gap-3 rounded-md px-2 py-3 text-left"
                >
                  <span className="bg-muted mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full">
                    <TypeIcon type={item.type} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={item.isRead ? "text-sm" : "text-sm font-semibold"}>
                        {item.title}
                      </span>
                      {!item.isRead ? (
                        <span className="size-2 shrink-0 rounded-full bg-indigo-600" />
                      ) : null}
                    </span>
                    {item.body ? (
                      <span className="text-muted-foreground block truncate text-sm">
                        {item.body}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {relativeTime(item.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {items.length > PER_PAGE ? (
              <div className="flex flex-wrap items-center gap-3 px-2 pt-3 pb-2">
                <p className="text-muted-foreground flex-1 text-xs">
                  Showing {(currentPage - 1) * PER_PAGE + 1}–
                  {Math.min(currentPage * PER_PAGE, items.length)} of {items.length}{" "}
                  notifications
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="size-3.5" /> Previous
                </Button>
                <span className="text-xs font-medium">
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next <ChevronRight className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
