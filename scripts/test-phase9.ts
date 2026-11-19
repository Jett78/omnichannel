import { createHash } from "node:crypto";

import type { Job } from "bullmq";

import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getProvider, listRegisteredProviders, registerProvider } from "@/integrations/registry";
import type { ChannelContext } from "@/integrations/types";
import {
  getGmailAccessState,
  getGmailConfig,
  gmailRedirectUri,
  isGmailConfigured,
} from "@/integrations/gmail/gmail-config";
import type { FetchLike } from "@/integrations/gmail/gmail-client";
import {
  GmailProvider,
  cleanGmailPlainText,
  gravatarAvatarUrl,
  normalizeGmailMessage,
  parseEmailAddress,
  type GmailMessageResource,
} from "@/integrations/gmail/gmail-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import { gmailConnectionService } from "@/services/gmail-connection.service";
import { messagingService } from "@/services/messaging.service";
import { metaConnectionService } from "@/services/meta-connection.service";
import { workspaceService } from "@/services/workspace.service";
import { pollGmailChannel, processGmailPollJob } from "@/workers/processors/gmail-poll.processor";
import type { GmailPollJobData } from "@/types/queue";

/**
 * Phase 9 Gmail channel tests — REAL local PostgreSQL + Redis.
 *
 *   npm run test:phase9
 *
 * ⚠️ NO real Google account, Cloud project, or network call is
 * involved — none exist in this environment. The provider is tested
 * against an injected fake-fetch TEST DOUBLE whose payloads follow
 * Google's official Gmail API reference shapes (users/me/profile,
 * users/me/history, messages.get format=full, messages.send,
 * oauth2 token endpoint):
 *  - https://developers.google.com/gmail/api/reference/rest
 *  - https://developers.google.com/identity/protocols/oauth2
 * See docs/GMAIL-SETUP.md for the operator setup.
 */

const PASSWORD = "test-password-123";
const runId = Date.now().toString(36);

const CLIENT_ID = "test-google-client-id";
const CLIENT_SECRET = "test-google-client-secret";
const MAILBOX = "support@business.test";
const CUSTOMER = "customer@example.com";

let passed = 0;
let failed = 0;
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];

function pass(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}
function fail(name: string, detail?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}
function assert(name: string, condition: boolean, detail?: string) {
  if (condition) pass(name);
  else fail(name, detail);
}

// ─── Fake Google endpoints ──────────────────────────────────────────

interface FakeCall {
  url: string;
  method: string;
  body?: string;
}

const b64url = (text: string): string => Buffer.from(text, "utf8").toString("base64url");

const MESSAGE_1: GmailMessageResource = {
  id: "gm-1",
  threadId: "th-1",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Hello, what is the price?",
  historyId: "1001",
  internalDate: String(Date.now() - 5 * 60 * 1000),
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: `Customer One <${CUSTOMER}>` },
      { name: "To", value: MAILBOX },
      { name: "Subject", value: "Pricing question" },
      { name: "Message-ID", value: "<m1@example.com>" },
      { name: "References", value: "<m0@example.com>" },
    ],
    parts: [
      {
        partId: "0",
        mimeType: "text/plain",
        body: { size: 24, data: b64url("Hello, what is the price?") },
      },
    ],
  },
};

const MESSAGE_2: GmailMessageResource = {
  id: "gm-2",
  threadId: "th-1",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Photo attached",
  historyId: "1002",
  internalDate: String(Date.now() - 4 * 60 * 1000),
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: `Customer One <${CUSTOMER}>` },
      { name: "Subject", value: "Pricing question" },
      { name: "Message-ID", value: "<m2@example.com>" },
      { name: "References", value: "<m0@example.com> <m1@example.com>" },
    ],
    parts: [
      { partId: "0", mimeType: "text/plain", body: { size: 14, data: b64url("Photo attached") } },
      {
        partId: "1",
        mimeType: "image/png",
        filename: "photo.png",
        body: { size: 7, attachmentId: "att-1" },
      },
    ],
  },
};

