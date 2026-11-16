import type { Job } from "bullmq";

import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getProvider, listRegisteredProviders } from "@/integrations/registry";
import type { ChannelContext, IMessagingProvider } from "@/integrations/types";
import {
  TikTokAccessError,
  TIKTOK_ACCESS_REASON,
  getTikTokAccessState,
  getTikTokConfig,
  isTikTokConfigured,
  tiktokRedirectUri,
} from "@/integrations/tiktok/tiktok-config";
import { TikTokProvider } from "@/integrations/tiktok/tiktok-provider";
import { webhookService } from "@/services/webhook.service";
import { workspaceService } from "@/services/workspace.service";
import { processWebhookJob } from "@/workers/processors/webhook.processor";
import type { WebhookJobData } from "@/types/queue";

/**
 * Phase 7 TikTok tests — REAL local PostgreSQL + Redis.
 *
 *   npm run test:phase7
 *
 * ⚠️ NO real TikTok account, developer app, or network call is
 * involved — none can exist: TikTok's Business Messaging API is
 * gated behind TikTok's Data Security & Privacy Review, which this
 * deployment has not passed (docs/TIKTOK-RESEARCH.md, verdict B).
 * These tests prove the SCAFFOLD behaves honestly: config errors name
 * variables, the access state never claims approval, every provider
 * operation throws TikTokAccessError, webhook verification always
 * fails closed, and the webhook pipeline records the gated failure
 * terminally without creating conversations.
 */

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

function isAccessError(error: unknown): boolean {
  return (
    error instanceof TikTokAccessError &&
    error.code === "TIKTOK_ACCESS_REQUIRED" &&
    error.message.includes("Data Security & Privacy Review")
  );
}

async function expectAccessError(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fail(name, "expected TikTokAccessError but none was thrown");
  } catch (error) {
    if (isAccessError(error)) pass(name);
    else fail(name, `wrong error: ${String(error)}`);
  }
}

