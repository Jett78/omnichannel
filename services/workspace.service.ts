import { randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { sendInvitationEmail } from "@/lib/mail";
import { canActOnMember } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  createTeamSchema,
  createWorkspaceSchema,
  inviteMemberSchema,
  setTeamMembersSchema,
  updateTeamSchema,
  updateWorkspaceSchema,
  type CreateTeamInput,
  type CreateWorkspaceData,
  type InviteMemberInput,
  type SetTeamMembersInput,
  type UpdateTeamInput,
  type UpdateWorkspaceInput,
} from "@/lib/validations";
import { requireWorkspaceMembership, requireWorkspacePermission } from "@/lib/workspace-auth";
import type { Role } from "@/generated/prisma/client";

/**
 * Workspace service — the tenant root (Phase 2).
 *
 * EVERY method takes the acting userId and enforces membership +
 * role permissions server-side (lib/workspace-auth.ts). A workspaceId
 * on its own is never trusted.
 */

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return base.length >= 2 ? base : "workspace";
}

/**
 * Make a team's membership exactly `memberIds` (Chatwoot-style sync):
 * every id must be a member of the workspace; rows not in the set are
 * removed and missing rows are created, in one transaction.
 */
async function syncTeamMembership(
  teamId: string,
  workspaceId: string,
  memberIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(memberIds)];
  if (uniqueIds.length > 0) {
    const found = await prisma.workspaceMember.count({
      where: { workspaceId, id: { in: uniqueIds } },
    });
    if (found !== uniqueIds.length) {
      throw AppError.badRequest("One or more selected people are not members of this workspace");
    }
  }
  await prisma.$transaction([
    prisma.teamMember.deleteMany({
      where: { teamId, ...(uniqueIds.length > 0 ? { workspaceMemberId: { notIn: uniqueIds } } : {}) },
    }),
    ...(uniqueIds.length > 0
      ? [
          prisma.teamMember.createMany({
            data: uniqueIds.map((workspaceMemberId) => ({ teamId, workspaceMemberId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (await prisma.workspace.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base.slice(0, 44)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function countOwners(workspaceId: string): Promise<number> {
  return prisma.workspaceMember.count({ where: { workspaceId, role: "OWNER" } });
}

export const workspaceService = {
  /** Workspaces the user belongs to (with their role in each). */
  async listWorkspacesForUser(userId: string) {
    return prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      include: { members: { where: { userId }, select: { role: true } } },
      orderBy: { createdAt: "asc" },
    });
  },

  /** Backwards-compatible alias used by Phase 1 code. */
  async listForUser(userId: string) {
    return this.listWorkspacesForUser(userId);
  },

  /** Create a workspace; creator becomes OWNER. Slug auto-generated + deduped. */
  async createWorkspace(userId: string, rawInput: CreateWorkspaceData) {
    const input = createWorkspaceSchema.parse(rawInput);
    const slug = await uniqueSlug(input.slug ? slugify(input.slug) : slugify(input.name));
    const workspace = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name: input.name,
          slug,
          timezone: input.timezone,
          members: { create: { userId, role: "OWNER" } },
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: created.id,
          actorId: userId,
          action: "workspace.created",
          entity: "Workspace",
          entityId: created.id,
        },
      });
      return created;
    });
    return workspace;
  },

  /** Backwards-compatible alias (Phase 1 signature order). */
  async create(ownerUserId: string, rawInput: CreateWorkspaceData) {
    return this.createWorkspace(ownerUserId, rawInput);
  },

  /** Fetch one workspace — only if the user is a member. */
  async getWorkspaceForUser(userId: string, workspaceId: string) {
    await requireWorkspaceMembership(userId, workspaceId);
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw AppError.notFound("Workspace not found");
    return workspace;
  },

  /** Backwards-compatible alias (Phase 1 signature order). */
  async getForMember(workspaceId: string, userId: string) {
    return this.getWorkspaceForUser(userId, workspaceId);
  },

  /** Guard used by other tenant-scoped services. */
  async assertMember(workspaceId: string, userId: string): Promise<void> {
    await requireWorkspaceMembership(userId, workspaceId);
  },

  async updateWorkspace(userId: string, workspaceId: string, rawInput: UpdateWorkspaceInput) {
    await requireWorkspacePermission(userId, workspaceId, "workspace.update");
    const input = updateWorkspaceSchema.parse(rawInput);
    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.settings !== undefined
          ? { settings: input.settings as object }
          : {}),
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: userId,
        action: "workspace.updated",
        entity: "Workspace",
        entityId: workspaceId,
      },
    });
    return updated;
  },

  async listMembers(userId: string, workspaceId: string) {
    await requireWorkspacePermission(userId, workspaceId, "members.view");
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
        teamMemberships: {
          include: { team: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  /** Invite by email → Invitation row + accept link (dev mailer logs it). */
  async inviteMember(userId: string, workspaceId: string, rawInput: InviteMemberInput) {
    const actor = await requireWorkspacePermission(userId, workspaceId, "members.invite");
    const input = inviteMemberSchema.parse(rawInput);
    if (input.role === "OWNER" && actor.role !== "OWNER") {
      throw AppError.forbidden("Only an owner can invite another owner");
    }
    const email = input.email.toLowerCase();
    const existingMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email } },
    });
    if (existingMember) throw AppError.badRequest("That person is already a member");

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });

    const invitation = await prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { workspaceId, email, status: "PENDING" },
        data: { status: "REVOKED" },
      });
      const created = await tx.invitation.create({
        data: {
          workspaceId,
          email,
          role: input.role,
          token,
          invitedById: userId,
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: userId,
          action: "member.invited",
          entity: "Invitation",
          entityId: created.id,
          meta: { email, role: input.role },
        },
      });
      return created;
    });

    const inviteUrl = `${getEnv().APP_URL}/accept-invite?token=${token}`;
    await sendInvitationEmail(email, inviteUrl, workspace.name);
    return { invitation, inviteUrl };
  },

  /** Pending (unexpired) invitations for the Team page. */
  async listInvitations(userId: string, workspaceId: string) {
    await requireWorkspacePermission(userId, workspaceId, "members.invite");
    return prisma.invitation.findMany({
      where: { workspaceId, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { name: true } },
      },
    });
  },

  /** Revoke a pending invitation (its accept link stops working). */
  async revokeInvitation(userId: string, workspaceId: string, invitationId: string) {
    await requireWorkspacePermission(userId, workspaceId, "members.invite");
    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, workspaceId },
    });
    if (!invitation) throw AppError.notFound("Invitation not found");
    if (invitation.status !== "PENDING") {
      throw AppError.badRequest(`Invitation is already ${invitation.status.toLowerCase()}`);
    }
    const updated = await prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "REVOKED" },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: userId,
        action: "member.invite_revoked",
        entity: "Invitation",
        entityId: invitationId,
        meta: { email: invitation.email },
      },
    });
    return updated;
  },

  /** Accept an invitation. The signed-in user's email must match the invite. */
  async acceptInvitation(userId: string, token: string) {
    const invitation = await prisma.invitation.findUnique({ where: { token } });
    if (!invitation || invitation.status !== "PENDING") {
      throw AppError.badRequest("This invitation is no longer valid");
    }
    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      throw AppError.badRequest("This invitation has expired");
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized("You must be signed in");
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw AppError.forbidden("This invitation was sent to a different email address");
    }
    const already = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
    });
    if (already) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED" },
      });
      return { workspaceId: invitation.workspaceId, alreadyMember: true as const };
    }
    await prisma.$transaction(async (tx) => {
      await tx.workspaceMember.create({
        data: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED" },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: invitation.workspaceId,
          actorId: userId,
          action: "member.joined",
          entity: "WorkspaceMember",
          entityId: userId,
        },
      });
    });
    return { workspaceId: invitation.workspaceId, alreadyMember: false as const };
  },

  async updateMemberRole(
    actorId: string,
    workspaceId: string,
    memberId: string,
    role: Role,
  ) {
    const actor = await requireWorkspacePermission(actorId, workspaceId, "members.updateRole");
    const target = await prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!target) throw AppError.notFound("Member not found");
    if (!canActOnMember(actor.role, target.role)) {
      throw AppError.forbidden("You cannot change the role of a member with an equal or higher role");
    }
    if (role !== "OWNER" && target.role === "OWNER" && (await countOwners(workspaceId)) <= 1) {
      throw AppError.badRequest("A workspace must keep at least one owner");
    }
    if (role === "OWNER" && actor.role !== "OWNER") {
      throw AppError.forbidden("Only an owner can promote someone to owner");
    }
    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId,
        action: "member.role_updated",
        entity: "WorkspaceMember",
        entityId: memberId,
        meta: { from: target.role, to: role },
      },
    });
    return updated;
  },

  async removeMember(actorId: string, workspaceId: string, memberId: string) {
    const actor = await requireWorkspacePermission(actorId, workspaceId, "members.remove");
    const target = await prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!target) throw AppError.notFound("Member not found");
    const isSelf = target.userId === actorId;
    if (!isSelf && !canActOnMember(actor.role, target.role)) {
      throw AppError.forbidden("You cannot remove a member with an equal or higher role");
    }
    if (target.role === "OWNER" && (await countOwners(workspaceId)) <= 1) {
      throw AppError.badRequest("The last owner cannot be removed — transfer ownership first");
    }
    await prisma.workspaceMember.delete({ where: { id: memberId } });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId,
        action: "member.removed",
        entity: "WorkspaceMember",
        entityId: memberId,
        meta: { removedUserId: target.userId, role: target.role },
      },
    });
    return { removed: true as const };
  },

  // ─── Teams (Chatwoot-style: many-to-many membership) ─────────────────

  async listTeams(userId: string, workspaceId: string) {
    await requireWorkspaceMembership(userId, workspaceId);
    return prisma.team.findMany({
      where: { workspaceId },
      include: {
        teamMembers: {
          include: {
            member: {
              select: {
                id: true,
                role: true,
                user: { select: { id: true, name: true, email: true, image: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  async createTeam(userId: string, workspaceId: string, rawInput: CreateTeamInput) {
    await requireWorkspacePermission(userId, workspaceId, "teams.manage");
    const input = createTeamSchema.parse(rawInput);
    const existing = await prisma.team.findUnique({
      where: { workspaceId_name: { workspaceId, name: input.name } },
    });
    if (existing) throw AppError.badRequest(`A team named "${input.name}" already exists`);
    const team = await prisma.team.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        allowAutoAssign: input.allowAutoAssign ?? true,
      },
    });
    if (input.memberIds && input.memberIds.length > 0) {
      await syncTeamMembership(team.id, workspaceId, input.memberIds);
    }
    return team;
  },

  async updateTeam(
    userId: string,
    workspaceId: string,
    teamId: string,
    rawInput: UpdateTeamInput,
  ) {
    await requireWorkspacePermission(userId, workspaceId, "teams.manage");
    const input = updateTeamSchema.parse(rawInput);
    const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
    if (!team) throw AppError.notFound("Team not found");
    if (input.name && input.name !== team.name) {
      const conflict = await prisma.team.findUnique({
        where: { workspaceId_name: { workspaceId, name: input.name } },
      });
      if (conflict) throw AppError.badRequest(`A team named "${input.name}" already exists`);
    }
    return prisma.team.update({
      where: { id: teamId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.allowAutoAssign !== undefined
          ? { allowAutoAssign: input.allowAutoAssign }
          : {}),
      },
    });
  },

  /** Replace a team's membership with exactly the given member set. */
  async setTeamMembers(
    userId: string,
    workspaceId: string,
    teamId: string,
    rawInput: SetTeamMembersInput,
  ) {
    await requireWorkspacePermission(userId, workspaceId, "teams.manage");
    const input = setTeamMembersSchema.parse(rawInput);
    const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
    if (!team) throw AppError.notFound("Team not found");
    await syncTeamMembership(teamId, workspaceId, input.memberIds);
    return { updated: true as const };
  },

  async deleteTeam(userId: string, workspaceId: string, teamId: string) {
    await requireWorkspacePermission(userId, workspaceId, "teams.manage");
    const team = await prisma.team.findFirst({ where: { id: teamId, workspaceId } });
    if (!team) throw AppError.notFound("Team not found");
    await prisma.team.delete({ where: { id: teamId } });
    return { deleted: true as const };
  },
};
