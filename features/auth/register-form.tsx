"use client";

import { ArrowRight, Mail, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard, authButtonClass, authIconClass, authInputClass } from "@/features/auth/auth-card";
import { PasswordInput } from "@/features/auth/password-input";
import { createVerificationWatch } from "@/features/auth/verification-watch-client";
import { authClient } from "@/lib/auth-client";
import { registerSchema } from "@/lib/validations";

export function RegisterForm({ nextPath }: { nextPath?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
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
      const result = await authClient.signUp.email({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (result.error) {
        setError(result.error.message ?? "Registration failed. Please try again.");
        return;
      }
      // Email verification is required before the account can be
      // used: the server has emailed a verification link, so send
      // the user to the check-your-inbox page. First plant a
      // verification watch in this browser, so that when the link
      // is clicked — on ANY device — this tab can sign itself in
      // automatically instead of falling back to the sign-in page.
      await createVerificationWatch(parsed.data.email);
      router.push(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
      router.refresh();
    } catch {
      setError("Something went wrong while creating your account. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function fieldError(name: string) {
    return fieldErrors[name] ? (
      <p className="text-destructive text-xs">{fieldErrors[name]}</p>
    ) : null;
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start managing every customer conversation from one inbox. We'll email you a verification link to activate your account."
    >
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Full name</Label>
          <div className="group relative">
            <User className={authIconClass} />
            <Input
              id="name"
              name="name"
              placeholder="Jeet Deula"
              autoComplete="name"
              required
              className={authInputClass}
            />
          </div>
          {fieldError("name")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Work email</Label>
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
          {fieldError("email")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required />
          {fieldError("password") ?? (
            <p className="text-muted-foreground text-xs">At least 8 characters.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
          />
          {fieldError("confirmPassword")}
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
          {pending ? "Creating account…" : "Create account"}
          {!pending ? <ArrowRight className="size-4" /> : null}
        </Button>
        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{" "}
          <Link
            href={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
            className="text-primary font-semibold underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
