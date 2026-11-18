import { createHash, createHmac } from "node:crypto";

import type { Job } from "bullmq";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { registerProvider } from "@/integrations/registry";
import { FacebookProvider } from "@/integrations/meta/facebook-provider";
import { InstagramProvider } from "@/integrations/meta/instagram-provider";
import { MetaGraphError, type FetchLike } from "@/integrations/meta/meta-graph-client";
import type { ChannelContext } from "@/integrations/types";
import { channelCredentialService } from "@/services/channel-credential.service";
import { messagingService } from "@/services/messaging.service";
import { metaConnectionService } from "@/services/meta-connection.service";
import { webhookService } from "@/services/webhook.service";
import { workspaceService } from "@/services/workspace.service";
import { processWebhookJob } from "@/workers/processors/webhook.processor";
import type { WebhookJobData } from "@/types/queue";

/**
 * Phase 5 Meta integration tests — REAL local PostgreSQL + Redis.
 *
 *   npm run test:phase5
 *
 * ⚠️ NO real Meta account, app, or network call is involved. None
 * exists in this environment. The providers under test are built with
 * an INJECTED FAKE FETCH — a labelled test double that implements the
 * Meta Graph HTTP surface in memory and records every call — and the
 * webhook fixtures model real Meta payload shapes. These tests prove
 * our client construction, signature checks, payload parsing, OAuth
 * session flow and engine behaviour against those shapes. They do NOT
 * prove a live Meta integration; that requires a real Meta app (see
 * docs/META-APP-REVIEW.md).
 */

// Test-only Meta configuration (read lazily by meta-config at call time).
process.env.META_APP_ID = "test-fb-app-id";
process.env.META_APP_SECRET = "test-fb-app-secret";
process.env.META_WEBHOOK_VERIFY_TOKEN = "test-verify-token";
process.env.INSTAGRAM_APP_ID = "test-ig-app-id";
process.env.INSTAGRAM_APP_SECRET = "test-ig-app-secret";

const FB_SECRET = "test-fb-app-secret";
const IG_SECRET = "test-ig-app-secret";
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

// ─── Fake fetch (TEST DOUBLE for the Meta Graph HTTP surface) ────────────────

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText: string;
}

