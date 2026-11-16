import { createHash, randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { decryptText, encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { scheduleTokenRefreshJob } from "@/lib/token-refresh";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { getXConfig } from "@/integrations/x/x-config";
import { X_SCOPES, XProvider, xProvider } from "@/integrations/x/x-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { Channel, OAuthConnectionSession, Prisma } from "@/generated/prisma/client";

/**
 * X connection service (Phase 8) — the OAuth hand-off between the
 * dashboard and the X provider, following the Phase 5 session
 * pattern:
 *
 *  1. startXConnect: creates an OAuthConnectionSession (state hash
 *     only; the raw state goes to the browser as an httpOnly cookie)
 *     whose ENCRYPTED payload holds the PKCE code verifier — it never
 *     leaves the server. Returns X's authorization URL.
 *  2. handleXCallback: looks the session up by state hash, verifies
 *     it belongs to the signed-in user, exchanges the code with the
 *     stored verifier (X codes expire in 30 seconds — the exchange
 *     happens immediately), resolves the account via /users/me, and
 *     creates/updates the Channel with tokens stored ENCRYPTED via
 *     the channel-credential service. Unlike Meta there is no
 *     account picker: one authorization = one X account.
 *  3. When the operator registered a webhook (X_WEBHOOK_ID set), the
 *     account's X Activity API subscriptions (dm.received, dm.sent)
 *     are created best-effort and their ids stored in the channel
 *     config for disconnect; failures are recorded and reported,
 *     never hidden — the channel still connects (history/send work
 *     via REST), but the config says the webhook subscription failed.
 *
 * Provider instances are injectable (tests pass a provider backed by
 * a labelled HTTP test double); production uses the real singleton.
 */

export interface XConnectionDeps {
  x?: XProvider;
}

interface XSessionData {
  codeVerifier: string;
}

export interface XConnectResult {
  channel: Channel;
  subscriptionWarning?: string;
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const EMPTY_PAYLOAD = "{}";

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function loadCallbackSession(
  actorUserId: string,
  state: string,
): Promise<OAuthConnectionSession> {
  const session = await prisma.oAuthConnectionSession.findUnique({
    where: { stateHash: hashState(state) },
  });
  if (!session || session.provider !== "X") {
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

function parseSessionData(session: OAuthConnectionSession): XSessionData {
  try {
    const parsed = JSON.parse(decryptText(session.encryptedData)) as XSessionData;
    if (!parsed || typeof parsed.codeVerifier !== "string" || parsed.codeVerifier.length === 0) {
      throw new Error("empty session payload");
    }
    return parsed;
  } catch {
    throw AppError.badRequest(
      "This connection session has no PKCE data. Start the connect flow again.",
    );
  }
}

async function consumeSession(sessionId: string): Promise<void> {
  await prisma.oAuthConnectionSession.update({
    where: { id: sessionId },
    data: { consumedAt: new Date(), encryptedData: encryptText(EMPTY_PAYLOAD) },
  });
}

export const xConnectionService = {
  async startXConnect(
    actorUserId: string,
    workspaceId: string,
    deps: XConnectionDeps = {},
  ): Promise<{ authUrl: string; state: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    getXConfig(); // throws a 503 naming the missing env vars
    const provider = deps.x ?? xProvider;

    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
    const state = randomBytes(32).toString("hex");
    const sessionData: XSessionData = { codeVerifier };
    await prisma.oAuthConnectionSession.create({
      data: {
        workspaceId,
        userId: actorUserId,
        provider: "X",
        stateHash: hashState(state),
        encryptedData: encryptText(JSON.stringify(sessionData)),
        scopes: [...X_SCOPES],
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { authUrl: provider.buildAuthUrl(state, codeChallenge), state };
  },

  async handleXCallback(
    actorUserId: string,
    state: string,
    code: string,
    deps: XConnectionDeps = {},
  ): Promise<XConnectResult> {
    const session = await loadCallbackSession(actorUserId, state);
    const data = parseSessionData(session);
    const provider = deps.x ?? xProvider;
    const workspaceId = session.workspaceId;

    const tokens = await provider.exchangeCodeForTokens(code, data.codeVerifier);
    const profile = await provider.getOwnProfile(tokens.accessToken);

    const baseConfig: Record<string, unknown> = {
      authModel: "oauth2-pkce",
      username: profile.username,
      ...(profile.profileImageUrl ? { profileImageUrl: profile.profileImageUrl } : {}),
    };

    const channel = await prisma.channel.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: "X",
          externalAccountId: profile.id,
        },
      },
      create: {
        workspaceId,
        provider: "X",
        externalAccountId: profile.id,
        displayName: profile.name,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
      update: {
        displayName: profile.name,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
    });

    await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}),
      scopes: tokens.scopes.length > 0 ? tokens.scopes : [...X_SCOPES],
    });
    // X access tokens live 2 hours and refresh tokens ROTATE — arm
    // the token-refresh chain (workers/processors/token-refresh).
    // Best-effort: a queue hiccup must not fail a completed connect;
    // the processor also re-arms whenever it runs.
    if (tokens.expiresAt) {
      try {
        await scheduleTokenRefreshJob(channel.id, workspaceId, tokens.expiresAt);
      } catch (error) {
        console.warn(
          `[x] could not schedule token refresh for channel ${channel.id}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    // X Activity API subscriptions — best effort, honestly recorded.
    // Without a registered webhook id there is nothing to subscribe
    // against; the config records "skipped" so the state is visible
    // rather than silently absent.
    const config = getXConfig();
    let subscriptionWarning: string | undefined;
    let webhookSubscription: Record<string, unknown>;
    let xaaSubscriptionIds: string[] = [];
    if (!config.webhookId) {
      webhookSubscription = {
        status: "skipped",
        reason:
          "X_WEBHOOK_ID is not set on this deployment — register the webhook (docs/X-ACCESS.md) and reconnect to enable real-time DM delivery.",
      };
    } else {
      try {
        for (const eventType of ["dm.received", "dm.sent"] as const) {
          const id = await provider.createActivitySubscription(tokens.accessToken, {
            userId: profile.id,
            webhookId: config.webhookId,
            eventType,
          });
          xaaSubscriptionIds.push(id);
        }
        webhookSubscription = { status: "subscribed", at: new Date().toISOString() };
      } catch (error) {
        subscriptionWarning =
          error instanceof Error ? error.message : "X Activity subscription failed";
        webhookSubscription = { status: "failed", error: subscriptionWarning };
        xaaSubscriptionIds = [];
      }
    }

    const saved = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        config: {
          ...baseConfig,
          webhookSubscription,
          ...(xaaSubscriptionIds.length > 0 ? { xaaSubscriptionIds } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    await consumeSession(session.id);
    return { channel: saved, ...(subscriptionWarning ? { subscriptionWarning } : {}) };
  },
};
