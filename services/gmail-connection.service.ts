import { createHash, randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { scheduleTokenRefreshJob } from "@/lib/token-refresh";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { getGmailConfig } from "@/integrations/gmail/gmail-config";
import { GMAIL_SCOPES, GmailProvider, gmailProvider } from "@/integrations/gmail/gmail-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { Channel, OAuthConnectionSession, Prisma } from "@/generated/prisma/client";

/**
 * Gmail connection service (Phase 9) — the OAuth hand-off between the
 * dashboard and the Gmail provider, following the Phase 5/8 session
 * pattern:
 *
 *  1. startGmailConnect: creates an OAuthConnectionSession (state
 *     hash only; the raw state goes to the browser as an httpOnly
 *     cookie) and returns Google's authorization URL. Google is a
 *     confidential client (client secret), so no PKCE payload is
 *     needed in the session.
 *  2. handleGmailCallback: looks the session up by state hash,
 *     verifies it belongs to the signed-in user, exchanges the code,
 *     resolves the mailbox via users/me/profile, and creates/updates
 *     the Channel (externalAccountId = the mailbox address) with
 *     tokens stored ENCRYPTED via the channel-credential service.
 *     One authorization = one mailbox, so there is no picker step.
 *  3. The profile's current historyId is stored in the channel
 *     config as the polling baseline — the inbox receives mail that
 *     arrives AFTER the connect, not the mailbox's past (a one-time
 *     "Import recent chats" backfill is available on the channel).
 *  4. The token-refresh chain is armed (Gmail access tokens live
 *     ~1 hour and the stored refresh token is exchanged by the
 *     worker); the poller also refreshes lazily on a 401.
 */

export interface GmailConnectionDeps {
  gmail?: GmailProvider;
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const EMPTY_PAYLOAD = "{}";

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

async function loadCallbackSession(
  actorUserId: string,
  state: string,
): Promise<OAuthConnectionSession> {
  const session = await prisma.oAuthConnectionSession.findUnique({
    where: { stateHash: hashState(state) },
  });
  if (!session || session.provider !== "GMAIL") {
    throw AppError.badRequest("Unknown connection session (state mismatch). Start again.");
  }
  if (session.userId !== actorUserId) {
    throw AppError.forbidden("This connection session belongs to a different user.");
  }
  if (session.consumedAt) {
    throw AppError.badRequest("This connection session has already been used. Start again.");
  }
  if (session.expiresAt.getTime() < Date.now()) {
    throw AppError.badRequest("This connection session has expired. Start again.");
  }
  return session;
}

async function consumeSession(sessionId: string): Promise<void> {
  await prisma.oAuthConnectionSession.update({
    where: { id: sessionId },
    data: { consumedAt: new Date(), encryptedData: encryptText(EMPTY_PAYLOAD) },
  });
}

export const gmailConnectionService = {
  async startGmailConnect(
    actorUserId: string,
    workspaceId: string,
    deps: GmailConnectionDeps = {},
  ): Promise<{ authUrl: string; state: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    getGmailConfig(); // throws a 503 naming the missing env vars
    const provider = deps.gmail ?? gmailProvider;

    const state = randomBytes(32).toString("hex");
    await prisma.oAuthConnectionSession.create({
      data: {
        workspaceId,
        userId: actorUserId,
        provider: "GMAIL",
        stateHash: hashState(state),
        encryptedData: encryptText(EMPTY_PAYLOAD),
        scopes: [...GMAIL_SCOPES],
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { authUrl: provider.buildAuthUrl(state), state };
  },

  async handleGmailCallback(
    actorUserId: string,
    state: string,
    code: string,
    deps: GmailConnectionDeps = {},
  ): Promise<{ channel: Channel }> {
    const session = await loadCallbackSession(actorUserId, state);
    const provider = deps.gmail ?? gmailProvider;
    const workspaceId = session.workspaceId;

    const tokens = await provider.exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      throw AppError.badRequest(
        "Google did not return a refresh token, so the mailbox would disconnect within an hour. Start again — the consent screen must grant offline access.",
      );
    }
    const profile = await provider.getOwnProfile(tokens.accessToken);
    const email = profile.email.toLowerCase();

    const config: Record<string, unknown> = {
      authModel: "google-oauth",
      email,
      // Polling baseline: only mail arriving after the connect is
      // ingested (history import is the explicit backfill path).
      ...(profile.historyId ? { gmailHistoryId: profile.historyId } : {}),
    };

    const channel = await prisma.channel.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: "GMAIL",
          externalAccountId: email,
        },
      },
      create: {
        workspaceId,
        provider: "GMAIL",
        externalAccountId: email,
        displayName: profile.email,
        status: "CONNECTED",
        config: config as Prisma.InputJsonValue,
      },
      update: {
        displayName: profile.email,
        status: "CONNECTED",
        config: config as Prisma.InputJsonValue,
      },
    });

    await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}),
      scopes: tokens.scopes.length > 0 ? tokens.scopes : [...GMAIL_SCOPES],
    });
    if (tokens.expiresAt) {
      try {
        await scheduleTokenRefreshJob(channel.id, workspaceId, tokens.expiresAt);
      } catch (error) {
        console.warn(
          `[gmail] could not schedule token refresh for channel ${channel.id}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    await consumeSession(session.id);
    return { channel };
  },
};