const MESSAGE_OWN: GmailMessageResource = {
  id: "gm-3",
  threadId: "th-9",
  labelIds: ["SENT"],
  internalDate: String(Date.now() - 3 * 60 * 1000),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: MAILBOX },
      { name: "To", value: CUSTOMER },
      { name: "Subject", value: "Our own reply" },
    ],
    body: { size: 9, data: b64url("Our reply") },
  },
};

function makeFakeFetch() {
  const calls: FakeCall[] = [];
  const sentPayloads: Array<{ raw: string; threadId?: string }> = [];
  let revokeCount = 0;

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, ...(body ? { body } : {}) });
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const form = new URLSearchParams(body ?? "");
      if (form.get("grant_type") === "authorization_code") {
        if (form.get("code") !== "good-code") {
          return json(400, { error: "invalid_grant", error_description: "Bad code" });
        }
        return json(200, {
          access_token: "gmail-access-1",
          refresh_token: "gmail-refresh-1",
          expires_in: 3600,
          scope: "openid email https://www.googleapis.com/auth/gmail.modify",
          token_type: "Bearer",
        });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (form.get("refresh_token") === "dead-refresh") {
          return json(400, { error: "invalid_grant", error_description: "Token revoked" });
        }
        return json(200, {
          access_token: "gmail-access-2",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.modify",
          token_type: "Bearer",
        });
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      revokeCount += 1;
      return new Response("", { status: 200 });
    }

    if (path === "/gmail/v1/users/me/profile") {
      return json(200, { emailAddress: MAILBOX, messagesTotal: 42, threadsTotal: 9, historyId: "1000" });
    }
    if (path === "/gmail/v1/users/me/history") {
      const start = parsed.searchParams.get("startHistoryId");
      if (start === "999999") {
        return json(404, { error: { message: "History too old", status: "NOT_FOUND" } });
      }
      if (start === "1000") {
        return json(200, {
          history: [
            {
              id: "1001",
              messagesAdded: [
                { message: { id: "gm-1", threadId: "th-1", labelIds: ["INBOX"] } },
                { message: { id: "gm-2", threadId: "th-1", labelIds: ["INBOX"] } },
                { message: { id: "gm-3", threadId: "th-9", labelIds: ["SENT"] } },
              ],
            },
          ],
          historyId: "1005",
        });
      }
      return json(200, { history: [], historyId: start ?? "1005" });
    }
    if (path === "/gmail/v1/users/me/messages/gm-1") return json(200, MESSAGE_1);
    if (path === "/gmail/v1/users/me/messages/gm-2") return json(200, MESSAGE_2);
    if (path === "/gmail/v1/users/me/messages/gm-3") return json(200, MESSAGE_OWN);
    if (path === "/gmail/v1/users/me/messages/gm-2/attachments/att-1") {
      return json(200, { size: 7, data: b64url("PNGDATA") });
    }
    if (path === "/gmail/v1/users/me/messages/send" && method === "POST") {
      const payload = JSON.parse(body ?? "{}") as { raw: string; threadId?: string };
      sentPayloads.push(payload);
      return json(200, { id: "gm-sent-1", threadId: payload.threadId ?? "th-1", labelIds: ["SENT"] });
    }
    if (path === "/gmail/v1/users/me/threads") {
      return json(200, { threads: [{ id: "th-1", snippet: "Pricing question", historyId: "1002" }] });
    }
    if (path === "/gmail/v1/users/me/threads/th-1") {
      return json(200, { id: "th-1", messages: [MESSAGE_1, MESSAGE_2] });
    }
    return json(404, { error: { message: `Fake: no route for ${method} ${path}`, status: "NOT_FOUND" } });
  };

  return { fetchImpl, calls, sentPayloads, revokeCount: () => revokeCount };
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase9-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase9 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

