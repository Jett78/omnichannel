import { createHash, randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { decryptText, encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceMembership, requireWorkspacePermission } from "@/lib/workspace-auth";
import {
  FACEBOOK_SCOPES,
  FacebookProvider,
  facebookProvider,
  type MetaPageAccount,
} from "@/integrations/meta/facebook-provider";
import {
  INSTAGRAM_SCOPES,
  InstagramProvider,
  instagramProvider,
  type MetaInstagramAccount,
} from "@/integrations/meta/instagram-provider";
import { getFacebookConfig, getInstagramConfig } from "@/integrations/meta/meta-config";
import {
  WhatsAppProvider,
  whatsappProvider,
  type WhatsAppPhoneNumber,
} from "@/integrations/whatsapp/whatsapp-provider";
import { XProvider, xProvider } from "@/integrations/x/x-provider";
import type { ChannelContext } from "@/integrations/types";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { Channel, OAuthConnectionSession, Prisma } from "@/generated/prisma/client";

/**
 * Meta connection service (Phase 5) — the OAuth hand-off between the
 * dashboard and the Meta providers.
 *
 * Flow (Facebook and Instagram alike):
 *  1. start*Connect: creates an OAuthConnectionSession (state hash
 *     only; the raw state goes to the browser as an httpOnly cookie)
 *     and returns the provider authorization URL.
 *  2. handle*Callback: the OAuth callback looks the session up by
 *     state hash, verifies it belongs to the signed-in user, exchanges
 *     the code, and stores the resulting tokens + selectable accounts
 *     ENCRYPTED in the session row.
 *  3. getConnectionSession: returns SANITIZED account metadata only —
 *     tokens never leave the server.
 *  4. select*: creates/updates the Channel, stores the account token
 *     via the encrypted credential service, subscribes the account to
 *     webhooks, then consumes the session and wipes its payload.
 *  5. disconnectChannel: best-effort provider unsubscribe, credential
 *     deletion, channel marked DISCONNECTED. History is kept.
 *
 * Provider instances are injectable (tests pass providers backed by a
 * labelled HTTP test double); production uses the real singletons.
 */

export interface MetaConnectionDeps {
  facebook?: FacebookProvider;
  instagram?: InstagramProvider;
  whatsapp?: WhatsAppProvider;
  x?: XProvider;
}

interface FacebookSessionData {
  userAccessToken: string;
  userTokenExpiresAt: string | null;
  pages: MetaPageAccount[];
}

interface InstagramSessionData {
  accessToken: string;
  expiresAt: string | null;
  account: MetaInstagramAccount;
}

/** Written by services/whatsapp-connection.service.ts (Embedded Signup). */
interface WhatsAppSessionData {
  accessToken: string;
  waba: { id: string; name: string };
  phoneNumbers: WhatsAppPhoneNumber[];
}

/** Account metadata safe to send to the browser — never contains tokens. */
export interface SanitizedConnectionAccount {
  externalAccountId: string;
  displayName: string;
  detail?: string;
  eligible: boolean;
  ineligibleReason?: string;
  instagramAccount?: { id: string; username?: string };
}

export interface ConnectionSessionView {
  sessionId: string;
  provider: OAuthConnectionSession["provider"];
  expiresAt: Date;
  accounts: SanitizedConnectionAccount[];
}

export interface SelectResult {
  channel: Channel;
  subscriptionWarning?: string;
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const EMPTY_PAYLOAD = "{}";

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

async function createSession(
  actorUserId: string,
  workspaceId: string,
  provider: "FACEBOOK" | "INSTAGRAM",
  scopes: readonly string[],
): Promise<string> {
  const state = randomBytes(32).toString("hex");
  await prisma.oAuthConnectionSession.create({
    data: {
      workspaceId,
      userId: actorUserId,
      provider,
      stateHash: hashState(state),
      encryptedData: encryptText(EMPTY_PAYLOAD),
      scopes: [...scopes],
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return state;
}

/** Load a session for select/read operations: owner-only, unconsumed, unexpired. */
async function loadUsableSession(
  actorUserId: string,
  workspaceId: string,
  sessionId: string,
): Promise<OAuthConnectionSession> {
  const session = await prisma.oAuthConnectionSession.findFirst({
    where: { id: sessionId, workspaceId },
  });
  if (!session || session.userId !== actorUserId) {
    throw AppError.notFound("Connection session not found");
  }
  if (session.consumedAt) {
    throw AppError.badRequest(
      "This connection session has already been used. Start the connect flow again.",
    );
  }
  if (session.expiresAt.getTime() < Date.now()) {
    throw AppError.badRequest("This connection session has expired. Start the connect flow again.");
  }
  return session;
}

async function loadCallbackSession(
  actorUserId: string,
  state: string,
  provider: "FACEBOOK" | "INSTAGRAM",
): Promise<OAuthConnectionSession> {
  const session = await prisma.oAuthConnectionSession.findUnique({
    where: { stateHash: hashState(state) },
  });
  if (!session || session.provider !== provider) {
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

function parseSessionData<T>(session: OAuthConnectionSession): T | null {
  try {
    const parsed = JSON.parse(decryptText(session.encryptedData)) as unknown;
    if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

async function consumeSession(sessionId: string): Promise<void> {
  await prisma.oAuthConnectionSession.update({
    where: { id: sessionId },
    data: { consumedAt: new Date(), encryptedData: encryptText(EMPTY_PAYLOAD) },
  });
}

async function storeSessionData(sessionId: string, data: unknown): Promise<void> {
  await prisma.oAuthConnectionSession.update({
    where: { id: sessionId },
    data: { encryptedData: encryptText(JSON.stringify(data)) },
  });
}

export const metaConnectionService = {
  // ─── Start ────────────────────────────────────────────────────────────────

  async startFacebookConnect(
    actorUserId: string,
    workspaceId: string,
    deps: MetaConnectionDeps = {},
  ): Promise<{ authUrl: string; state: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    getFacebookConfig(); // throws a 503 naming the missing env vars
    const provider = deps.facebook ?? facebookProvider;
    const state = await createSession(actorUserId, workspaceId, "FACEBOOK", FACEBOOK_SCOPES);
    return { authUrl: provider.buildAuthUrl(state), state };
  },

  async startInstagramConnect(
    actorUserId: string,
    workspaceId: string,
    deps: MetaConnectionDeps = {},
  ): Promise<{ authUrl: string; state: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    getInstagramConfig(); // throws a 503 naming the missing env vars
    const provider = deps.instagram ?? instagramProvider;
    const state = await createSession(actorUserId, workspaceId, "INSTAGRAM", INSTAGRAM_SCOPES);
    return { authUrl: provider.buildAuthUrl(state), state };
  },

  // ─── Callbacks ────────────────────────────────────────────────────────────

  async handleFacebookCallback(
    actorUserId: string,
    state: string,
    code: string,
    deps: MetaConnectionDeps = {},
  ): Promise<{ sessionId: string; workspaceId: string }> {
    const session = await loadCallbackSession(actorUserId, state, "FACEBOOK");
    const provider = deps.facebook ?? facebookProvider;
    const shortLived = await provider.exchangeCodeForUserToken(code);
    const longLived = await provider.exchangeLongLivedUserToken(shortLived.accessToken);
    const pages = await provider.listAccessiblePages(longLived.accessToken);
    const data: FacebookSessionData = {
      userAccessToken: longLived.accessToken,
      userTokenExpiresAt: longLived.expiresAt?.toISOString() ?? null,
      pages,
    };
    await storeSessionData(session.id, data);
    return { sessionId: session.id, workspaceId: session.workspaceId };
  },

  async handleInstagramCallback(
    actorUserId: string,
    state: string,
    code: string,
    deps: MetaConnectionDeps = {},
  ): Promise<{ sessionId: string; workspaceId: string }> {
    const session = await loadCallbackSession(actorUserId, state, "INSTAGRAM");
    const provider = deps.instagram ?? instagramProvider;
    const account = await provider.authorizeWithCode(code);
    const data: InstagramSessionData = {
      accessToken: account.accessToken,
      expiresAt: account.expiresAt?.toISOString() ?? null,
      account,
    };
    await storeSessionData(session.id, data);
    return { sessionId: session.id, workspaceId: session.workspaceId };
  },

  // ─── Read (sanitized) ─────────────────────────────────────────────────────

  async getConnectionSession(
    actorUserId: string,
    workspaceId: string,
    sessionId: string,
  ): Promise<ConnectionSessionView> {
    await requireWorkspaceMembership(actorUserId, workspaceId);
    const session = await loadUsableSession(actorUserId, workspaceId, sessionId);

    if (session.provider === "FACEBOOK") {
      const data = parseSessionData<FacebookSessionData>(session);
      return {
        sessionId: session.id,
        provider: session.provider,
        expiresAt: session.expiresAt,
        accounts: (data?.pages ?? []).map((page) => ({
          externalAccountId: page.id,
          displayName: page.name,
          ...(page.category ? { detail: page.category } : {}),
          eligible: page.eligible,
          ...(page.ineligibleReason ? { ineligibleReason: page.ineligibleReason } : {}),
          ...(page.instagramAccount
            ? {
                instagramAccount: {
                  id: page.instagramAccount.id,
                  ...(page.instagramAccount.username
                    ? { username: page.instagramAccount.username }
                    : {}),
                },
              }
            : {}),
        })),
      };
    }

    if (session.provider === "WHATSAPP") {
      const data = parseSessionData<WhatsAppSessionData>(session);
      return {
        sessionId: session.id,
        provider: session.provider,
        expiresAt: session.expiresAt,
        accounts: (data?.phoneNumbers ?? []).map((number) => ({
          externalAccountId: number.id,
          displayName: number.verifiedName,
          detail: [
            number.displayPhoneNumber,
            number.status ? `status ${number.status}` : null,
            number.qualityRating ? `quality ${number.qualityRating}` : null,
            data?.waba ? `WABA ${data.waba.name}` : null,
          ]
            .filter((part): part is string => Boolean(part))
            .join(" · "),
          eligible: number.eligible,
          ...(number.ineligibleReason ? { ineligibleReason: number.ineligibleReason } : {}),
        })),
      };
    }

    const data = parseSessionData<InstagramSessionData>(session);
    const account = data?.account;
    return {
      sessionId: session.id,
      provider: session.provider,
      expiresAt: session.expiresAt,
      accounts: account
        ? [
            {
              externalAccountId: account.id,
              displayName: account.name ?? account.username ?? account.id,
              ...(account.username ? { detail: `@${account.username}` } : {}),
              eligible: account.eligible,
              ...(account.ineligibleReason ? { ineligibleReason: account.ineligibleReason } : {}),
            },
          ]
        : [],
    };
  },

  // ─── Select ───────────────────────────────────────────────────────────────

  async selectConnectionAccount(
    actorUserId: string,
    workspaceId: string,
    sessionId: string,
    externalAccountId: string,
    deps: MetaConnectionDeps = {},
  ): Promise<SelectResult> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    const session = await loadUsableSession(actorUserId, workspaceId, sessionId);
    if (session.provider === "FACEBOOK") {
      return this.selectFacebookPage(actorUserId, session, externalAccountId, deps);
    }
    if (session.provider === "INSTAGRAM") {
      return this.selectInstagramAccount(actorUserId, session, externalAccountId, deps);
    }
    throw AppError.badRequest(`Provider ${session.provider} does not use connection sessions`);
  },

  async selectFacebookPage(
    actorUserId: string,
    session: OAuthConnectionSession,
    pageId: string,
    deps: MetaConnectionDeps = {},
  ): Promise<SelectResult> {
    const data = parseSessionData<FacebookSessionData>(session);
    const page = data?.pages.find((p) => p.id === pageId);
    if (!page) {
      throw AppError.badRequest("That Page was not returned by Meta for this connection session.");
    }
    if (!page.eligible) {
      throw AppError.badRequest(page.ineligibleReason ?? "This Page is not eligible to connect.");
    }
    const provider = deps.facebook ?? facebookProvider;
    const workspaceId = session.workspaceId;

    const baseConfig: Record<string, unknown> = {
      authModel: "facebook-login",
      ...(page.category ? { pageCategory: page.category } : {}),
      ...(page.instagramAccount
        ? {
            instagramBusinessAccountId: page.instagramAccount.id,
            ...(page.instagramAccount.username
              ? { instagramUsername: page.instagramAccount.username }
              : {}),
          }
        : {}),
    };

    const channel = await prisma.channel.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: "FACEBOOK",
          externalAccountId: page.id,
        },
      },
      create: {
        workspaceId,
        provider: "FACEBOOK",
        externalAccountId: page.id,
        displayName: page.name,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
      update: {
        displayName: page.name,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
    });

    await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
      accessToken: page.pageAccessToken,
      scopes: [...FACEBOOK_SCOPES],
    });

    // The token is valid even if the webhook subscription call fails —
    // keep the channel, but record and report the failure honestly.
    let subscriptionWarning: string | undefined;
    let webhookSubscription: Record<string, unknown>;
    try {
      await provider.subscribePage(page.id, page.pageAccessToken);
      webhookSubscription = { status: "subscribed", at: new Date().toISOString() };
    } catch (error) {
      subscriptionWarning = error instanceof Error ? error.message : "Webhook subscription failed";
      webhookSubscription = { status: "failed", error: subscriptionWarning };
    }
    const saved = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        config: { ...baseConfig, webhookSubscription } as Prisma.InputJsonValue,
      },
    });

    await consumeSession(session.id);
    return { channel: saved, ...(subscriptionWarning ? { subscriptionWarning } : {}) };
  },

  async selectInstagramAccount(
    actorUserId: string,
    session: OAuthConnectionSession,
    externalAccountId: string,
    deps: MetaConnectionDeps = {},
  ): Promise<SelectResult> {
    const data = parseSessionData<InstagramSessionData>(session);
    const account = data?.account;
    if (!account || account.id !== externalAccountId) {
      throw AppError.badRequest(
        "That Instagram account was not returned by Meta for this connection session.",
      );
    }
    if (!account.eligible) {
      throw AppError.badRequest(
        account.ineligibleReason ?? "This Instagram account is not eligible to connect.",
      );
    }
    const provider = deps.instagram ?? instagramProvider;
    const workspaceId = session.workspaceId;

    const baseConfig: Record<string, unknown> = {
      authModel: "instagram-login",
      accountType: account.accountType,
      ...(account.username ? { username: account.username } : {}),
    };

    const channel = await prisma.channel.upsert({
      where: {
        workspaceId_provider_externalAccountId: {
          workspaceId,
          provider: "INSTAGRAM",
          externalAccountId: account.id,
        },
      },
      create: {
        workspaceId,
        provider: "INSTAGRAM",
        externalAccountId: account.id,
        displayName: account.name ?? account.username ?? account.id,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
      update: {
        displayName: account.name ?? account.username ?? account.id,
        status: "CONNECTED",
        config: baseConfig as Prisma.InputJsonValue,
      },
    });

    await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
      accessToken: account.accessToken,
      ...(account.expiresAt ? { tokenExpiresAt: new Date(account.expiresAt) } : {}),
      scopes: [...INSTAGRAM_SCOPES],
    });

    let subscriptionWarning: string | undefined;
    let webhookSubscription: Record<string, unknown>;
    try {
      await provider.subscribeAccount(account.accessToken);
      webhookSubscription = { status: "subscribed", at: new Date().toISOString() };
    } catch (error) {
      subscriptionWarning = error instanceof Error ? error.message : "Webhook subscription failed";
      webhookSubscription = { status: "failed", error: subscriptionWarning };
    }
    const saved = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        config: { ...baseConfig, webhookSubscription } as Prisma.InputJsonValue,
      },
    });

    await consumeSession(session.id);
    return { channel: saved, ...(subscriptionWarning ? { subscriptionWarning } : {}) };
  },

  // ─── Disconnect ───────────────────────────────────────────────────────────

  async disconnectChannel(
    actorUserId: string,
    workspaceId: string,
    channelId: string,
    deps: MetaConnectionDeps = {},
  ): Promise<Channel> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId } });
    if (!channel) throw AppError.notFound("Channel not found");

    if (
      channel.provider === "FACEBOOK" ||
      channel.provider === "INSTAGRAM" ||
      channel.provider === "WHATSAPP" ||
      channel.provider === "X"
    ) {
      const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(
        channel.id,
      );
      const context: ChannelContext = {
        channelId: channel.id,
        workspaceId,
        provider:
          channel.provider === "FACEBOOK"
            ? "facebook"
            : channel.provider === "INSTAGRAM"
              ? "instagram"
              : channel.provider === "WHATSAPP"
                ? "whatsapp"
                : "x",
        externalAccountId: channel.externalAccountId,
        credentials: {
          accessToken: credential?.accessToken ?? "",
          ...(credential?.refreshToken ? { refreshToken: credential.refreshToken } : {}),
          scopes: credential?.scopes ?? [],
        },
        ...(channel.config &&
        typeof channel.config === "object" &&
        !Array.isArray(channel.config)
          ? { config: channel.config as Record<string, unknown> }
          : {}),
      };
      const provider =
        channel.provider === "FACEBOOK"
          ? (deps.facebook ?? facebookProvider)
          : channel.provider === "INSTAGRAM"
            ? (deps.instagram ?? instagramProvider)
            : channel.provider === "WHATSAPP"
              ? (deps.whatsapp ?? whatsappProvider)
              : (deps.x ?? xProvider);
      // disconnectAccount is best-effort internally (logs, never throws).
      await provider.disconnectAccount(context);
    }

    await prisma.channelCredential.deleteMany({ where: { channelId } });
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { status: "DISCONNECTED" },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: actorUserId,
        action: "channel.disconnected",
        entity: "Channel",
        entityId: channelId,
        meta: {
          provider: channel.provider,
          externalAccountId: channel.externalAccountId,
        } as Prisma.InputJsonValue,
      },
    });
    return updated;
  },
};
