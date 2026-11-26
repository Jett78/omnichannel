import { createHash } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

/**
 * Cross-device auto-login for email verification ("verification watch").
 *
 * The problem: a user signs up on their laptop, but taps the
 * verification link in the mail app on their phone. The phone gets a
 * session (autoSignInAfterVerification), while the laptop tab — which
 * never held a session or the password — could only fall back to the
 * sign-in page. Other apps solve this by letting the ORIGINAL tab
 * sign itself in once verification lands.
 *
 * How: at sign-up the browser generates a random watch id, keeps it
 * in localStorage, and registers its SHA-256 hash here, bound to the
 * email. The check-your-inbox page polls the verification status;
 * when the account flips to verified it exchanges the watch id for a
 * real session (single-use, 1-hour expiry). Security rests on two
 * independent factors: the unguessable watch id that never leaves
 * the signing-up browser, and proof of inbox access (the account
 * must actually become verified before an exchange can succeed).
 */
const bodySchema = z.object({
  email: z.email().max(254),
  watchId: z.string().min(16).max(128),
});

const identifierFor = (email: string) => `verify-watch:${email}`;
const hashWatchId = (watchId: string) => createHash("sha256").update(watchId).digest("hex");
const WATCH_TTL_MS = 60 * 60 * 1000;

export const verificationWatch = (): BetterAuthPlugin => ({
  id: "verification-watch",
  endpoints: {
    registerWatch: createAuthEndpoint(
      "/verification-watch/register",
      { method: "POST", body: bodySchema },
      async (ctx) => {
        const email = ctx.body.email.toLowerCase();
        const found = await ctx.context.internalAdapter.findUserByEmail(email);
        const user = found?.user ?? null;
        if (user && !user.emailVerified) {
          // One live watch per account: clear any previous one first.
          await ctx.context.internalAdapter
            .consumeVerificationValue(identifierFor(email))
            .catch(() => null);
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: identifierFor(email),
            value: hashWatchId(ctx.body.watchId),
            expiresAt: new Date(Date.now() + WATCH_TTL_MS),
          });
        }
        // Same answer whether or not the account exists, so this
        // endpoint cannot be used to enumerate registered emails.
        return ctx.json({ ok: true });
      },
    ),
    exchangeWatch: createAuthEndpoint(
      "/verification-watch/exchange",
      { method: "POST", body: bodySchema },
      async (ctx) => {
        const email = ctx.body.email.toLowerCase();
        const found = await ctx.context.internalAdapter.findUserByEmail(email);
        const user = found?.user ?? null;
        if (!user || !user.emailVerified) {
          throw ctx.error("BAD_REQUEST", { message: "Account is not verified yet." });
        }
        // consume = read + delete in one step: the watch is single-use.
        const record = await ctx.context.internalAdapter.consumeVerificationValue(
          identifierFor(email),
        );
        if (
          !record ||
          record.expiresAt < new Date() ||
          record.value !== hashWatchId(ctx.body.watchId)
        ) {
          throw ctx.error("BAD_REQUEST", { message: "Invalid or expired watch." });
        }
        const session = await ctx.context.internalAdapter.createSession(user.id, false);
        if (!session) {
          throw ctx.error("INTERNAL_SERVER_ERROR", { message: "Could not create a session." });
        }
        await setSessionCookie(ctx, { session, user }, false);
        return ctx.json({ ok: true });
      },
    ),
  },
});
