import { spawn, type ChildProcess } from "node:child_process";

import { auth } from "@/lib/auth";
import { getQueues } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { automationService } from "@/services/automation.service";
import { cannedResponseService } from "@/services/canned-response.service";
import { contactProfileService } from "@/services/contact-profile.service";
import { channelService } from "@/services/channel.service";
import { conversationService } from "@/services/conversation.service";
import { notificationService } from "@/services/notification.service";
import { workspaceService } from "@/services/workspace.service";

/**
 * Phase 13 tests — automation engine + smart assignment (13B) and the
 * canned-response completion (13A service surface is covered in
 * test-phase4; here: rules CRUD permissions).
 *
 * Runs against the REAL local PostgreSQL + Redis with the REAL worker
 * spawned as a child process, exactly like the other suites. All
 * channels are the dev-only MOCK provider — no real platform involved.
 *
 *   npm run test:phase13
 */

const runId = Date.now().toString(36);
const PASSWORD = "test-password-123";

let passed = 0;
let failed = 0;
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
  timeoutMs = 25000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function spawnChild(label: string, args: string[]): ChildProcess {
  const child = spawn("npx", ["tsx", ...args], {
    cwd: process.cwd(),
    env: { ...process.env },
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
  const email = `phase13-${label}-${runId}@test.local`;
  const result = await auth.api.signUpEmail({
    body: { name: `Phase13 ${label}`, email, password: PASSWORD },
  });
  return { id: result.user.id, email };
}

async function enqueueMockWebhook(
  channelId: string,
  suffix: string,
  events: Array<Record<string, string>>,
): Promise<string> {
  const eventId = `test13-${runId}-${suffix}`;
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

/** Ingest one inbound message from a fresh customer; returns the conversation. */
async function ingestFrom(
  channelId: string,
  workspaceId: string,
  sender: string,
): Promise<{ id: string; assigneeId: string | null }> {
  const eventId = await enqueueMockWebhook(channelId, sender, [
    {
      externalMessageId: `ext13-${runId}-${sender}`,
      senderExternalId: sender,
      senderName: `Customer ${sender}`,
      text: `Hello from ${sender}`,
      type: "TEXT",
      sentAt: new Date().toISOString(),
    },
  ]);
  await waitEventProcessed(eventId);
  const conversation = await prisma.conversation.findFirst({
    where: { workspaceId, channelId, contact: { identities: { some: { externalUserId: sender } } } },
    select: { id: true, assigneeId: true },
  });
  if (!conversation) throw new Error(`setup: no conversation for ${sender}`);
  return conversation;
}

async function main(): Promise<void> {
  console.log(`Phase 13 tests (run ${runId})\n`);

  spawnChild("worker", ["workers/index.ts"]);
  // Give the worker a moment to connect its consumers.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  pass("setup: worker child process started");

  // ── Users + workspace: A=OWNER, C/D/E=AGENT (E unavailable) ────────
  const userA = await signUp("a");
  const userC = await signUp("c");
  const userD = await signUp("d");
  const userE = await signUp("e");
  const wa = await workspaceService.createWorkspace(userA.id, { name: `W13 ${runId}` });
  for (const [user, role] of [
    [userC, "AGENT"],
    [userD, "AGENT"],
    [userE, "AGENT"],
  ] as const) {
    await prisma.workspaceMember.create({
      data: { workspaceId: wa.id, userId: user.id, role },
    });
  }
  await automationService.setMyAvailability(userE.id, wa.id, false);
  const channel = await channelService.connectMockChannel(userA.id, wa.id);
  pass("setup: workspace with OWNER + 3 AGENTs (E unavailable) + mock channel");

  // ── 1. Rule CRUD permissions ───────────────────────────────────────
  await expectThrows("rules: AGENT cannot create a rule (needs workspace.update)", () =>
    automationService.createRule(userC.id, wa.id, {
      name: "Nope",
      trigger: "conversation.created",
      actions: [{ type: "set_priority", priority: "LOW" }],
    }),
  );

  // ── 2. Round-robin on conversation.created ─────────────────────────
  const rr = await automationService.createRule(userA.id, wa.id, {
    name: "Round robin new chats",
    trigger: "conversation.created",
    actions: [{ type: "assign", strategy: "round_robin" }],
  });
  assert("rules: OWNER created the round-robin rule", Boolean(rr.id));

  const conv1 = await ingestFrom(channel.id, wa.id, "cust-1");
  const conv2 = await ingestFrom(channel.id, wa.id, "cust-2");
  const conv3 = await ingestFrom(channel.id, wa.id, "cust-3");
  const conv4 = await ingestFrom(channel.id, wa.id, "cust-4");
  assert(
    "round-robin: rotates A → C → D → A in member order",
    conv1.assigneeId === userA.id &&
      conv2.assigneeId === userC.id &&
      conv3.assigneeId === userD.id &&
      conv4.assigneeId === userA.id,
    `got ${[conv1, conv2, conv3, conv4].map((c) => c.assigneeId).join(",")}`,
  );
  assert(
    "round-robin: unavailable agent E is never picked",
    ![conv1, conv2, conv3, conv4].some((c) => c.assigneeId === userE.id),
  );

  // ── 3. Availability toggle affects the rotation ────────────────────
  await automationService.setMyAvailability(userD.id, wa.id, false);
  const conv5 = await ingestFrom(channel.id, wa.id, "cust-5");
  assert(
    "availability: with D toggled off, next pick after A is C",
    conv5.assigneeId === userC.id,
    `got ${conv5.assigneeId}`,
  );
  await automationService.setMyAvailability(userD.id, wa.id, true);

  // ── 4. Least-busy ──────────────────────────────────────────────────
  await automationService.updateRule(userA.id, wa.id, rr.id, { enabled: false });
  await automationService.createRule(userA.id, wa.id, {
    name: "Least busy",
    trigger: "conversation.created",
    actions: [{ type: "assign", strategy: "least_busy" }],
  });
  // Active counts now: A=2 (cust-1, cust-4), C=2 (cust-2, cust-5), D=1 (cust-3).
  const conv6 = await ingestFrom(channel.id, wa.id, "cust-6");
  assert(
    "least-busy: picks D (fewest active conversations)",
    conv6.assigneeId === userD.id,
    `got ${conv6.assigneeId}`,
  );

  // ── 5. Provider condition on message.created ───────────────────────
  const lbRules = await automationService.listRules(userA.id, wa.id);
  for (const rule of lbRules) {
    if (rule.enabled && rule.trigger === "conversation.created") {
      await automationService.updateRule(userA.id, wa.id, rule.id, { enabled: false });
    }
  }
  const pcMiss = await automationService.createRule(userA.id, wa.id, {
    name: "WhatsApp only priority",
    trigger: "message.created",
    conditions: { providers: ["whatsapp"] },
    actions: [{ type: "set_priority", priority: "URGENT" }],
  });
  await automationService.createRule(userA.id, wa.id, {
    name: "Mock priority",
    trigger: "message.created",
    conditions: { providers: ["mock"] },
    actions: [{ type: "set_priority", priority: "URGENT" }],
  });
  const conv7 = await ingestFrom(channel.id, wa.id, "cust-7");
  const conv7Row = await prisma.conversation.findUnique({ where: { id: conv7.id } });
  assert(
    "conditions: matching provider rule fired (priority URGENT)",
    conv7Row?.priority === "URGENT",
  );
  const missRuns = await prisma.automationRun.count({ where: { ruleId: pcMiss.id } });
  assert("conditions: non-matching provider rule produced no run", missRuns === 0);

  // ── 6. Combo rule: add_tag + send_canned + notify ──────────────────
  const canned = await cannedResponseService.create(userA.id, wa.id, {
    title: "Auto greeting",
    body: "Hi {{contact.name}}, thanks for reaching out!",
    category: "Automation",
  });
  await automationService.createRule(userA.id, wa.id, {
    name: "Welcome combo",
    trigger: "conversation.created",
    actions: [
      { type: "add_tag", name: "auto-greeted" },
      { type: "send_canned", cannedResponseId: canned.id },
      { type: "notify", message: "New conversation from {{contact.name}}" },
    ],
  });
  const conv8 = await ingestFrom(channel.id, wa.id, "cust-8");
  const conv8Tags = await prisma.conversationTag.findMany({
    where: { conversationId: conv8.id },
    include: { tag: true },
  });
  assert(
    "combo: tag added by automation",
    conv8Tags.some((t) => t.tag.name === "auto-greeted"),
  );
  const outbound = await waitFor("automation canned reply SENT", async () => {
    const message = await prisma.message.findFirst({
      where: { conversationId: conv8.id, direction: "OUTBOUND" },
    });
    return message?.status === "SENT" ? message : null;
  });
  assert(
    "combo: canned reply sent through the normal outbound path",
    outbound.body?.includes("Customer cust-8") ?? false,
    `body: ${outbound.body}`,
  );
  const notification = await prisma.notification.findFirst({
    where: { workspaceId: wa.id, userId: userA.id, entityId: conv8.id },
  });
  assert(
    "combo: notify action created a notification for the owner",
    notification?.title === "Automation: Welcome combo",
  );

  // ── 7. tag.added trigger ───────────────────────────────────────────
  await automationService.createRule(userA.id, wa.id, {
    name: "VIP escalation",
    trigger: "tag.added",
    actions: [{ type: "set_priority", priority: "HIGH" }],
  });
  await conversationService.addTag(userA.id, wa.id, conv8.id, "vip");
  const conv8After = await prisma.conversation.findUnique({ where: { id: conv8.id } });
  assert("tag.added: rule fired and set priority HIGH", conv8After?.priority === "HIGH");

  // ── 8. Recursion guard on conversation.assigned ────────────────────
  const ra = await automationService.createRule(userA.id, wa.id, {
    name: "Always to D",
    trigger: "conversation.assigned",
    actions: [{ type: "assign", strategy: "specific", userId: userD.id }],
  });
  await conversationService.assignConversation(userA.id, wa.id, conv8.id, userC.id);
  const conv8Final = await prisma.conversation.findUnique({ where: { id: conv8.id } });
  assert(
    "recursion guard: assigned-trigger rule reassigns once (to D)",
    conv8Final?.assigneeId === userD.id,
    `got ${conv8Final?.assigneeId}`,
  );
  const raRuns = await prisma.automationRun.count({ where: { ruleId: ra.id } });
  assert("recursion guard: exactly one run (no loop)", raRuns === 1, `runs=${raRuns}`);

  // ── 9. Runs list + delete ──────────────────────────────────────────
  const runs = await automationService.listRuns(userA.id, wa.id);
  assert(
    "runs: history lists executions with ok results",
    runs.length >= 6 && runs.every((r) => Array.isArray(r.results)),
    `runs=${runs.length}`,
  );
  await automationService.deleteRule(userA.id, wa.id, ra.id);
  const rulesAfterDelete = await automationService.listRules(userA.id, wa.id);
  assert(
    "rules: delete removes the rule",
    !rulesAfterDelete.some((r) => r.id === ra.id),
  );

  // ── 10. Unified customer profile (13D) ─────────────────────────────
  const conv8Row = await prisma.conversation.findUnique({ where: { id: conv8.id } });
  if (!conv8Row) throw new Error("setup: conv8 missing");
  await conversationService.addInternalNote(
    userA.id,
    wa.id,
    conv8.id,
    "VIP customer — prefers email follow-ups.",
  );
  const profile = await contactProfileService.getProfile(userA.id, wa.id, conv8Row.contactId);
  assert(
    "profile: identities grouped under the contact (mock channel)",
    profile.identities.length >= 1 && profile.identities[0]?.provider === "MOCK",
  );
  assert(
    "profile: tag union spans the contact's conversations",
    profile.tags.includes("auto-greeted") && profile.tags.includes("vip"),
    `tags=${profile.tags.join(",")}`,
  );
  assert(
    "profile: internal notes aggregated with author name",
    profile.notes.some(
      (n) => n.body?.includes("prefers email") && n.senderName === "Phase13 a",
    ),
  );
  assert(
    "profile: conversation history includes the combo conversation",
    profile.conversations.some((c) => c.id === conv8.id) && profile.stats.conversations >= 1,
  );
  const updatedProfile = await contactProfileService.updateContact(
    userA.id,
    wa.id,
    conv8Row.contactId,
    { phone: "+977 9800000000", customAttrs: { City: "Kathmandu", Tier: "Gold" } },
  );
  assert(
    "profile: update sets phone + attributes",
    updatedProfile.phone === "+977 9800000000" &&
      updatedProfile.customAttrs.City === "Kathmandu" &&
      updatedProfile.customAttrs.Tier === "Gold",
  );
  const outsider = await signUp("outsider");
  await expectThrows("profile: outsider cannot read a profile", () =>
    contactProfileService.getProfile(outsider.id, wa.id, conv8Row.contactId),
  );
  await prisma.user.delete({ where: { id: outsider.id } }).catch(() => null);

  // ── 11. Notifications (13E) ────────────────────────────────────────
  const conv9 = await ingestFrom(channel.id, wa.id, "cust-9");
  const ownerNotifications = await notificationService.listForUser(userA.id, wa.id);
  assert(
    "notifications: owner notified of a new conversation",
    ownerNotifications.some(
      (n) => n.title === "New conversation" && n.entityId === conv9.id && !n.isRead,
    ),
  );
  await conversationService.assignConversation(userA.id, wa.id, conv9.id, userC.id);
  const followUpEvent = await enqueueMockWebhook(channel.id, "cust-9-b", [
    {
      externalMessageId: `ext13-${runId}-cust-9-b`,
      senderExternalId: "cust-9",
      senderName: "Customer cust-9",
      text: "One more thing please",
      type: "TEXT",
      sentAt: new Date().toISOString(),
    },
  ]);
  await waitEventProcessed(followUpEvent);
  const agentNotifications = await notificationService.listForUser(userC.id, wa.id);
  assert(
    "notifications: assignee got the assignment notification",
    agentNotifications.some(
      (n) => n.type === "ASSIGNMENT" && n.entityId === conv9.id,
    ),
  );
  assert(
    "notifications: assignee got the new-message notification",
    agentNotifications.some(
      (n) => n.title.startsWith("New message from") && n.entityId === conv9.id,
    ),
  );
  const readResult = await notificationService.markAllRead(userC.id, wa.id);
  const agentAfterRead = await notificationService.listForUser(userC.id, wa.id);
  assert(
    "notifications: mark-all-read flips every unread row",
    readResult.updated >= 2 && agentAfterRead.every((n) => n.isRead),
    `updated=${readResult.updated}`,
  );
  const otherWorkspace = await workspaceService.createWorkspace(userA.id, {
    name: `W13-other ${runId}`,
  });
  const crossWorkspace = await notificationService.listForUser(userA.id, otherWorkspace.id);
  assert(
    "notifications: lists are workspace-scoped",
    !crossWorkspace.some((n) => n.entityId === conv9.id),
  );
  await prisma.workspace.delete({ where: { id: otherWorkspace.id } }).catch(() => null);

  // Cleanup so back-to-back suite runs don't hit residue collisions.
  await prisma.workspace.delete({ where: { id: wa.id } }).catch(() => null);
  for (const user of [userA, userC, userD, userE]) {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  for (const child of children) child.kill("SIGTERM");
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("Phase 13 tests crashed:", error);
  for (const child of children) child.kill("SIGTERM");
  await prisma.$disconnect();
  process.exit(1);
});
