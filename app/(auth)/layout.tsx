import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AuthShell } from "@/features/auth/auth-shell";
import { getCurrentUser } from "@/lib/auth";

/**
 * Auth pages a signed-in user should never see: send them into the
 * app instead. (Reset-password is NOT in this group — its email link
 * must reach the form even when a session exists; see
 * app/(auth-standalone).)
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return <AuthShell>{children}</AuthShell>;
}
