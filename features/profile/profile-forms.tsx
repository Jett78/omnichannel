"use client";

import { BadgeCheck, Building2, CheckCircle2, LogOut, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/features/auth/password-input";
import { authClient } from "@/lib/auth-client";
import type { Role } from "@/generated/prisma/client";

export interface ProfileWorkspace {
  id: string;
  name: string;
  slug: string;
  role: Role | null;
  isActive: boolean;
}

const ROLE_BADGE: Record<Role, "info" | "success" | "secondary" | "warning"> = {
  OWNER: "info",
  ADMIN: "success",
  AGENT: "secondary",
  VIEWER: "warning",
};

/**
 * The dedicated /profile page (Jeet, 2026-11-26): personal info with a
 * REAL name save (Better Auth updateUser), the user's workspaces with
 * their role in each + one-click switch, a real password change
 * (revokes other sessions), and sign-out-everywhere-else. Email is
 * shown read-only — it is the sign-in identity and changing it needs
 * a verify-the-new-address flow that does not exist yet.
 */
export function ProfileForms({
  user,
  memberSinceLabel,
  workspaces,
}: {
  user: { name: string; email: string; image: string | null; emailVerified: boolean };
  memberSinceLabel: string;
  workspaces: ProfileWorkspace[];
}) {
  const router = useRouter();
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  async function onSaveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    setNameMessage(null);
    setNameError(null);
    if (name.length < 2) {
      setNameError("Please enter your name.");
      return;
    }
    setSavingName(true);
    try {
      const result = await authClient.updateUser({ name });
      if (result.error) {
        setNameError(result.error.message ?? "Could not save your name. Please try again.");
        return;
      }
      setNameMessage("Name saved.");
      router.refresh();
    } finally {
      setSavingName(false);
    }
  }

  async function onChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    setPasswordMessage(null);
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError("Your new password needs at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new password and its confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Your new password is the same as the current one.");
      return;
    }
    setChangingPassword(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setPasswordError(
          result.error.message ?? "Could not change your password. Check the current password.",
        );
        return;
      }
      form.reset();
      setPasswordMessage("Password changed. Other devices have been signed out.");
    } finally {
      setChangingPassword(false);
    }
  }

  async function onRevokeOtherSessions() {
    setSessionMessage(null);
    const result = await authClient.revokeOtherSessions();
    setSessionMessage(
      result.error
        ? "Could not sign out other devices. Please try again."
        : "All other devices have been signed out.",
    );
  }

  async function onSwitchWorkspace(workspaceId: string) {
    setSwitchingId(workspaceId);
    try {
      await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      router.push("/dashboard");
      router.refresh();
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Personal information</CardTitle>
          <CardDescription>How you appear to your teammates across every workspace.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <AvatarWithBadge name={user.name || user.email} image={user.image} size="lg" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate font-medium">{user.name}</p>
              <p className="text-muted-foreground truncate text-sm">{user.email}</p>
              <p className="text-muted-foreground mt-1 text-xs">Member since {memberSinceLabel}</p>
            </div>
            {user.emailVerified ? (
              <Badge variant="success">
                <BadgeCheck className="size-3" /> Email verified
              </Badge>
            ) : (
              <Badge variant="warning">Email not verified</Badge>
            )}
          </div>

          <form onSubmit={(e) => void onSaveName(e)} className="flex flex-col gap-2">
            <Label htmlFor="profile-name">Display name</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="profile-name"
                name="name"
                defaultValue={user.name}
                autoComplete="name"
                className="min-w-56 flex-1"
                required
              />
              <Button type="submit" disabled={savingName}>
                {savingName ? "Saving…" : "Save name"}
              </Button>
            </div>
            {nameMessage ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" /> {nameMessage}
              </p>
            ) : null}
            {nameError ? (
              <p className="text-destructive flex items-center gap-1.5 text-sm" role="alert">
                <TriangleAlert className="size-4" /> {nameError}
              </p>
            ) : null}
          </form>

          <div className="flex flex-col gap-2 border-t pt-4">
            <Label htmlFor="profile-email">Email address</Label>
            <Input id="profile-email" value={user.email} readOnly disabled />
            <p className="text-muted-foreground text-xs">
              Your email is your sign-in identity, so it can&apos;t be changed here.{" "}
              {!user.emailVerified ? (
                <>
                  It isn&apos;t verified yet —{" "}
                  <Link href="/verify-email" className="text-primary font-medium hover:underline">
                    verify it now
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My workspaces</CardTitle>
          <CardDescription>Every workspace you belong to, and your role in each.</CardDescription>
        </CardHeader>
        <CardContent>
          {workspaces.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You don&apos;t belong to any workspace yet.{" "}
              <Link href="/onboarding" className="text-primary font-medium hover:underline">
                Create your first workspace
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y">
              {workspaces.map((workspace) => (
                <li key={workspace.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="bg-accent text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Building2 className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-medium">{workspace.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      /{workspace.slug}
                    </span>
                  </span>
                  {workspace.role ? (
                    <Badge variant={ROLE_BADGE[workspace.role]}>{workspace.role}</Badge>
                  ) : null}
                  {workspace.isActive ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={switchingId !== null}
                      onClick={() => void onSwitchWorkspace(workspace.id)}
                    >
                      {switchingId === workspace.id ? "Switching…" : "Switch"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Change your password. You&apos;ll stay signed in here; every other device is signed
            out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void onChangePassword(e)}
            className="flex max-w-md flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="current-password">Current password</Label>
              <PasswordInput
                id="current-password"
                name="currentPassword"
                required
                autoComplete="current-password"
                placeholder="Your current password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">New password</Label>
              <PasswordInput
                id="new-password"
                name="newPassword"
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <PasswordInput
                id="confirm-password"
                name="confirmPassword"
                required
                autoComplete="new-password"
                placeholder="Repeat the new password"
              />
            </div>
            {passwordMessage ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" /> {passwordMessage}
              </p>
            ) : null}
            {passwordError ? (
              <p className="text-destructive flex items-center gap-1.5 text-sm" role="alert">
                <TriangleAlert className="size-4" /> {passwordError}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={changingPassword}>
                {changingPassword ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Signed in on a device you don&apos;t recognise?</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <Button variant="outline" onClick={() => void onRevokeOtherSessions()}>
            <LogOut className="size-4" /> Sign out of all other devices
          </Button>
          {sessionMessage ? <p className="text-sm">{sessionMessage}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
