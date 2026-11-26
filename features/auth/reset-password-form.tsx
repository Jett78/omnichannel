"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/features/auth/password-input";
import { authClient } from "@/lib/auth-client";
import { resetPasswordSchema } from "@/lib/validations";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    token ? null : "This reset link is missing its token. Request a new one.",
  );
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  // After a successful reset, continue to the sign-in page on its own
  // (with a banner there) — the button below is the manual fallback.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      router.push("/login?reset=1");
      router.refresh();
    }, 1600);
    return () => clearTimeout(timer);
  }, [done, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    const formData = new FormData(event.currentTarget);
    const parsed = resetPasswordSchema.safeParse({
      token,
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.resetPassword({
        token: parsed.data.token,
        newPassword: parsed.data.password,
      });
      if (result.error) {
        setError(result.error.message ?? "This reset link is invalid or has expired.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Reset password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <CheckCircle2 className="size-7" />
            </span>
            <div>
              <p className="font-medium">Password updated</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                Your password has been reset. Taking you to sign in with your new password…
              </p>
            </div>
            <Button asChild className="rounded-full px-5">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">New password</Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                required
                disabled={!token}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                required
                disabled={!token}
              />
            </div>
            {error ? (
              <p
                className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={pending || !token}
              className="h-11 w-full rounded-full font-semibold"
            >
              {pending ? "Resetting…" : "Reset password"}
            </Button>
            <Link
              href="/forgot-password"
              className="text-muted-foreground text-center text-sm underline-offset-4 hover:underline"
            >
              Request a new reset link
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
