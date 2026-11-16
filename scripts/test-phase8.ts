import { createHmac } from "node:crypto";

import type { Job } from "bullmq";

import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { GET as webhookGet, POST as webhookPost } from "@/app/api/webhooks/[provider]/route";
import { getProvider, listRegisteredProviders } from "@/integrations/registry";
import type { ChannelContext } from "@/integrations/types";
import {
  getXAccessState,
  getXConfig,
  isXConfigured,
  xCrcSecret,
  xRedirectUri,
  xWebhookSigningSecrets,
} from "@/integrations/x/x-config";
import { XApiError, type FetchLike } from "@/integrations/x/x-api-client";
import {
  computeCrcResponseToken,
  verifyXSignature,
  xHmacSha256Base64,
} from "@/integrations/x/x-webhook";
import { XProvider } from "@/integrations/x/x-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import { metaConnectionService } from "@/services/meta-connection.service";
import { xConnectionService } from "@/services/x-connection.service";
import { processWebhookJob } from "@/workers/processors/webhook.processor";
import type { WebhookJobData } from "@/types/queue";

/**
 * Phase 8 X (Twitter) DM tests — REAL local PostgreSQL + Redis.
 *
 *   npm run test:phase8
 *
 * ⚠️ NO real X account, developer app, credits, or network call is
 * involved — none exist in this environment. The provider is tested
 * against an injected fake-fetch TEST DOUBLE whose response payloads
 * are copied from X's official documentation examples:
 *  - DM event objects + fields: docs.x.com/x-api/direct-messages/
 *    lookup/integrate (the "Hi everyone." MessageCreate example) and
 *    the manage introduction's send response example.
 *  - Webhook payloads: the documented Account Activity API family
 *    (for_user_id / direct_message_events / message_create /
 *    direct_message_read_events) and the X Activity API envelope
 *    ({data: {event_type, filter, payload}}).
 * See docs/X-RESEARCH.md for the access verdict (A: self-serve,
 * pay-per-use) and sources.
 */

const PASSWORD = "test-password-123";
const runId = Date.now().toString(36);

const CLIENT_ID = "test-x-client-id";
const CLIENT_SECRET = "test-x-client-secret";
const CONSUMER_SECRET = "test-x-consumer-secret";

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
  check?: (error: unknown) => boolean,
): Promise<void> {
  try {
    await fn();
    fail(name, "expected an error but none was thrown");
  } catch (error) {
    if (check && !check(error)) {
      fail(name, `wrong error: ${String(error)}`);
      return;
    }
    pass(name);
  }
}

// ─── Fake fetch (TEST DOUBLE for the X API HTTP surface) ─────────────────────

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText: string;
}

interface FakeResult {
  status?: number;
  json: unknown;
  headers?: Record<string, string>;
}

type FakeHandler = (call: RecordedCall) => FakeResult | null;

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
          title: "Not Found",
          detail: `Fake fetch: no route for ${call.method} ${url}`,
          type: "https://api.twitter.com/2/problems/not-found",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(result.json), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json", ...(result.headers ?? {}) },
    });
  };
  return { fetchImpl, calls };
}

const ACCOUNT_ID = "1001";
const CUSTOMER_ID = "2002";

const DM_EVENTS_RESPONSE = {
  data: [
    {
      id: "evt-300",
      event_type: "MessageCreate",
      text: "Latest in one-to-one",
      sender_id: CUSTOMER_ID,
      dm_conversation_id: "1001-2002",
      participant_ids: [ACCOUNT_ID, CUSTOMER_ID],
      created_at: "2026-11-15T10:00:00.000Z",
    },
    {
      id: "evt-200",
      event_type: "MessageCreate",
      text: "Earlier in one-to-one",
      sender_id: CUSTOMER_ID,
      dm_conversation_id: "1001-2002",
      participant_ids: [ACCOUNT_ID, CUSTOMER_ID],
      created_at: "2026-11-15T09:00:00.000Z",
    },
    {
      // Verbatim event shape from the official DM lookup integration
      // guide example (group conversation).
      id: "1582838499983564806",
      event_type: "MessageCreate",
      text: "Hi everyone.",
      sender_id: "944480690",
      dm_conversation_id: "1578398451921985538",
      participant_ids: ["944480690", ACCOUNT_ID, "3003"],
      created_at: "2022-10-19T20:58:00.000Z",
    },
    {
      id: "evt-join",
      event_type: "ParticipantsJoin",
      participant_ids: ["3003"],
      sender_id: "944480690",
      dm_conversation_id: "1578398451921985538",
      created_at: "2022-10-19T20:45:58.000Z",
    },
  ],
  includes: {
    users: [
      {
        id: CUSTOMER_ID,
        name: "Customer Two",
        username: "customertwo",
        profile_image_url: "https://example.com/two.png",
      },
      {
        id: "944480690",
        name: "Doc Example",
        username: "docexample",
        profile_image_url: "https://example.com/doc.png",
      },
    ],
  },
  meta: { result_count: 4 },
};

