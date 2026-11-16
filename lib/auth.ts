import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { headers } from "next/headers";

import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { sendResetPasswordEmail, sendVerificationEmail } from "@/lib/mail";
import { getPrisma } from "@/lib/prisma";

/**
 * Better Auth server instance (Phase 2).
 *
 * - Database sessions via the Prisma adapter (PostgreSQL).
 * - Email + password auth. Email verification is wired (mail is logged
 *   by the dev mailer) and sent on sign-up, but NOT required to sign in
 *   during development so seeded/demo accounts can log in immediately.
 * - Password reset uses Better Auth's token flow; the reset URL is
 *   delivered through lib/mail.ts.
 */
const env = getEnv();

export const auth = betterAuth({
  appName: "Unified Omnichannel Inbox",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.APP_URL, env.BETTER_AUTH_URL],
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail(user.email, url);
    },
    onPasswordReset: async ({ user }) => {
      console.log(`[auth] Password reset completed for ${user.email}`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url);
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh session once per day
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
});

export type AuthSession = typeof auth.$Infer.Session;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
}

/** Current signed-in user from the request session, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
    image: session.user.image ?? null,
  };
}

/** Like getCurrentUser, but throws 401 when unauthenticated. */
export async function requireCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw AppError.unauthorized("You must be signed in");
  return user;
}

/** Full session (user + session record) for API route handlers. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
