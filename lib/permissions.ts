import type { Role } from "@/generated/prisma/client";

/**
 * Role-based permission matrix for workspaces.
 *
 * OWNER > ADMIN > AGENT > VIEWER. Services must check permissions
 * server-side via lib/workspace-auth.ts — the UI only mirrors these
 * rules to decide what controls to show.
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  AGENT: 2,
  VIEWER: 1,
};

export type Permission =
  | "workspace.update"
  | "workspace.delete"
  | "members.view"
  | "members.invite"
  | "members.updateRole"
  | "members.remove"
  | "teams.manage"
  | "channels.manage"
  | "conversations.view"
  | "conversations.assign"
  | "conversations.reply"
  | "settings.view";

const AGENT_PERMISSIONS: readonly Permission[] = [
  "members.view",
  "conversations.view",
  "conversations.assign",
  "conversations.reply",
  "settings.view",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...AGENT_PERMISSIONS,
  "workspace.update",
  "members.invite",
  "members.updateRole",
  "members.remove",
  "teams.manage",
  "channels.manage",
];

const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  OWNER: [...ADMIN_PERMISSIONS, "workspace.delete"],
  ADMIN: ADMIN_PERMISSIONS,
  AGENT: AGENT_PERMISSIONS,
  VIEWER: ["members.view", "conversations.view", "settings.view"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].includes(permission);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return PERMISSIONS_BY_ROLE[role];
}

/**
 * Can `actorRole` modify (role-change / remove) a member with
 * `targetRole`? You can only act on members strictly below you —
 * except that an OWNER can act on another OWNER (the last-owner guard
 * in the service still prevents removing the final OWNER).
 */
export function canActOnMember(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "OWNER" && targetRole === "OWNER") return true;
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}
