"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/lib/permissions";
import type { Role } from "@/generated/prisma/client";

export interface WorkspaceSettingsData {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

/**
 * Workspace profile form (real, Phase 2 API). Member/team management
 * lives in features/team/team-management.tsx and is reused by both
 * /team and /settings.
 */
export function WorkspaceSettings({
  workspace,
  currentRole,
}: {
  workspace: WorkspaceSettingsData;
  currentRole: Role;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canUpdate = hasPermission(currentRole, "workspace.update");

  async function onUpdateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name") ?? ""),
          timezone: String(formData.get("timezone") ?? ""),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && "error" in data
            ? (data as { error: { message?: string } }).error.message
            : undefined;
        setMessage(msg ?? "Could not save workspace settings.");
        return;
      }
      setMessage("Saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Workspace profile</CardTitle>
        <CardDescription>
          {workspace.name} · /{workspace.slug} · your role: {currentRole}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onUpdateWorkspace} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              name="name"
              defaultValue={workspace.name}
              disabled={!canUpdate}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-tz">Timezone</Label>
            <Input
              id="ws-tz"
              name="timezone"
              defaultValue={workspace.timezone}
              disabled={!canUpdate}
              required
            />
          </div>
          {canUpdate ? (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy} className="w-fit">
                Save changes
              </Button>
              {message ? (
                <p className="text-sm" role="status">
                  {message}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Your role cannot edit workspace details.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
