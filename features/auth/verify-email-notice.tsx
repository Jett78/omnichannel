"use client";

import { CheckCircle2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";

export function VerifyEmailNotice({ initialEmail }: { initialEmail?: string | null }) {
  const { data: session } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emailInput, setEmailInput] = useState(initialEmail ?? "");

  const sessionEmail = session?.user.email;
  const verified = session?.user.emailVerified ?? false;
  const email = sessionEmail ?? emailInput;

  async function onResend() {
    if (!email) {
      setMessage("Enter your email address first.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/dashboard",
      });
      setMessage(
        result.error
          ? (result.error.message ?? "Could not resend the verification email.")
          : "Verification email sent. Check your inbox (and spam folder).",
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (verified) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <CheckCircle2 className="size-7" />
          </span>
          <div>
            <p className="font-medium">Email verified</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Your email address is verified. You&apos;re all set.
            </p>
          </div>
          <Button asChild className="rounded-full px-5">
            <Link href="/dashboard">Continue to your inbox</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <span className="bg-accent text-primary mx-auto flex size-14 items-center justify-center rounded-full">
          <MailCheck className="size-7" />
        </span>
        <CardTitle className="text-xl">Verify your email</CardTitle>
        <CardDescription>
          {email ? (
            <>
              We sent a verification link to{" "}
              <span className="text-foreground font-medium">{email}</span>. Click it to activate
              your account — the link expires in 1 hour.
            </>
          ) : (
            "Enter your email and we'll send you a verification link to activate your account."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!sessionEmail && !initialEmail ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="verify-email">Email</Label>
            <Input
              id="verify-email"
              type="email"
              placeholder="you@company.com"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              className="h-11"
            />
          </div>
        ) : null}
        <Button
          onClick={() => void onResend()}
          disabled={pending}
          className="h-11 w-full rounded-full font-semibold"
        >
          {pending ? "Sending…" : "Resend verification email"}
        </Button>
        {message ? <p className="text-center text-sm">{message}</p> : null}
        <p className="text-muted-foreground text-center text-sm">
          Already verified?{" "}
          <Link href="/login" className="text-primary font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
