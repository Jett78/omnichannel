import type { Provider } from "@/generated/prisma/client";

/**
 * Serialized shapes passed from the inbox server page to the client
 * shell, and returned by the conversations API (Dates as ISO strings).
 * These mirror services/conversation.service + UnifiedMessage.
 */
export type ConversationPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface RealConversationItem {
  id: string;
  status: "OPEN" | "PENDING" | "RESOLVED" | "SNOOZED";
  priority: ConversationPriority | null;
  snoozedUntil: string | null;
  awaitingReply: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  preview: string | null;
  contact: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    phone: string | null;
    email: string | null;
  };
  channel: { id: string; provider: Provider; displayName: string };
  assignee: { id: string; name: string } | null;
  tags: Array<{ id: string; name: string }>;
}

export interface RealMessageItem {
  id: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  messageType: string;
  content: string | null;
  status: string;
  senderType: "CONTACT" | "AGENT" | "SYSTEM";
  senderId: string;
  isPrivateNote: boolean;
  externalMessageId: string | null;
  createdAt: string;
  /** Provider message metadata (template info, delivery error, …). */
  metadata?: Record<string, unknown> | null;
  attachments?: Array<{
    id: string;
    url: string | null;
    mimeType: string | null;
    fileName: string | null;
    size: number | null;
  }>;
}

/** Saved reply as returned by the canned-responses API. */
export interface CannedResponseView {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  category: string | null;
}

/** APPROVED WhatsApp template as returned by the templates API. */
export interface WhatsAppTemplateView {
  name: string;
  language: string;
  category: string | null;
  bodyText: string | null;
  paramsCount: number;
}

export interface RealInboxData {
  workspaceId: string;
  currentUserId: string;
  /** Sidebar inbox views (?view=…): which assignee tab opens first. */
  initialView?: "all" | "mine" | "unassigned" | "mentions";
  /** Phase 13G — whether an AI provider key is configured server-side. */
  aiConfigured: boolean;
  conversations: RealConversationItem[];
  initialMessages: { conversationId: string; messages: RealMessageItem[] };
  members: Array<{ id: string; name: string }>;
}
