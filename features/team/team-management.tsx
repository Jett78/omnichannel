"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission, type Permission } from "@/lib/permissions";
import type { Role } from "@/generated/prisma/client";

export interface MemberData {
  id: string;
  role: Role;
  user: { id: string; name: string; email: string; image: string | null };
  team: { id: string; name: string } | null;
  joinedLabel: string;
}

export interface TeamData {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

export interface InvitationData {
  id: string;
  email: string;
  role: Role;
  invitedByName: string;
  expiresLabel: string;
}

const ROLES: readonly Role[] = ["OWNER", "ADMIN", "AGENT", "VIEWER"];

const ROLE_BADGE: Record<Role, "info" | "success" | "secondary" | "muted"> = {
  OWNER: "info",
  ADMIN: "success",
  AGENT: "secondary",
  VIEWER: "muted",
};

function can(role: Role, permission: Permission): boolean {
  return hasPermission(role, permission);
}

/**
 * Real team management (Phase 2 APIs): members, roles, invites, teams.
 * Canonical home is /team; Settings reuses the same component.
 */
export function TeamManagement({
  workspaceId,
  workspaceName,
  members,
  teams,
  invitations = [],
  currentUserId,
  currentRole,
}: {
  workspaceId: string;
  workspaceName: string;
  members: MemberData[];
  teams: TeamData[];
  invitations?: InvitationData[];
  currentUserId: string;
  currentRole: Role;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function callApi(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "error" in data
          ? (data as { error: { message?: string } }).error.message
          : undefined;
      return { ok: false, message: msg ?? `Request failed (${res.status})` };
    }
    return { ok: true, message: "Saved." };
  }

  async function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(result.message);
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setBusy(true);
    setMessage(null);
    setInviteUrl(null);
    void (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: String(formData.get("email") ?? ""),
            role: String(formData.get("role") ?? "AGENT"),
          }),
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const msg =
            data && typeof data === "object" && "error" in data
              ? (data as { error: { message?: string } }).error.message
              : undefined;
          setMessage(msg ?? "Invite failed.");
          return;
        }
        const url =
          data && typeof data === "object" && "inviteUrl" in data
            ? (data as { inviteUrl: string }).inviteUrl
            : null;
        setInviteUrl(url);
        setMessage(
          `Invitation emailed to ${String(formData.get("email") ?? "")}. You can also share the link below directly.`,
        );
        form.reset();
        router.refresh();
      } finally {
        setBusy(false);
      }
    })();
  }

  function onCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    void run(async () => {
      const result = await callApi(`/api/workspaces/${workspaceId}/teams`, "POST", {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || undefined,
      });
      if (result.ok) form.reset();
      return result;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>
            People with access to {workspaceName}. Roles are enforced by the server on every
            request — your role: {currentRole}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 font-medium">Joined</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="py-3 pr-3">
                      <span className="flex items-center gap-2.5">
                        <AvatarWithBadge
                          name={member.user.name || member.user.email}
                          image={member.user.image}
                          size="sm"
                        />
                        <span className="leading-tight">
                          <span className="block font-medium">
                            {member.user.name}
                            {member.user.id === currentUserId ? (
                              <span className="text-muted-foreground"> (you)</span>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {member.user.email}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      {can(currentRole, "members.updateRole") ? (
                        <select
                          aria-label={`Role for ${member.user.email}`}
                          className="rounded-md border px-2 py-1 text-xs"
                          value={member.role}
                          disabled={busy}
                          onChange={(event) =>
                            void run(() =>
                              callApi(
                                `/api/workspaces/${workspaceId}/members/${member.id}`,
                                "PATCH",
                                { role: event.target.value },
                              ),
                            )
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge variant={ROLE_BADGE[member.role]}>{member.role}</Badge>
                      )}
                    </td>
                    <td className="text-muted-foreground py-3 pr-3">
                      {member.team?.name ?? "—"}
                    </td>
                    <td className="text-muted-foreground py-3 pr-3">{member.joinedLabel}</td>
                    <td className="py-3 text-right">
                      {can(currentRole, "members.remove") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              callApi(
                                `/api/workspaces/${workspaceId}/members/${member.id}`,
                                "DELETE",
                              ),
                            )
                          }
                        >
                          Remove
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {can(currentRole, "members.invite") ? (
            <form onSubmit={onInvite} className="flex flex-wrap items-end gap-2 border-t pt-4">
              <div className="flex min-w-56 flex-1 flex-col gap-2">
                <Label htmlFor="invite-email">Invite by email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="agent@company.com"
                  required
                />
              </div>
              <select
                name="role"
                aria-label="Invite role"
                className="h-9 rounded-md border px-2 text-sm"
                defaultValue="AGENT"
              >
                {ROLES.filter((role) => role !== "OWNER" || currentRole === "OWNER").map(
                  (role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ),
                )}
              </select>
              <Button type="submit" disabled={busy}>
                <UserPlus className="size-4" />
                Send invite
              </Button>
            </form>
          ) : (
            <p className="text-muted-foreground border-t pt-4 text-sm">
              Your role cannot invite members.
            </p>
          )}
          {inviteUrl ? (
            <p className="bg-muted rounded-md p-2 text-xs break-all">
              Invite link: <span className="font-mono">{inviteUrl}</span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {can(currentRole, "members.invite") && invitations.length > 0 ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              People who have been invited but have not accepted yet. Resending emails a fresh
              7-day link and invalidates the old one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{invitation.email}</span>
                    <span className="text-muted-foreground block text-xs">
                      Invited by {invitation.invitedByName} · expires {invitation.expiresLabel}
                    </span>
                  </span>
                  <Badge variant={ROLE_BADGE[invitation.role]}>{invitation.role}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            email: invitation.email,
                            role: invitation.role,
                          }),
                        });
                        return res.ok
                          ? { ok: true, message: `Invitation re-sent to ${invitation.email}.` }
                          : { ok: false, message: "Could not resend the invitation." };
                      })
                    }
                  >
                    Resend
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        callApi(
                          `/api/workspaces/${workspaceId}/invitations/${invitation.id}`,
                          "DELETE",
                        ),
                      )
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>Group members into teams inside this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {teams.length === 0 ? (
            <p className="text-muted-foreground text-sm">No teams yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {teams.map((team) => (
                <li key={team.id} className="flex items-center justify-between py-1">
                  <span>
                    <span className="font-medium">{team.name}</span>
                    {team.description ? (
                      <span className="text-muted-foreground"> — {team.description}</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {can(currentRole, "teams.manage") ? (
            <form onSubmit={onCreateTeam} className="flex flex-wrap items-end gap-2 border-t pt-4">
              <div className="flex min-w-48 flex-1 flex-col gap-2">
                <Label htmlFor="team-name">New team</Label>
                <Input id="team-name" name="name" placeholder="Support" required minLength={2} />
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-2">
                <Label htmlFor="team-desc">Description</Label>
                <Input id="team-desc" name="description" placeholder="Optional" />
              </div>
              <Button type="submit" disabled={busy}>
                Create team
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
