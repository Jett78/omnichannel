import type { Job } from "bullmq";

import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getProvider, registerProvider } from "@/integrations/registry";
import type { ChannelContext } from "@/integrations/types";
import type { FetchLike } from "@/integrations/telegram/telegram-client";
import {
  TelegramProvider,
  normalizeTelegramUpdate,
  type TelegramUpdate,
} from "@/integrations/telegram/telegram-provider";
import { messagingService } from "@/services/messaging.service";
import { metaConnectionService } from "@/services/meta-connection.service";
import { telegramConnectionService } from "@/services/telegram-connection.service";
import { webhookService } from "@/services/webhook.service";
import { workspaceService } from "@/services/workspace.service";
import { processWebhookJob } from "@/workers/processors/webhook.processor";
import type { WebhookJobData } from "@/types/queue";

/**
 * Phase 10 Telegram channel tests — REAL local PostgreSQL + Redis.
 *
 *   npm run test:phase10
 *
 * ⚠️ NO real Telegram bot or network call is involved. The provider
 * is tested against an injected fake-fetch TEST DOUBLE whose payloads
 * follow the official Bot API shapes (getMe, setWebhook, sendMessage,
 * sendPhoto, getFile, file download):
 *  - https://core.telegram.org/bots/api
 * See docs/TELEGRAM-SETUP.md for the operator setup.
 */

const PASSWORD = "test-password-123";
const runId = Date.now().toString(36);

const BOT_TOKEN = "123456789:AAEfakeTokenForPhase10Tests_123456";
const BAD_TOKEN = "999999999:AAEbadTokenForPhase10Tests_1234567";
const BOT_ID = "424242";
const CUSTOMER_ID = 555;
const GROUP_CHAT_ID = -100123;

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

// ─── Fake Telegram endpoints ────────────────────────────────────────

interface FakeCall {
  url: string;
  method: string;
  body?: string;
  formChatId?: string;
  formKind?: string;
  formFileName?: string;
}

function makeFakeFetch() {
  const calls: FakeCall[] = [];
  let deleteWebhookCount = 0;

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    let body: string | undefined;
    let formChatId: string | undefined;
    let formKind: string | undefined;
    let formFileName: string | undefined;
    if (typeof init?.body === "string") body = init.body;
    if (init?.body instanceof FormData) {
      formChatId = String(init.body.get("chat_id") ?? "");
      formKind = init.body.has("photo")
        ? "photo"
        : init.body.has("video")
          ? "video"
          : init.body.has("audio")
            ? "audio"
            : "document";
      const file = init.body.get(formKind);
      if (file instanceof File) formFileName = file.name;
    }
    calls.push({
      url,
      method,
      ...(body ? { body } : {}),
      ...(formChatId ? { formChatId, formKind } : {}),
      ...(formFileName ? { formFileName } : {}),
    });

    if (url.includes(`/file/bot${BOT_TOKEN}/`)) {
      return new Response(Buffer.from("JPEGDATA"), { status: 200 });
    }
    if (url.includes(`/bot${BAD_TOKEN}/`)) {
      return json(401, { ok: false, error_code: 401, description: "Unauthorized" });
    }
    if (!url.includes(`/bot${BOT_TOKEN}/`)) {
      return json(404, { ok: false, error_code: 404, description: `Fake: unexpected url ${url}` });
    }
    const apiMethod = url.split(`/bot${BOT_TOKEN}/`)[1] ?? "";
    const payload = body ? (JSON.parse(body) as Record<string, unknown>) : {};

    switch (apiMethod) {
      case "getMe":
        return json(200, {
          ok: true,
          result: { id: 424242, is_bot: true, first_name: "Test Shop Bot", username: "testshop_bot" },
        });
      case "setWebhook":
        return json(200, { ok: true, result: true });
      case "deleteWebhook":
        deleteWebhookCount += 1;
        return json(200, { ok: true, result: true });
      case "sendMessage":
        return json(200, {
          ok: true,
          result: { message_id: 9001, chat: { id: Number(payload.chat_id) || 0 } },
        });
      case "sendPhoto":
        // Telegram rejects photos whose width + height exceed
        // 10,000 px — the fake reproduces that verdict for the
        // oversized fixture name.
        if (formFileName === "big-photo.jpg") {
          return json(400, {
            ok: false,
            error_code: 400,
            description: "Bad Request: PHOTO_INVALID_DIMENSIONS",
          });
        }
        return json(200, {
          ok: true,
          result: {
            message_id: 9002,
            chat: { id: Number(formChatId ?? payload.chat_id) || 0 },
            photo: [{ file_id: "sent-photo-file-1", file_unique_id: "uq1", width: 10, height: 10 }],
          },
        });
      case "sendDocument":
        return json(200, {
          ok: true,
          result: {
            message_id: 9003,
            chat: { id: Number(formChatId ?? payload.chat_id) || 0 },
            document: { file_id: "sent-doc-file-1" },
          },
        });
      case "getFile":
        return json(200, {
          ok: true,
          result: {
            file_id: payload.file_id,
            file_unique_id: "uq-file",
            file_size: 8,
            file_path: "photos/file_1.jpg",
          },
        });
      case "getChat":
        return json(200, {
          ok: true,
          result: {
            id: Number(payload.chat_id) || 0,
            type: "private",
            first_name: "Customer",
            last_name: "One",
            username: "customerone",
          },
        });
      default:
        return json(404, { ok: false, error_code: 404, description: `Fake: no route for ${apiMethod}` });
    }
  };

  return { fetchImpl, calls, deleteWebhookCount: () => deleteWebhookCount };
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase10-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase10 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