function expectAccessErrorSync(name: string, fn: () => unknown): void {
  try {
    fn();
    fail(name, "expected TikTokAccessError but none was thrown");
  } catch (error) {
    if (isAccessError(error)) pass(name);
    else fail(name, `wrong error: ${String(error)}`);
  }
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase7-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase7 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

const testChannel: ChannelContext = {
  channelId: "chan-test",
  workspaceId: "ws-test",
  provider: "tiktok",
  externalAccountId: "tiktok-test-account",
  credentials: { accessToken: "never-used", scopes: [] },
};

async function main(): Promise<void> {
  console.log("Phase 7 TikTok tests (access-gated scaffold — no real TikTok account)\n");

  // ── Config: unconfigured ────────────────────────────────────────────────
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
  delete process.env.TIKTOK_REDIRECT_URI;

  assert("Config: unconfigured → isTikTokConfigured() false", !isTikTokConfigured());
  try {
    getTikTokConfig();
    fail("Config: unconfigured → getTikTokConfig throws", "no error thrown");
  } catch (error) {
    assert(
      "Config: unconfigured → getTikTokConfig throws 503 naming both variables",
      error instanceof AppError &&
        error.code === "TIKTOK_NOT_CONFIGURED" &&
        error.status === 503 &&
        error.message.includes("TIKTOK_CLIENT_KEY") &&
        error.message.includes("TIKTOK_CLIENT_SECRET"),
      String(error),
    );
  }
  const unconfiguredState = getTikTokAccessState();
  assert(
    "Access state: unconfigured → gated, missingEnv lists both variables",
    unconfiguredState.access === "gated" &&
      unconfiguredState.configured === false &&
      unconfiguredState.missingEnv.includes("TIKTOK_CLIENT_KEY") &&
      unconfiguredState.missingEnv.includes("TIKTOK_CLIENT_SECRET") &&
      unconfiguredState.reason === TIKTOK_ACCESS_REASON,
    JSON.stringify(unconfiguredState),
  );

  // ── Config: configured (still gated — the honesty core) ────────────────
  process.env.TIKTOK_CLIENT_KEY = "test-tiktok-app-id";
  process.env.TIKTOK_CLIENT_SECRET = "test-tiktok-app-secret";

  assert("Config: configured → isTikTokConfigured() true", isTikTokConfigured());
  const config = getTikTokConfig();
  assert(
    "Config: configured → values returned, redirect URI derived from APP_URL",
    config.clientKey === "test-tiktok-app-id" &&
      config.clientSecret === "test-tiktok-app-secret" &&
      config.redirectUri.endsWith("/api/oauth/tiktok/callback"),
    JSON.stringify({ ...config, clientSecret: "***" }),
  );
  const configuredState = getTikTokAccessState();
  assert(
    "Access state: configured → STILL gated (credentials ≠ TikTok approval)",
    configuredState.access === "gated" &&
      configuredState.configured === true &&
      configuredState.missingEnv.length === 0 &&
      configuredState.reason.includes("Data Security & Privacy Review"),
    JSON.stringify(configuredState),
  );
  process.env.TIKTOK_REDIRECT_URI = "https://example.test/custom/tiktok/callback";
  assert(
    "Config: TIKTOK_REDIRECT_URI override respected",
    tiktokRedirectUri() === "https://example.test/custom/tiktok/callback" &&
      getTikTokConfig().redirectUri === "https://example.test/custom/tiktok/callback",
  );
  delete process.env.TIKTOK_REDIRECT_URI;

  // ── Provider: registered, honest capabilities, everything gated ────────
  const provider = getProvider("tiktok");
  assert(
    "Provider: registered in the registry as tiktok",
    provider.id === "tiktok" && listRegisteredProviders().includes("tiktok"),
  );
  const caps = provider.capabilities;
  assert(
    "Provider: capabilities are honestly all-off",
    caps.supportsTyping === false &&
      caps.supportsReadReceipts === false &&
      caps.supportsMedia.length === 0 &&
      caps.messagingWindowHours === null &&
      caps.requiresTemplateOutsideWindow === false,
    JSON.stringify(caps),
  );
  assert(
    "Provider: verifyWebhook always fails closed",
    provider.verifyWebhook({
      headers: new Headers({ "tiktok-signature": "t=1,s=abc" }),
      rawBody: "{}",
      searchParams: new URLSearchParams(),
    }) === false,
  );

  // Exercise the provider through the engine-facing interface, exactly
  // as services do — the gated class itself takes no arguments because
  // every method refuses before touching them.
  const direct: IMessagingProvider = new TikTokProvider();
  await expectAccessError("Provider: connectAccount throws TikTokAccessError", () =>
    direct.connectAccount({ workspaceId: "ws-test" }),
  );
  await expectAccessError("Provider: disconnectAccount throws TikTokAccessError", () =>
    direct.disconnectAccount(testChannel),
  );
  await expectAccessError("Provider: sendMessage throws TikTokAccessError", () =>
    direct.sendMessage({
      channel: testChannel,
      toExternalId: "user-1",
      message: { type: "TEXT", body: "hello" },
    }),
  );
  await expectAccessError("Provider: getConversations throws TikTokAccessError", () =>
    direct.getConversations(testChannel),
  );
  await expectAccessError("Provider: getMessages throws TikTokAccessError", () =>
    direct.getMessages(testChannel, "thread-1"),
  );
  await expectAccessError("Provider: getContactProfile throws TikTokAccessError", () =>
    direct.getContactProfile(testChannel, "user-1"),
  );
  await expectAccessError("Provider: exchangeCode throws TikTokAccessError", () =>
    direct.exchangeCode!("any-code"),
  );
  expectAccessErrorSync("Provider: getAuthUrl throws TikTokAccessError", () =>
    direct.getAuthUrl!("ws-test"),
  );
  expectAccessErrorSync("Provider: parseWebhook throws TikTokAccessError (no fake parsing)", () =>
    direct.parseWebhook({ event: "im_receive_msg", content: "{}" }),
  );
  expectAccessErrorSync("Provider: parseStatusUpdates throws TikTokAccessError", () =>
    direct.parseStatusUpdates!({ event: "im_send_msg" }),
  );
  assert(
    "TikTokAccessError: AppError with status 403",
    new TikTokAccessError() instanceof AppError && new TikTokAccessError().status === 403,
  );

  // ── Workspaces + a manually-created TIKTOK channel row ─────────────────
  const userA = await signUp("a");
  const userB = await signUp("b");
  const wsA = await workspaceService.createWorkspace(userA.id, { name: `WS A ${runId}` });
  const wsB = await workspaceService.createWorkspace(userB.id, { name: `WS B ${runId}` });
  createdWorkspaceIds.push(wsA.id, wsB.id);

  const channelA = await prisma.channel.create({
    data: {
      workspaceId: wsA.id,
      provider: "TIKTOK",
      externalAccountId: `tiktok-manual-${runId}`,
      displayName: "TikTok (manual test row)",
      status: "DISCONNECTED",
    },
  });

  // The channels page lists channels with a workspaceId filter — mirror it.
  const channelsForB = await prisma.channel.findMany({ where: { workspaceId: wsB.id } });
  const channelsForA = await prisma.channel.findMany({ where: { workspaceId: wsA.id } });
  assert(
    "Workspace scoping: A's TIKTOK channel appears only in A's channel list",
    channelsForA.some((c) => c.id === channelA.id) &&
      !channelsForB.some((c) => c.id === channelA.id),
  );

  // ── Webhook pipeline: gated failure is terminal, creates nothing ───────
  const { event } = await webhookService.recordAndEnqueue("TIKTOK", {
    event: "im_receive_msg",
    note: "Arbitrary payload. The gated parser must refuse it, never interpret it.",
  });
  const job = {
    data: { webhookEventId: event.id, provider: "tiktok" },
  } as unknown as Job<WebhookJobData>;
  await expectAccessError("Pipeline: processWebhookJob surfaces TikTokAccessError", () =>
    processWebhookJob(job),
  );
  const stored = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
  assert(
    "Pipeline: event recorded FAILED with the access reason (terminal, no crash-loop)",
    stored?.status === "FAILED" &&
      typeof stored.error === "string" &&
      stored.error.includes("Data Security & Privacy Review"),
    JSON.stringify({ status: stored?.status, error: stored?.error }),
  );
  const conversationCount = await prisma.conversation.count({
    where: { workspaceId: wsA.id },
  });
  const messageCount = await prisma.message.count({ where: { conversation: { workspaceId: wsA.id } } });
  assert(
    "Pipeline: no conversations or messages were created",
    conversationCount === 0 && messageCount === 0,
    `conversations=${conversationCount} messages=${messageCount}`,
  );

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
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
