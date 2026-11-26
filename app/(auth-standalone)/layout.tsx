import type { ReactNode } from "react";

import { AuthShell } from "@/features/auth/auth-shell";

/**
 * Same auth frame, but WITHOUT the signed-in bounce: pages here are
 * reached from email links (reset password) and must render for
 * whoever clicks — signed in or not. Bouncing a signed-in clicker to
 * the dashboard used to strand them on onboarding and eat the reset
 * token's page entirely (reported 2026-11-26).
 */
export default function AuthStandaloneLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
