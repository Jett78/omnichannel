"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Better Auth browser client. baseURL defaults to the current origin,
 * which is what we want — the handler is mounted at /api/auth.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, sendVerificationEmail, requestPasswordReset } =
  authClient;
