"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Danger-zone workspace deletion (Settings). Rendered only for the
 * workspace OWNER — the API enforces the same rule server-side
 * (workspace.delete is an owner-only permission). Type-the-name
 * confirmation, same pattern as team deletion. On success the whole
 * app state is stale (the active workspace is gone), so we do a full
 * navigation to /dashboard, which lands on another workspace or on
 * onboarding when none remain.
 */
export function DeleteWorkspace({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "Could not delete the workspace.");
      }
      // Hard navigation on purpose: the active workspace no longer
      // exists, so client-side workspace state must be rebuilt from
      // scratch rather than soft-navigated with stale context.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the workspace.");
      setBusy(false);
    }
  }

  return (
    <div>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setConfirmName("");
            setError(null);
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete workspace</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{workspaceName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The workspace and everything in it — channels, contacts, conversations, saved
              replies, automations and settings — are removed permanently. This cannot be
              undone. To confirm, type the workspace name below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Type the workspace name to confirm deletion"
            placeholder={workspaceName}
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmName !== workspaceName || busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {busy ? "Deleting…" : "Delete workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="text-muted-foreground mt-2 text-xs">
        Only the workspace owner can do this. Deleting removes all of the workspace&apos;s data
        permanently.
      </p>
    </div>
  );
}
