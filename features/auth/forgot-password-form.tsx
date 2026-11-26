"use client";

import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, authButtonClass, authIconClass, authInputClass } from "@/features/auth/auth-card";
import { authClient } from "@/lib/auth-client";
import { forgotPasswordSchema } from "@/lib/validations";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
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
      setSentTo(parsed.data.email);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Forgot password"
      description="Enter the email you signed up with and we'll send you a secure link to reset your password."
    >
        {sentTo ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="bg-accent text-primary flex size-14 items-center justify-center rounded-full">
              <MailCheck className="size-7" />
            </span>
            <div>
              <p className="font-medium">Check your inbox</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                If an account exists for <span className="text-foreground font-medium">{sentTo}</span>,
                a password reset link is on its way. The link expires in 1 hour — and don&apos;t
                forget your spam folder.
              </p>
            </div>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/login">
                <ArrowLeft className="size-4" /> Back to sign in
              </Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <div className="group relative">
                <Mail className={authIconClass} />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  className={authInputClass}
                />
              </div>
            </div>
            {error ? (
              <p
                className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border px-3.5 py-2.5 text-sm"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className={authButtonClass}>
              {pending ? "Sending…" : "Send reset link"}
            </Button>
            <Link
              href="/login"
              className="text-muted-foreground text-center text-sm underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
    </AuthCard>
  );
}
