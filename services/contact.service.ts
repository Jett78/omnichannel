import { prisma } from "@/lib/prisma";

/**
 * Contact service — unified people per workspace.
 * A Contact owns one ContactIdentity per channel they have written from.
 */
export const contactService = {
  async listForWorkspace(workspaceId: string, options?: { search?: string; limit?: number }) {
    return prisma.contact.findMany({
      where: {
        workspaceId,
        ...(options?.search
          ? {
              OR: [
                { displayName: { contains: options.search, mode: "insensitive" as const } },
                { email: { contains: options.search, mode: "insensitive" as const } },
                { phone: { contains: options.search } },
              ],
            }
          : {}),
      },
      include: { identities: { include: { channel: { select: { provider: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: options?.limit ?? 50,
    });
  },

  async getForWorkspace(workspaceId: string, contactId: string) {
    return prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      include: { identities: { include: { channel: true } }, conversations: true },
    });
  },
};
