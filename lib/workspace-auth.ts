import { AppError } from "@/lib/errors";
import { hasPermission, type Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Role, WorkspaceMember } from "@/generated/prisma/client";

/**
 * Workspace-level authorization — the single gate every tenant-scoped
 * service method must pass through. A workspaceId alone is NEVER
 * trusted: membership is loaded from the database for the acting user
 * on every call.
 */
export async function requireWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMember> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member) {
    // Not-found (not forbidden) so non-members cannot probe workspace ids.
    throw AppError.notFound("Workspace not found");
  }
  return member;
}

export async function requireWorkspacePermission(
  userId: string,
  workspaceId: string,
  permission: Permission,
): Promise<WorkspaceMember> {
  const member = await requireWorkspaceMembership(userId, workspaceId);
  if (!hasPermission(member.role, permission)) {
    throw AppError.forbidden(`Your role (${member.role}) cannot perform this action`);
  }
  return member;
}

export function assertRole(member: WorkspaceMember, roles: readonly Role[]): void {
  if (!roles.includes(member.role)) {
    throw AppError.forbidden(`Requires one of: ${roles.join(", ")}`);
  }
}
