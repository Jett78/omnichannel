import { createHash, randomBytes } from "node:crypto";

import { AppError } from "@/lib/errors";
import { decryptText, encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { requireWhatsAppEmbeddedConfig } from "@/integrations/meta/meta-config";
import {
  WHATSAPP_SCOPES,
  WhatsAppProvider,
  whatsappProvider,
  type WhatsAppBusinessAccount,
  type WhatsAppPhoneNumber,
} from "@/integrations/whatsapp/whatsapp-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { Channel, OAuthConnectionSession, Prisma } from "@/generated/prisma/client";

/**
 * WhatsApp connection service (Phase 6).
 *
 * Two official connect paths:
 *  1. Embedded Signup — the browser popup (Facebook JS SDK) returns
 *     {code, waba_id, phone_number_id} to the Channels page, which
 *     POSTs them here. We exchange the code for a business token,
 *     verify via /debug_token that the token actually grants access
 *     to the claimed WABA, discover its phone numbers, subscribe the
 *     WABA to webhooks, and park the token in an encrypted
 *     OAuthConnectionSession (the Phase 5 selection hand-off) until
 *     the user picks a number. The token NEVER reaches the browser.
 *  2. Manual connect — the workspace admin pastes a permanent
 *     system-user token plus WABA + phone number ids. The token is
 *     validated against the real WABA before anything is stored.
 *
 * Provider instances are injectable so tests can use a labelled
 * fake-fetch test double; production uses the real singleton.
 */

export interface WhatsAppConnectionDeps {
  whatsapp?: WhatsAppProvider;
}

export interface WhatsAppSessionData {
  accessToken: string;
  tokenExpiresAt: string | null;
  waba: WhatsAppBusinessAccount;
  phoneNumbers: WhatsAppPhoneNumber[];
  webhookSubscription: Record<string, unknown>;
}

export interface SanitizedWhatsAppPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  status?: string;
  codeVerificationStatus?: string;
  qualityRating?: string;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface EmbeddedSignupResult {
  sessionId: string;
  waba: WhatsAppBusinessAccount;
  phoneNumbers: SanitizedWhatsAppPhoneNumber[];
  subscriptionWarning?: string;
}

export interface WhatsAppSelectResult {
  channel: Channel;
  subscriptionWarning?: string;
}

export interface WhatsAppTemplateView {
  name: string;
  language: string;
  category: string;
  bodyText: string | null;
  paramsCount: number;
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const EMPTY_PAYLOAD = "{}";

function sanitizeNumber(number: WhatsAppPhoneNumber): SanitizedWhatsAppPhoneNumber {
  return {
    id: number.id,
    displayPhoneNumber: number.displayPhoneNumber,
    verifiedName: number.verifiedName,
    ...(number.status ? { status: number.status } : {}),
    ...(number.codeVerificationStatus
      ? { codeVerificationStatus: number.codeVerificationStatus }
      : {}),
    ...(number.qualityRating ? { qualityRating: number.qualityRating } : {}),
    eligible: number.eligible,
    ...(number.ineligibleReason ? { ineligibleReason: number.ineligibleReason } : {}),
  };
}

async function loadUsableSession(
  actorUserId: string,
  workspaceId: string,
  sessionId: string,
): Promise<OAuthConnectionSession> {
  const session = await prisma.oAuthConnectionSession.findFirst({
    where: { id: sessionId, workspaceId },
  });
  if (!session || session.userId !== actorUserId || session.provider !== "WHATSAPP") {
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

function parseSessionData(session: OAuthConnectionSession): WhatsAppSessionData {
  try {
    const parsed = JSON.parse(decryptText(session.encryptedData)) as WhatsAppSessionData;
    if (!parsed || typeof parsed.accessToken !== "string" || !parsed.waba) {
      throw new Error("empty session payload");
    }
    return parsed;
  } catch {
    throw AppError.badRequest(
      "This connection session has no WhatsApp data. Start the connect flow again.",
    );
  }
}

async function consumeSession(sessionId: string): Promise<void> {
  await prisma.oAuthConnectionSession.update({
    where: { id: sessionId },
    data: { consumedAt: new Date(), encryptedData: encryptText(EMPTY_PAYLOAD) },
  });
}

/**
 * Product rule (Jeet, 2026-11-17): a workspace holds ONE WhatsApp number.
 * Connecting a different number is rejected until the existing one is
 * disconnected; reconnecting the SAME number stays allowed (it refreshes
 * the stored credentials through the upsert in finalizeChannel).
 */
async function assertSingleWhatsAppNumber(
  workspaceId: string,
  phoneNumberId: string,
): Promise<void> {
  const existing = await prisma.channel.findFirst({
    where: { workspaceId, provider: "WHATSAPP" },
    select: { externalAccountId: true, displayName: true },
  });
  if (existing && existing.externalAccountId !== phoneNumberId) {
    throw AppError.badRequest(
      `This workspace already has a WhatsApp number connected (${existing.displayName}). Only one WhatsApp number is allowed per workspace — disconnect it first to connect a different number.`,
    );
  }
}

async function finalizeChannel(
  actorUserId: string,
  workspaceId: string,
  input: {
    accessToken: string;
    tokenExpiresAt?: Date;
    waba: WhatsAppBusinessAccount;
    phoneNumber: WhatsAppPhoneNumber;
    connectionMethod: "embedded_signup" | "manual";
    webhookSubscription: Record<string, unknown>;
  },
): Promise<Channel> {
  await assertSingleWhatsAppNumber(workspaceId, input.phoneNumber.id);
  const config: Record<string, unknown> = {
    wabaId: input.waba.id,
    wabaName: input.waba.name,
    displayPhoneNumber: input.phoneNumber.displayPhoneNumber,
    verifiedName: input.phoneNumber.verifiedName,
    connectionMethod: input.connectionMethod,
    webhookSubscription: input.webhookSubscription,
    ...(input.phoneNumber.qualityRating ? { qualityRating: input.phoneNumber.qualityRating } : {}),
    ...(input.phoneNumber.status ? { phoneNumberStatus: input.phoneNumber.status } : {}),
  };
  const channel = await prisma.channel.upsert({
    where: {
      workspaceId_provider_externalAccountId: {
        workspaceId,
        provider: "WHATSAPP",
        externalAccountId: input.phoneNumber.id,
      },
    },
    create: {
      workspaceId,
      provider: "WHATSAPP",
      externalAccountId: input.phoneNumber.id,
      displayName: input.phoneNumber.verifiedName || input.phoneNumber.displayPhoneNumber,
      status: "CONNECTED",
      config: config as Prisma.InputJsonValue,
    },
    update: {
      displayName: input.phoneNumber.verifiedName || input.phoneNumber.displayPhoneNumber,
      status: "CONNECTED",
      config: config as Prisma.InputJsonValue,
    },
  });
  await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
    accessToken: input.accessToken,
    ...(input.tokenExpiresAt ? { tokenExpiresAt: input.tokenExpiresAt } : {}),
    scopes: [...WHATSAPP_SCOPES],
  });
  return channel;
}

async function subscribeBestEffort(
  provider: WhatsAppProvider,
  wabaId: string,
  accessToken: string,
): Promise<{ webhookSubscription: Record<string, unknown>; subscriptionWarning?: string }> {
  try {
    await provider.subscribeWaba(wabaId, accessToken);
    return { webhookSubscription: { status: "subscribed", at: new Date().toISOString() } };
  } catch (error) {
    const subscriptionWarning =
      error instanceof Error ? error.message : "Webhook subscription failed";
    return {
      webhookSubscription: { status: "failed", error: subscriptionWarning },
      subscriptionWarning,
    };
  }
}

async function loadWhatsAppChannel(
  actorUserId: string,
  workspaceId: string,
  channelId: string,
  permission: "channels.manage" | "conversations.reply",
): Promise<Channel> {
  await requireWorkspacePermission(actorUserId, workspaceId, permission);
  const channel = await prisma.channel.findFirst({ where: { id: channelId, workspaceId } });
  if (!channel) throw AppError.notFound("Channel not found");
  if (channel.provider !== "WHATSAPP") {
    throw AppError.badRequest("This channel is not a WhatsApp channel.");
  }
  return channel;
}

function channelWabaId(channel: Channel): string {
  const config =
    channel.config && typeof channel.config === "object" && !Array.isArray(channel.config)
      ? (channel.config as Record<string, unknown>)
      : {};
  if (typeof config.wabaId !== "string" || !config.wabaId) {
    throw AppError.badRequest("This WhatsApp channel has no WABA id in its configuration.");
  }
  return config.wabaId;
}

async function decryptedToken(channelId: string): Promise<string> {
  const credential =
    await channelCredentialService.getDecryptedChannelCredentialForServer(channelId);
  if (!credential?.accessToken) {
    throw AppError.badRequest("This WhatsApp channel has no stored access token. Reconnect it.");
  }
  return credential.accessToken;
}

export const whatsappConnectionService = {
  /**
   * Embedded Signup completion: exchange the popup code, verify the
   * resulting token really grants the claimed WABA (debug_token
   * granular scopes), discover numbers, subscribe the WABA, and park
   * everything in an encrypted selection session.
   */
  async startEmbeddedSignup(
    actorUserId: string,
    workspaceId: string,
    input: { code: string; wabaId: string; phoneNumberId?: string },
    deps: WhatsAppConnectionDeps = {},
  ): Promise<EmbeddedSignupResult> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    requireWhatsAppEmbeddedConfig(); // 503 naming the missing env vars
    const provider = deps.whatsapp ?? whatsappProvider;

    const { accessToken } = await provider.exchangeEmbeddedSignupCode(input.code);
    const debug = await provider.debugToken(accessToken);
    if (!debug.isValid || !debug.wabaIds.includes(input.wabaId)) {
      throw AppError.forbidden(
        "The signup did not grant access to that WhatsApp Business Account. Complete Embedded Signup again and make sure the correct business account is shared with the app.",
      );
    }
    const waba = await provider.getWaba(input.wabaId, accessToken);
    const phoneNumbers = await provider.listPhoneNumbers(input.wabaId, accessToken);
    if (input.phoneNumberId && !phoneNumbers.some((number) => number.id === input.phoneNumberId)) {
      throw AppError.badRequest(
        "The phone number returned by Embedded Signup is not listed on that WhatsApp Business Account.",
      );
    }

    const { webhookSubscription, subscriptionWarning } = await subscribeBestEffort(
      provider,
      input.wabaId,
      accessToken,
    );

    const data: WhatsAppSessionData = {
      accessToken,
      tokenExpiresAt: debug.expiresAt?.toISOString() ?? null,
      waba,
      phoneNumbers,
      webhookSubscription,
    };
    const state = randomBytes(32).toString("hex");
    const session = await prisma.oAuthConnectionSession.create({
      data: {
        workspaceId,
        userId: actorUserId,
        provider: "WHATSAPP",
        stateHash: createHash("sha256").update(state).digest("hex"),
        encryptedData: encryptText(JSON.stringify(data)),
        scopes: [...WHATSAPP_SCOPES],
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    return {
      sessionId: session.id,
      waba,
      phoneNumbers: phoneNumbers.map(sanitizeNumber),
      ...(subscriptionWarning ? { subscriptionWarning } : {}),
    };
  },

  /** Finalize an Embedded Signup session by choosing a phone number. */
  async selectWhatsAppNumber(
    actorUserId: string,
    workspaceId: string,
    sessionId: string,
    phoneNumberId: string,
    deps: WhatsAppConnectionDeps = {},
  ): Promise<WhatsAppSelectResult> {
    void deps; // selection needs no provider call — subscription happened at signup
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    const session = await loadUsableSession(actorUserId, workspaceId, sessionId);
    const data = parseSessionData(session);
    const phoneNumber = data.phoneNumbers.find((number) => number.id === phoneNumberId);
    if (!phoneNumber) {
      throw AppError.badRequest(
        "That phone number was not returned by Meta for this connection session.",
      );
    }
    if (!phoneNumber.eligible) {
      throw AppError.badRequest(
        phoneNumber.ineligibleReason ?? "This phone number is not eligible to connect.",
      );
    }
    const channel = await finalizeChannel(actorUserId, workspaceId, {
      accessToken: data.accessToken,
      ...(data.tokenExpiresAt ? { tokenExpiresAt: new Date(data.tokenExpiresAt) } : {}),
      waba: data.waba,
      phoneNumber,
      connectionMethod: "embedded_signup",
      webhookSubscription: data.webhookSubscription,
    });
    await consumeSession(session.id);
    const subscriptionWarning =
      data.webhookSubscription.status === "failed"
        ? String(data.webhookSubscription.error ?? "Webhook subscription failed")
        : undefined;
    return { channel, ...(subscriptionWarning ? { subscriptionWarning } : {}) };
  },

  /**
   * Manual connect with a permanent system-user token. The token is
   * validated against the real WABA (and the number must belong to
   * it) before anything is stored.
   */
  async connectManually(
    actorUserId: string,
    workspaceId: string,
    input: { wabaId: string; phoneNumberId: string; accessToken: string },
    deps: WhatsAppConnectionDeps = {},
  ): Promise<WhatsAppSelectResult> {
    await requireWorkspacePermission(actorUserId, workspaceId, "channels.manage");
    const provider = deps.whatsapp ?? whatsappProvider;

    const waba = await provider.getWaba(input.wabaId, input.accessToken);
    const phoneNumbers = await provider.listPhoneNumbers(input.wabaId, input.accessToken);
    const phoneNumber = phoneNumbers.find((number) => number.id === input.phoneNumberId);
    if (!phoneNumber) {
      throw AppError.badRequest(
        "That phone number is not listed on the given WhatsApp Business Account.",
      );
    }

    const { webhookSubscription, subscriptionWarning } = await subscribeBestEffort(
      provider,
      input.wabaId,
      input.accessToken,
    );
    const channel = await finalizeChannel(actorUserId, workspaceId, {
      accessToken: input.accessToken,
      waba,
      phoneNumber,
      connectionMethod: "manual",
      webhookSubscription,
    });
    return { channel, ...(subscriptionWarning ? { subscriptionWarning } : {}) };
  },

  /**
   * Replace the stored system-user token of an existing WhatsApp channel
   * (the Edit action in Channels). The new token is verified against the
   * channel's own WABA and phone number before it is stored — a token
   * that cannot read them is rejected and the old one kept. Stored tokens
   * are never readable again, so editing credentials means replacing the
   * token, never viewing it.
   */
  async updateManualCredentials(
    actorUserId: string,
    workspaceId: string,
    channelId: string,
    input: { accessToken: string },
    deps: WhatsAppConnectionDeps = {},
  ): Promise<WhatsAppSelectResult> {
    const channel = await loadWhatsAppChannel(actorUserId, workspaceId, channelId, "channels.manage");
    const wabaId = channelWabaId(channel);
    const provider = deps.whatsapp ?? whatsappProvider;

    await provider.getWaba(wabaId, input.accessToken);
    const phoneNumbers = await provider.listPhoneNumbers(wabaId, input.accessToken);
    const phoneNumber = phoneNumbers.find((number) => number.id === channel.externalAccountId);
    if (!phoneNumber) {
      throw AppError.badRequest(
        "That token does not have access to this channel's phone number on its WhatsApp Business Account.",
      );
    }

    const { webhookSubscription, subscriptionWarning } = await subscribeBestEffort(
      provider,
      wabaId,
      input.accessToken,
    );
    await channelCredentialService.setChannelCredential(actorUserId, workspaceId, channel.id, {
      accessToken: input.accessToken,
      scopes: [...WHATSAPP_SCOPES],
    });
    const oldConfig =
      channel.config && typeof channel.config === "object" && !Array.isArray(channel.config)
        ? (channel.config as Record<string, unknown>)
        : {};
    const nextConfig: Record<string, unknown> = { ...oldConfig };
    delete nextConfig.lastError;
    delete nextConfig.lastErrorAt;
    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        status: "CONNECTED",
        config: {
          ...nextConfig,
          webhookSubscription,
          ...(phoneNumber.qualityRating ? { qualityRating: phoneNumber.qualityRating } : {}),
          ...(phoneNumber.status ? { phoneNumberStatus: phoneNumber.status } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    return { channel: updated, ...(subscriptionWarning ? { subscriptionWarning } : {}) };
  },

  /** Register a connected phone number with its 6-digit PIN. */
  async registerPhoneNumber(
    actorUserId: string,
    workspaceId: string,
    channelId: string,
    pin: string,
    deps: WhatsAppConnectionDeps = {},
  ): Promise<Channel> {
    const channel = await loadWhatsAppChannel(actorUserId, workspaceId, channelId, "channels.manage");
    const provider = deps.whatsapp ?? whatsappProvider;
    const token = await decryptedToken(channel.id);
    await provider.registerPhoneNumber(channel.externalAccountId, token, pin);
    return channel;
  },

  /** Deregister a connected phone number from the Cloud API. */
  async deregisterPhoneNumber(
    actorUserId: string,
    workspaceId: string,
    channelId: string,
    deps: WhatsAppConnectionDeps = {},
  ): Promise<Channel> {
    const channel = await loadWhatsAppChannel(actorUserId, workspaceId, channelId, "channels.manage");
    const provider = deps.whatsapp ?? whatsappProvider;
    const token = await decryptedToken(channel.id);
    await provider.deregisterPhoneNumber(channel.externalAccountId, token);
    return channel;
  },

  /** APPROVED message templates for a channel (agents sending templates). */
  async listApprovedTemplates(
    actorUserId: string,
    workspaceId: string,
    channelId: string,
    deps: WhatsAppConnectionDeps = {},
  ): Promise<WhatsAppTemplateView[]> {
    const channel = await loadWhatsAppChannel(
      actorUserId,
      workspaceId,
      channelId,
      "conversations.reply",
    );
    const provider = deps.whatsapp ?? whatsappProvider;
    const token = await decryptedToken(channel.id);
    const templates = await provider.listTemplates(channelWabaId(channel), token);
    return templates
      .filter((template) => template.status === "APPROVED")
      .map((template) => {
        const body = template.components.find((component) => component.type === "BODY");
        const placeholders = new Set(
          (body?.text?.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((match) =>
            match.replace(/[^\d]/g, ""),
          ),
        );
        return {
          name: template.name,
          language: template.language,
          category: template.category,
          bodyText: body?.text ?? null,
          paramsCount: placeholders.size,
        };
      });
  },
};
