"use client";

import { CheckCircle2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/features/auth/password-input";
import { authClient } from "@/lib/auth-client";
import { loginSchema } from "@/lib/validations";

export function LoginForm({
  nextPath,
  justVerified,
  initialEmail,
}: {
  nextPath?: string | null;
  justVerified?: boolean;
  initialEmail?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setUnverified(false);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setPending(true);
    try {
      const result = await authClient.signIn.email({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (result.error) {
        const code = (result.error as { code?: string }).code ?? "";
        const message = result.error.message ?? "";
        if (code === "EMAIL_NOT_VERIFIED" || /not verified/i.test(message)) {
          // The server also emails a fresh verification link
          // (sendOnSignIn), so the user can finish verifying now.
          setUnverified(true);
          return;
        }
        setError(message || "Sign-in failed. Check your email and password.");
        return;
      }
      // An explicit post-auth destination (e.g. an invitation link)
      // wins; otherwise route by workspace ownership: none →
      // onboarding, else dashboard.
      if (nextPath) {
        router.push(nextPath);
        router.refresh();
        return;
      }
      let destination = "/dashboard";
      try {
        const res = await fetch("/api/workspaces");
        if (res.ok) {
          const data: unknown = await res.json();
          const list =
            data && typeof data === "object" && "workspaces" in data
              ? (data as { workspaces: unknown[] }).workspaces
              : [];
          if (list.length === 0) destination = "/onboarding";
        }
      } catch {
        // Keep the dashboard default if the probe fails.
      }
      router.push(destination);
      router.refresh();
    } catch {
      setError("Something went wrong while signing in. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Welcome back to Unified Omnichannel Inbox.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          {justVerified ? (
            <p
              className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200"
              role="status"
            >
              <CheckCircle2 className="size-4 shrink-0" />
              Email verified — sign in to continue into your account.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                required
                defaultValue={initialEmail ?? ""}
                className="h-11 pl-10"
              />
            </div>
            {fieldErrors.email ? (
              <p className="text-destructive text-xs">{fieldErrors.email}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
            {fieldErrors.password ? (
              <p className="text-destructive text-xs">{fieldErrors.password}</p>
            ) : null}
          </div>
          {unverified ? (
            <p
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
              role="alert"
            >
              Your email address isn&apos;t verified yet. We&apos;ve just sent a fresh
              verification link to your inbox — click it, then sign in.
            </p>
          ) : null}
          {error ? (
            <p
              className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="h-11 w-full rounded-full font-semibold">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <Link
              href="/forgot-password"
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
            <Link
              href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : "/register"}
              className="text-primary font-medium underline-offset-4 hover:underline"
            >
              Create account
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
