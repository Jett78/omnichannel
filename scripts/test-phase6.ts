import { createHmac } from "node:crypto";

import type { Job } from "bullmq";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { whatsappRegisterSchema } from "@/lib/validations";
import { registerProvider } from "@/integrations/registry";
import { MetaGraphError, type FetchLike } from "@/integrations/meta/meta-graph-client";
import type { ChannelContext } from "@/integrations/types";
import { WhatsAppProvider } from "@/integrations/whatsapp/whatsapp-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import { messagingService } from "@/services/messaging.service";
import { metaConnectionService } from "@/services/meta-connection.service";
import { webhookService } from "@/services/webhook.service";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";
import { workspaceService } from "@/services/workspace.service";
import { processWebhookJob } from "@/workers/processors/webhook.processor";
import type { WebhookJobData } from "@/types/queue";

/**
 * Phase 6 WhatsApp Cloud API tests — REAL local PostgreSQL + Redis.
 *
 *   npm run test:phase6
 *
 * ⚠️ NO real WhatsApp account, Meta app, or network call is involved.
 * None exists in this environment. The provider under test is built
 * with an INJECTED FAKE FETCH — a labelled test double that implements
 * the WhatsApp Cloud API HTTP surface in memory and records every
 * call — and the webhook fixtures model real Cloud API payload shapes.
 * These tests prove our client construction, signature checks, payload
 * parsing, connection flows and engine behaviour against those shapes.
 * They do NOT prove a live WhatsApp integration; that requires a real
 * Meta app + WhatsApp Business Account (see docs/WHATSAPP-SETUP.md).
 */

// Test-only WhatsApp configuration (read lazily by meta-config).
process.env.META_APP_ID = "test-wa-app-id";
process.env.META_APP_SECRET = "test-meta-app-secret";
process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = "test-signup-config-id";
delete process.env.WHATSAPP_APP_SECRET; // fallback-to-META_APP_SECRET case first

const META_SECRET = "test-meta-app-secret";
const WA_SECRET = "test-whatsapp-app-secret";
const PASSWORD = "test-password-123";
const runId = Date.now().toString(36);

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
async function expectThrows(
  name: string,
  fn: () => Promise<unknown>,
  messageIncludes?: string,
): Promise<void> {
  try {
    await fn();
    fail(name, "expected an error but none was thrown");
  } catch (error) {
    if (messageIncludes && !(error instanceof Error && error.message.includes(messageIncludes))) {
      fail(name, `error did not mention "${messageIncludes}": ${String(error)}`);
      return;
    }
    pass(name);
  }
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// ─── Fake fetch (TEST DOUBLE for the WhatsApp Cloud API HTTP surface) ────────

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText: string;
}

type FakeResult = { status?: number; json?: unknown; bytes?: Uint8Array } | null;
type FakeHandler = (call: RecordedCall) => FakeResult;

