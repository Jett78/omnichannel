import { spawn, type ChildProcess } from "node:child_process";

import type { Job } from "bullmq";
import { io, type Socket } from "socket.io-client";

import { auth } from "@/lib/auth";
import { getQueues } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { channelService } from "@/services/channel.service";
import { conversationService } from "@/services/conversation.service";
import { messagingService } from "@/services/messaging.service";
import { workspaceService } from "@/services/workspace.service";
import { processOutboundJob } from "@/workers/processors/outbound.processor";
import type { OutboundJobData } from "@/types/queue";

/**
 * Phase 4 messaging-engine tests — runs against the REAL local
 * PostgreSQL + Redis, with the REAL worker and realtime gateway
 * spawned as child processes.
 *
 *   npm run test:phase4
 *
 * Covers: mock channel connect + encrypted credential, webhook
 * ingest (conversation/contact/message creation), idempotency,
 * unread counts, mark-as-read, assignment (+ notification), internal
 * notes, tags, resolve/reopen-on-inbound, outbound delivery success
 * and failure, realtime delivery over Socket.IO, and cross-workspace
 * isolation. The mock provider is a dev/test fake — no real platform
 * is involved anywhere in this file.
 */

const runId = Date.now().toString(36);
const PASSWORD = "test-password-123";
const REALTIME_PORT = 4101;
const SOCKET_URL = `http://127.0.0.1:${REALTIME_PORT}`;

let passed = 0;
let failed = 0;
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];
const children: ChildProcess[] = [];

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

async function expectThrows(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fail(name, "expected an error but none was thrown");
  } catch {
    pass(name);
  }
}

async function waitFor<T>(
  name: string,
  fn: () => Promise<T | null | false>,
  timeoutMs = 20000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function spawnChild(label: string, args: string[], extraEnv: Record<string, string>): ChildProcess {
  const child = spawn("npx", ["tsx", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) console.log(`    [${label}] ${line.trim()}`);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) console.error(`    [${label}!] ${line.trim()}`);
    }
  });
  children.push(child);
  return child;
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `phase4-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase4 ${label}`, email, password: PASSWORD },
  });
  createdUserIds.push(result.user.id);
  return { id: result.user.id, email };
}

async function enqueueMockWebhook(
  channelId: string,
  suffix: string,
  events: Array<Record<string, string>>,
): Promise<string> {
  const eventId = `test-${runId}-${suffix}`;
  const event = await prisma.webhookEvent.create({
    data: {
      provider: "MOCK",
      channelId,
      externalEventId: eventId,
      payload: { eventId, channelId, events },
    },
  });
  await getQueues().webhook.add("webhook", { webhookEventId: event.id, provider: "mock" });
  return event.id;
}

async function waitEventProcessed(eventId: string): Promise<void> {
  await waitFor(`webhook event ${eventId} PROCESSED`, async () => {
    const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (event?.status === "FAILED") throw new Error(`webhook event FAILED: ${event.error}`);
    return event?.status === "PROCESSED" ? true : null;
  });
}

