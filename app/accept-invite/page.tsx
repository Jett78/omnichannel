"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";

function AcceptInviteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();
  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && "error" in data
            ? (data as { error: { message?: string } }).error.message
            : undefined;
        setMessage(msg ?? "Could not accept this invitation.");
        return;
      }
      const workspaceId =
        data && typeof data === "object" && "workspaceId" in data
          ? (data as { workspaceId: string }).workspaceId
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Accept invitation</CardTitle>
          <CardDescription>
            {isPending
              ? "Checking your session…"
              : session
                ? `Signed in as ${session.user.email}. The invitation must have been sent to this email address.`
                : "Sign in (or create an account) with the email address the invitation was sent to, then come back here."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {session ? (
            <form onSubmit={(e) => void onAccept(e)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="token">Invitation token</Label>
                <Input
                  id="token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste the token from your invite link"
                  required
                />
              </div>
              {message ? (
                <p className="text-destructive text-sm" role="alert">
                  {message}
                </p>
              ) : null}
              <Button type="submit" disabled={busy || !token.trim()}>
                {busy ? "Joining…" : "Join workspace"}
              </Button>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button asChild className="flex-1">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href="/register">Create account</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteInner />
    </Suspense>
  );
}
