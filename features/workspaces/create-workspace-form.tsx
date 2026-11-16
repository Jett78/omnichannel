"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "");
    const timezone = String(formData.get("timezone") ?? "Asia/Kathmandu");
    setPending(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, timezone }),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === "object" && "error" in data
            ? (data as { error: { message?: string } }).error.message
            : undefined;
        setError(message ?? "Could not create the workspace.");
        return;
      }
      const data: unknown = await res.json();
      const workspaceId =
        data && typeof data === "object" && "workspace" in data
          ? (data as { workspace: { id: string } }).workspace.id
          : null;
      if (workspaceId) {
        await fetch("/api/workspaces/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        }).catch(() => null);
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>1 · Create your workspace</CardTitle>
        <CardDescription>
          Name your business workspace — channels, contacts and conversations are scoped to it.
          You become its owner.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ob-name">Workspace name</Label>
            <Input id="ob-name" name="name" placeholder="My Business" required minLength={2} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ob-tz">Timezone</Label>
            <Input id="ob-tz" name="timezone" defaultValue="Asia/Kathmandu" required />
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