async function main(): Promise<void> {
  console.log(`Phase 4 tests (run ${runId})\n`);

  // ── Spawn the real worker + realtime gateway ───────────────────────
  spawnChild("worker", ["workers/index.ts"], {});
  spawnChild("realtime", ["realtime/server.ts"], { SOCKET_PORT: String(REALTIME_PORT) });
  await waitFor("realtime /health", async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/health`);
      return res.ok ? true : null;
    } catch {
      return null;
    }
  });
  pass("setup: worker + realtime child processes started");

  // ── Users + workspace ──────────────────────────────────────────────
  const userA = await signUp("a"); // OWNER of WA
  const userB = await signUp("b"); // outsider (no membership in WA)
  const userC = await signUp("c"); // AGENT in WA
  const wa = await workspaceService.createWorkspace(userA.id, { name: `WA ${runId}` });
  createdWorkspaceIds.push(wa.id);
  await prisma.workspaceMember.create({
    data: { workspaceId: wa.id, userId: userC.id, role: "AGENT" },
  });
  pass("setup: users A/B/C + workspace WA (A=OWNER, C=AGENT, B=outsider)");

  // ── 1. Mock channel connect + encrypted credential ─────────────────
  const channel = await channelService.connectMockChannel(userA.id, wa.id);
  assert("mock channel created with provider MOCK", channel.provider === "MOCK");
  const credential = await prisma.channelCredential.findUnique({
    where: { channelId: channel.id },
  });
  assert(
    "mock credential stored encrypted (ciphertext != plaintext)",
    credential !== null && credential.encryptedAccessToken !== "mock-token",
  );

  // ── 2. Webhook ingest creates conversation/contact/message ─────────
  const event1 = await enqueueMockWebhook(channel.id, "e1", [
    {
      externalMessageId: `ext-${runId}-1`,
      senderExternalId: "cust-1",
      senderName: "Test Customer",
      text: "Hi there, I need help with my order.",
      type: "TEXT",
      sentAt: new Date().toISOString(),
    },
  ]);
  await waitEventProcessed(event1);

  const identity = await prisma.contactIdentity.findUnique({
    where: { channelId_externalUserId: { channelId: channel.id, externalUserId: "cust-1" } },
  });
  assert("contact identity created for cust-1", identity !== null);
  const contact = identity
    ? await prisma.contact.findUnique({ where: { id: identity.contactId } })
    : null;
  assert("contact created with sender name", contact?.displayName === "Test Customer");

  const conversation = await prisma.conversation.findFirst({
    where: { channelId: channel.id, contactId: identity?.contactId ?? "" },
  });
  if (!conversation) throw new Error("setup: conversation was not created by ingest");
  const conversationId = conversation.id;
  assert("conversation created OPEN", conversation.status === "OPEN");
  assert("unreadCount = 1 after first inbound", conversation.unreadCount === 1);
  const messagesAfterFirst = await prisma.message.count({ where: { conversationId } });
  assert("exactly 1 message stored", messagesAfterFirst === 1);

  // ── 3. Idempotency: same externalMessageId delivered again ─────────
  const event2 = await enqueueMockWebhook(channel.id, "e2", [
    {
      externalMessageId: `ext-${runId}-1`, // duplicate of the first message
      senderExternalId: "cust-1",
      senderName: "Test Customer",
      text: "Hi there, I need help with my order.",
      type: "TEXT",
      sentAt: new Date().toISOString(),
    },
  ]);
  await waitEventProcessed(event2);
  const afterDup = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const countAfterDup = await prisma.message.count({ where: { conversationId } });
  assert("duplicate webhook creates no second message", countAfterDup === 1);
  assert("duplicate webhook does not bump unreadCount", afterDup?.unreadCount === 1);
  const conversationCount = await prisma.conversation.count({
    where: { channelId: channel.id },
  });
  assert("still exactly 1 conversation for the channel", conversationCount === 1);

  // ── 4. Second inbound from same sender → same conversation ─────────
  const event3 = await enqueueMockWebhook(channel.id, "e3", [
    {
      externalMessageId: `ext-${runId}-2`,
      senderExternalId: "cust-1",
      senderName: "Test Customer",
      text: "Following up — any news?",
      type: "TEXT",
      sentAt: new Date().toISOString(),
    },
  ]);
  await waitEventProcessed(event3);
  const afterSecond = await prisma.conversation.findUnique({ where: { id: conversationId } });
  assert(
    "second inbound lands in same conversation, unreadCount = 2",
    afterSecond?.unreadCount === 2,
  );

  // ── 5. Mark as read ────────────────────────────────────────────────
  await conversationService.markAsRead(userA.id, wa.id, conversationId);
  const afterRead = await prisma.conversation.findUnique({ where: { id: conversationId } });
  assert("markAsRead sets unreadCount = 0", afterRead?.unreadCount === 0);

  // ── 6. Assignment + notification ───────────────────────────────────
  const assigned = await conversationService.assignConversation(
    userA.id,
    wa.id,
    conversationId,
    userC.id,
  );
  assert("assignConversation sets assignee", assigned.assigneeId === userC.id);
  const assignmentRow = await prisma.conversationAssignment.findFirst({
    where: { conversationId, assigneeId: userC.id },
  });
  assert("ConversationAssignment row recorded", assignmentRow !== null);
  const notification = await prisma.notification.findFirst({
    where: { userId: userC.id, type: "ASSIGNMENT", entityId: conversationId },
  });
  assert("Notification created for the assignee", notification !== null);

  // ── 7. Internal note ───────────────────────────────────────────────
  const note = await conversationService.addInternalNote(
    userA.id,
    wa.id,
    conversationId,
    "Internal: check the warehouse first.",
  );
  assert(
    "internal note stored as PRIVATE_NOTE",
    note.isPrivateNote && note.messageType === "PRIVATE_NOTE",
  );
  const thread = await conversationService.listMessages(userA.id, wa.id, conversationId);
  assert(
    "listMessages includes the note, flagged isPrivateNote",
    thread.items.some((m) => m.id === note.id && m.isPrivateNote),
  );

  // ── 8. Tags add/remove ─────────────────────────────────────────────
  const tagsAfterAdd = await conversationService.addTag(userA.id, wa.id, conversationId, "vip");
  assert(
    "addTag attaches the tag",
    tagsAfterAdd.some((t) => t.name === "vip"),
  );
  const tagsAfterRemove = await conversationService.removeTag(
    userA.id,
    wa.id,
    conversationId,
    "vip",
  );
  assert("removeTag detaches the tag", !tagsAfterRemove.some((t) => t.name === "vip"));

  // ── 8b. Contact details edit (Customer details panel) ──────────────
  const contactAfterEdit = await conversationService.updateContactDetails(
    userA.id,
    wa.id,
    conversationId,
    { phone: "+977 9800000000", email: "ram@example.com" },
  );
  assert(
    "updateContactDetails sets phone + email",
    contactAfterEdit.phone === "+977 9800000000" && contactAfterEdit.email === "ram@example.com",
  );
  const contactAfterClear = await conversationService.updateContactDetails(
    userA.id,
    wa.id,
    conversationId,
    { email: "" },
  );
  assert(
    "updateContactDetails clears email with empty string, keeps phone",
    contactAfterClear.email === null && contactAfterClear.phone === "+977 9800000000",
  );
  await expectThrows("updateContactDetails: outsider cannot edit", () =>
    conversationService.updateContactDetails(userB.id, wa.id, conversationId, { phone: "1" }),
  );

  // ── 9. Resolve, then a new inbound reopens ─────────────────────────
  const resolved = await conversationService.resolveConversation(userA.id, wa.id, conversationId);
  assert("resolveConversation → RESOLVED", resolved.status === "RESOLVED");
  const event4 = await enqueueMockWebhook(channel.id, "e4", [
    {
      externalMessageId: `ext-${runId}-3`,
      senderExternalId: "cust-1",
      senderName: "Test Customer",
      text: "Actually, one more thing…",
      type: "TEXT",
      sentAt: new Date().toISOString(),
    },
  ]);
  await waitEventProcessed(event4);
  const afterReopen = await prisma.conversation.findUnique({ where: { id: conversationId } });
  assert("new inbound reopens a RESOLVED conversation", afterReopen?.status === "OPEN");

  // ── 10a. Outbound success through the worker ───────────────────────
  const outbound = await messagingService.sendOutboundMessage(userA.id, wa.id, conversationId, {
    content: "Happy to help — your order is on its way.",
  });
  assert("outbound message starts QUEUED", outbound.status === "QUEUED");
  const delivered = await waitFor("outbound message SENT", async () => {
    const row = await prisma.message.findUnique({ where: { id: outbound.id } });
    return row?.status === "SENT" ? row : null;
  });
  assert(
    "worker delivered outbound via mock provider (SENT + mock external id)",
    typeof delivered.externalMessageId === "string" &&
      delivered.externalMessageId.startsWith("mock-out-"),
  );

  // ── 10b. Outbound failure → FAILED after final attempt ─────────────
  // The [fail] marker makes the mock provider throw. The real worker
  // will retry with backoff; to assert the terminal state without
  // waiting out the full backoff schedule, the final attempt is driven
  // directly through the processor here (documented shortcut — the
  // success path above goes through the real worker queue).
  const failing = await messagingService.sendOutboundMessage(userA.id, wa.id, conversationId, {
    content: "[fail] this send must fail",
  });
  const fakeJob = {
    id: "test-phase4-direct",
    data: { messageId: failing.id, workspaceId: wa.id, channelId: channel.id },
    attemptsMade: 2,
    opts: { attempts: 3 },
  } as unknown as Job<OutboundJobData>;
  await processOutboundJob(fakeJob);
  const failedRow = await prisma.message.findUnique({ where: { id: failing.id } });
  const failedMeta = (failedRow?.metadata ?? {}) as Record<string, unknown>;
  assert("failing outbound ends FAILED", failedRow?.status === "FAILED");
  assert(
    "failure error recorded in message metadata",
    typeof failedMeta.error === "string" && failedMeta.error.includes("[fail]"),
  );

  // ── 11. Realtime: socket receives message.created ──────────────────
  const signIn = await auth.api.signInEmail({
    body: { email: userA.email, password: PASSWORD },
  });
  const socket: Socket = io(SOCKET_URL, {
    auth: { token: signIn.token },
    transports: ["websocket"],
    reconnectionAttempts: 0,
  });
  try {
    await waitFor("socket connected", async () => (socket.connected ? true : null), 10000);
    const joinAck = await socket.emitWithAck("join:workspace", { workspaceId: wa.id });
    assert(
      "socket joined workspace room",
      (joinAck as { ok?: boolean })?.ok === true,
      JSON.stringify(joinAck),
    );
    const receivedPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no message.created within 15s")), 15000);
      socket.on("message.created", (payload: Record<string, unknown>) => {
        if (payload.workspaceId === wa.id) {
          clearTimeout(timer);
          resolve(payload);
        }
      });
    });
    const event5 = await enqueueMockWebhook(channel.id, "e5", [
      {
        externalMessageId: `ext-${runId}-4`,
        senderExternalId: "cust-2",
        senderName: "Second Customer",
        text: "Realtime hello!",
        type: "TEXT",
        sentAt: new Date().toISOString(),
      },
    ]);
    await waitEventProcessed(event5);
    const received = await receivedPromise;
    const receivedMessage = received.message as { content?: string } | undefined;
    assert(
      "socket received message.created for the workspace",
      receivedMessage?.content === "Realtime hello!",
    );
  } finally {
    socket.disconnect();
  }

  // ── 12. Cross-workspace isolation ──────────────────────────────────
  await expectThrows("B cannot listConversations(WA)", () =>
    conversationService.listConversations(userB.id, wa.id),
  );
  await expectThrows("B cannot getConversation(WA conversation)", () =>
    conversationService.getConversation(userB.id, wa.id, conversationId),
  );
  await expectThrows("B cannot listMessages(WA conversation)", () =>
    conversationService.listMessages(userB.id, wa.id, conversationId),
  );
  await expectThrows("B cannot sendOutboundMessage(WA conversation)", () =>
    messagingService.sendOutboundMessage(userB.id, wa.id, conversationId, { content: "intrusion" }),
  );
  await expectThrows("B cannot assignConversation(WA conversation)", () =>
    conversationService.assignConversation(userB.id, wa.id, conversationId, userB.id),
  );
}

main()
  .catch((error: unknown) => {
    console.error("Test run crashed:", error);
    failed += 1;
  })
  .finally(async () => {
    for (const child of children) child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 800));
    for (const child of children) child.kill("SIGKILL");
    try {
      await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      console.log("\nCleanup done (workspaces + users deleted, children killed).");
    } catch (error) {
      console.error("Cleanup failed:", error);
    }
    const queues = getQueues();
    await Promise.allSettled([
      queues.webhook.close(),
      queues.outbound.close(),
      queues.media.close(),
      queues.tokenRefresh.close(),
    ]);
    await prisma.$disconnect();
    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
