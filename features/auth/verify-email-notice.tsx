"use client";

import { CheckCircle2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, authButtonClass, authIconClass, authInputClass } from "@/features/auth/auth-card";
import {
  clearVerificationWatch,
  exchangeVerificationWatch,
  readVerificationWatch,
  registerVerificationWatch,
} from "@/features/auth/verification-watch-client";
import { authClient, useSession } from "@/lib/auth-client";

export function VerifyEmailNotice({ initialEmail }: { initialEmail?: string | null }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emailInput, setEmailInput] = useState(initialEmail ?? "");
  const [justVerified, setJustVerified] = useState(false);
  const [watchId, setWatchId] = useState<string | null>(null);

  const sessionEmail = session?.user.email;
  const verified = (session?.user.emailVerified ?? false) || justVerified;
  const email = sessionEmail ?? emailInput;

  // Pick up the verification watch planted at sign-up (this browser
  // only) and re-register it, so an exchange is possible the moment
  // verification lands — and so a stale or overwritten registration
  // heals itself while this page is open.
  useEffect(() => {
    if (!email || verified) return;
    const stored = readVerificationWatch(email);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatchId(stored);
    if (stored) void registerVerificationWatch(email, stored);
  }, [email, verified]);

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
  }, [email, verified]);

  // Continue automatically once verification lands. This must live in
  // its own effect: when the timed navigation sat inside the polling
  // effect, flipping `verified` re-ran that effect and its cleanup
  // cancelled the pending redirect (found in live QA, 2026-11-26).
  // With a verification watch, this tab exchanges it for a session
  // and goes straight into the app — no sign-in step. Without one
  // (a browser that didn't start the sign-up), the fallbacks are a
  // session refresh (the click happened in this browser) or the
  // prefilled sign-in page.
  useEffect(() => {
    if (!justVerified) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (watchId && email) {
          const exchanged = await exchangeVerificationWatch(email, watchId);
          if (cancelled) return;
          if (exchanged) {
            clearVerificationWatch();
            router.push("/dashboard");
            router.refresh();
            return;
          }
        }
        if (cancelled) return;
        if (sessionEmail) {
          router.refresh();
        } else if (email) {
          router.push(`/login?verified=1&email=${encodeURIComponent(email)}`);
        }
      })();
    }, 1400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [justVerified, watchId, sessionEmail, email, router]);

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
      <AuthCard
        title="Email verified"
        description={
          sessionEmail || watchId
            ? "Your email address is verified. Signing you in…"
            : "Your email address is verified. Taking you to sign in…"
        }
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <CheckCircle2 className="size-7" />
          </span>
          <Button asChild className="rounded-full px-5">
            {sessionEmail || watchId ? (
              <Link href="/dashboard">Continue to your inbox</Link>
            ) : (
              <Link href={`/login?verified=1&email=${encodeURIComponent(email)}`}>
                Continue to sign in
              </Link>
            )}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Verify your email"
      description={
        email ? (
          <>
            We sent a verification link to{" "}
            <span className="text-foreground font-medium">{email}</span>. Click it to activate your
            account — the link expires in 1 hour.
          </>
        ) : (
          "Enter your email and we'll send you a verification link to activate your account."
        )
      }
    >
      <div className="flex flex-col gap-4">
        {!sessionEmail && !initialEmail ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="verify-email">Email</Label>
            <div className="group relative">
              <Mail className={authIconClass} />
              <Input
                id="verify-email"
                type="email"
                placeholder="you@company.com"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                className={authInputClass}
              />
            </div>
          </div>
        ) : null}
        <Button onClick={() => void onResend()} disabled={pending} className={authButtonClass}>
          {pending ? "Sending…" : "Resend verification email"}
        </Button>
        {message ? <p className="text-center text-sm">{message}</p> : null}
        {email ? (
          <p className="text-muted-foreground flex items-center justify-center gap-2 text-center text-sm">
            <span className="relative flex size-2">
              <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" />
              <span className="bg-primary relative inline-flex size-2 rounded-full" />
            </span>
            Waiting for the click — this page continues on its own once you tap the link, on any
            device.
          </p>
        ) : null}
        <p className="text-muted-foreground text-center text-sm">
          Already verified?{" "}
          <Link
            href="/login"
            className="text-primary font-semibold underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