async function main(): Promise<void> {
  console.log("Phase 9 Gmail channel tests (fake-fetch double — no real Google account or network)\n");

  // ── Config ───────────────────────────────────────────────────────
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert("Config: unconfigured → isGmailConfigured() false", !isGmailConfigured());
  try {
    getGmailConfig();
    fail("Config: unconfigured → getGmailConfig throws", "no error thrown");
  } catch (error) {
    assert(
      "Config: unconfigured → 503 naming both variables",
      error instanceof AppError &&
        error.code === "GMAIL_NOT_CONFIGURED" &&
        error.status === 503 &&
        error.message.includes("GOOGLE_CLIENT_ID") &&
        error.message.includes("GOOGLE_CLIENT_SECRET"),
      String(error),
    );
  }
  const unState = getGmailAccessState();
  assert(
    "Access state: unconfigured → false + missingEnv + redirect URI derived from APP_URL",
    unState.configured === false &&
      unState.missingEnv.length === 2 &&
      unState.redirectUri.endsWith("/api/oauth/gmail/callback"),
  );

  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;
  assert("Config: configured → isGmailConfigured() true", isGmailConfigured());
  assert(
    "Config: redirect URI default",
    gmailRedirectUri().endsWith("/api/oauth/gmail/callback") &&
      getGmailConfig().clientId === CLIENT_ID,
  );

  assert(
    "Registry: gmail provider registered",
    listRegisteredProviders().includes("gmail") && getProvider("gmail").id === "gmail",
  );
  assert(
    "Capabilities: no messaging window, media supported",
    getProvider("gmail").capabilities.messagingWindowHours === null &&
      getProvider("gmail").capabilities.supportsMedia.includes("image"),
  );

  // ── Pure helpers / normalization ─────────────────────────────────
  assert(
    "parseEmailAddress: named address",
    JSON.stringify(parseEmailAddress(`Customer One <${CUSTOMER}>`)) ===
      JSON.stringify({ email: CUSTOMER, name: "Customer One" }),
  );
  assert(
    "parseEmailAddress: bare address, no name",
    JSON.stringify(parseEmailAddress(CUSTOMER)) === JSON.stringify({ email: CUSTOMER }),
  );
  assert("parseEmailAddress: garbage → null", parseEmailAddress("not an address") === null);

  const n1 = normalizeGmailMessage(MESSAGE_1, MAILBOX);
  assert(
    "Normalize: plain-text message → TEXT with decoded body, sender + thread",
    n1 !== null &&
      n1.type === "TEXT" &&
      n1.body === "Hello, what is the price?" &&
      n1.senderExternalId === CUSTOMER &&
      n1.senderName === "Customer One" &&
      n1.externalThreadId === "th-1" &&
      n1.externalMessageId === "gm-1",
    JSON.stringify(n1),
  );
  assert(
    "Normalize: subject + threading headers land in metadata",
    n1?.metadata?.subject === "Pricing question" &&
      n1?.metadata?.rfcMessageId === "<m1@example.com>" &&
      n1?.metadata?.references === "<m0@example.com>",
  );
  const EXPECTED_AVATAR = `https://www.gravatar.com/avatar/${createHash("md5")
    .update(CUSTOMER)
    .digest("hex")}?s=128&d=404`;
  assert(
    "Normalize: sender avatar is the Gravatar URL of the From address (Gmail API has no sender photo)",
    n1?.senderAvatarUrl === EXPECTED_AVATAR && gravatarAvatarUrl(CUSTOMER) === EXPECTED_AVATAR,
    n1?.senderAvatarUrl,
  );
  const n2 = normalizeGmailMessage(MESSAGE_2, MAILBOX);
  assert(
    "Normalize: attachment → gmail-attachment ref with filename/mime/size",
    n2?.attachments?.length === 1 &&
      n2.attachments[0]?.url === "gmail-attachment:gm-2:att-1" &&
      n2.attachments[0]?.fileName === "photo.png" &&
      n2.attachments[0]?.mimeType === "image/png" &&
      n2.attachments[0]?.size === 7,
  );
  assert(
    "Normalize: own SENT mail is skipped",
    normalizeGmailMessage(MESSAGE_OWN, MAILBOX) === null,
  );
  const htmlOnly: GmailMessageResource = {
    id: "gm-html",
    threadId: "th-2",
    labelIds: ["INBOX"],
    internalDate: String(Date.now()),
    payload: {
      mimeType: "text/html",
      headers: [{ name: "From", value: CUSTOMER }],
      body: { size: 40, data: b64url("<p>Hello <b>there</b></p><p>Second line</p>") },
    },
  };
  const nHtml = normalizeGmailMessage(htmlOnly, MAILBOX);
  assert(
    "Normalize: HTML-only mail → stripped plain text",
    nHtml?.body === "Hello there\nSecond line",
    JSON.stringify(nHtml?.body),
  );
  assert(
    "Body cleanup: [image:] placeholders dropped, quoted history tail cut",
    cleanGmailPlainText(
      "Here is my resume.\n[image: download.png]\n\nOn Thu, Nov 19, 2026 at 2:35 PM Jet Deula <jetdeula@gmail.com> wrote:\n> hello\n>",
    ) === "Here is my resume." &&
      cleanGmailPlainText("First line\nSecond line") === "First line\nSecond line",
  );
  const messyMail: GmailMessageResource = {
    id: "gm-messy",
    threadId: "th-3",
    labelIds: ["INBOX"],
    internalDate: String(Date.now()),
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "From", value: CUSTOMER }],
      body: {
        size: 90,
        data: b64url(
          "Application attached. [image: logo.png]\n\nOn Wed, Nov 18, 2026 at 9:00 AM Someone <s@example.com> wrote:\n> earlier text",
        ),
      },
    },
  };
  assert(
    "Normalize: body cleanup applies at ingest (no placeholders, no quote tail)",
    normalizeGmailMessage(messyMail, MAILBOX)?.body === "Application attached.",
    JSON.stringify(normalizeGmailMessage(messyMail, MAILBOX)?.body),
  );
  assert(
    "Body cleanup: hard-wrapped paragraphs reflow; lists + signatures keep their lines",
    cleanGmailPlainText(
      "I am applying for the Full Stack Developer position (Mid-Baneshwor,\r\nKathmandu) advertised on SathiJob.\r\n\r\nDetails as requested:\r\n- Expected salary: NPR 40,000\r\n- Notice period: 10 days\r\n\r\nBest regards,\r\nJeet Deula",
    ) ===
      "I am applying for the Full Stack Developer position (Mid-Baneshwor, Kathmandu) advertised on SathiJob.\n\nDetails as requested:\n- Expected salary: NPR 40,000\n- Notice period: 10 days\n\nBest regards,\nJeet Deula",
    JSON.stringify(
      cleanGmailPlainText(
        "I am applying for the Full Stack Developer position (Mid-Baneshwor,\r\nKathmandu) advertised on SathiJob.",
      ),
    ),
  );

  // ── Provider OAuth + API via the fake ────────────────────────────
  const fake = makeFakeFetch();
  const provider = new GmailProvider(fake.fetchImpl);
  registerProvider(provider); // engine sends resolve to the fake-backed provider

  const authUrl = provider.buildAuthUrl("state-123");
  const authParams = new URL(authUrl).searchParams;
  assert(
    "Auth URL: offline access + consent + gmail.modify scope + state",
    authUrl.startsWith("https://accounts.google.com/o/oauth2/v2/auth") &&
      authParams.get("access_type") === "offline" &&
      authParams.get("prompt") === "consent" &&
      (authParams.get("scope") ?? "").includes("https://www.googleapis.com/auth/gmail.modify") &&
      authParams.get("state") === "state-123" &&
      authParams.get("redirect_uri")?.endsWith("/api/oauth/gmail/callback") === true,
    authUrl,
  );

  const tokens = await provider.exchangeCodeForTokens("good-code");
  assert(
    "Token exchange: access + refresh + expiry + scopes",
    tokens.accessToken === "gmail-access-1" &&
      tokens.refreshToken === "gmail-refresh-1" &&
      tokens.expiresAt instanceof Date &&
      tokens.scopes.includes("https://www.googleapis.com/auth/gmail.modify"),
  );
  const refreshed = await provider.refreshToken({
    accessToken: "gmail-access-1",
    refreshToken: "gmail-refresh-1",
    scopes: [],
  });
  assert(
    "Refresh: new access token, refresh token preserved (Google does not rotate)",
    refreshed.accessToken === "gmail-access-2" && refreshed.refreshToken === "gmail-refresh-1",
  );
  const profile = await provider.getOwnProfile("gmail-access-1");
  assert(
    "Profile: mailbox address + historyId baseline",
    profile.email === MAILBOX && profile.historyId === "1000",
  );

  // ── Connect flow (service) ───────────────────────────────────────
  const owner = await signUp("owner");
  const workspace = await workspaceService.createWorkspace(owner.id, {
    name: `Phase9 WS ${runId}`,
    timezone: "Asia/Kathmandu",
  });
  createdWorkspaceIds.push(workspace.id);

  const started = await gmailConnectionService.startGmailConnect(owner.id, workspace.id, {
    gmail: provider,
  });
  assert(
    "Connect start: Google auth URL returned + session row created",
    started.authUrl.includes("accounts.google.com") &&
      (await prisma.oAuthConnectionSession.count({
        where: { workspaceId: workspace.id, provider: "GMAIL", consumedAt: null },
      })) === 1,
  );

  const connected = await gmailConnectionService.handleGmailCallback(
    owner.id,
    started.state,
    "good-code",
    { gmail: provider },
  );
  const channel = connected.channel;
  assert(
    "Connect callback: GMAIL channel CONNECTED, keyed by mailbox, baseline cursor stored",
    channel.provider === "GMAIL" &&
      channel.status === "CONNECTED" &&
      channel.externalAccountId === MAILBOX &&
      (channel.config as { gmailHistoryId?: string }).gmailHistoryId === "1000",
  );
  const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(channel.id);
  assert(
    "Connect callback: credential stored encrypted, decrypts to the fake tokens",
    credential?.accessToken === "gmail-access-1" && credential?.refreshToken === "gmail-refresh-1",
  );
  const rawCredential = await prisma.channelCredential.findUnique({ where: { channelId: channel.id } });
  assert(
    "Connect callback: raw DB credential is ciphertext, not the token",
    !!rawCredential &&
      !rawCredential.encryptedAccessToken.includes("gmail-access-1") &&
      !(rawCredential.encryptedRefreshToken ?? "").includes("gmail-refresh-1"),
  );

  // ── Poll: ingest new mail ────────────────────────────────────────
  const job = { data: { channelId: channel.id } } as Job<GmailPollJobData>;
  await processGmailPollJob(job, { gmail: provider });

  const conversation = await prisma.conversation.findFirst({
    where: { workspaceId: workspace.id, channelId: channel.id, externalThreadId: "th-1" },
    include: { messages: { orderBy: { sentAt: "asc" } }, contact: true },
  });
  assert(
    "Poll: thread conversation created with the customer as contact",
    !!conversation && conversation.contact.displayName === "Customer One",
  );
  assert(
    "Poll: contact email + Gravatar avatar recorded at ingest",
    conversation?.contact.email === CUSTOMER &&
      conversation?.contact.avatarUrl === EXPECTED_AVATAR,
    JSON.stringify(conversation?.contact),
  );
  assert(
    "Poll: both customer messages ingested, own SENT mail skipped",
    conversation?.messages.length === 2 &&
      conversation.messages[0]?.externalMessageId === "gm-1" &&
      conversation.messages[1]?.externalMessageId === "gm-2",
    `messages: ${conversation?.messages.map((m) => m.externalMessageId).join(",")}`,
  );
  assert(
    "Poll: subject stored in the first message's metadata",
    (conversation?.messages[0]?.metadata as { subject?: string } | null)?.subject ===
      "Pricing question",
  );
  assert(
    "Poll: attachment row carries the gmail ref",
    (await prisma.messageAttachment.count({
      where: { message: { externalMessageId: "gm-2" }, originalUrl: "gmail-attachment:gm-2:att-1" },
    })) === 1,
  );
  const afterPoll = await prisma.channel.findUnique({ where: { id: channel.id } });
  assert(
    "Poll: history cursor advanced to 1005",
    (afterPoll?.config as { gmailHistoryId?: string }).gmailHistoryId === "1005",
  );

  const again = await pollGmailChannel(afterPoll as typeof channel, { gmail: provider });
  const messageCount = await prisma.message.count({
    where: { conversationId: conversation?.id },
  });
  assert(
    "Poll: second sweep ingests nothing new (cursor + dedupe)",
    again.ingested === 0 && messageCount === 2,
  );

  // ── Outbound reply: threaded MIME through the engine ─────────────
  if (!conversation) throw new Error("conversation missing — cannot test outbound");
  const outbound = await messagingService.sendOutboundMessage(owner.id, workspace.id, conversation.id, {
    content: "It costs Rs 500.",
  });
  const delivered = await messagingService.deliverOutboundMessage(outbound.id, {
    isFinalAttempt: true,
  });
  const outboundRow = await prisma.message.findUnique({ where: { id: outbound.id } });
  assert(
    "Outbound: delivered SENT with Gmail's message id (no window block on email)",
    delivered.status === "SENT" &&
      outboundRow?.status === "SENT" &&
      outboundRow?.externalMessageId === "gm-sent-1",
  );
  const sentRaw = fake.sentPayloads.at(-1);
  const mime = sentRaw ? Buffer.from(sentRaw.raw, "base64url").toString("utf8") : "";
  assert(
    "Outbound: MIME carries To / Re: subject / In-Reply-To / References / threadId",
    mime.includes(`To: ${CUSTOMER}`) &&
      mime.includes("Subject: Re: Pricing question") &&
      mime.includes("In-Reply-To: <m2@example.com>") &&
      mime.includes("References: <m0@example.com> <m1@example.com>") &&
      sentRaw?.threadId === "th-1" &&
      mime.includes("It costs Rs 500."),
    mime,
  );

  // ── Attachment download ──────────────────────────────────────────
  const channelContext: ChannelContext = {
    channelId: channel.id,
    workspaceId: workspace.id,
    provider: "gmail",
    externalAccountId: MAILBOX,
    credentials: { accessToken: "gmail-access-1", refreshToken: "gmail-refresh-1", scopes: [] },
  };
  const bytes = await provider.downloadMedia("gmail-attachment:gm-2:att-1", channelContext);
  assert("Download: attachment bytes round-trip", bytes.toString("utf8") === "PNGDATA");

  // ── History import ───────────────────────────────────────────────
  const imported = await provider.fetchRecentConversations({
    channel: channelContext,
    conversationLimit: 25,
    messageLimit: 50,
  });
  assert(
    "Import: thread returned with participant + both messages",
    imported.length === 1 &&
      imported[0]?.participantExternalId === CUSTOMER &&
      imported[0]?.messages.length === 2 &&
      imported[0]?.messages.every((m) => m.direction === "INBOUND"),
  );

  // ── Disconnect (revokes at Google, deletes credential) ───────────
  const disconnected = await metaConnectionService.disconnectChannel(
    owner.id,
    workspace.id,
    channel.id,
    { gmail: provider },
  );
  assert(
    "Disconnect: channel DISCONNECTED, credential deleted, Google revoke called",
    disconnected.status === "DISCONNECTED" &&
      (await prisma.channelCredential.count({ where: { channelId: channel.id } })) === 0 &&
      fake.revokeCount() === 1,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Phase 9 test run crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const id of createdWorkspaceIds) {
      await prisma.workspace.deleteMany({ where: { id } });
    }
    for (const id of createdUserIds) {
      await prisma.user.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
  });