const TEXT_UPDATE: TelegramUpdate = {
  update_id: 5001,
  message: {
    message_id: 101,
    date: 1763524800,
    chat: { id: CUSTOMER_ID, type: "private" },
    from: { id: CUSTOMER_ID, is_bot: false, first_name: "Customer", last_name: "One", username: "customerone" },
    text: "Hello, do you deliver to Pokhara?",
  },
};

async function main(): Promise<void> {
  console.log("Phase 10 — Telegram channel tests\n");

  const fake = makeFakeFetch();
  const provider = new TelegramProvider(fake.fetchImpl);
  registerProvider(provider);

  // ── Registry + capabilities ──────────────────────────────────────
  assert(
    "Registry: telegram provider registered, no messaging window",
    getProvider("telegram").id === "telegram" &&
      getProvider("telegram").capabilities.messagingWindowHours === null,
  );

  // ── Normalize (pure) ─────────────────────────────────────────────
  const n1 = normalizeTelegramUpdate(TEXT_UPDATE);
  assert(
    "Normalize: private text → sender id = user id, thread = chat id, name joined",
    n1 !== null &&
      n1.senderExternalId === String(CUSTOMER_ID) &&
      n1.externalThreadId === String(CUSTOMER_ID) &&
      n1.senderName === "Customer One" &&
      n1.type === "TEXT" &&
      n1.body === "Hello, do you deliver to Pokhara?" &&
      n1.externalMessageId === "101",
    JSON.stringify(n1),
  );

  const groupUpdate: TelegramUpdate = {
    update_id: 5002,
    message: {
      message_id: 102,
      date: 1763524860,
      chat: { id: GROUP_CHAT_ID, type: "supergroup" },
      from: { id: CUSTOMER_ID, is_bot: false, first_name: "Customer" },
      text: "Group question",
    },
  };
  const nGroup = normalizeTelegramUpdate(groupUpdate);
  assert(
    "Normalize: group message → composite identity {chatId}:{userId}, thread = group chat",
    nGroup !== null &&
      nGroup.senderExternalId === `${GROUP_CHAT_ID}:${CUSTOMER_ID}` &&
      nGroup.externalThreadId === String(GROUP_CHAT_ID),
    JSON.stringify(nGroup),
  );

  const photoUpdate: TelegramUpdate = {
    update_id: 5003,
    message: {
      message_id: 103,
      date: 1763524920,
      chat: { id: CUSTOMER_ID, type: "private" },
      from: { id: CUSTOMER_ID, is_bot: false, first_name: "Customer" },
      caption: "This arrived broken",
      photo: [
        { file_id: "photo-small", file_size: 100 },
        { file_id: "photo-large", file_size: 900 },
      ],
    },
  };
  const nPhoto = normalizeTelegramUpdate(photoUpdate);
  assert(
    "Normalize: photo → largest size as telegram-file ref, caption as body",
    nPhoto !== null &&
      nPhoto.type === "IMAGE" &&
      nPhoto.body === "This arrived broken" &&
      nPhoto.attachments?.[0]?.url === "telegram-file:photo-large" &&
      nPhoto.attachments[0]?.mimeType === "image/jpeg",
    JSON.stringify(nPhoto),
  );

  const docUpdate: TelegramUpdate = {
    update_id: 5004,
    message: {
      message_id: 104,
      date: 1763524980,
      chat: { id: CUSTOMER_ID, type: "private" },
      from: { id: CUSTOMER_ID, is_bot: false, first_name: "Customer" },
      document: { file_id: "doc-1", file_size: 2048, mime_type: "application/pdf", file_name: "invoice.pdf" },
    },
  };
  const nDoc = normalizeTelegramUpdate(docUpdate);
  assert(
    "Normalize: document → FILE with filename/mime/size",
    nDoc !== null &&
      nDoc.type === "FILE" &&
      nDoc.attachments?.[0]?.url === "telegram-file:doc-1" &&
      nDoc.attachments[0]?.fileName === "invoice.pdf" &&
      nDoc.attachments[0]?.size === 2048,
  );

  assert(
    "Normalize: bot's own messages and non-message updates are skipped",
    normalizeTelegramUpdate({
      update_id: 5005,
      message: {
        message_id: 105,
        date: 1763525000,
        chat: { id: CUSTOMER_ID, type: "private" },
        from: { id: 424242, is_bot: true, first_name: "Test Shop Bot" },
        text: "bot echo",
      },
    }) === null &&
      normalizeTelegramUpdate({ update_id: 5006 } as TelegramUpdate) === null,
  );

  // ── Connect flow ─────────────────────────────────────────────────
  const owner = await signUp("owner");
  const workspace = await workspaceService.createWorkspace(owner.id, {
    name: `Phase10 WS ${runId}`,
    timezone: "Asia/Kathmandu",
  });
  createdWorkspaceIds.push(workspace.id);

  let badTokenError: string | null = null;
  try {
    await telegramConnectionService.connectWithToken(
      owner.id,
      workspace.id,
      { botToken: BAD_TOKEN },
      { telegram: provider },
    );
  } catch (error) {
    badTokenError = error instanceof Error ? error.message : String(error);
  }
  assert(
    "Connect: Telegram-rejected token fails with guidance, nothing stored",
    badTokenError !== null &&
      badTokenError.includes("rejected") &&
      (await prisma.channel.count({ where: { workspaceId: workspace.id, provider: "TELEGRAM" } })) === 0,
    badTokenError ?? "no error",
  );

  const connected = await telegramConnectionService.connectWithToken(
    owner.id,
    workspace.id,
    { botToken: BOT_TOKEN },
    { telegram: provider },
  );
  const channel = connected.channel;
  assert(
    "Connect: channel CONNECTED, keyed by bot id, named from getMe",
    channel.status === "CONNECTED" &&
      channel.externalAccountId === BOT_ID &&
      channel.displayName === "Test Shop Bot (@testshop_bot)",
  );
  const channelConfig = channel.config as { webhookSecret?: string; webhookSubscription?: { status?: string } };
  const setWebhookCall = fake.calls.find((call) => call.url.endsWith("/setWebhook"));
  const setWebhookBody = setWebhookCall?.body ? (JSON.parse(setWebhookCall.body) as Record<string, unknown>) : {};
  assert(
    "Connect: webhook registered at the per-channel URL with the stored secret",
    setWebhookBody.url === `${getEnv().APP_URL.replace(/\/$/, "")}/api/webhooks/telegram/${channel.id}` &&
      typeof channelConfig.webhookSecret === "string" &&
      channelConfig.webhookSecret.length === 64 &&
      setWebhookBody.secret_token === channelConfig.webhookSecret &&
      channelConfig.webhookSubscription?.status === "subscribed",
    JSON.stringify(setWebhookBody),
  );
  const rawCredential = await prisma.channelCredential.findUnique({ where: { channelId: channel.id } });
  assert(
    "Connect: bot token stored encrypted, never in plaintext",
    !!rawCredential && !rawCredential.encryptedAccessToken.includes(BOT_TOKEN),
  );

  // ── Webhook ingest through the real processor ────────────────────
  const { event, duplicate } = await webhookService.recordAndEnqueue("TELEGRAM", TEXT_UPDATE, {
    externalEventId: String(TEXT_UPDATE.update_id),
    channelId: channel.id,
  });
  assert("Webhook: first delivery recorded, not a duplicate", duplicate === false);
  const { duplicate: duplicateAgain } = await webhookService.recordAndEnqueue(
    "TELEGRAM",
    TEXT_UPDATE,
    { externalEventId: String(TEXT_UPDATE.update_id), channelId: channel.id },
  );
  assert("Webhook: same update_id is deduped", duplicateAgain === true);

  await processWebhookJob({ data: { webhookEventId: event.id } } as Job<WebhookJobData>);
  const conversation = await prisma.conversation.findFirst({
    where: { workspaceId: workspace.id, channelId: channel.id },
    include: { messages: true, contact: true },
  });
  assert(
    "Webhook: conversation + message ingested, contact named from the update",
    !!conversation &&
      conversation.status === "OPEN" &&
      conversation.externalThreadId === String(CUSTOMER_ID) &&
      conversation.messages.length === 1 &&
      conversation.messages[0]?.body === "Hello, do you deliver to Pokhara?" &&
      conversation.contact.displayName === "Customer One",
    JSON.stringify(conversation?.messages),
  );

  // ── Outbound through the engine ──────────────────────────────────
  if (!conversation) throw new Error("conversation missing — cannot test outbound");
  const outbound = await messagingService.sendOutboundMessage(owner.id, workspace.id, conversation.id, {
    content: "Yes, we deliver to Pokhara in 2 days.",
  });
  const delivered = await messagingService.deliverOutboundMessage(outbound.id, {
    isFinalAttempt: true,
  });
  const sendCall = fake.calls.find((call) => call.url.endsWith("/sendMessage"));
  const sendBody = sendCall?.body ? (JSON.parse(sendCall.body) as Record<string, unknown>) : {};
  assert(
    "Outbound: delivered SENT via sendMessage to the customer's chat",
    delivered.status === "SENT" &&
      sendBody.chat_id === String(CUSTOMER_ID) &&
      sendBody.text === "Yes, we deliver to Pokhara in 2 days.",
    JSON.stringify(sendBody),
  );

  // ── Provider-level: group reply routing, media, download ─────────
  const channelContext: ChannelContext = {
    channelId: channel.id,
    workspaceId: workspace.id,
    provider: "telegram",
    externalAccountId: BOT_ID,
    credentials: { accessToken: BOT_TOKEN, scopes: [] },
  };
  const groupSent = await provider.sendMessage({
    channel: channelContext,
    toExternalId: `${GROUP_CHAT_ID}:${CUSTOMER_ID}`,
    message: { type: "TEXT", body: "Group reply", externalThreadId: String(GROUP_CHAT_ID) },
  });
  const groupCall = fake.calls.filter((call) => call.url.endsWith("/sendMessage")).at(-1);
  const groupBody = groupCall?.body ? (JSON.parse(groupCall.body) as Record<string, unknown>) : {};
  assert(
    "Send: group replies go to the group chat id, not the composite identity",
    groupSent.externalMessageId === "9001" && groupBody.chat_id === String(GROUP_CHAT_ID),
    JSON.stringify(groupBody),
  );

  const uploaded = await provider.uploadMedia({
    channel: channelContext,
    media: { bytes: Buffer.from("PNGBYTES"), mimeType: "image/png", fileName: "photo.png" },
  });
  assert(
    "Media: uploadMedia returns a telegram-pending ref (deferred upload)",
    uploaded.ref.startsWith("telegram-pending:"),
    uploaded.ref,
  );
  const mediaSent = await provider.sendMessage({
    channel: channelContext,
    toExternalId: String(CUSTOMER_ID),
    message: {
      type: "IMAGE",
      body: "Here is the photo",
      externalThreadId: String(CUSTOMER_ID),
      attachments: [{ url: uploaded.ref, mimeType: "image/png", fileName: "photo.png" }],
    },
  });
  const photoCall = fake.calls.find((call) => call.url.endsWith("/sendPhoto"));
  assert(
    "Media: pending bytes are sent as a real multipart sendPhoto",
    mediaSent.externalMessageId === "9002" &&
      photoCall?.formChatId === String(CUSTOMER_ID) &&
      photoCall?.formKind === "photo",
    JSON.stringify(photoCall),
  );
  let expiredError: string | null = null;
  try {
    await provider.sendMessage({
      channel: channelContext,
      toExternalId: String(CUSTOMER_ID),
      message: {
        type: "IMAGE",
        externalThreadId: String(CUSTOMER_ID),
        attachments: [{ url: uploaded.ref, mimeType: "image/png", fileName: "photo.png" }],
      },
    });
  } catch (error) {
    expiredError = error instanceof Error ? error.message : String(error);
  }
  assert(
    "Media: the stash is single-use — a second send of the same ref fails honestly",
    expiredError !== null && expiredError.includes("no longer available"),
    expiredError ?? "no error",
  );

  const bigUpload = await provider.uploadMedia({
    channel: channelContext,
    media: { bytes: Buffer.from("BIGJPEG"), mimeType: "image/jpeg", fileName: "big-photo.jpg" },
  });
  const bigSent = await provider.sendMessage({
    channel: channelContext,
    toExternalId: String(CUSTOMER_ID),
    message: {
      type: "IMAGE",
      body: "Full size original",
      externalThreadId: String(CUSTOMER_ID),
      attachments: [{ url: bigUpload.ref, mimeType: "image/jpeg", fileName: "big-photo.jpg" }],
    },
  });
  const docCall = fake.calls.find((call) => call.url.endsWith("/sendDocument"));
  assert(
    "Media: oversized photo falls back to sendDocument and still delivers",
    bigSent.externalMessageId === "9003" &&
      docCall?.formChatId === String(CUSTOMER_ID) &&
      docCall?.formKind === "document" &&
      docCall?.formFileName === "big-photo.jpg",
    JSON.stringify(docCall),
  );

  const downloaded = await provider.downloadMedia("telegram-file:photo-large", channelContext);
  assert(
    "Media: downloadMedia resolves a file ref to bytes via getFile",
    downloaded.toString("utf8") === "JPEGDATA",
  );

  const profile = await provider.getContactProfile(channelContext, String(CUSTOMER_ID));
  assert(
    "Profile: getContactProfile returns the name from getChat (no avatar URL exists)",
    profile.name === "Customer One" && profile.avatarUrl === undefined,
    JSON.stringify(profile),
  );

  // ── Disconnect ───────────────────────────────────────────────────
  const disconnected = await metaConnectionService.disconnectChannel(owner.id, workspace.id, channel.id, {
    telegram: provider,
  });
  assert(
    "Disconnect: webhook deleted at Telegram, credential removed, channel DISCONNECTED",
    disconnected.status === "DISCONNECTED" &&
      fake.deleteWebhookCount() === 1 &&
      (await prisma.channelCredential.count({ where: { channelId: channel.id } })) === 0,
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Phase 10 test run crashed:", error);
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
