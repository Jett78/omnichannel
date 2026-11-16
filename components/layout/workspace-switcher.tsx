"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

/** Switches the active workspace via the membership-checked API route. */
export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
}: {
  workspaces: WorkspaceOption[];
  activeWorkspaceId: string | null;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  if (workspaces.length === 0) {
    return <p className="text-muted-foreground truncate text-xs">No workspace yet</p>;
  }

  async function onChange(workspaceId: string) {
    setSwitching(true);
    try {
      await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <select
      aria-label="Active workspace"
      className="bg-sidebar-accent text-sidebar-accent-foreground w-full truncate rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-50"
      value={activeWorkspaceId ?? workspaces[0]?.id ?? ""}
      disabled={switching}
      onChange={(event) => void onChange(event.target.value)}
    >
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  );
}
