import type { Provider } from "@/generated/prisma/client";

/**
 * A real contact row for the Contacts page, mapped server-side from
 * the database (Contact + identities + conversations). Sample data
 * no longer exists for contacts — this page is fully dynamic.
 */
export interface RealContact {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Providers this contact is reachable on (from their identities). */
  providers: Provider[];
  email: string | null;
  phone: string | null;
  /** Union of tags across the contact's conversations. */
  tags: string[];
  /** ISO timestamp of the newest conversation activity, if any. */
  lastActiveAt: string | null;
  conversationsCount: number;
}

/** "4 min ago" / "2 hrs ago" / "3 days ago" / a date for older. */
export function formatLastActive(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Unified customer profile as returned by the Phase-13D profile service. */
export interface ContactProfileView {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  customAttrs: Record<string, string>;
  identities: Array<{
    id: string;
    provider: string;
    channelDisplayName: string;
    externalUserId: string;
    username: string | null;
  }>;
  tags: string[];
  stats: { conversations: number; open: number; messages: number };
  conversations: Array<{
    id: string;
    status: string;
    priority: string | null;
    provider: string;
    channelDisplayName: string;
    lastMessageAt: string | null;
    preview: string | null;
    unreadCount: number;
  }>;
  notes: Array<{
    id: string;
    body: string | null;
    senderName: string | null;
    conversationId: string;
    createdAt: string;
  }>;
}
