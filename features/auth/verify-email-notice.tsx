"use client";

import { CheckCircle2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";

export function VerifyEmailNotice({ initialEmail }: { initialEmail?: string | null }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emailInput, setEmailInput] = useState(initialEmail ?? "");
  const [justVerified, setJustVerified] = useState(false);

  const sessionEmail = session?.user.email;
  const verified = (session?.user.emailVerified ?? false) || justVerified;
  const email = sessionEmail ?? emailInput;

  // Cross-device watch: the verification link is often clicked on
  // another device (e.g. the phone's mail app) while THIS tab stays
  // open. Poll the verification status and continue automatically —
  // no session exists yet, so a verified flip sends the user to the
  // sign-in page with a success banner; a signed-in session just
  // refreshes into the app.
  useEffect(() => {
    if (!email || verified) return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > 150) {
        clearInterval(timer);
        return;
      }
      void (async () => {
        try {
          const res = await fetch(
            `/api/auth/verification-status?email=${encodeURIComponent(email)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return;
          const data: unknown = await res.json();
          if (cancelled) return;
          if (data && typeof data === "object" && "verified" in data && data.verified === true) {
            clearInterval(timer);
            setJustVerified(true);
          }
        } catch {
          // A failed poll is not fatal — the next tick retries.
        }
      })();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, verified]);

  // Continue automatically once verification lands. This must live in
  // its own effect: when the timed navigation sat inside the polling
  // effect, flipping `verified` re-ran that effect and its cleanup
  // cancelled the pending redirect (found in live QA, 2026-11-26).
  useEffect(() => {
    if (!justVerified) return;
    const timer = setTimeout(() => {
      if (sessionEmail) {
        router.refresh();
      } else if (email) {
        router.push(`/login?verified=1&email=${encodeURIComponent(email)}`);
      }
    }, 1400);
    return () => clearTimeout(timer);
  }, [justVerified, sessionEmail, email, router]);

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
              {sessionEmail
                ? "Your email address is verified. You're all set."
                : "Your email address is verified. Taking you to sign in…"}
            </p>
          </div>
          <Button asChild className="rounded-full px-5">
            {sessionEmail ? (
              <Link href="/dashboard">Continue to your inbox</Link>
            ) : (
              <Link href={`/login?verified=1&email=${encodeURIComponent(email)}`}>
                Continue to sign in
              </Link>
            )}
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
        {email ? (
          <p className="text-muted-foreground flex items-center justify-center gap-2 text-center text-sm">
            <span className="relative flex size-2">
              <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" />
              <span className="bg-primary relative inline-flex size-2 rounded-full" />
            </span>
            Waiting for the click — this page continues on its own once you tap the link, on
            any device.
          </p>
        ) : null}
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
