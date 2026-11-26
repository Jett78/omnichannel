"use client";

import { ArrowLeft, Mail, MailCheck } from "lucide-react";
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
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Forgot password</CardTitle>
        <CardDescription>
          Enter the email you signed up with and we&apos;ll send you a secure link to reset your
          password.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
              <div className="relative">
                <Mail className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  className="h-11 pl-10"
                />
              </div>
            </div>
            {error ? (
              <p
                className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="h-11 w-full rounded-full font-semibold">
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
      </CardContent>
    </Card>
  );
}