type FakeHandler = (call: RecordedCall) => { status?: number; json: unknown } | null;

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
        JSON.stringify({
          error: { message: `Fake fetch: no route for ${call.method} ${url}`, code: 404 },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(result.json), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

const FB_PAGES_RESPONSE = {
  data: [
    {
      id: "page-1001",
      name: "Acme Store",
      category: "Shopping & retail",
      access_token: "page-token-1001",
      tasks: ["MANAGE", "CREATE_CONTENT", "MODERATE"],
      instagram_business_account: {
        id: "ig-biz-2001",
        username: "acme.store",
        name: "Acme Store",
        profile_picture_url: "https://example.com/acme.jpg",
      },
    },
    {
      id: "page-1002",
      name: "View Only Page",
      category: "Brand",
      access_token: "page-token-1002",
      tasks: ["VIEW"],
    },
  ],
  paging: {},
};

/** Mutable fake state: the page-autherr send route fails with a Meta
 * 190 (dead token) until a test flips this off to simulate recovery. */
const fakeState = { authErrorPageFails: true };

function facebookHandler(call: RecordedCall): { status?: number; json: unknown } | null {
  const url = new URL(call.url);
  const path = url.pathname;
  if (url.hostname !== "graph.facebook.com") return null;
  if (call.method === "POST" && path === "/v25.0/oauth/access_token") {
    return {
      json: { access_token: "fb-short-user-token", token_type: "bearer", expires_in: 3600 },
    };
  }
  if (
    call.method === "GET" &&
    path === "/v25.0/oauth/access_token" &&
    url.searchParams.get("grant_type") === "fb_exchange_token"
  ) {
    return {
      json: { access_token: "fb-long-user-token", token_type: "bearer", expires_in: 5184000 },
    };
  }
  if (call.method === "GET" && path === "/v25.0/me/accounts") return { json: FB_PAGES_RESPONSE };
  if (call.method === "POST" && path === "/v25.0/page-1001/subscribed_apps") {
    return { json: { success: true } };
  }
  if (call.method === "DELETE" && path === "/v25.0/page-1001/subscribed_apps") {
    return { json: { success: true } };
  }
  if (call.method === "POST" && path === "/v25.0/page-1001/messages") {
    return { json: { recipient_id: "psid-9", message_id: "fb-out-mid-1" } };
  }
  if (call.method === "POST" && path === "/v25.0/page-1001/message_attachments") {
    return { json: { attachment_id: "att-fb-1" } };
  }
  if (call.method === "GET" && path === "/v25.0/page-1001/conversations") {
    // History import fixture: one old thread, messages newest-first
    // (as Meta returns them).
    return {
      json: {
        data: [
          {
            id: "thread-old-1",
            participants: {
              data: [
                { id: "page-1001", name: "Acme Store" },
                { id: "psid-old", name: "Old Customer" },
              ],
            },
            messages: {
              data: [
                {
                  id: "mid-old-2",
                  message: "Old answer from the shop",
                  from: { id: "page-1001", name: "Acme Store" },
                  created_time: "2026-11-10T10:05:00+0000",
                },
                {
                  id: "mid-old-1",
                  message: "Old question",
                  from: { id: "psid-old", name: "Old Customer" },
                  created_time: "2026-11-10T10:00:00+0000",
                },
              ],
            },
          },
        ],
      },
    };
  }
  if (call.method === "GET" && path === "/v25.0/psid-9") {
    // User Profile API for the webhook test sender.
    return {
      json: {
        first_name: "Hook",
        last_name: "Tester",
        profile_pic: "https://example.com/psid-9.jpg",
      },
    };
  }
  if (call.method === "POST" && path === "/v25.0/page-autherr/messages") {
    if (fakeState.authErrorPageFails) {
      return {
        status: 400,
        json: {
          error: {
            message: "(#190) OAuthException - The access token has expired",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
            fbtrace_id: "trace-190",
          },
        },
      };
    }
    return { json: { recipient_id: "psid-autherr", message_id: "fb-out-autherr-1" } };
  }
  if (call.method === "POST" && path === "/v25.0/page-error/messages") {
    return {
      status: 400,
      json: {
        error: {
          message: "(#100) Invalid parameter",
          type: "OAuthException",
          code: 100,
          error_subcode: 2018001,
          fbtrace_id: "trace-abc",
        },
      },
    };
  }
  return null;
}

function instagramHandler(profile: Record<string, unknown>): FakeHandler {
  return (call) => {
    const url = new URL(call.url);
    const path = url.pathname;
    if (
      url.hostname === "api.instagram.com" &&
      call.method === "POST" &&
      path === "/oauth/access_token"
    ) {
      return {
        json: {
          access_token: "ig-short-token",
          user_id: 998877,
          permissions: ["instagram_business_basic", "instagram_business_manage_messages"],
        },
      };
    }
    if (url.hostname !== "graph.instagram.com") return null;
    if (call.method === "GET" && path === "/access_token") {
      return { json: { access_token: "ig-long-token", token_type: "bearer", expires_in: 5184000 } };
    }
    if (call.method === "GET" && path === "/v25.0/me") return { json: profile };
    if (call.method === "POST" && path === "/v25.0/me/subscribed_apps") {
      return { json: { success: true } };
    }
    if (call.method === "DELETE" && path === "/v25.0/me/subscribed_apps") {
      return { json: { success: true } };
    }
    if (call.method === "POST" && path === "/v25.0/ig-acct-3001/messages") {
      return { json: { message_id: "ig-out-mid-1", recipient_id: "igsid-1" } };
    }
    return null;
  };
}

const IG_PROFILE_CREATOR = {
  id: "ig-acct-3001",
  user_id: "998877",
  username: "creator.shop",
  name: "Creator Shop",
  account_type: "MEDIA_CREATOR",
  profile_picture_url: "https://example.com/creator.jpg",
};

const IG_PROFILE_PERSONAL = {
  id: "ig-acct-4001",
  user_id: "998877",
  username: "personal.user",
  name: "Personal User",
  account_type: "PERSONAL",
};

// ─── Webhook fixtures (real Meta payload shapes) ─────────────────────────────

const T0 = 1_700_000_000_000;

const fbMessagePayload = {
  object: "page",
  entry: [
    {
      id: "page-1001",
      time: T0,
      messaging: [
        {
          sender: { id: "psid-1" },
          recipient: { id: "page-1001" },
          timestamp: T0 + 100,
          message: { mid: "mid-text-1", text: "Hello there" },
        },
        {
          sender: { id: "psid-1" },
          recipient: { id: "page-1001" },
          timestamp: T0 + 200,
          message: {
            mid: "mid-img-1",
            attachments: [{ type: "image", payload: { url: "https://cdn.example.com/pic.jpg" } }],
          },
        },
        {
          sender: { id: "page-1001" },
          recipient: { id: "psid-1" },
          timestamp: T0 + 300,
          message: { mid: "mid-echo-1", text: "echo of our own send", is_echo: true },
        },
        {
          sender: { id: "psid-2" },
          recipient: { id: "page-1001" },
          timestamp: T0 + 400,
          postback: { title: "Get Started", payload: "GET_STARTED" },
        },
      ],
    },
  ],
};

const fbDeliveryPayload = {
  object: "page",
  entry: [
    {
      id: "page-1001",
      time: T0 + 1000,
      messaging: [
        {
          sender: { id: "psid-9" },
          recipient: { id: "page-1001" },
          timestamp: T0 + 1000,
          delivery: { mids: ["fb-out-mid-1"], watermark: T0 + 900 },
        },
      ],
    },
  ],
};

const fbReadPayload = {
  object: "page",
  entry: [
    {
      id: "page-1001",
      time: T0 + 2000,
      messaging: [
        {
          sender: { id: "psid-9" },
          recipient: { id: "page-1001" },
          timestamp: T0 + 2000,
          read: { mid: "fb-out-mid-1", watermark: T0 + 1900 },
        },
      ],
    },
  ],
};

const igMessagePayload = {
  object: "instagram",
  entry: [
    {
      id: "ig-acct-3001",
      time: T0,
      messaging: [
        {
          sender: { id: "igsid-1" },
          recipient: { id: "ig-acct-3001" },
          timestamp: T0 + 100,
          message: { mid: "ig-mid-1", text: "Hi from Instagram" },
        },
        {
          sender: { id: "igsid-1" },
          recipient: { id: "ig-acct-3001" },
          timestamp: T0 + 200,
          message: {
            mid: "ig-mid-2",
            attachments: [
              { type: "story_mention", payload: { url: "https://cdn.example.com/story.jpg" } },
            ],
          },
        },
        {
          sender: { id: "ig-acct-3001" },
          recipient: { id: "igsid-1" },
          timestamp: T0 + 300,
          message: { mid: "ig-echo-1", text: "echo", is_echo: true },
        },
        {
          sender: { id: "igsid-1" },
          recipient: { id: "ig-acct-3001" },
          timestamp: T0 + 400,
          read: { watermark: T0 + 350 },
        },
      ],
    },
  ],
};

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function channelContext(externalAccountId: string, accessToken: string): ChannelContext {
  return {
    channelId: "test-channel",
    workspaceId: "test-workspace",
    provider: "facebook",
    externalAccountId,
    credentials: { accessToken, scopes: [] },
  };
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase5-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase5 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

async function runWebhookEvent(eventId: string): Promise<void> {
  const job = {
    data: { webhookEventId: eventId, provider: "facebook" },
  } as unknown as Job<WebhookJobData>;
  await processWebhookJob(job);
}

async function main(): Promise<void> {
  console.log("Phase 5 Meta tests (fake-fetch test double — no real Meta account)\n");

  const fbFake = createFakeFetch(facebookHandler);
  const igFake = createFakeFetch(instagramHandler(IG_PROFILE_CREATOR));
  const igPersonalFake = createFakeFetch(instagramHandler(IG_PROFILE_PERSONAL));
  const fbProvider = new FacebookProvider(fbFake.fetchImpl);
  const igProvider = new InstagramProvider(igFake.fetchImpl);
  const igPersonalProvider = new InstagramProvider(igPersonalFake.fetchImpl);
  // Engine paths (webhook processor, outbound delivery) resolve
  // providers through the registry — point them at the test doubles.
  registerProvider(fbProvider);
  registerProvider(igProvider);

  // ── 1. Webhook signature verification ──────────────────────────────────────
  console.log("1. Signature verification");
  {
    const body = JSON.stringify(fbMessagePayload);
    const headers = (value: string | null) =>
      new Headers(value ? { "x-hub-signature-256": value } : {});
    const req = (h: Headers) => ({
      headers: h,
      rawBody: body,
      searchParams: new URLSearchParams(),
    });
    const pureFb = new FacebookProvider();
    assert("FB: correct HMAC passes", pureFb.verifyWebhook(req(headers(sign(body, FB_SECRET)))));
    assert(
      "FB: signature with wrong secret fails",
      !pureFb.verifyWebhook(req(headers(sign(body, "wrong-secret")))),
    );
    assert(
      "FB: tampered body fails",
      !pureFb.verifyWebhook({
        headers: headers(sign(body, FB_SECRET)),
        rawBody: `${body} `,
        searchParams: new URLSearchParams(),
      }),
    );
    assert("FB: missing header fails", !pureFb.verifyWebhook(req(headers(null))));
    assert("FB: malformed header fails", !pureFb.verifyWebhook(req(headers("sha1=deadbeef"))));
    const pureIg = new InstagramProvider();
    assert("IG: correct HMAC passes", pureIg.verifyWebhook(req(headers(sign(body, IG_SECRET)))));
    assert(
      "IG: FB secret does not verify IG webhooks",
      !pureIg.verifyWebhook(req(headers(sign(body, FB_SECRET)))),
    );
  }

  // ── 2. Facebook webhook parsing ────────────────────────────────────────────
  console.log("2. Facebook parseWebhook / parseStatusUpdates");
  {
    const messages = fbProvider.parseWebhook(fbMessagePayload);
    assert("FB parse: 3 messages (echo skipped)", messages.length === 3, `got ${messages.length}`);
    assert(
      "FB parse: text message fields",
      messages[0]?.externalMessageId === "mid-text-1" &&
        messages[0]?.type === "TEXT" &&
        messages[0]?.body === "Hello there" &&
        messages[0]?.senderExternalId === "psid-1" &&
        messages[0]?.sentAt.getTime() === T0 + 100,
    );
    assert(
      "FB parse: image attachment",
      messages[1]?.type === "IMAGE" &&
        messages[1]?.attachments?.[0]?.url === "https://cdn.example.com/pic.jpg",
    );
    assert(
      "FB parse: postback → SYSTEM with deterministic id",
      messages[2]?.type === "SYSTEM" &&
        messages[2]?.body === "Get Started" &&
        messages[2]?.externalMessageId === `postback:psid-2:${T0 + 400}:GET_STARTED`,
    );
    assert(
      "FB parse: instagram-object payload ignored",
      fbProvider.parseWebhook(igMessagePayload).length === 0,
    );
    const delivery = fbProvider.parseStatusUpdates(fbDeliveryPayload);
    assert(
      "FB status: delivery → per-mid DELIVERED",
      delivery.length === 1 &&
        delivery[0]?.externalMessageId === "fb-out-mid-1" &&
        delivery[0]?.status === "DELIVERED" &&
        delivery[0]?.channelExternalAccountId === "page-1001" &&
        delivery[0]?.contactExternalId === "psid-9",
    );
    const read = fbProvider.parseStatusUpdates(fbReadPayload);
    assert(
      "FB status: read with mid → READ",
      read.length === 1 &&
        read[0]?.status === "READ" &&
        read[0]?.externalMessageId === "fb-out-mid-1",
    );
    const readWatermark = fbProvider.parseStatusUpdates({
      object: "page",
      entry: [
        {
          id: "page-1001",
          messaging: [
            { sender: { id: "psid-9" }, timestamp: T0 + 3000, read: { watermark: T0 + 2900 } },
          ],
        },
      ],
    });
    assert(
      "FB status: read without mid → watermark update",
      readWatermark.length === 1 &&
        readWatermark[0]?.externalMessageId === null &&
        readWatermark[0]?.watermark?.getTime() === T0 + 2900,
    );
  }

  // ── 3. Instagram webhook parsing ───────────────────────────────────────────
  console.log("3. Instagram parseWebhook / parseStatusUpdates");
  {
    const messages = igProvider.parseWebhook(igMessagePayload);
    assert("IG parse: 2 messages (echo skipped)", messages.length === 2, `got ${messages.length}`);
    assert(
      "IG parse: DM text",
      messages[0]?.externalMessageId === "ig-mid-1" && messages[0]?.body === "Hi from Instagram",
    );
    assert(
      "IG parse: story_mention attachment kept (FILE + url)",
      messages[1]?.type === "FILE" &&
        messages[1]?.attachments?.[0]?.url === "https://cdn.example.com/story.jpg",
    );
    const updates = igProvider.parseStatusUpdates(igMessagePayload);
    assert(
      "IG status: read event → READ watermark update",
      updates.length === 1 &&
        updates[0]?.status === "READ" &&
        updates[0]?.externalMessageId === null &&
        updates[0]?.channelExternalAccountId === "ig-acct-3001",
    );
  }

  // ── 4/5. sendMessage over the fake Graph surface ───────────────────────────
  console.log("4/5. sendMessage (Facebook + Instagram)");
  {
    const before = fbFake.calls.length;
    const sent = await fbProvider.sendMessage({
      channel: channelContext("page-1001", "page-token-1001"),
      toExternalId: "psid-1",
      message: { type: "TEXT", body: "Thanks for your message" },
    });
    const call = fbFake.calls[before];
    assert("FB send: returns Meta message_id", sent.externalMessageId === "fb-out-mid-1");
    assert(
      "FB send: URL + Bearer header (token not in URL)",
      call?.url === "https://graph.facebook.com/v25.0/page-1001/messages" &&
        call?.headers.authorization === "Bearer page-token-1001" &&
        !call?.url.includes("page-token-1001"),
    );
    const sentBody = JSON.parse(call?.bodyText ?? "{}") as {
      messaging_type?: string;
      recipient?: { id?: string };
      message?: { text?: string };
    };
    assert(
      "FB send: RESPONSE messaging_type + recipient + text",
      sentBody.messaging_type === "RESPONSE" &&
        sentBody.recipient?.id === "psid-1" &&
        sentBody.message?.text === "Thanks for your message",
    );

    const attBefore = fbFake.calls.length;
    await fbProvider.sendMessage({
      channel: channelContext("page-1001", "page-token-1001"),
      toExternalId: "psid-1",
      message: {
        type: "IMAGE",
        attachments: [{ url: "https://cdn.example.com/out.jpg", mimeType: "image/jpeg" }],
      },
    });
    const attBody = JSON.parse(fbFake.calls[attBefore]?.bodyText ?? "{}") as {
      message?: {
        attachment?: { type?: string; payload?: { url?: string; is_reusable?: boolean } };
      };
    };
    assert(
      "FB send: attachment shape",
      attBody.message?.attachment?.type === "image" &&
        attBody.message?.attachment?.payload?.url === "https://cdn.example.com/out.jpg" &&
        attBody.message?.attachment?.payload?.is_reusable === false,
    );

    try {
      await fbProvider.sendMessage({
        channel: channelContext("page-error", "super-secret-page-token"),
        toExternalId: "psid-1",
        message: { type: "TEXT", body: "boom" },
      });
      fail("FB send: Meta error surfaces as MetaGraphError", "no error thrown");
    } catch (error) {
      assert(
        "FB send: Meta error surfaces as MetaGraphError (code/subcode, no token in message)",
        error instanceof MetaGraphError &&
          error.code === 100 &&
          error.subcode === 2018001 &&
          error.fbtraceId === "trace-abc" &&
          !error.message.includes("super-secret-page-token"),
      );
    }

    const igBefore = igFake.calls.length;
    const igSent = await igProvider.sendMessage({
      channel: { ...channelContext("ig-acct-3001", "ig-long-token"), provider: "instagram" },
      toExternalId: "igsid-1",
      message: { type: "TEXT", body: "Hello IG" },
    });
    const igCall = igFake.calls[igBefore];
    assert(
      "IG send: graph.instagram.com /{igId}/messages with Bearer token",
      igSent.externalMessageId === "ig-out-mid-1" &&
        igCall?.url === "https://graph.instagram.com/v25.0/ig-acct-3001/messages" &&
        igCall?.headers.authorization === "Bearer ig-long-token",
    );
  }

  // ── Users + workspaces ─────────────────────────────────────────────────────
  const userA = await signUp("a");
  const userB = await signUp("b");
  const wsA = await workspaceService.createWorkspace(userA.id, { name: `WS A ${runId}` });
  const wsB = await workspaceService.createWorkspace(userB.id, { name: `WS B ${runId}` });
  createdWorkspaceIds.push(wsA.id, wsB.id);

  // ── 6. Facebook OAuth session flow ─────────────────────────────────────────
  console.log("6. Facebook OAuth session flow");
  let fbChannelId = "";
  {
    const deps = { facebook: fbProvider };
    const start = await metaConnectionService.startFacebookConnect(userA.id, wsA.id, deps);
    assert(
      "FB OAuth: auth URL is the official dialog with our scopes",
      start.authUrl.startsWith("https://www.facebook.com/v25.0/dialog/oauth?") &&
        start.authUrl.includes("pages_messaging") &&
        start.authUrl.includes(`state=${start.state}`),
    );
    const sessionRow = await prisma.oAuthConnectionSession.findUnique({
      where: { stateHash: createHash("sha256").update(start.state).digest("hex") },
    });
    assert(
      "FB OAuth: session row stores only the state HASH",
      sessionRow !== null && sessionRow.provider === "FACEBOOK" && sessionRow.consumedAt === null,
    );

    const callback = await metaConnectionService.handleFacebookCallback(
      userA.id,
      start.state,
      "auth-code-1",
      deps,
    );
    const tokenCall = fbFake.calls.find(
      (c) => c.method === "POST" && c.url.includes("/oauth/access_token"),
    );
    const exchangeCall = fbFake.calls.find(
      (c) => c.method === "GET" && c.url.includes("fb_exchange_token"),
    );
    const accountsCall = fbFake.calls.find((c) => c.url.includes("/me/accounts"));
    assert(
      "FB OAuth: code exchange + long-lived exchange + /me/accounts with user token",
      Boolean(tokenCall) &&
        Boolean(exchangeCall) &&
        accountsCall?.headers.authorization === "Bearer fb-long-user-token",
    );

    const view = await metaConnectionService.getConnectionSession(
      userA.id,
      wsA.id,
      callback.sessionId,
    );
    assert(
      "FB session: both pages listed, eligible + ineligible flagged",
      view.accounts.length === 2 &&
        view.accounts[0]?.eligible === true &&
        view.accounts[1]?.eligible === false &&
        (view.accounts[1]?.ineligibleReason ?? "").includes("MODERATE"),
    );
    const viewJson = JSON.stringify(view);
    assert(
      "FB session: sanitized view contains NO tokens",
      !viewJson.includes("page-token-1001") &&
        !viewJson.includes("page-token-1002") &&
        !viewJson.includes("fb-long-user-token"),
    );

    await expectThrows(
      "FB select: ineligible page rejected",
      () =>
        metaConnectionService.selectConnectionAccount(
          userA.id,
          wsA.id,
          callback.sessionId,
          "page-1002",
          deps,
        ),
      "MODERATE",
    );

    const selected = await metaConnectionService.selectConnectionAccount(
      userA.id,
      wsA.id,
      callback.sessionId,
      "page-1001",
      deps,
    );
    fbChannelId = selected.channel.id;
    assert(
      "FB select: channel CONNECTED with facebook-login config + linked IG account",
      selected.channel.status === "CONNECTED" &&
        selected.channel.provider === "FACEBOOK" &&
        selected.channel.externalAccountId === "page-1001" &&
        (selected.channel.config as { authModel?: string }).authModel === "facebook-login" &&
        (selected.channel.config as { instagramBusinessAccountId?: string })
          .instagramBusinessAccountId === "ig-biz-2001" &&
        selected.subscriptionWarning === undefined,
    );
    const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(
      selected.channel.id,
    );
    assert(
      "FB select: stored credential decrypts to the Page token",
      credential?.accessToken === "page-token-1001",
    );
    const subscribeCall = fbFake.calls.find(
      (c) => c.method === "POST" && c.url.includes("/page-1001/subscribed_apps"),
    );
    assert(
      "FB select: webhook subscription requested with delivery/read fields",
      Boolean(subscribeCall) &&
        (subscribeCall?.url ?? "").includes("message_deliveries") &&
        (subscribeCall?.url ?? "").includes("message_reads"),
    );

    await expectThrows("FB select: consumed session cannot be reused", () =>
      metaConnectionService.selectConnectionAccount(
        userA.id,
        wsA.id,
        callback.sessionId,
        "page-1001",
        deps,
      ),
    );

    // Unconfigured deployment → clear 503 naming the missing var.
    const savedSecret = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    await expectThrows(
      "FB connect: missing META_APP_SECRET → 503 naming the variable",
      () => metaConnectionService.startFacebookConnect(userA.id, wsA.id, deps),
      "META_APP_SECRET",
    );
    process.env.META_APP_SECRET = savedSecret;
  }

  // ── 7. Instagram OAuth session flow ────────────────────────────────────────
  console.log("7. Instagram OAuth session flow");
  {
    const deps = { instagram: igProvider };
    const start = await metaConnectionService.startInstagramConnect(userA.id, wsA.id, deps);
    assert(
      "IG OAuth: auth URL is instagram.com/oauth/authorize with business scopes",
      start.authUrl.startsWith("https://www.instagram.com/oauth/authorize?") &&
        start.authUrl.includes("instagram_business_manage_messages"),
    );
    const callback = await metaConnectionService.handleInstagramCallback(
      userA.id,
      start.state,
      "ig-auth-code",
      deps,
    );
    const formCall = igFake.calls.find((c) => c.url.startsWith("https://api.instagram.com/"));
    assert(
      "IG OAuth: code exchanged via api.instagram.com FORM post",
      Boolean(formCall) &&
        (formCall?.bodyText ?? "").includes("grant_type=authorization_code") &&
        (formCall?.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded"),
    );
    const view = await metaConnectionService.getConnectionSession(
      userA.id,
      wsA.id,
      callback.sessionId,
    );
    assert(
      "IG session: creator account eligible, shown as @creator.shop, no token leaked",
      view.accounts.length === 1 &&
        view.accounts[0]?.eligible === true &&
        view.accounts[0]?.detail === "@creator.shop" &&
        !JSON.stringify(view).includes("ig-long-token"),
    );
    const selected = await metaConnectionService.selectConnectionAccount(
      userA.id,
      wsA.id,
      callback.sessionId,
      "ig-acct-3001",
      deps,
    );
    const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(
      selected.channel.id,
    );
    assert(
      "IG select: channel + long-lived token + expiry stored",
      selected.channel.provider === "INSTAGRAM" &&
        selected.channel.externalAccountId === "ig-acct-3001" &&
        credential?.accessToken === "ig-long-token" &&
        credential?.tokenExpiresAt !== null &&
        (credential?.tokenExpiresAt?.getTime() ?? 0) > Date.now(),
    );

    // Personal account → ineligible end-to-end.
    const personalDeps = { instagram: igPersonalProvider };
    const pStart = await metaConnectionService.startInstagramConnect(
      userA.id,
      wsA.id,
      personalDeps,
    );
    const pCallback = await metaConnectionService.handleInstagramCallback(
      userA.id,
      pStart.state,
      "ig-auth-code-personal",
      personalDeps,
    );
    const pView = await metaConnectionService.getConnectionSession(
      userA.id,
      wsA.id,
      pCallback.sessionId,
    );
    assert(
      "IG session: PERSONAL account flagged ineligible with the professional-account reason",
      pView.accounts[0]?.eligible === false &&
        (pView.accounts[0]?.ineligibleReason ?? "").includes(
          "Personal Instagram accounts are not eligible",
        ),
    );
    await expectThrows(
      "IG select: PERSONAL account rejected",
      () =>
        metaConnectionService.selectConnectionAccount(
          userA.id,
          wsA.id,
          pCallback.sessionId,
          "ig-acct-4001",
          personalDeps,
        ),
      "Personal Instagram accounts are not eligible",
    );
  }

  // ── 8. Webhook pipeline + delivery/read status application ─────────────────
  // ── 7b. Instagram Unified Login flow (newer Meta apps) ─────────────────────
  console.log("7b. Instagram Unified Login flow");
  {
    process.env.INSTAGRAM_LOGIN_CONFIG_ID = "test-ig-config-1";
    try {
      // The unified flow's Instagram provider talks to
      // graph.facebook.com, so its test double is backed by the
      // Facebook fake fetch (in production both use the real fetch).
      const deps = { facebook: fbProvider, instagram: new InstagramProvider(fbFake.fetchImpl) };
      const start = await metaConnectionService.startInstagramConnect(userA.id, wsA.id, deps);
      assert(
        "IG unified: auth URL is the Facebook dialog with config_id + Instagram redirect",
        start.authUrl.startsWith("https://www.facebook.com/v25.0/dialog/oauth?") &&
          start.authUrl.includes("config_id=test-ig-config-1") &&
          start.authUrl.includes("oauth%2Finstagram%2Fcallback") &&
          !start.authUrl.includes("instagram.com"),
        start.authUrl,
      );
      const fbCallsBefore = fbFake.calls.length;
      const callback = await metaConnectionService.handleInstagramCallback(
        userA.id,
        start.state,
        "ig-unified-code",
        deps,
      );
      const exchangeCall = fbFake.calls
        .slice(fbCallsBefore)
        .find((c) => c.method === "POST" && c.url.includes("/oauth/access_token"));
      assert(
        "IG unified: code exchanged on graph.facebook.com with the Instagram redirect_uri",
        Boolean(exchangeCall) && (exchangeCall?.bodyText ?? "").includes("oauth/instagram/callback"),
        exchangeCall?.bodyText,
      );
      const view = await metaConnectionService.getConnectionSession(
        userA.id,
        wsA.id,
        callback.sessionId,
      );
      const igAccount = view.accounts.find((a) => a.externalAccountId === "ig-biz-2001");
      const noIgPage = view.accounts.find((a) => a.externalAccountId === "page-1002");
      assert(
        "IG unified session: linked IG account eligible via its Page, Page token never leaks",
        igAccount?.eligible === true &&
          (igAccount?.detail ?? "").includes("via Page Acme Store") &&
          !JSON.stringify(view).includes("page-token"),
      );
      assert(
        "IG unified session: Page without a linked IG account is ineligible with the link reason",
        noIgPage?.eligible === false &&
          (noIgPage?.ineligibleReason ?? "").includes(
            "No Instagram professional account is linked",
          ),
      );
      const selected = await metaConnectionService.selectConnectionAccount(
        userA.id,
        wsA.id,
        callback.sessionId,
        "ig-biz-2001",
        deps,
      );
      const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(
        selected.channel.id,
      );
      const config = (selected.channel.config ?? {}) as Record<string, unknown>;
      assert(
        "IG unified select: INSTAGRAM channel keyed by IG id, Page token stored, unified config",
        selected.channel.provider === "INSTAGRAM" &&
          selected.channel.externalAccountId === "ig-biz-2001" &&
          credential?.accessToken === "page-token-1001" &&
          config.authModel === "facebook-unified-login" &&
          config.pageId === "page-1001" &&
          (config.webhookSubscription as { status?: string })?.status === "subscribed",
        JSON.stringify({
          provider: selected.channel.provider,
          externalAccountId: selected.channel.externalAccountId,
          token: credential?.accessToken,
          config,
        }),
      );

      // Unified send: with the unified auth model in the channel
      // config, the Instagram provider must talk to graph.facebook.com
      // via the Page edge, not graph.instagram.com.
      const fbBackedIg = new InstagramProvider(fbFake.fetchImpl);
      const sendContext: ChannelContext = {
        channelId: selected.channel.id,
        workspaceId: wsA.id,
        provider: "instagram",
        externalAccountId: "ig-biz-2001",
        credentials: { accessToken: "page-token-1001", scopes: [] },
        config,
      };
      const before = fbFake.calls.length;
      const sent = await fbBackedIg.sendMessage({
        channel: sendContext,
        toExternalId: "igsid-7",
        message: { type: "TEXT", body: "Unified hello" },
      });
      const sendCall = fbFake.calls[before];
      assert(
        "IG unified send: POSTs to graph.facebook.com/{page-id}/messages",
        sent.externalMessageId === "fb-out-mid-1" &&
          sendCall?.url === "https://graph.facebook.com/v25.0/page-1001/messages",
        sendCall?.url,
      );

      // Webhook signature fallback: with no INSTAGRAM_APP_SECRET set
      // (the Unified Login deployment shape), Instagram webhooks are
      // signed with the Meta (Facebook) app secret.
      const savedIgSecret = process.env.INSTAGRAM_APP_SECRET;
      delete process.env.INSTAGRAM_APP_SECRET;
      try {
        const body = JSON.stringify({ object: "instagram", entry: [] });
        assert(
          "IG unified webhook: signature verifies against the Meta app secret",
          igProvider.verifyWebhook({
            headers: new Headers({ "x-hub-signature-256": sign(body, FB_SECRET) }),
            rawBody: body,
            searchParams: new URLSearchParams(),
          }),
        );
      } finally {
        process.env.INSTAGRAM_APP_SECRET = savedIgSecret;
      }
    } finally {
      delete process.env.INSTAGRAM_LOGIN_CONFIG_ID;
    }
  }

  console.log("8. Webhook pipeline + status updates");
  let conversationId = "";
  {
    const inboundPayload = {
      object: "page",
      entry: [
        {
          id: "page-1001",
          time: Date.now(),
          messaging: [
            {
              sender: { id: "psid-9" },
              recipient: { id: "page-1001" },
              timestamp: Date.now(),
              message: { mid: "mid-hook-1", text: "Webhook hello" },
            },
          ],
        },
      ],
    };
    const { event } = await webhookService.recordAndEnqueue("FACEBOOK", inboundPayload);
    await runWebhookEvent(event.id);
    const conversation = await prisma.conversation.findFirst({
      where: { channelId: fbChannelId },
      include: { messages: true },
    });
    conversationId = conversation?.id ?? "";
    assert(
      "Pipeline: FB webhook → conversation + message stored (channel resolved via entry id)",
      conversation !== null &&
        conversation.messages.some(
          (m) => m.externalMessageId === "mid-hook-1" && m.body === "Webhook hello",
        ),
    );
    const processedEvent = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    assert("Pipeline: event marked PROCESSED", processedEvent?.status === "PROCESSED");

    // Ingest enriches the contact from the User Profile API when the
    // webhook carried only a PSID (no sender name in the payload).
    const hookContact = conversation
      ? await prisma.contact.findUnique({ where: { id: conversation.contactId } })
      : null;
    assert(
      "Pipeline: contact enriched with profile name + avatar (was PSID-only)",
      hookContact?.displayName === "Hook Tester" &&
        hookContact?.avatarUrl === "https://example.com/psid-9.jpg",
      `displayName=${hookContact?.displayName} avatar=${hookContact?.avatarUrl}`,
    );

    // Outbound message awaiting receipts.
    const outbound = await prisma.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "Reply under test",
        senderType: "AGENT",
        senderUserId: userA.id,
        status: "SENT",
        externalMessageId: "fb-out-mid-1",
        sentAt: new Date(),
      },
    });
    const outbound2 = await prisma.message.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "Second reply",
        senderType: "AGENT",
        senderUserId: userA.id,
        status: "SENT",
        externalMessageId: "fb-out-mid-2",
        sentAt: new Date(Date.now() - 60_000),
      },
    });

    const delivery = await webhookService.recordAndEnqueue("FACEBOOK", fbDeliveryPayload);
    await runWebhookEvent(delivery.event.id);
    let row = await prisma.message.findUnique({ where: { id: outbound.id } });
    assert(
      "Status: delivery receipt → DELIVERED + deliveredAt in metadata",
      row?.status === "DELIVERED" &&
        typeof (row?.metadata as { deliveredAt?: unknown } | null)?.deliveredAt === "string",
    );

    const read = await webhookService.recordAndEnqueue("FACEBOOK", fbReadPayload);
    await runWebhookEvent(read.event.id);
    row = await prisma.message.findUnique({ where: { id: outbound.id } });
    assert(
      "Status: read receipt → READ + readAt in metadata",
      row?.status === "READ" &&
        typeof (row?.metadata as { readAt?: unknown } | null)?.readAt === "string",
    );

    const redelivered = await webhookService.recordAndEnqueue("FACEBOOK", fbDeliveryPayload);
    await runWebhookEvent(redelivered.event.id);
    row = await prisma.message.findUnique({ where: { id: outbound.id } });
    assert("Status: late delivery receipt never downgrades READ", row?.status === "READ");

    // Watermark path: everything sent to psid-9 up to now is read.
    const advanced = await messagingService.applyDeliveryStatusUpdates(fbChannelId, [
      {
        externalMessageId: null,
        status: "READ",
        at: new Date(),
        watermark: new Date(),
        contactExternalId: "psid-9",
        raw: null,
      },
    ]);
    const row2 = await prisma.message.findUnique({ where: { id: outbound2.id } });
    assert(
      "Status: watermark update advances the contact's sent messages",
      advanced >= 1 && row2?.status === "READ",
    );
  }

  // ── 9. 24-hour messaging window ────────────────────────────────────────────
  console.log("9. Meta 24h window enforcement");
  {
    const contact = await prisma.contact.create({
      data: { workspaceId: wsA.id, displayName: "Stale Customer" },
    });
    await prisma.contactIdentity.create({
      data: { contactId: contact.id, channelId: fbChannelId, externalUserId: "psid-stale" },
    });
    const staleConversation = await prisma.conversation.create({
      data: { workspaceId: wsA.id, channelId: fbChannelId, contactId: contact.id, status: "OPEN" },
    });
    await prisma.message.create({
      data: {
        conversationId: staleConversation.id,
        direction: "INBOUND",
        type: "TEXT",
        body: "Old question",
        senderType: "CONTACT",
        externalMessageId: "mid-stale-1",
        status: "RECEIVED",
        sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    const staleOutbound = await prisma.message.create({
      data: {
        conversationId: staleConversation.id,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "Late reply",
        senderType: "AGENT",
        senderUserId: userA.id,
        status: "QUEUED",
      },
    });
    const sendsBefore = fbFake.calls.filter((c) => c.url.includes("/messages")).length;
    const staleResult = await messagingService.deliverOutboundMessage(staleOutbound.id, {
      isFinalAttempt: false,
    });
    const staleRow = await prisma.message.findUnique({ where: { id: staleOutbound.id } });
    const sendsAfterStale = fbFake.calls.filter((c) => c.url.includes("/messages")).length;
    assert(
      "Window: 25h-old inbound → FAILED immediately with windowViolation, no API call",
      staleResult.status === "FAILED" &&
        staleRow?.status === "FAILED" &&
        ((staleRow?.metadata as { error?: string } | null)?.error ?? "").includes("24-hour") &&
        (staleRow?.metadata as { windowViolation?: boolean } | null)?.windowViolation === true &&
        sendsAfterStale === sendsBefore,
    );

    const freshContact = await prisma.contact.create({
      data: { workspaceId: wsA.id, displayName: "Fresh Customer" },
    });
    await prisma.contactIdentity.create({
      data: { contactId: freshContact.id, channelId: fbChannelId, externalUserId: "psid-fresh" },
    });
    const freshConversation = await prisma.conversation.create({
      data: {
        workspaceId: wsA.id,
        channelId: fbChannelId,
        contactId: freshContact.id,
        status: "OPEN",
      },
    });
    await prisma.message.create({
      data: {
        conversationId: freshConversation.id,
        direction: "INBOUND",
        type: "TEXT",
        body: "Fresh question",
        senderType: "CONTACT",
        externalMessageId: "mid-fresh-1",
        status: "RECEIVED",
        sentAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const freshOutbound = await prisma.message.create({
      data: {
        conversationId: freshConversation.id,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "Timely reply",
        senderType: "AGENT",
        senderUserId: userA.id,
        status: "QUEUED",
      },
    });
    const freshResult = await messagingService.deliverOutboundMessage(freshOutbound.id, {
      isFinalAttempt: false,
    });
    const freshRow = await prisma.message.findUnique({ where: { id: freshOutbound.id } });
    assert(
      "Window: 1h-old inbound → send succeeds via provider",
      freshResult.status === "SENT" &&
        freshRow?.status === "SENT" &&
        freshRow?.externalMessageId === "fb-out-mid-1",
    );
  }

  // ── 9b. Outbound media (composer attachments) ──────────────────────────────
  console.log("9b. Outbound media");
  {
    const mediaContact = await prisma.contact.create({
      data: { workspaceId: wsA.id, displayName: "Media Customer" },
    });
    await prisma.contactIdentity.create({
      data: { contactId: mediaContact.id, channelId: fbChannelId, externalUserId: "psid-media" },
    });
    const mediaConversation = await prisma.conversation.create({
      data: {
        workspaceId: wsA.id,
        channelId: fbChannelId,
        contactId: mediaContact.id,
        status: "OPEN",
      },
    });
    await prisma.message.create({
      data: {
        conversationId: mediaConversation.id,
        direction: "INBOUND",
        type: "TEXT",
        body: "Please send the photo",
        senderType: "CONTACT",
        externalMessageId: "mid-media-1",
        status: "RECEIVED",
        sentAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });
    const mediaMessage = await messagingService.sendOutboundMedia(
      userA.id,
      wsA.id,
      mediaConversation.id,
      {
        bytes: Buffer.from("fake-png-bytes"),
        fileName: "photo.png",
        mimeType: "image/png",
        caption: "Here is the photo",
      },
    );
    assert(
      "sendOutboundMedia: IMAGE message queued with the meta-attachment ref",
      mediaMessage.messageType === "IMAGE" &&
        mediaMessage.status === "QUEUED" &&
        mediaMessage.attachments[0]?.url === "meta-attachment:att-fb-1" &&
        mediaMessage.attachments[0]?.fileName === "photo.png",
    );
    const mediaResult = await messagingService.deliverOutboundMessage(mediaMessage.id, {
      isFinalAttempt: true,
    });
    const mediaRow = await prisma.message.findUnique({ where: { id: mediaMessage.id } });
    const attachmentSend = fbFake.calls
      .filter((c) => c.url.includes("/page-1001/messages"))
      .at(-1);
    assert(
      "sendOutboundMedia: delivery SENT with payload.attachment_id = att-fb-1",
      mediaResult.status === "SENT" &&
        mediaRow?.externalMessageId === "fb-out-mid-1" &&
        (attachmentSend?.bodyText ?? "").includes('"attachment_id":"att-fb-1"'),
    );
    await expectThrows("sendOutboundMedia: unsupported file type rejected", () =>
      messagingService.sendOutboundMedia(userA.id, wsA.id, mediaConversation.id, {
        bytes: Buffer.from("x"),
        fileName: "evil.exe",
        mimeType: "application/x-msdownload",
      }),
    );
  }

  // ── 9c. History import ─────────────────────────────────────────────────────
  console.log("9c. History import");
  {
    const import1 = await messagingService.importRecentConversations(userA.id, wsA.id, fbChannelId);
    assert(
      "Import: 1 conversation, 2 messages imported",
      import1.conversations === 1 && import1.messagesImported === 2 && import1.messagesSkipped === 0,
    );
    const imported = await prisma.message.findMany({
      where: { externalMessageId: { in: ["mid-old-1", "mid-old-2"] } },
      orderBy: { createdAt: "asc" },
    });
    assert(
      "Import: directions, status and platform timestamps preserved",
      imported.length === 2 &&
        imported[0]?.direction === "INBOUND" &&
        imported[0]?.body === "Old question" &&
        imported[1]?.direction === "OUTBOUND" &&
        imported[1]?.status === "SENT" &&
        imported[0]?.createdAt.toISOString() === "2026-11-10T10:00:00.000Z",
    );
    const import2 = await messagingService.importRecentConversations(userA.id, wsA.id, fbChannelId);
    assert(
      "Import: second run skips everything (idempotent)",
      import2.messagesImported === 0 && import2.messagesSkipped === 2,
    );
  }

  // ── 10. Disconnect ─────────────────────────────────────────────────────────
  console.log("10. Disconnect");
  {
    const conversationsBefore = await prisma.conversation.count({
      where: { channelId: fbChannelId },
    });
    const disconnected = await metaConnectionService.disconnectChannel(
      userA.id,
      wsA.id,
      fbChannelId,
      {
        facebook: fbProvider,
      },
    );
    const credential = await prisma.channelCredential.findUnique({
      where: { channelId: fbChannelId },
    });
    const conversationsAfter = await prisma.conversation.count({
      where: { channelId: fbChannelId },
    });
    const unsubscribeCall = fbFake.calls.find(
      (c) => c.method === "DELETE" && c.url.includes("/page-1001/subscribed_apps"),
    );
    assert(
      "Disconnect: DISCONNECTED + credential deleted + unsubscribe attempted + history kept",
      disconnected.status === "DISCONNECTED" &&
        credential === null &&
        Boolean(unsubscribeCall) &&
        conversationsBefore > 0 &&
        conversationsAfter === conversationsBefore,
    );
  }

  // ── 11. Cross-workspace isolation ──────────────────────────────────────────
  console.log("11. Cross-workspace isolation");
  {
    const deps = { facebook: fbProvider };
    const start = await metaConnectionService.startFacebookConnect(userA.id, wsA.id, deps);
    const callback = await metaConnectionService.handleFacebookCallback(
      userA.id,
      start.state,
      "auth-code-2",
      deps,
    );
    await expectThrows("Cross-workspace: B cannot read A's session via A's workspace", () =>
      metaConnectionService.getConnectionSession(userB.id, wsA.id, callback.sessionId),
    );
    await expectThrows("Cross-workspace: B cannot read A's session via B's workspace", () =>
      metaConnectionService.getConnectionSession(userB.id, wsB.id, callback.sessionId),
    );
    await expectThrows("Cross-workspace: B cannot select in A's session", () =>
      metaConnectionService.selectConnectionAccount(
        userB.id,
        wsA.id,
        callback.sessionId,
        "page-1001",
        deps,
      ),
    );
    await expectThrows("Cross-workspace: B cannot disconnect A's channel", () =>
      metaConnectionService.disconnectChannel(userB.id, wsA.id, fbChannelId, deps),
    );
    assert("Sanity: conversation from pipeline still exists", conversationId.length > 0);
  }

  // ── 12. Channel ERROR status on dead credential ───────────────────────────
  console.log("12. Channel ERROR status (dead credential → ERROR → recovery)");
  {
    const channel = await prisma.channel.create({
      data: {
        workspaceId: wsA.id,
        provider: "FACEBOOK",
        externalAccountId: "page-autherr",
        displayName: "Auth Error Page",
        status: "CONNECTED",
      },
    });
    await channelCredentialService.setChannelCredential(userA.id, wsA.id, channel.id, {
      accessToken: "dead-page-token",
      scopes: [],
    });
    const contact = await prisma.contact.create({
      data: { workspaceId: wsA.id, displayName: "Auth Err Customer" },
    });
    await prisma.contactIdentity.create({
      data: { contactId: contact.id, channelId: channel.id, externalUserId: "psid-autherr" },
    });
    const conversation = await prisma.conversation.create({
      data: { workspaceId: wsA.id, channelId: channel.id, contactId: contact.id, status: "OPEN" },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        type: "TEXT",
        body: "hi",
        senderType: "CONTACT",
        externalMessageId: "mid-autherr-in-1",
        status: "RECEIVED",
        sentAt: new Date(),
      },
    });
    const outbound = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "reply",
        senderType: "AGENT",
        senderUserId: userA.id,
        status: "QUEUED",
      },
    });
    const failedResult = await messagingService.deliverOutboundMessage(outbound.id, {
      isFinalAttempt: true,
    });
    const errored = await prisma.channel.findUnique({ where: { id: channel.id } });
    assert(
      "Channel ERROR: Meta 190 (dead token) marks the channel ERROR with the reason recorded",
      failedResult.status === "FAILED" &&
        errored?.status === "ERROR" &&
        typeof (errored?.config as { lastError?: unknown } | null)?.lastError === "string",
      `status=${errored?.status}`,
    );

    // Recovery: the credential works again → the next successful send
    // restores CONNECTED and clears the recorded error.
    fakeState.authErrorPageFails = false;
    const outbound2 = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "reply 2",
        senderType: "AGENT",
        senderUserId: userA.id,
        status: "QUEUED",
      },
    });
    const okResult = await messagingService.deliverOutboundMessage(outbound2.id, {
      isFinalAttempt: true,
    });
    const recovered = await prisma.channel.findUnique({ where: { id: channel.id } });
    assert(
      "Channel ERROR: a later successful send restores CONNECTED and clears the error",
      okResult.status === "SENT" &&
        recovered?.status === "CONNECTED" &&
        (recovered?.config as { lastError?: unknown } | null)?.lastError === undefined,
      `status=${recovered?.status} send=${okResult.status}`,
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
