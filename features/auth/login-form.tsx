"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { loginSchema } from "@/lib/validations";

export function LoginForm({ nextPath }: { nextPath?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
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
        setError(result.error.message ?? "Sign-in failed. Check your email and password.");
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
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to Unified Omnichannel Inbox.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="you@company.com" required />
            {fieldErrors.email ? (
              <p className="text-destructive text-xs">{fieldErrors.email}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required />
            {fieldErrors.password ? (
              <p className="text-destructive text-xs">{fieldErrors.password}</p>
            ) : null}
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="underline underline-offset-4">
              Forgot password?
            </Link>
            <Link
              href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : "/register"}
              className="underline underline-offset-4"
            >
              Create account
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
