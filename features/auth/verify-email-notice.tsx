"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";

export function VerifyEmailNotice() {
  const { data: session } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emailInput, setEmailInput] = useState("");

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
          : "Verification email sent — in development it is printed to the server console.",
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          {verified
            ? "Your email address is verified. You're all set."
            : "We sent a verification link when you signed up. In development the link is printed to the server console (dev mailer) instead of a real inbox."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!verified ? (
          <>
            {sessionEmail ? (
              <p className="text-sm">
                Signed in as <span className="font-medium">{sessionEmail}</span> — not verified yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="verify-email">Email</Label>
                <Input
                  id="verify-email"
                  type="email"
                  placeholder="you@company.com"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                />
              </div>
            )}
            <Button onClick={() => void onResend()} disabled={pending}>
              {pending ? "Sending…" : "Resend verification email"}
            </Button>
          </>
        ) : null}
        {message ? <p className="text-sm">{message}</p> : null}
        <Link href="/dashboard" className="text-sm underline underline-offset-4">
          Continue to the dashboard
        </Link>
      </CardContent>
    </Card>
  );
}
