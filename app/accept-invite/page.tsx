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
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-gradient-to-br from-indigo-100 via-slate-50 to-violet-100 p-6 dark:from-indigo-950 dark:via-neutral-950 dark:to-violet-950">
      <div
        aria-hidden
        className="absolute -top-24 -left-24 size-72 rounded-full bg-indigo-400/20 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -right-24 -bottom-24 size-72 rounded-full bg-violet-400/20 blur-3xl"
      />
      <div className="relative flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-md">
          U
        </span>
        <span className="text-lg font-semibold">Unified Inbox</span>
      </div>
      <Card className="relative w-full max-w-md">
        <CardHeader>
          <CardTitle>Accept invitation</CardTitle>
          <CardDescription>
            {isPending
              ? "Checking your session…"
              : session
                ? `Signed in as ${session.user.email}. The invitation must have been sent to this email address.`
                : "Sign in (or create an account) with the email address the invitation was sent to — we'll bring you right back here to join."}
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
                <Link href={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>
                  Sign in
                </Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link
                  href={`/register?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
                >
                  Create account
                </Link>
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
