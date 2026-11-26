"use client";

import { Pencil, Plus, Search, Trash2, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { hasPermission, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@/generated/prisma/client";

export interface MemberData {
  id: string;
  role: Role;
  user: { id: string; name: string; email: string; image: string | null };
  teams: { id: string; name: string }[];
  joinedLabel: string;
}

export interface TeamMemberRef {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
}

export interface TeamData {
  id: string;
  name: string;
  description: string | null;
  allowAutoAssign: boolean;
  memberCount: number;
  members: TeamMemberRef[];
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

  // ─── Teams (Chatwoot-style create/edit + agent picker) ──────────────
  const canManageTeams = can(currentRole, "teams.manage");
  const [teamDialog, setTeamDialog] = useState<
    { mode: "create" } | { mode: "edit"; team: TeamData } | null
  >(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formAutoAssign, setFormAutoAssign] = useState(true);
  const [formMemberIds, setFormMemberIds] = useState<ReadonlySet<string>>(new Set());
  const [agentSearch, setAgentSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TeamData | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  function openCreateTeam() {
    setFormName("");
    setFormDescription("");
    setFormAutoAssign(true);
    setFormMemberIds(new Set());
    setAgentSearch("");
    setTeamDialog({ mode: "create" });
  }

  function openEditTeam(team: TeamData) {
    setFormName(team.name);
    setFormDescription(team.description ?? "");
    setFormAutoAssign(team.allowAutoAssign);
    setFormMemberIds(new Set(team.members.map((member) => member.memberId)));
    setAgentSearch("");
    setTeamDialog({ mode: "edit", team });
  }

  function toggleFormMember(memberId: string) {
    setFormMemberIds((previous) => {
      const next = new Set(previous);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function saveTeam() {
    if (!teamDialog) return;
    const name = formName.trim();
    if (name.length < 2) {
      setMessage("Team name must be at least 2 characters.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (teamDialog.mode === "create") {
        const result = await callApi(`/api/workspaces/${workspaceId}/teams`, "POST", {
          name,
          description: formDescription.trim() || undefined,
          allowAutoAssign: formAutoAssign,
          memberIds: [...formMemberIds],
        });
        setMessage(result.ok ? `Team "${name}" created.` : result.message);
        if (result.ok) {
          setTeamDialog(null);
          router.refresh();
        }
        return;
      }
      const team = teamDialog.team;
      const basics = await callApi(`/api/workspaces/${workspaceId}/teams/${team.id}`, "PATCH", {
        name,
        description: formDescription.trim() || null,
        allowAutoAssign: formAutoAssign,
      });
      if (!basics.ok) {
        setMessage(basics.message);
        return;
      }
      const membership = await callApi(
        `/api/workspaces/${workspaceId}/teams/${team.id}/members`,
        "PUT",
        { memberIds: [...formMemberIds] },
      );
      setMessage(membership.ok ? `Team "${name}" updated.` : membership.message);
      if (membership.ok) {
        setTeamDialog(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const filteredMembers = members.filter((member) => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      member.user.name.toLowerCase().includes(query) ||
      member.user.email.toLowerCase().includes(query)
    );
  });

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

  return (
    <div className="flex flex-col gap-4">
      <Card>
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
                    <td className="py-3 pr-3">
                      {member.teams.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {member.teams.map((team) => (
                            <Badge key={team.id} variant="secondary" className="rounded-full">
                              {team.name}
                            </Badge>
                          ))}
                        </span>
                      )}
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
        <Card>
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Teams</CardTitle>
              <CardDescription>
                Group agents into teams — for example Sales or Support. An agent can be in
                several teams at once.
              </CardDescription>
            </div>
            {canManageTeams ? (
              <Button onClick={openCreateTeam} className="rounded-full">
                <Plus className="size-4" /> Create team
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {teams.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="bg-accent text-primary flex size-12 items-center justify-center rounded-full">
                <Users className="size-6" />
              </span>
              <p className="text-sm font-medium">No teams yet</p>
              <p className="text-muted-foreground max-w-sm text-sm">
                Create your first team to organise agents by responsibility — teams can be
                assigned conversations and used in automations.
              </p>
              {canManageTeams ? (
                <Button onClick={openCreateTeam} className="mt-2 rounded-full" size="sm">
                  <Plus className="size-4" /> Create team
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {teams.map((team) => (
                <li
                  key={team.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3.5"
                >
                  <span className="flex -space-x-2">
                    {team.members.slice(0, 5).map((member) => (
                      <AvatarWithBadge
                        key={member.memberId}
                        name={member.name || member.email}
                        image={member.image}
                        size="sm"
                        className="ring-card ring-2"
                      />
                    ))}
                    {team.memberCount > 5 ? (
                      <span className="bg-muted text-muted-foreground ring-card flex size-8 items-center justify-center rounded-full text-[11px] font-medium ring-2">
                        +{team.memberCount - 5}
                      </span>
                    ) : null}
                    {team.memberCount === 0 ? (
                      <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full">
                        <Users className="size-4" />
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{team.name}</span>
                      {team.allowAutoAssign ? (
                        <Badge variant="success" className="rounded-full">
                          Auto-assign
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {team.description ?? "No description"} · {team.memberCount} member
                      {team.memberCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  {canManageTeams ? (
                    <span className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => openEditTeam(team)}
                      >
                        <Pencil className="size-4" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setDeleteTarget(team);
                          setDeleteConfirmName("");
                        }}
                      >
                        <Trash2 className="size-4" /> Delete
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {!canManageTeams ? (
            <p className="text-muted-foreground text-xs">
              Only owners and admins can create or change teams.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Create / edit team dialog */}
      <Dialog
        open={teamDialog !== null}
        onOpenChange={(open) => {
          if (!open) setTeamDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {teamDialog?.mode === "edit" ? "Edit team" : "Create a team"}
            </DialogTitle>
            <DialogDescription>
              Name the team, then tick the agents who belong to it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                placeholder="e.g. Support"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                maxLength={60}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-description">Description (optional)</Label>
              <Textarea
                id="team-description"
                placeholder="What does this team handle?"
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                maxLength={500}
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Allow auto-assign</p>
                <p className="text-muted-foreground text-xs">
                  Conversations assigned to this team are shared out among its available
                  members.
                </p>
              </div>
              <Switch checked={formAutoAssign} onCheckedChange={setFormAutoAssign} />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Agents</Label>
                <span className="text-muted-foreground text-xs">
                  {formMemberIds.size} selected
                </span>
              </div>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  placeholder="Search agents…"
                  value={agentSearch}
                  onChange={(event) => setAgentSearch(event.target.value)}
                  className="pl-10"
                />
              </div>
              <ul className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-lg border">
                {filteredMembers.length === 0 ? (
                  <li className="text-muted-foreground px-3 py-4 text-sm">
                    No agents match your search.
                  </li>
                ) : (
                  filteredMembers.map((member) => {
                    const checked = formMemberIds.has(member.id);
                    return (
                      <li key={member.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors",
                            checked ? "bg-accent/60" : "hover:bg-muted/50",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary size-4 shrink-0"
                            checked={checked}
                            onChange={() => toggleFormMember(member.id)}
                          />
                          <AvatarWithBadge
                            name={member.user.name || member.user.email}
                            image={member.user.image}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate font-medium">
                              {member.user.name}
                              {member.user.id === currentUserId ? (
                                <span className="text-muted-foreground"> (you)</span>
                              ) : null}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {member.user.email}
                            </span>
                          </span>
                          <Badge variant={ROLE_BADGE[member.role]}>{member.role}</Badge>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
              <p className="text-muted-foreground text-xs">
                Agents must already be workspace members — invite new people above first.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeamDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void saveTeam()} disabled={busy} className="rounded-full">
              {busy
                ? "Saving…"
                : teamDialog?.mode === "edit"
                  ? "Save changes"
                  : "Create team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete team confirmation (type-the-name, like Chatwoot) */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The team and its memberships are removed permanently. Members keep their accounts
              and roles — they just leave this team. To confirm, type the team name below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Type the team name to confirm deletion"
            placeholder={deleteTarget?.name}
            value={deleteConfirmName}
            onChange={(event) => setDeleteConfirmName(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteTarget === null || deleteConfirmName !== deleteTarget.name || busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return;
                const team = deleteTarget;
                setDeleteTarget(null);
                void run(() =>
                  callApi(`/api/workspaces/${workspaceId}/teams/${team.id}`, "DELETE"),
                );
              }}
            >
              Delete team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