function createFakeFetch(handler: FakeHandler): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      headers,
      bodyText: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const result = handler(call);
    if (!result) {
      return new Response(
        JSON.stringify({ error: { message: `Fake fetch: no route for ${call.method} ${url}`, code: 404 } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    if (result.bytes) {
      return new Response(Buffer.from(result.bytes), { status: result.status ?? 200 });
    }
    return new Response(JSON.stringify(result.json ?? {}), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

const PHONE_NUMBERS_RESPONSE = {
  data: [
    {
      id: "phone-1",
      display_phone_number: "+977 98000 00000",
      verified_name: "Acme Store",
      code_verification_status: "VERIFIED",
      name_status: "APPROVED",
      status: "CONNECTED",
      quality_rating: "GREEN",
      messaging_limit: "TIER_1000",
    },
    {
      id: "phone-2",
      display_phone_number: "+977 98111 11111",
      verified_name: "Acme Store 2",
      code_verification_status: "NOT_VERIFIED",
      name_status: "PENDING_REVIEW",
      status: "PENDING",
      quality_rating: "UNKNOWN",
    },
  ],
};

const TEMPLATES_RESPONSE = {
  data: [
    {
      name: "hello_world",
      status: "APPROVED",
      language: "en_US",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Hello {{1}}, welcome!" }],
    },
    {
      name: "order_update",
      status: "APPROVED",
      language: "en_US",
      category: "UTILITY",
      components: [
        { type: "HEADER", format: "TEXT", text: "Order update" },
        { type: "BODY", text: "Order {{1}} has shipped and arrives by {{2}}." },
      ],
    },
    {
      name: "promo_offer",
      status: "PENDING",
      language: "en_US",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Sale! {{1}}% off" }],
    },
  ],
};

function whatsappHandler(call: RecordedCall): FakeResult {
  const url = new URL(call.url);
  const path = url.pathname;

  if (url.hostname === "lookaside.fbsbx.example") {
    return { bytes: new TextEncoder().encode("JPEGDATA") };
  }
  if (url.hostname !== "graph.facebook.com") return null;

  if (call.method === "GET" && path === "/v25.0/oauth/access_token") {
    const code = url.searchParams.get("code");
    if (code === "code-good") return { json: { access_token: "wa-business-token", token_type: "bearer" } };
    if (code === "code-other") return { json: { access_token: "wa-other-token", token_type: "bearer" } };
    return { status: 400, json: { error: { message: "(#100) Invalid code", code: 100 } } };
  }
  if (call.method === "GET" && path === "/v25.0/debug_token") {
    const inputToken = url.searchParams.get("input_token");
    const wabaIds = inputToken === "wa-business-token" ? ["waba-1"] : ["waba-other"];
    return {
      json: {
        data: {
          is_valid: true,
          expires_at: 1_900_000_000,
          scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
          granular_scopes: [
            { scope: "whatsapp_business_management", target_ids: wabaIds },
            { scope: "whatsapp_business_messaging", target_ids: wabaIds },
          ],
        },
      },
    };
  }
  if (call.method === "GET" && path === "/v25.0/waba-1") {
    return { json: { id: "waba-1", name: "Acme WABA", currency: "USD", timezone_id: "UTC" } };
  }
  if (call.method === "GET" && path === "/v25.0/waba-bad") {
    return {
      status: 400,
      json: { error: { message: "(#100) Invalid parameter: unknown WABA", code: 100 } },
    };
  }
  if (call.method === "GET" && path === "/v25.0/waba-1/phone_numbers") {
    return { json: PHONE_NUMBERS_RESPONSE };
  }
  if (call.method === "POST" && path === "/v25.0/waba-1/subscribed_apps") {
    return { json: { success: true } };
  }
  if (call.method === "DELETE" && path === "/v25.0/waba-1/subscribed_apps") {
    return { json: { success: true } };
  }
  if (call.method === "GET" && path === "/v25.0/waba-1/message_templates") {
    return { json: TEMPLATES_RESPONSE };
  }
  if (call.method === "POST" && path === "/v25.0/phone-1/register") {
    const body = JSON.parse(call.bodyText) as { pin?: string };
    if (body.pin === "999999") {
      return {
        status: 400,
        json: {
          error: {
            message: "(#133016) Account temporarily locked due to too many failed attempts",
            code: 133016,
          },
        },
      };
    }
    return { json: { success: true } };
  }
  if (call.method === "POST" && path === "/v25.0/phone-1/deregister") {
    return { json: { success: true } };
  }
  if (call.method === "GET" && path === "/v25.0/media-img-1") {
    return {
      json: { url: "https://lookaside.fbsbx.example/download/media-img-1", mime_type: "image/jpeg", file_size: 8 },
    };
  }
  if (call.method === "POST" && path === "/v25.0/phone-1/messages") {
    const body = JSON.parse(call.bodyText) as {
      text?: { body?: string };
      status?: string;
      message_id?: string;
    };
    if (body.status === "read") return { json: { success: true } };
    if ((body.text?.body ?? "").includes("TRIGGER_131047")) {
      return {
        status: 400,
        json: {
          error: {
            message: "(#131047) Re-engagement message: the user has not replied within 24 hours",
            code: 131047,
            error_data: { messaging_product: "whatsapp", details: "Re-engagement message required" },
          },
        },
      };
    }
    return {
      json: {
        messaging_product: "whatsapp",
        contacts: [{ input: "9779801112222", wa_id: "9779801112222" }],
        messages: [{ id: `wamid.out-${Math.floor(Math.random() * 1e9)}` }],
      },
    };
  }
  return null;
}

// ─── Webhook fixtures (real Cloud API payload shapes) ────────────────────────

const WA_ID = "9779801112222";
const TS = 1_700_000_100; // seconds

function waValue(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+977 98000 00000", phone_number_id: "phone-1" },
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

const waMessagesPayload = waValue({
  contacts: [{ profile: { name: "Ram Bahadur" }, wa_id: WA_ID }],
  messages: [
    { from: WA_ID, id: "wamid.in-1", timestamp: String(TS), type: "text", text: { body: "Namaste, is this available?" } },
    {
      from: WA_ID, id: "wamid.in-2", timestamp: String(TS + 10), type: "image",
      image: { id: "media-img-1", mime_type: "image/jpeg", caption: "Photo of the item" },
    },
    {
      from: WA_ID, id: "wamid.in-3", timestamp: String(TS + 20), type: "document",
      document: { id: "media-doc-1", mime_type: "application/pdf", filename: "invoice.pdf" },
    },
    {
      from: WA_ID, id: "wamid.in-4", timestamp: String(TS + 30), type: "location",
      location: { latitude: 27.7172, longitude: 85.324, name: "Thamel", address: "Kathmandu" },
    },
    {
      from: WA_ID, id: "wamid.in-5", timestamp: String(TS + 40), type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "btn-yes", title: "Yes, book it" } },
    },
    {
      from: WA_ID, id: "wamid.in-6", timestamp: String(TS + 50), type: "reaction",
      reaction: { message_id: "wamid.in-1", emoji: "👍" },
    },
    { from: WA_ID, id: "wamid.in-7", timestamp: String(TS + 60), type: "future_type_xyz" },
  ],
});

const waStatusesPayload = waValue({
  statuses: [
    { id: "wamid.out-1", status: "read", timestamp: String(TS + 500), recipient_id: WA_ID },
    {
      id: "wamid.out-2", status: "failed", timestamp: String(TS + 600), recipient_id: WA_ID,
      errors: [
        {
          code: 131047,
          title: "Re-engagement message",
          message: "Re-engagement message",
          error_data: { details: "More than 24 hours have passed since the recipient last replied" },
        },
      ],
    },
  ],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase6-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase6 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

async function runWebhookEvent(eventId: string): Promise<void> {
  const job = {
    data: { webhookEventId: eventId, provider: "whatsapp" },
  } as unknown as Job<WebhookJobData>;
  await processWebhookJob(job);
}

const testChannel: ChannelContext = {
  channelId: "chan-test",
  workspaceId: "ws-test",
  provider: "whatsapp",
  externalAccountId: "phone-1",
  credentials: { accessToken: "wa-business-token", scopes: [] },
};

async function main(): Promise<void> {
  console.log("Phase 6 WhatsApp tests (fake-fetch test double — no real WhatsApp account)\n");

  const waFake = createFakeFetch(whatsappHandler);
  const waProvider = new WhatsAppProvider(waFake.fetchImpl);
  // Engine paths (webhook processor, outbound delivery, disconnect)
  // resolve providers through the registry — point them at the double.
  registerProvider(waProvider);

  const userA = await signUp("a");
  const userB = await signUp("b");
  const wsA = await workspaceService.createWorkspace(userA.id, { name: `WS A ${runId}` });
  const wsB = await workspaceService.createWorkspace(userB.id, { name: `WS B ${runId}` });
  createdWorkspaceIds.push(wsA.id, wsB.id);

  // ── 1. Signature verification (incl. secret fallback) ─────────────────────
  console.log("1. Signature verification");
  {
    const pure = new WhatsAppProvider();
    const body = JSON.stringify(waMessagesPayload);
    const req = (value: string | null) => ({
      headers: new Headers(value ? { "x-hub-signature-256": value } : {}),
      rawBody: body,
      searchParams: new URLSearchParams(),
    });
    assert(
      "WA sig: META_APP_SECRET fallback verifies when WHATSAPP_APP_SECRET unset",
      pure.verifyWebhook(req(sign(body, META_SECRET))),
    );
    assert("WA sig: wrong secret fails", !pure.verifyWebhook(req(sign(body, "wrong-secret"))));
    assert("WA sig: missing header fails", !pure.verifyWebhook(req(null)));

    process.env.WHATSAPP_APP_SECRET = WA_SECRET;
    assert("WA sig: explicit WHATSAPP_APP_SECRET verifies", pure.verifyWebhook(req(sign(body, WA_SECRET))));
    assert(
      "WA sig: META secret no longer verifies once WHATSAPP_APP_SECRET set",
      !pure.verifyWebhook(req(sign(body, META_SECRET))),
    );
  }

  // ── 2. Webhook parsing ─────────────────────────────────────────────────────
  console.log("2. Webhook parseWebhook");
  {
    const messages = waProvider.parseWebhook(waMessagesPayload);
    assert("WA parse: all 7 messages kept (unknown type not dropped)", messages.length === 7, `got ${messages.length}`);
    assert(
      "WA parse: text fields (wamid, wa_id, profile name, seconds→Date)",
      messages[0]?.externalMessageId === "wamid.in-1" &&
        messages[0]?.type === "TEXT" &&
        messages[0]?.body === "Namaste, is this available?" &&
        messages[0]?.senderExternalId === WA_ID &&
        messages[0]?.senderName === "Ram Bahadur" &&
        messages[0]?.sentAt.getTime() === TS * 1000,
    );
    assert(
      "WA parse: image caption + whatsapp-media attachment",
      messages[1]?.type === "IMAGE" &&
        messages[1]?.body === "Photo of the item" &&
        messages[1]?.attachments?.[0]?.url === "whatsapp-media:media-img-1" &&
        messages[1]?.attachments?.[0]?.mimeType === "image/jpeg",
    );
    assert(
      "WA parse: document → FILE with filename",
      messages[2]?.type === "FILE" && messages[2]?.attachments?.[0]?.fileName === "invoice.pdf",
    );
    assert(
      "WA parse: location body from name/address",
      messages[3]?.type === "LOCATION" && messages[3]?.body === "Thamel — Kathmandu",
    );
    assert(
      "WA parse: interactive button_reply → TEXT with the tapped title",
      messages[4]?.type === "TEXT" && messages[4]?.body === "Yes, book it",
    );
    assert(
      "WA parse: reaction → SYSTEM",
      messages[5]?.type === "SYSTEM" && (messages[5]?.body ?? "").includes("👍"),
    );
    assert(
      "WA parse: unknown type → SYSTEM naming the type",
      messages[6]?.type === "SYSTEM" &&
        messages[6]?.body === "Unsupported WhatsApp message type: future_type_xyz",
    );
    assert(
      "WA parse: non-WhatsApp payload ignored",
      waProvider.parseWebhook({ object: "page", entry: [] }).length === 0,
    );
  }

  // ── 3. Status parsing ──────────────────────────────────────────────────────
  console.log("3. Webhook parseStatusUpdates");
  {
    const updates = waProvider.parseStatusUpdates(waStatusesPayload);
    assert("WA status: 2 updates parsed", updates.length === 2, `got ${updates.length}`);
    assert(
      "WA status: read → READ with phone_number_id as channel account",
      updates[0]?.status === "READ" &&
        updates[0]?.externalMessageId === "wamid.out-1" &&
        updates[0]?.channelExternalAccountId === "phone-1" &&
        updates[0]?.contactExternalId === WA_ID,
    );
    assert(
      "WA status: failed → FAILED carrying Meta error title + details",
      updates[1]?.status === "FAILED" &&
        (updates[1]?.error ?? "").includes("Re-engagement message") &&
        (updates[1]?.error ?? "").includes("More than 24 hours"),
    );
  }

  // ── 4. sendMessage shapes / markAsRead / downloadMedia ────────────────────
  console.log("4. Provider send + media");
  {
    const before = waFake.calls.length;
    const textResult = await waProvider.sendMessage({
      channel: testChannel,
      toExternalId: WA_ID,
      message: { type: "TEXT", body: "See https://example.com/item for details" },
    });
    const textCall = waFake.calls[before];
    const textBody = JSON.parse(textCall?.bodyText ?? "{}") as {
      messaging_product?: string; to?: string; type?: string; text?: { body?: string; preview_url?: boolean };
    };
    assert(
      "WA send: text shape + preview_url true when a link is present",
      textResult.externalMessageId.startsWith("wamid.out-") &&
        textBody.messaging_product === "whatsapp" &&
        textBody.to === WA_ID &&
        textBody.type === "text" &&
        textBody.text?.preview_url === true,
    );

    const plainResult = await waProvider.sendMessage({
      channel: testChannel,
      toExternalId: WA_ID,
      message: { type: "TEXT", body: "Plain hello" },
    });
    const plainBody = JSON.parse(waFake.calls[waFake.calls.length - 1]?.bodyText ?? "{}") as {
      text?: { preview_url?: boolean };
    };
    assert(
      "WA send: preview_url false without a link",
      plainResult.externalMessageId.startsWith("wamid.out-") && plainBody.text?.preview_url === false,
    );

    await waProvider.sendMessage({
      channel: testChannel,
      toExternalId: WA_ID,
      message: {
        type: "TEMPLATE",
        templateName: "order_update",
        templateLanguage: "en_US",
        templateParams: ["ORD-9", "Friday"],
      },
    });
    const templateBody = JSON.parse(waFake.calls[waFake.calls.length - 1]?.bodyText ?? "{}") as {
      type?: string;
      template?: { name?: string; language?: { code?: string }; components?: Array<{ parameters?: Array<{ text?: string }> }> };
    };
    assert(
      "WA send: template shape (name/language/body params)",
      templateBody.type === "template" &&
        templateBody.template?.name === "order_update" &&
        templateBody.template?.language?.code === "en_US" &&
        templateBody.template?.components?.[0]?.parameters?.map((p) => p.text).join(",") === "ORD-9,Friday",
    );

    await waProvider.sendMessage({
      channel: testChannel,
      toExternalId: WA_ID,
      message: { type: "IMAGE", body: "Here it is", attachments: [{ url: "https://cdn.example.com/pic.jpg" }] },
    });
    const linkBody = JSON.parse(waFake.calls[waFake.calls.length - 1]?.bodyText ?? "{}") as {
      type?: string; image?: { link?: string; caption?: string };
    };
    assert(
      "WA send: image by link with caption",
      linkBody.type === "image" && linkBody.image?.link === "https://cdn.example.com/pic.jpg" && linkBody.image?.caption === "Here it is",
    );

    await waProvider.sendMessage({
      channel: testChannel,
      toExternalId: WA_ID,
      message: { type: "IMAGE", attachments: [{ url: "whatsapp-media:media-img-1" }] },
    });
    const idBody = JSON.parse(waFake.calls[waFake.calls.length - 1]?.bodyText ?? "{}") as {
      image?: { id?: string };
    };
    assert("WA send: image by media id", idBody.image?.id === "media-img-1");

    let caught: unknown = null;
    try {
      await waProvider.sendMessage({
        channel: testChannel,
        toExternalId: WA_ID,
        message: { type: "TEXT", body: "TRIGGER_131047" },
      });
    } catch (error) {
      caught = error;
    }
    assert(
      "WA send: Meta 131047 surfaces as MetaGraphError with its code",
      caught instanceof MetaGraphError && caught.code === 131047,
      String(caught),
    );

    await waProvider.markAsRead(testChannel, "wamid.in-1");
    const readBody = JSON.parse(waFake.calls[waFake.calls.length - 1]?.bodyText ?? "{}") as {
      status?: string; message_id?: string;
    };
    assert(
      "WA markAsRead: status read + message_id body",
      readBody.status === "read" && readBody.message_id === "wamid.in-1",
    );

    const bytes = await waProvider.downloadMedia("whatsapp-media:media-img-1", testChannel);
    const lookupCall = waFake.calls.find((c) => c.url.includes("/v25.0/media-img-1"));
    const downloadCall = waFake.calls.find((c) => c.url.includes("lookaside.fbsbx.example"));
    assert(
      "WA downloadMedia: two-step lookup + bytes returned",
      bytes.toString("utf8") === "JPEGDATA" && Boolean(lookupCall) && Boolean(downloadCall),
    );
  }

  // ── 5. Embedded Signup + selection ─────────────────────────────────────────
  console.log("5. Embedded Signup connection flow");
  let waChannelId = "";
  {
    const signup = await whatsappConnectionService.startEmbeddedSignup(
      userA.id,
      wsA.id,
      { code: "code-good", wabaId: "waba-1", phoneNumberId: "phone-1" },
      { whatsapp: waProvider },
    );
    assert(
      "Signup: session returned with WABA + sanitized numbers",
      signup.waba.id === "waba-1" &&
        signup.phoneNumbers.length === 2 &&
        signup.phoneNumbers[0]?.eligible === true &&
        signup.phoneNumbers[1]?.eligible === false &&
        Boolean(signup.phoneNumbers[1]?.ineligibleReason),
    );
    assert(
      "Signup: token never present in the result payload",
      !JSON.stringify(signup).includes("wa-business-token"),
    );
    const subscribeCall = waFake.calls.find(
      (c) => c.method === "POST" && c.url.includes("/waba-1/subscribed_apps"),
    );
    assert("Signup: WABA subscribed_apps called", Boolean(subscribeCall));

    const sessionView = await metaConnectionService.getConnectionSession(userA.id, wsA.id, signup.sessionId);
    assert(
      "Signup: session view exposes numbers, never the token",
      sessionView.provider === "WHATSAPP" &&
        sessionView.accounts.length === 2 &&
        !JSON.stringify(sessionView).includes("wa-business-token"),
    );

    await expectThrows("Signup: debug_token without the WABA in granular scopes → 403", () =>
      whatsappConnectionService.startEmbeddedSignup(
        userA.id,
        wsA.id,
        { code: "code-other", wabaId: "waba-1" },
        { whatsapp: waProvider },
      ),
    );

    const selected = await whatsappConnectionService.selectWhatsAppNumber(
      userA.id,
      wsA.id,
      signup.sessionId,
      "phone-1",
      { whatsapp: waProvider },
    );
    waChannelId = selected.channel.id;
    const config = selected.channel.config as Record<string, unknown> | null;
    assert(
      "Select: channel CONNECTED with WABA config",
      selected.channel.provider === "WHATSAPP" &&
        selected.channel.status === "CONNECTED" &&
        selected.channel.externalAccountId === "phone-1" &&
        config?.wabaId === "waba-1" &&
        config?.connectionMethod === "embedded_signup",
    );
    const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(waChannelId);
    assert(
      "Select: stored credential decrypts to the business token",
      credential?.accessToken === "wa-business-token",
    );

    const signup2 = await whatsappConnectionService.startEmbeddedSignup(
      userA.id,
      wsA.id,
      { code: "code-good", wabaId: "waba-1" },
      { whatsapp: waProvider },
    );
    await expectThrows("Select: ineligible (unverified) number rejected", () =>
      whatsappConnectionService.selectWhatsAppNumber(userA.id, wsA.id, signup2.sessionId, "phone-2", {
        whatsapp: waProvider,
      }),
    );
    await expectThrows("Cross-workspace: B cannot select from A's signup session", () =>
      whatsappConnectionService.selectWhatsAppNumber(userB.id, wsA.id, signup2.sessionId, "phone-1", {
        whatsapp: waProvider,
      }),
    );
  }

  // ── 6. Manual connect ──────────────────────────────────────────────────────
  console.log("6. Manual connect");
  {
    // One WhatsApp number per workspace: wsA already holds phone-1 (section
    // 5), so a manual connect of a DIFFERENT number is rejected there…
    await expectThrows("Manual: second WhatsApp number in a workspace is rejected", () =>
      whatsappConnectionService.connectManually(
        userA.id,
        wsA.id,
        { wabaId: "waba-1", phoneNumberId: "phone-2", accessToken: "manual-system-token" },
        { whatsapp: waProvider },
      ),
    );
    // …and succeeds in a fresh workspace.
    const wsC = await workspaceService.createWorkspace(userA.id, { name: `WS C ${runId}` });
    createdWorkspaceIds.push(wsC.id);
    const manual = await whatsappConnectionService.connectManually(
      userA.id,
      wsC.id,
      { wabaId: "waba-1", phoneNumberId: "phone-2", accessToken: "manual-system-token" },
      { whatsapp: waProvider },
    );
    const config = manual.channel.config as Record<string, unknown> | null;
    assert(
      "Manual: channel created with connectionMethod manual",
      manual.channel.externalAccountId === "phone-2" && config?.connectionMethod === "manual",
    );
    const channelsBefore = await prisma.channel.count({ where: { workspaceId: wsC.id } });
    await expectThrows("Manual: token that cannot read the WABA is rejected", () =>
      whatsappConnectionService.connectManually(
        userA.id,
        wsC.id,
        { wabaId: "waba-bad", phoneNumberId: "phone-9", accessToken: "bad-token" },
        { whatsapp: waProvider },
      ),
    );
    const channelsAfter = await prisma.channel.count({ where: { workspaceId: wsC.id } });
    assert("Manual: rejected connect created no channel", channelsAfter === channelsBefore);

    // ── 6b. Update credentials (Edit) + same-number reconnect ────────────────
    console.log("6b. Update credentials");
    const updated = await whatsappConnectionService.updateManualCredentials(
      userA.id,
      wsC.id,
      manual.channel.id,
      { accessToken: "manual-system-token-2" },
      { whatsapp: waProvider },
    );
    assert("Update creds: channel stays CONNECTED", updated.channel.status === "CONNECTED");
    const credAfterUpdate = await channelCredentialService.getDecryptedChannelCredentialForServer(
      manual.channel.id,
    );
    assert(
      "Update creds: stored token replaced",
      credAfterUpdate?.accessToken === "manual-system-token-2",
    );
    await expectThrows("Update creds: a user outside the workspace cannot update", () =>
      whatsappConnectionService.updateManualCredentials(
        userB.id,
        wsC.id,
        manual.channel.id,
        { accessToken: "manual-system-token-3" },
        { whatsapp: waProvider },
      ),
    );
    const reconnected = await whatsappConnectionService.connectManually(
      userA.id,
      wsC.id,
      { wabaId: "waba-1", phoneNumberId: "phone-2", accessToken: "manual-system-token-3" },
      { whatsapp: waProvider },
    );
    assert(
      "Manual: reconnecting the SAME number is allowed",
      reconnected.channel.id === manual.channel.id,
    );
    const credAfterReconnect =
      await channelCredentialService.getDecryptedChannelCredentialForServer(manual.channel.id);
    assert(
      "Manual: reconnect stored the new token",
      credAfterReconnect?.accessToken === "manual-system-token-3",
    );
  }

  // ── 7. Webhook pipeline ────────────────────────────────────────────────────
  console.log("7. Webhook pipeline (phone_number_id resolution)");
  let conversationId = "";
  {
    const { event } = await webhookService.recordAndEnqueue("WHATSAPP", waMessagesPayload);
    await runWebhookEvent(event.id);
    const conversation = await prisma.conversation.findFirst({
      where: { channelId: waChannelId },
      include: { contact: true, messages: true },
    });
    assert("Pipeline: conversation created via phone_number_id match", Boolean(conversation));
    conversationId = conversation?.id ?? "";
    assert(
      "Pipeline: contact phone set from wa_id + name from contacts payload",
      conversation?.contact.phone === WA_ID && conversation?.contact.displayName === "Ram Bahadur",
    );
    assert(
      "Pipeline: 7 messages stored",
      (conversation?.messages.length ?? 0) === 7,
      `got ${conversation?.messages.length}`,
    );

    const redelivered = await webhookService.recordAndEnqueue("WHATSAPP", waMessagesPayload);
    await runWebhookEvent(redelivered.event.id);
    const countAfter = await prisma.message.count({ where: { conversationId } });
    assert("Pipeline: duplicate redelivery deduplicated (still 7)", countAfter === 7, `got ${countAfter}`);

    // Outbound rows the status fixture will act on.
    const outRead = await prisma.message.create({
      data: {
        conversationId, direction: "OUTBOUND", type: "TEXT", body: "First reply",
        senderType: "AGENT", senderUserId: userA.id, status: "SENT", externalMessageId: "wamid.out-1",
      },
    });
    const outFail = await prisma.message.create({
      data: {
        conversationId, direction: "OUTBOUND", type: "TEXT", body: "Second reply",
        senderType: "AGENT", senderUserId: userA.id, status: "SENT", externalMessageId: "wamid.out-2",
      },
    });
    const statusEvent = await webhookService.recordAndEnqueue("WHATSAPP", waStatusesPayload);
    await runWebhookEvent(statusEvent.event.id);
    const readRow = await prisma.message.findUnique({ where: { id: outRead.id } });
    const failRow = await prisma.message.findUnique({ where: { id: outFail.id } });
    assert("Pipeline: read receipt advances SENT → READ", readRow?.status === "READ");
    assert(
      "Pipeline: FAILED receipt settles SENT → FAILED with Meta's error",
      failRow?.status === "FAILED" &&
        ((failRow?.metadata as { error?: string } | null)?.error ?? "").includes("Re-engagement"),
    );
    const statusEvent2 = await webhookService.recordAndEnqueue("WHATSAPP", waStatusesPayload);
    await runWebhookEvent(statusEvent2.event.id);
    const readRow2 = await prisma.message.findUnique({ where: { id: outRead.id } });
    assert("Pipeline: FAILED receipt never downgrades a READ message", readRow2?.status === "READ");
  }

  // ── 8. Window rules + template sends ───────────────────────────────────────
  console.log("8. 24h window + template send rules");
  {
    // The pipeline conversation's inbound messages carry 2023 fixture
    // timestamps — far outside the 24h window.
    const sendsBefore = waFake.calls.filter((c) => c.url.includes("/phone-1/messages")).length;
    const staleOutbound = await prisma.message.create({
      data: {
        conversationId, direction: "OUTBOUND", type: "TEXT", body: "Too late reply",
        senderType: "AGENT", senderUserId: userA.id, status: "QUEUED",
      },
    });
    const staleResult = await messagingService.deliverOutboundMessage(staleOutbound.id, { isFinalAttempt: false });
    const staleRow = await prisma.message.findUnique({ where: { id: staleOutbound.id } });
    const sendsAfter = waFake.calls.filter((c) => c.url.includes("/phone-1/messages")).length;
    assert(
      "Window: free-form outside 24h → FAILED with WhatsApp copy, no API call",
      staleResult.status === "FAILED" &&
        ((staleRow?.metadata as { error?: string } | null)?.error ?? "").includes("Outside WhatsApp's 24-hour") &&
        sendsAfter === sendsBefore,
    );

    await expectThrows(
      "Template: send without optInConfirmed rejected before queueing",
      () =>
        messagingService.sendOutboundMessage(userA.id, wsA.id, conversationId, {
          templateName: "hello_world",
          templateLanguage: "en_US",
          templateParams: ["Ram"],
          previewText: "Hello Ram, welcome!",
        }),
      "opt-in",
    );

    const templateMessage = await messagingService.sendOutboundMessage(userA.id, wsA.id, conversationId, {
      templateName: "hello_world",
      templateLanguage: "en_US",
      templateParams: ["Ram"],
      previewText: "Hello Ram, welcome!",
      optInConfirmed: true,
    });
    assert(
      "Template: queued as TEMPLATE with rendered preview body",
      templateMessage.messageType === "TEMPLATE" && templateMessage.content === "Hello Ram, welcome!",
    );
    const templateResult = await messagingService.deliverOutboundMessage(templateMessage.id, {
      isFinalAttempt: false,
    });
    const templateRow = await prisma.message.findUnique({ where: { id: templateMessage.id } });
    const templateMeta = templateRow?.metadata as {
      optInConfirmed?: boolean; whatsappTemplate?: { name?: string };
    } | null;
    assert(
      "Template: sends outside the window via the provider; opt-in recorded",
      templateResult.status === "SENT" &&
        templateRow?.status === "SENT" &&
        Boolean(templateRow?.externalMessageId) &&
        templateMeta?.optInConfirmed === true &&
        templateMeta?.whatsappTemplate?.name === "hello_world",
    );

    // Fresh conversation: free-form inside the window delivers.
    const freshContact = await prisma.contact.create({
      data: { workspaceId: wsA.id, displayName: "Fresh WA Customer", phone: "9779803334444" },
    });
    await prisma.contactIdentity.create({
      data: { contactId: freshContact.id, channelId: waChannelId, externalUserId: "9779803334444" },
    });
    const freshConversation = await prisma.conversation.create({
      data: { workspaceId: wsA.id, channelId: waChannelId, contactId: freshContact.id, status: "OPEN" },
    });
    await prisma.message.create({
      data: {
        conversationId: freshConversation.id, direction: "INBOUND", type: "TEXT", body: "Hi!",
        senderType: "CONTACT", externalMessageId: "wamid.fresh-1", status: "RECEIVED", sentAt: new Date(),
      },
    });
    const freshOutbound = await prisma.message.create({
      data: {
        conversationId: freshConversation.id, direction: "OUTBOUND", type: "TEXT", body: "Hello back",
        senderType: "AGENT", senderUserId: userA.id, status: "QUEUED",
      },
    });
    const freshResult = await messagingService.deliverOutboundMessage(freshOutbound.id, { isFinalAttempt: false });
    assert("Window: free-form inside 24h delivers", freshResult.status === "SENT");
  }

  // ── 9. Register + templates + cross-workspace ─────────────────────────────
  console.log("9. Register, templates, isolation");
  {
    assert(
      "Register: PIN schema requires exactly 6 digits",
      !whatsappRegisterSchema.safeParse({ pin: "12345" }).success &&
        whatsappRegisterSchema.safeParse({ pin: "123456" }).success,
    );
    await whatsappConnectionService.registerPhoneNumber(userA.id, wsA.id, waChannelId, "123456", {
      whatsapp: waProvider,
    });
    const registerCall = waFake.calls.find((c) => c.url.includes("/phone-1/register"));
    const registerBody = JSON.parse(registerCall?.bodyText ?? "{}") as { pin?: string };
    assert("Register: PIN posted to the Cloud API", registerBody.pin === "123456");
    await expectThrows(
      "Register: Meta 133016 lockout surfaces verbatim",
      () =>
        whatsappConnectionService.registerPhoneNumber(userA.id, wsA.id, waChannelId, "999999", {
          whatsapp: waProvider,
        }),
      "133016",
    );

    const templates = await whatsappConnectionService.listApprovedTemplates(userA.id, wsA.id, waChannelId, {
      whatsapp: waProvider,
    });
    assert(
      "Templates: APPROVED only, body text + paramsCount derived",
      templates.length === 2 &&
        templates.find((t) => t.name === "order_update")?.paramsCount === 2 &&
        templates.find((t) => t.name === "hello_world")?.bodyText === "Hello {{1}}, welcome!",
      JSON.stringify(templates),
    );

    await expectThrows("Cross-workspace: B cannot register A's number", () =>
      whatsappConnectionService.registerPhoneNumber(userB.id, wsA.id, waChannelId, "123456", {
        whatsapp: waProvider,
      }),
    );
    await expectThrows("Cross-workspace: B cannot list A's templates", () =>
      whatsappConnectionService.listApprovedTemplates(userB.id, wsA.id, waChannelId, {
        whatsapp: waProvider,
      }),
    );
    await expectThrows("Cross-workspace: B cannot disconnect A's WhatsApp channel", () =>
      metaConnectionService.disconnectChannel(userB.id, wsA.id, waChannelId, { whatsapp: waProvider }),
    );
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  console.log("\nCleanup done (workspaces + users deleted).");
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("\nTest run crashed:", error);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
