import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";

/**
 * Canned responses (Chatwoot-style saved replies) — workspace-shared
 * snippets inserted from the composer with "/". Bodies may contain
 * {{contact.name}}, substituted by the client at insert time.
 */
export interface CannedResponseView {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  category: string | null;
}

const VIEW_SELECT = {
  id: true,
  title: true,
  body: true,
  shortcut: true,
  category: true,
} as const;

function cleanOptional(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const cannedResponseService = {
  async list(actorUserId: string, workspaceId: string): Promise<CannedResponseView[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const rows = await prisma.cannedResponse.findMany({
      where: { workspaceId },
      orderBy: [{ category: "asc" }, { title: "asc" }],
      select: VIEW_SELECT,
    });
    return rows;
  },

  async create(
    actorUserId: string,
    workspaceId: string,
    input: { title: string; body: string; shortcut?: string; category?: string },
  ): Promise<CannedResponseView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const row = await prisma.cannedResponse.create({
      data: {
        workspaceId,
        title: input.title.trim(),
        body: input.body,
        shortcut: cleanOptional(input.shortcut),
        category: cleanOptional(input.category),
      },
      select: VIEW_SELECT,
    });
    return row;
  },

  /** Edit an existing saved reply (Phase 13A). Omitted fields stay as-is;
   *  shortcut/category can be cleared by passing null or "". */
  async update(
    actorUserId: string,
    workspaceId: string,
    cannedId: string,
    input: {
      title?: string;
      body?: string;
      shortcut?: string | null;
      category?: string | null;
    },
  ): Promise<CannedResponseView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const existing = await prisma.cannedResponse.findFirst({
      where: { id: cannedId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound("Canned response not found");
    const row = await prisma.cannedResponse.update({
      where: { id: cannedId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.shortcut !== undefined ? { shortcut: cleanOptional(input.shortcut) } : {}),
        ...(input.category !== undefined ? { category: cleanOptional(input.category) } : {}),
      },
      select: VIEW_SELECT,
    });
    return row;
  },

  async remove(
    actorUserId: string,
    workspaceId: string,
    cannedId: string,
  ): Promise<{ id: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const row = await prisma.cannedResponse.findFirst({
      where: { id: cannedId, workspaceId },
      select: { id: true },
    });
    if (!row) throw AppError.notFound("Canned response not found");
    await prisma.cannedResponse.delete({ where: { id: cannedId } });
    return { id: cannedId };
  },
};
