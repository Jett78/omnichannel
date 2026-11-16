"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { forgotPasswordSchema } from "@/lib/validations";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.requestPasswordReset({
        email: parsed.data.email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        setError(result.error.message ?? "Could not start the password reset.");
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send a reset link. In development the link is printed to
          the server console (dev mailer).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              If an account exists for that email, a password reset link is on its way. Check the
              server console in development.
            </p>
            <Link href="/login" className="text-sm underline underline-offset-4">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@company.com" required />
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Sending…" : "Send reset link"}
            </Button>
            <Link href="/login" className="text-center text-sm underline underline-offset-4">
              Back to sign in
            </Link>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
