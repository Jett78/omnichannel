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
}

export const cannedResponseService = {
  async list(actorUserId: string, workspaceId: string): Promise<CannedResponseView[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const rows = await prisma.cannedResponse.findMany({
      where: { workspaceId },
      orderBy: { title: "asc" },
      select: { id: true, title: true, body: true, shortcut: true },
    });
    return rows;
  },

  async create(
    actorUserId: string,
    workspaceId: string,
    input: { title: string; body: string; shortcut?: string },
  ): Promise<CannedResponseView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const row = await prisma.cannedResponse.create({
      data: {
        workspaceId,
        title: input.title.trim(),
        body: input.body,
        shortcut: input.shortcut?.trim() ? input.shortcut.trim() : null,
      },
      select: { id: true, title: true, body: true, shortcut: true },
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
