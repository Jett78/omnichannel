import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";

/**
 * Phase 13D — unified customer profile.
 *
 * One Contact, seen whole: every channel identity linked to it, its
 * full conversation history, the union of tags, the internal notes
 * agents left across its conversations, and free-form attributes.
 *
 * Identities are grouped ONLY by the Contact they already belong to —
 * nothing is merged automatically. Two contacts that look like the
 * same person stay separate until a human merges them (no merge tool
 * exists yet, by design).
 */

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

function previewFor(
  message: { body: string | null; type: string; direction: string } | undefined,
): string | null {
  if (!message) return null;
  if (message.body) return message.body;
  const outbound = message.direction === "OUTBOUND";
  switch (message.type) {
    case "IMAGE":
      return outbound ? "You sent a photo" : "Photo";
    case "VIDEO":
      return outbound ? "You sent a video" : "Video";
    case "AUDIO":
      return outbound ? "You sent an audio message" : "Audio message";
    case "FILE":
      return outbound ? "You sent a file" : "File";
    case "STICKER":
      return "Sticker";
    case "LOCATION":
      return "Location";
    default:
      return null;
  }
}

function toAttrs(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || raw === undefined) continue;
    out[key] = typeof raw === "string" ? raw : String(raw);
  }
  return out;
}

export const contactProfileService = {
  async getProfile(
    actorUserId: string,
    workspaceId: string,
    contactId: string,
  ): Promise<ContactProfileView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      include: {
        identities: {
          include: { channel: { select: { provider: true, displayName: true } } },
          orderBy: { createdAt: "asc" },
        },
        conversations: {
          orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
          include: {
            channel: { select: { provider: true, displayName: true } },
            tags: { include: { tag: { select: { name: true } } } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { body: true, type: true, direction: true },
            },
            _count: { select: { messages: true } },
          },
        },
      },
    });
    if (!contact) throw AppError.notFound("Contact not found");

    const notes = await prisma.message.findMany({
      where: {
        type: "PRIVATE_NOTE",
        conversation: { contactId, workspaceId },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        body: true,
        senderUserId: true,
        conversationId: true,
        createdAt: true,
      },
    });
    const noteSenderIds = [...new Set(notes.map((n) => n.senderUserId).filter(Boolean))] as string[];
    const senders = noteSenderIds.length
      ? await prisma.user.findMany({
          where: { id: { in: noteSenderIds } },
          select: { id: true, name: true },
        })
      : [];
    const senderName = new Map(senders.map((s) => [s.id, s.name]));

    const tagNames = [
      ...new Set(contact.conversations.flatMap((c) => c.tags.map((t) => t.tag.name))),
    ].sort();

    return {
      id: contact.id,
      displayName: contact.displayName,
      avatarUrl: contact.avatarUrl,
      phone: contact.phone,
      email: contact.email,
      createdAt: contact.createdAt.toISOString(),
      customAttrs: toAttrs(contact.customAttrs),
      identities: contact.identities.map((identity) => ({
        id: identity.id,
        provider: identity.channel.provider,
        channelDisplayName: identity.channel.displayName,
        externalUserId: identity.externalUserId,
        username: identity.username,
      })),
      tags: tagNames,
      stats: {
        conversations: contact.conversations.length,
        open: contact.conversations.filter(
          (c) => c.status === "OPEN" || c.status === "PENDING" || c.status === "SNOOZED",
        ).length,
        messages: contact.conversations.reduce((sum, c) => sum + c._count.messages, 0),
      },
      conversations: contact.conversations.map((conversation) => ({
        id: conversation.id,
        status: conversation.status,
        priority: conversation.priority,
        provider: conversation.channel.provider,
        channelDisplayName: conversation.channel.displayName,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        preview: previewFor(conversation.messages[0]),
        unreadCount: conversation.unreadCount,
      })),
      notes: notes.map((note) => ({
        id: note.id,
        body: note.body,
        senderName: note.senderUserId ? (senderName.get(note.senderUserId) ?? null) : null,
        conversationId: note.conversationId,
        createdAt: note.createdAt.toISOString(),
      })),
    };
  },

  /**
   * Edit the profile fields an agent maintains by hand: display name,
   * phone, email and the free-form attribute set. Attributes REPLACE
   * the whole set (the editor always sends the full map).
   */
  async updateContact(
    actorUserId: string,
    workspaceId: string,
    contactId: string,
    input: {
      displayName?: string;
      phone?: string | null;
      email?: string | null;
      customAttrs?: Record<string, string>;
    },
  ): Promise<ContactProfileView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.assign");
    const existing = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound("Contact not found");

    const cleanOptional = (value?: string | null): string | null | undefined => {
      if (value === undefined) return undefined;
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };

    let attrs: Record<string, string> | undefined;
    if (input.customAttrs !== undefined) {
      attrs = {};
      for (const [key, value] of Object.entries(input.customAttrs)) {
        const cleanKey = key.trim();
        if (!cleanKey) continue;
        attrs[cleanKey] = value;
        if (Object.keys(attrs).length >= 20) break;
      }
    }

    await prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(input.displayName !== undefined
          ? { displayName: input.displayName.trim() }
          : {}),
        ...(input.phone !== undefined ? { phone: cleanOptional(input.phone) } : {}),
        ...(input.email !== undefined ? { email: cleanOptional(input.email) } : {}),
        ...(attrs !== undefined ? { customAttrs: attrs } : {}),
      },
    });
    return this.getProfile(actorUserId, workspaceId, contactId);
  },
};