const CONVERSATION_EVENTS_RESPONSE = {
  data: [
    DM_EVENTS_RESPONSE.data[0],
    {
      id: "evt-250",
      event_type: "MessageCreate",
      text: "Mine, sent from x.com",
      sender_id: ACCOUNT_ID,
      dm_conversation_id: "1001-2002",
      participant_ids: [ACCOUNT_ID, CUSTOMER_ID],
      created_at: "2026-11-15T09:30:00.000Z",
    },
    DM_EVENTS_RESPONSE.data[1],
  ],
  includes: DM_EVENTS_RESPONSE.includes,
  meta: { result_count: 3 },
};

function xHandler(call: RecordedCall): FakeResult | null {
  const url = new URL(call.url);
  const path = url.pathname;
  if (url.hostname !== "api.x.com") return null;

  if (call.method === "POST" && path === "/2/oauth2/token") {
    const form = new URLSearchParams(call.bodyText);
    if (form.get("grant_type") === "authorization_code") {
      // A second code yields a SECOND account, so the two test
      // workspaces connect different X accounts (webhook channel
      // resolution by account id stays unambiguous).
      if (form.get("code") === "auth-code-b") {
        return {
          json: {
            access_token: "x-access-b",
            refresh_token: "x-refresh-b",
            expires_in: 7200,
            scope: "dm.read dm.write tweet.read users.read offline.access",
            token_type: "bearer",
          },
        };
      }
      return {
        json: {
          access_token: "x-access-1",
          refresh_token: "x-refresh-1",
          expires_in: 7200,
          scope: "dm.read dm.write tweet.read users.read offline.access",
          token_type: "bearer",
        },
      };
    }
    if (form.get("grant_type") === "refresh_token") {
      if (form.get("refresh_token") === "dead-refresh-token") {
        return {
          status: 401,
          json: {
            title: "Unauthorized",
            detail: "The refresh token has been revoked.",
            type: "https://api.twitter.com/2/problems/not-authorized",
          },
        };
      }
      return {
        json: {
          access_token: "x-access-2",
          refresh_token: "x-refresh-2",
          expires_in: 7200,
          scope: "dm.read dm.write tweet.read users.read offline.access",
          token_type: "bearer",
        },
      };
    }
    return null;
  }
  if (call.method === "POST" && path === "/2/oauth2/revoke") return { json: {} };
  if (call.method === "GET" && path === "/2/users/me") {
    if (call.headers.authorization === "Bearer x-access-b") {
      return {
        json: {
          data: {
            id: "5005",
            name: "Other Support",
            username: "othersupport",
            profile_image_url: "https://example.com/other.png",
          },
        },
      };
    }
    return {
      json: {
        data: {
          id: ACCOUNT_ID,
          name: "Acme Support",
          username: "acmesupport",
          profile_image_url: "https://example.com/acme.png",
        },
      },
    };
  }
  if (call.method === "GET" && path === `/2/users/${CUSTOMER_ID}`) {
    return {
      json: {
        data: {
          id: CUSTOMER_ID,
          name: "Customer Two",
          username: "customertwo",
          profile_image_url: "https://example.com/two.png",
        },
      },
    };
  }
  if (call.method === "POST" && path === "/2/activity/subscriptions") {
    const body = JSON.parse(call.bodyText) as { event_type?: string };
    return { json: { data: { id: `sub-${body.event_type ?? "unknown"}` } } };
  }
  if (call.method === "DELETE" && path.startsWith("/2/activity/subscriptions/")) {
    return { json: {} };
  }
  if (call.method === "GET" && path === "/2/dm_events") {
    if (call.headers.authorization === "Bearer rate-limited-token") {
      return {
        status: 429,
        headers: {
          "x-rate-limit-limit": "15",
          "x-rate-limit-remaining": "0",
          "x-rate-limit-reset": "1763273700",
        },
        json: {
          title: "Too Many Requests",
          detail: "Too many requests",
          type: "https://api.twitter.com/2/problems/too-many-requests",
        },
      };
    }
    return { json: DM_EVENTS_RESPONSE };
  }
  if (call.method === "GET" && path === "/2/dm_conversations/1001-2002/dm_events") {
    return { json: CONVERSATION_EVENTS_RESPONSE };
  }
  if (call.method === "POST" && path === `/2/dm_conversations/with/${CUSTOMER_ID}/messages`) {
    return { json: { data: { dm_conversation_id: "1001-2002", dm_event_id: "out-event-1" } } };
  }
  if (call.method === "POST" && path === "/2/dm_conversations/with/9999/messages") {
    return {
      status: 403,
      json: {
        title: "Forbidden",
        detail: "You cannot send messages to this user.",
        type: "https://api.twitter.com/2/problems/not-authorized-for-resource",
      },
    };
  }
  return null;
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase8-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase8 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

const testChannel: ChannelContext = {
  channelId: "chan-test",
  workspaceId: "ws-test",
  provider: "x",
  externalAccountId: ACCOUNT_ID,
  credentials: { accessToken: "x-access-1", refreshToken: "x-refresh-1", scopes: [] },
};

async function main(): Promise<void> {
  console.log("Phase 8 X DM tests (fake-fetch double — no real X account or network)\n");

  // ── Config: unconfigured ────────────────────────────────────────────────
  delete process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_SECRET;
  delete process.env.X_CONSUMER_KEY;
  delete process.env.X_CONSUMER_SECRET;
  delete process.env.X_WEBHOOK_ID;
  delete process.env.X_REDIRECT_URI;

  assert("Config: unconfigured → isXConfigured() false", !isXConfigured());
  try {
    getXConfig();
    fail("Config: unconfigured → getXConfig throws", "no error thrown");
  } catch (error) {
    assert(
      "Config: unconfigured → getXConfig throws 503 naming both variables",
      error instanceof AppError &&
        error.code === "X_NOT_CONFIGURED" &&
        error.status === 503 &&
        error.message.includes("X_CLIENT_ID") &&
        error.message.includes("X_CLIENT_SECRET"),
      String(error),
    );
  }
  const unconfiguredState = getXAccessState();
  assert(
    "Access state: unconfigured → configured false, missingEnv lists both, webhookIdSet false",
    unconfiguredState.configured === false &&
      unconfiguredState.missingEnv.includes("X_CLIENT_ID") &&
      unconfiguredState.missingEnv.includes("X_CLIENT_SECRET") &&
      unconfiguredState.webhookIdSet === false &&
      unconfiguredState.redirectUri.endsWith("/api/oauth/x/callback") &&
      unconfiguredState.webhookUrl.endsWith("/api/webhooks/x"),
    JSON.stringify(unconfiguredState),
  );
  assert(
    "Webhook secrets: none configured → empty list, CRC secret undefined (fail closed)",
    xWebhookSigningSecrets().length === 0 && xCrcSecret() === undefined,
  );
  assert(
    "Signature: verifyXSignature fails closed with no secrets",
    verifyXSignature("{}", `sha256=${"a".repeat(43)}=`, []) === false,
  );

  // ── Config: configured ──────────────────────────────────────────────────
  process.env.X_CLIENT_ID = CLIENT_ID;
  process.env.X_CLIENT_SECRET = CLIENT_SECRET;
  process.env.X_CONSUMER_SECRET = CONSUMER_SECRET;

  assert("Config: configured → isXConfigured() true", isXConfigured());
  const config = getXConfig();
  assert(
    "Config: configured → values returned, redirect URI derived from APP_URL",
    config.clientId === CLIENT_ID &&
      config.redirectUri.endsWith("/api/oauth/x/callback") &&
      config.consumerSecret === CONSUMER_SECRET,
  );
  process.env.X_REDIRECT_URI = "https://example.test/custom/x/callback";
  assert(
    "Config: X_REDIRECT_URI override respected",
    xRedirectUri() === "https://example.test/custom/x/callback",
  );
  delete process.env.X_REDIRECT_URI;
  assert(
    "Webhook secrets: client secret preferred, consumer secret as fallback",
    JSON.stringify(xWebhookSigningSecrets()) ===
      JSON.stringify([CLIENT_SECRET, CONSUMER_SECRET]) && xCrcSecret() === CLIENT_SECRET,
  );

  // ── Webhook security: CRC + signature ───────────────────────────────────
  const crcExpected =
    "sha256=" + createHmac("sha256", CLIENT_SECRET).update("crc-token-123").digest("base64");
  assert(
    "CRC: response_token matches the documented HMAC-SHA256 construction",
    computeCrcResponseToken("crc-token-123", CLIENT_SECRET) === crcExpected,
  );
  const signedBody = JSON.stringify({ for_user_id: ACCOUNT_ID });
  assert(
    "Signature: verifies against the client secret",
    verifyXSignature(signedBody, xHmacSha256Base64(signedBody, CLIENT_SECRET), [CLIENT_SECRET]),
  );
  assert(
    "Signature: verifies against the consumer secret (classic AAA key)",
    verifyXSignature(signedBody, xHmacSha256Base64(signedBody, CONSUMER_SECRET), [
      CLIENT_SECRET,
      CONSUMER_SECRET,
    ]),
  );
  assert(
    "Signature: rejects a wrong secret and a missing header",
    !verifyXSignature(signedBody, xHmacSha256Base64(signedBody, "wrong-secret"), [
      CLIENT_SECRET,
    ]) && !verifyXSignature(signedBody, null, [CLIENT_SECRET]),
  );

  // ── Provider: registry, capabilities, OAuth URL ─────────────────────────
  const { fetchImpl, calls } = createFakeFetch(xHandler);
  const provider = new XProvider(fetchImpl);

  const registered = getProvider("x");
  assert(
    "Provider: registered in the registry as x with honest capabilities",
    registered.id === "x" &&
      listRegisteredProviders().includes("x") &&
      registered.capabilities.messagingWindowHours === null &&
      registered.capabilities.supportsTyping === false &&
      registered.capabilities.supportsReadReceipts === true,
  );
  assert(
    "Provider: verifyWebhook uses configured env secrets",
    registered.verifyWebhook({
      headers: new Headers({
        "x-twitter-webhooks-signature": xHmacSha256Base64(signedBody, CLIENT_SECRET),
      }),
      rawBody: signedBody,
      searchParams: new URLSearchParams(),
    }) === true &&
      registered.verifyWebhook({
        headers: new Headers({ "x-twitter-webhooks-signature": "sha256=bogus" }),
        rawBody: signedBody,
        searchParams: new URLSearchParams(),
      }) === false,
  );

  const authUrl = new URL(provider.buildAuthUrl("state-xyz", "challenge-abc"));
  assert(
    "OAuth: authorize URL targets x.com/i/oauth2/authorize with PKCE + DM scopes",
    authUrl.origin + authUrl.pathname === "https://x.com/i/oauth2/authorize" &&
      authUrl.searchParams.get("response_type") === "code" &&
      authUrl.searchParams.get("client_id") === CLIENT_ID &&
      authUrl.searchParams.get("state") === "state-xyz" &&
      authUrl.searchParams.get("code_challenge") === "challenge-abc" &&
      authUrl.searchParams.get("code_challenge_method") === "S256" &&
      (authUrl.searchParams.get("scope") ?? "").includes("dm.read") &&
      (authUrl.searchParams.get("scope") ?? "").includes("dm.write") &&
      (authUrl.searchParams.get("scope") ?? "").includes("offline.access"),
    authUrl.toString(),
  );
  await expectThrows(
    "Provider: connectAccount refuses token-paste connects",
    () => provider.connectAccount({ workspaceId: "ws-test" }),
    (e) => e instanceof AppError && e.code === "OAUTH_FLOW_REQUIRED",
  );

  // ── Provider: token exchange / refresh / profile (fake fetch) ───────────
  const tokens = await provider.exchangeCodeForTokens("auth-code-1", "verifier-1");
  const tokenCall = calls.find((c) => c.url.includes("/2/oauth2/token"));
  assert(
    "OAuth: code exchange returns tokens + expiry + scopes, sent form-encoded with Basic auth and the PKCE verifier",
    tokens.accessToken === "x-access-1" &&
      tokens.refreshToken === "x-refresh-1" &&
      tokens.expiresAt instanceof Date &&
      tokens.scopes.includes("dm.read") &&
      tokenCall?.headers.authorization?.startsWith("Basic ") === true &&
      new URLSearchParams(tokenCall?.bodyText ?? "").get("code_verifier") === "verifier-1" &&
      new URLSearchParams(tokenCall?.bodyText ?? "").get("grant_type") ===
        "authorization_code",
  );
  const refreshed = await provider.refreshToken({
    accessToken: "x-access-1",
    refreshToken: "x-refresh-1",
    scopes: [],
  });
  assert(
    "OAuth: refresh rotates BOTH tokens (X rotation is persisted by the caller)",
    refreshed.accessToken === "x-access-2" && refreshed.refreshToken === "x-refresh-2",
  );
  const profile = await provider.getOwnProfile("x-access-1");
  assert(
    "Profile: /users/me resolves the connected account identity",
    profile.id === ACCOUNT_ID && profile.username === "acmesupport" && profile.name === "Acme Support",
  );

  // ── Provider: reads (fake fetch, doc-example payloads) ──────────────────
  const conversations = await provider.getConversations(testChannel);
  assert(
    "getConversations: events grouped by conversation, newest first, contact resolved",
    conversations.length === 2 &&
      conversations[0]?.externalThreadId === "1001-2002" &&
      conversations[0]?.contactExternalId === CUSTOMER_ID &&
      conversations[0]?.contactName === "Customer Two" &&
      conversations[0]?.lastMessageAt?.toISOString() === "2026-11-15T10:00:00.000Z" &&
      conversations[1]?.externalThreadId === "1578398451921985538" &&
      conversations[1]?.contactExternalId === "944480690",
    JSON.stringify(conversations.map((c) => c.externalThreadId)),
  );
  const messages = await provider.getMessages(testChannel, "1001-2002");
  assert(
    "getMessages: inbound only (own messages filtered), sender name from includes",
    messages.length === 2 &&
      messages.every((m) => m.senderExternalId === CUSTOMER_ID) &&
      messages.every((m) => m.externalThreadId === "1001-2002") &&
      messages[0]?.senderName === "Customer Two" &&
      messages[0]?.body === "Latest in one-to-one",
    JSON.stringify(messages.map((m) => m.externalMessageId)),
  );
  const contactProfile = await provider.getContactProfile(testChannel, CUSTOMER_ID);
  assert(
    "getContactProfile: name/username/avatar mapped",
    contactProfile.name === "Customer Two" &&
      contactProfile.username === "customertwo" &&
      contactProfile.avatarUrl === "https://example.com/two.png",
  );

  // ── Provider: sends + error mapping ─────────────────────────────────────
  const sent = await provider.sendMessage({
    channel: testChannel,
    toExternalId: CUSTOMER_ID,
    message: { type: "TEXT", body: "Hello back" },
  });
  const sendCall = calls.find((c) => c.url.includes("/messages") && c.method === "POST");
  assert(
    "sendMessage: participant endpoint used, provider event id recorded",
    sent.externalMessageId === "out-event-1" &&
      sendCall?.url.endsWith(`/2/dm_conversations/with/${CUSTOMER_ID}/messages`) === true &&
      (JSON.parse(sendCall?.bodyText ?? "{}") as { text?: string }).text === "Hello back",
  );
  await expectThrows(
    "sendMessage: recipient who cannot be messaged → X's 403 detail surfaces, not retryable",
    () =>
      provider.sendMessage({
        channel: testChannel,
        toExternalId: "9999",
        message: { type: "TEXT", body: "Hello?" },
      }),
    (e) =>
      e instanceof XApiError &&
      e.status === 403 &&
      e.message.includes("You cannot send messages to this user") &&
      e.retryable === false,
  );
  await expectThrows(
    "sendMessage: attachments fail with a clear media_id error (nothing faked)",
    () =>
      provider.sendMessage({
        channel: testChannel,
        toExternalId: CUSTOMER_ID,
        message: { type: "IMAGE", attachments: [{ url: "https://example.com/pic.png" }] },
      }),
    (e) => e instanceof XApiError && e.message.includes("media_id"),
  );
  await expectThrows(
    "Rate limit: 429 maps to XApiError with rate-limit info and retryable=true",
    () =>
      provider.getConversations({
        ...testChannel,
        credentials: { accessToken: "rate-limited-token", scopes: [] },
      }),
    (e) =>
      e instanceof XApiError &&
      e.status === 429 &&
      e.retryable === true &&
      e.rateLimit?.limit === 15 &&
      e.rateLimit?.reset === 1763273700,
  );

  // ── Webhook parsing: AAA family (documented payload shape) ──────────────
  const aaaPayload = {
    for_user_id: ACCOUNT_ID,
    direct_message_events: [
      {
        type: "message_create",
        id: "aaa-evt-1",
        created_timestamp: "1763272800000",
        message_create: {
          sender_id: CUSTOMER_ID,
          target: { recipient_id: ACCOUNT_ID },
          message_data: {
            text: "Hello from AAA",
            entities: { hashtags: [], symbols: [], user_mentions: [], urls: [] },
          },
        },
      },
      {
        type: "message_create",
        id: "aaa-evt-2",
        created_timestamp: "1763272860000",
        message_create: {
          sender_id: ACCOUNT_ID,
          target: { recipient_id: CUSTOMER_ID },
          message_data: { text: "My own echo — must be skipped", entities: {} },
        },
      },
    ],
    users: {
      [CUSTOMER_ID]: {
        id: CUSTOMER_ID,
        name: "Customer Two",
        screen_name: "customertwo",
        profile_image_url_https: "https://example.com/two.png",
      },
      [ACCOUNT_ID]: {
        id: ACCOUNT_ID,
        name: "Acme Support",
        screen_name: "acmesupport",
        profile_image_url_https: "https://example.com/acme.png",
      },
    },
  };
  const aaaMessages = provider.parseWebhook(aaaPayload);
  assert(
    "parseWebhook (AAA): inbound normalized, own echo skipped, 1:1 thread id derived",
    aaaMessages.length === 1 &&
      aaaMessages[0]?.externalMessageId === "aaa-evt-1" &&
      aaaMessages[0]?.externalThreadId === "1001-2002" &&
      aaaMessages[0]?.senderExternalId === CUSTOMER_ID &&
      aaaMessages[0]?.senderName === "Customer Two" &&
      aaaMessages[0]?.body === "Hello from AAA" &&
      aaaMessages[0]?.sentAt.getTime() === 1763272800000,
    JSON.stringify(aaaMessages),
  );
  const readUpdates = provider.parseStatusUpdates({
    for_user_id: ACCOUNT_ID,
    direct_message_read_events: [
      {
        type: "message_read",
        id: "aaa-read-1",
        created_timestamp: "1763272900000",
        message_read: {
          sender_id: CUSTOMER_ID,
          target: { recipient_id: ACCOUNT_ID },
          last_read_event_id: "aaa-evt-1",
        },
      },
    ],
    users: aaaPayload.users,
  });
  assert(
    "parseStatusUpdates (AAA): read event → watermark READ update for the reader contact",
    readUpdates.length === 1 &&
      readUpdates[0]?.status === "READ" &&
      readUpdates[0]?.externalMessageId === null &&
      readUpdates[0]?.contactExternalId === CUSTOMER_ID &&
      readUpdates[0]?.channelExternalAccountId === ACCOUNT_ID &&
      readUpdates[0]?.watermark?.getTime() === 1763272900000,
    JSON.stringify(readUpdates),
  );

  // ── Webhook parsing: X Activity family ──────────────────────────────────
  const xaaMessages = provider.parseWebhook({
    data: {
      event_type: "dm.received",
      filter: { user_id: ACCOUNT_ID },
      payload: {
        id: "xaa-evt-1",
        event_type: "MessageCreate",
        text: "Hello from XAA",
        sender_id: CUSTOMER_ID,
        participant_ids: [CUSTOMER_ID, ACCOUNT_ID],
        created_at: "2026-11-16T10:00:00.000Z",
      },
    },
  });
  assert(
    "parseWebhook (XAA): dm.received normalized, thread id derived from participants",
    xaaMessages.length === 1 &&
      xaaMessages[0]?.externalMessageId === "xaa-evt-1" &&
      xaaMessages[0]?.externalThreadId === "1001-2002" &&
      xaaMessages[0]?.body === "Hello from XAA",
  );
  assert(
    "parseWebhook: dm.sent echoes and unknown payloads produce no messages",
    provider.parseWebhook({
      data: { event_type: "dm.sent", filter: { user_id: ACCOUNT_ID }, payload: {} },
    }).length === 0 && provider.parseWebhook({ hello: "world" }).length === 0,
  );

  // ── Workspaces + connection flow (service level, fake fetch) ────────────
  const userA = await signUp("a");
  const userB = await signUp("b");
  const { workspaceService } = await import("@/services/workspace.service");
  const wsA = await workspaceService.createWorkspace(userA.id, { name: `WS A ${runId}` });
  const wsB = await workspaceService.createWorkspace(userB.id, { name: `WS B ${runId}` });
  createdWorkspaceIds.push(wsA.id, wsB.id);

  process.env.X_WEBHOOK_ID = "wh-123";
  await expectThrows(
    "Connect: non-member cannot start the X connect flow",
    () => xConnectionService.startXConnect(userB.id, wsA.id, { x: provider }),
  );
  const { authUrl: serviceAuthUrl, state } = await xConnectionService.startXConnect(
    userA.id,
    wsA.id,
    { x: provider },
  );
  assert(
    "Connect: start returns an authorize URL and stores a session (state hash only)",
    serviceAuthUrl.startsWith("https://x.com/i/oauth2/authorize") &&
      typeof state === "string" &&
      state.length >= 32,
  );
  const sessionRow = await prisma.oAuthConnectionSession.findFirst({
    where: { workspaceId: wsA.id, provider: "X" },
  });
  assert(
    "Connect: session row is provider X and its payload does not contain the raw state",
    sessionRow !== null && !sessionRow.encryptedData.includes(state),
  );

  const { channel, subscriptionWarning } = await xConnectionService.handleXCallback(
    userA.id,
    state,
    "auth-code-1",
    { x: provider },
  );
  assert(
    "Connect: callback creates the X channel for the authorized account",
    channel.provider === "X" &&
      channel.externalAccountId === ACCOUNT_ID &&
      channel.displayName === "Acme Support" &&
      channel.status === "CONNECTED" &&
      subscriptionWarning === undefined,
    JSON.stringify({ status: channel.status, warning: subscriptionWarning }),
  );
  const channelConfig = (channel.config ?? {}) as Record<string, unknown>;
  assert(
    "Connect: XAA subscriptions recorded in channel config (dm.received + dm.sent)",
    channelConfig.username === "acmesupport" &&
      (channelConfig.webhookSubscription as { status?: string })?.status === "subscribed" &&
      JSON.stringify(channelConfig.xaaSubscriptionIds) ===
        JSON.stringify(["sub-dm.received", "sub-dm.sent"]),
    JSON.stringify(channelConfig),
  );
  const storedCredential =
    await channelCredentialService.getDecryptedChannelCredentialForServer(channel.id);
  assert(
    "Connect: tokens stored encrypted via the credential service (access + refresh)",
    storedCredential?.accessToken === "x-access-1" &&
      storedCredential?.refreshToken === "x-refresh-1" &&
      storedCredential?.scopes.includes("dm.read") === true,
  );
  const rawCredential = await prisma.channelCredential.findUnique({
    where: { channelId: channel.id },
  });
  assert(
    "Connect: the DB row holds ciphertext, never the plain token",
    rawCredential !== null && !rawCredential.encryptedAccessToken.includes("x-access-1"),
  );
  await expectThrows(
    "Connect: replaying the consumed session state is rejected",
    () => xConnectionService.handleXCallback(userA.id, state, "auth-code-1", { x: provider }),
  );

  // Second workspace: without X_WEBHOOK_ID the connect still succeeds
  // and the config honestly records the skipped subscription.
  delete process.env.X_WEBHOOK_ID;
  const second = await xConnectionService.startXConnect(userB.id, wsB.id, { x: provider });
  const secondResult = await xConnectionService.handleXCallback(
    userB.id,
    second.state,
    "auth-code-b",
    { x: provider },
  );
  const secondConfig = (secondResult.channel.config ?? {}) as Record<string, unknown>;
  assert(
    "Connect (no webhook id): channel connects, config records subscription as skipped with reason",
    secondResult.channel.externalAccountId === "5005" &&
      secondResult.channel.status === "CONNECTED" &&
      (secondConfig.webhookSubscription as { status?: string })?.status === "skipped" &&
      typeof (secondConfig.webhookSubscription as { reason?: string })?.reason === "string",
    JSON.stringify(secondConfig.webhookSubscription),
  );

  // ── Webhook route: CRC + signature gate ─────────────────────────────────
  const routeContext = { params: Promise.resolve({ provider: "x" }) };
  const crcResponse = await webhookGet(
    new Request("http://localhost:3000/api/webhooks/x?crc_token=crc-token-123"),
    routeContext,
  );
  const crcJson = (await crcResponse.json()) as { response_token?: string };
  assert(
    "Route GET: CRC challenge answered with the documented response_token",
    crcResponse.status === 200 && crcJson.response_token === crcExpected,
    JSON.stringify(crcJson),
  );

  const signedAaaBody = JSON.stringify(aaaPayload);
  const eventsBefore = await prisma.webhookEvent.count({ where: { provider: "X" } });
  const unsignedResponse = await webhookPost(
    new Request("http://localhost:3000/api/webhooks/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signedAaaBody,
    }),
    routeContext,
  );
  const eventsAfterUnsigned = await prisma.webhookEvent.count({ where: { provider: "X" } });
  assert(
    "Route POST: unsigned delivery rejected 401 and NOT recorded",
    unsignedResponse.status === 401 && eventsAfterUnsigned === eventsBefore,
    `status=${unsignedResponse.status} events ${eventsBefore}→${eventsAfterUnsigned}`,
  );
  const signedResponse = await webhookPost(
    new Request("http://localhost:3000/api/webhooks/x", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-twitter-webhooks-signature": xHmacSha256Base64(signedAaaBody, CLIENT_SECRET),
      },
      body: signedAaaBody,
    }),
    routeContext,
  );
  assert(
    "Route POST: correctly signed delivery accepted",
    signedResponse.status === 200,
    `status=${signedResponse.status}`,
  );

  // ── Pipeline: signed webhook → conversation in the right workspace ──────
  const event = await prisma.webhookEvent.findFirst({
    where: { provider: "X" },
    orderBy: { receivedAt: "desc" },
  });
  assert("Pipeline: the signed event was recorded", event !== null);
  if (event) {
    const job = {
      data: { webhookEventId: event.id, provider: "x" },
    } as unknown as Job<WebhookJobData>;
    await processWebhookJob(job);
    const stored = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    const conversation = await prisma.conversation.findFirst({
      where: { channelId: channel.id },
      include: { messages: true },
    });
    assert(
      "Pipeline: event PROCESSED, conversation + message created on workspace A's channel",
      stored?.status === "PROCESSED" &&
        conversation !== null &&
        conversation.workspaceId === wsA.id &&
        conversation.externalThreadId === "1001-2002" &&
        conversation.messages.some((m) => m.body === "Hello from AAA"),
      JSON.stringify({ status: stored?.status, conversation: conversation?.id }),
    );
    const wsBConversations = await prisma.conversation.count({
      where: { channel: { workspaceId: wsB.id, provider: "X" } },
    });
    assert(
      "Pipeline: nothing leaked into workspace B (tenant isolation)",
      wsBConversations === 0,
      `wsB conversations=${wsBConversations}`,
    );
  }

  // ── Token refresh chain (processor implemented in Phase 8) ──
  {
    const { processTokenRefreshJob } = await import(
      "@/workers/processors/token-refresh.processor"
    );
    const { encryptText } = await import("@/lib/encryption");
    const { getQueues } = await import("@/lib/queue");
    // Make the stored token nearly expired, then run the processor.
    await prisma.channelCredential.update({
      where: { channelId: channel.id },
      data: { tokenExpiresAt: new Date(Date.now() + 30_000) },
    });
    await processTokenRefreshJob(
      { data: { channelId: channel.id, workspaceId: wsA.id } } as never,
      { provider },
    );
    const refreshedCred =
      await channelCredentialService.getDecryptedChannelCredentialForServer(channel.id);
    assert(
      "Token refresh: processor persists the ROTATED access + refresh tokens",
      refreshedCred?.accessToken === "x-access-2" &&
        refreshedCred?.refreshToken === "x-refresh-2",
      `access=${refreshedCred?.accessToken}`,
    );
    const delayedJobs = await getQueues().tokenRefresh.getJobs(["delayed"]);
    assert(
      "Token refresh: next refresh job is armed (delayed) for the channel",
      delayedJobs.some((j) => j.data.channelId === channel.id),
    );
    // A rejected refresh token marks the channel EXPIRED (reconnect needed).
    await prisma.channelCredential.update({
      where: { channelId: channel.id },
      data: {
        encryptedRefreshToken: encryptText("dead-refresh-token"),
        tokenExpiresAt: new Date(Date.now() + 30_000),
      },
    });
    await processTokenRefreshJob(
      { data: { channelId: channel.id, workspaceId: wsA.id } } as never,
      { provider },
    );
    const expiredChannel = await prisma.channel.findUnique({ where: { id: channel.id } });
    assert(
      "Token refresh: rejected refresh token → channel EXPIRED (not silently dead)",
      expiredChannel?.status === "EXPIRED",
      `status=${expiredChannel?.status}`,
    );
    // Restore CONNECTED for the disconnect assertions below.
    await prisma.channel.update({ where: { id: channel.id }, data: { status: "CONNECTED" } });
  }

  // ── Disconnect: subscriptions removed, token revoked, credential wiped ──
  const callsBeforeDisconnect = calls.length;
  const disconnected = await metaConnectionService.disconnectChannel(userA.id, wsA.id, channel.id, {
    x: provider,
  });
  const disconnectCalls = calls.slice(callsBeforeDisconnect);
  const credentialAfter = await prisma.channelCredential.findUnique({
    where: { channelId: channel.id },
  });
  assert(
    "Disconnect: channel DISCONNECTED, credential deleted, X saw subscription deletes + revoke",
    disconnected.status === "DISCONNECTED" &&
      credentialAfter === null &&
      disconnectCalls.filter((c) => c.method === "DELETE" && c.url.includes("/activity/subscriptions/"))
        .length === 2 &&
      disconnectCalls.some((c) => c.url.includes("/2/oauth2/revoke")),
    JSON.stringify(disconnectCalls.map((c) => `${c.method} ${c.url}`)),
  );

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  delete process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_SECRET;
  delete process.env.X_CONSUMER_SECRET;
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
