import { spawn, type ChildProcess } from "node:child_process";

import { auth } from "@/lib/auth";
import { getQueues } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { automationEngine, automationService } from "@/services/automation.service";
import { cannedResponseService } from "@/services/canned-response.service";
import { contactProfileService } from "@/services/contact-profile.service";
import { channelService } from "@/services/channel.service";
import { conversationService } from "@/services/conversation.service";
import { analyticsService } from "@/services/analytics.service";
import { AiNotConfiguredError } from "@/lib/ai";
import { aiAssistantService, knowledgeService } from "@/services/ai.service";
import { messagingService } from "@/services/messaging.service";
import { storeConnectionService, storeProductService } from "@/services/store.service";
import { aiConfigService } from "@/services/ai-config.service";
import { knowledgeDocumentService } from "@/services/knowledge-document.service";
import { webhookService } from "@/services/webhook.service";
import { MAX_KNOWLEDGE_FILE_BYTES } from "@/lib/knowledge-extract";
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

  // ── 12. Analytics additions (13F) ──────────────────────────────────
  await conversationService.resolveConversation(userA.id, wa.id, conv9.id);
  const analytics = await analyticsService.getAnalytics(userA.id, wa.id, 7);
  assert(
    "analytics: incoming/outgoing split adds up to the message total",
    analytics.totals.incomingMessages + analytics.totals.outgoingMessages ===
      analytics.totals.messagesInRange &&
      analytics.totals.incomingMessages >= 10 &&
      analytics.totals.outgoingMessages >= 1,
    `in=${analytics.totals.incomingMessages} out=${analytics.totals.outgoingMessages}`,
  );
  assert(
    "analytics: resolution time computed from real resolve events",
    analytics.totals.resolvedInRange >= 1 && analytics.totals.avgResolutionMinutes !== null,
    `resolved=${analytics.totals.resolvedInRange} avg=${analytics.totals.avgResolutionMinutes}`,
  );

  // ── 13. AI assistant + knowledge (13G) ─────────────────────────────
  let agentKnowledgeBlocked = false;
  try {
    await knowledgeService.create(userC.id, wa.id, { title: "X", content: "Y" });
  } catch {
    agentKnowledgeBlocked = true;
  }
  assert("ai: agents cannot manage knowledge entries", agentKnowledgeBlocked);
  const entry = await knowledgeService.create(userA.id, wa.id, {
    title: "Greeting and delivery policy",
    content: "Always say hello first. Delivery inside the valley takes 2 days.",
  });
  const updatedEntry = await knowledgeService.update(userA.id, wa.id, entry.id, {
    content: "Always say hello first. Delivery inside the valley takes 3 days.",
  });
  assert(
    "ai: knowledge entry created + updated",
    updatedEntry.content.includes("3 days") &&
      (await knowledgeService.list(userA.id, wa.id)).some((e) => e.id === entry.id),
  );

  delete process.env.AI_API_KEY;
  let notConfigured = false;
  try {
    await aiAssistantService.suggestReply(userA.id, wa.id, conv9.id);
  } catch (error) {
    notConfigured = error instanceof AiNotConfiguredError;
  }
  assert("ai: without a key, suggest fails as not-configured (never faked)", notConfigured);

  process.env.AI_API_KEY = "test-key-not-real";
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";
  let stubContent = "Hello! Delivery inside the valley takes 3 days.";
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    capturedUrl = String(url);
    capturedBody = init?.body ?? "";
    return new Response(
      JSON.stringify({ choices: [{ message: { content: stubContent } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const suggestion = await aiAssistantService.suggestReply(userA.id, wa.id, conv9.id);
    assert(
      "ai: suggest returns the provider draft and the matched knowledge",
      suggestion.text === stubContent &&
        suggestion.knowledgeUsed.includes("Greeting and delivery policy"),
      suggestion.text.slice(0, 40),
    );
    assert(
      "ai: request hits the Groq-compatible endpoint carrying thread + knowledge",
      capturedUrl.includes("api.groq.com") &&
        capturedBody.includes("Customer:") &&
        capturedBody.includes("Greeting and delivery policy"),
      capturedUrl,
    );
    const suggestUsage = await prisma.aiUsageLog.count({
      where: { workspaceId: wa.id, action: "suggest" },
    });
    assert("ai: usage is logged per action", suggestUsage >= 1, `count=${suggestUsage}`);
    stubContent = '{"sentiment":"negative","reason":"Customer sounds frustrated"}';
    const sentiment = await aiAssistantService.sentiment(userA.id, wa.id, conv9.id);
    assert(
      "ai: sentiment JSON is parsed strictly",
      sentiment.sentiment === "negative" && sentiment.reason.includes("frustrated"),
    );
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as typeof fetch;
    let providerError = false;
    try {
      await aiAssistantService.summarize(userA.id, wa.id, conv9.id);
    } catch (error) {
      providerError = error instanceof Error && error.name === "AiProviderError";
    }
    assert("ai: provider failures surface as errors, never fake text", providerError);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.AI_API_KEY;
  }
  await knowledgeService.remove(userA.id, wa.id, entry.id);
  assert(
    "ai: knowledge entry deleted",
    !(await knowledgeService.list(userA.id, wa.id)).some((e) => e.id === entry.id),
  );

  // ── 14. Keyword auto-reply (message contains) ──────────────────────
  async function ingestText(sender: string, suffix: string, text: string) {
    const eventId = await enqueueMockWebhook(channel.id, `${sender}-${suffix}`, [
      {
        externalMessageId: `ext13-${runId}-${sender}-${suffix}`,
        senderExternalId: sender,
        senderName: `Customer ${sender}`,
        text,
        type: "TEXT",
        sentAt: new Date().toISOString(),
      },
    ]);
    await waitEventProcessed(eventId);
    const conversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: wa.id,
        channelId: channel.id,
        contact: { identities: { some: { externalUserId: sender } } },
      },
      select: { id: true },
    });
    if (!conversation) throw new Error(`setup: no conversation for ${sender}`);
    return conversation;
  }
  const priceCanned = await cannedResponseService.create(userA.id, wa.id, {
    title: "Price list",
    body: "Price list: Jacket Rs 4,999, Shoes Rs 2,999.",
  });
  const keywordRule = await automationService.createRule(userA.id, wa.id, {
    name: "Price auto-reply",
    trigger: "message.created",
    conditions: { keywords: ["price", "kati"] },
    actions: [{ type: "send_canned", cannedResponseId: priceCanned.id }],
  });
  const convPrice = await ingestText("cust-20", "a", "What is the price of the jacket?");
  const priceReply = await waitFor("keyword auto-reply SENT", async () => {
    const message = await prisma.message.findFirst({
      where: {
        conversationId: convPrice.id,
        direction: "OUTBOUND",
        body: { contains: "Price list" },
      },
    });
    return message?.status === "SENT" ? message : null;
  });
  assert(
    "keywords: a matching first message gets the canned auto-reply",
    priceReply.body?.includes("Rs 4,999") ?? false,
    `body: ${priceReply.body}`,
  );
  const keywordRun = await prisma.automationRun.findFirst({
    where: { ruleId: keywordRule.id, conversationId: convPrice.id },
  });
  assert(
    "keywords: the firing is recorded in the rule's runs",
    JSON.stringify(keywordRun?.results ?? []).includes('"ok":true'),
  );
  const convSunday = await ingestText("cust-21", "a", "Hello, do you open on Sunday?");
  // Wait until ingest automations have clearly run for this conversation
  // (the welcome combo's reply lands), then prove no price reply exists.
  await waitFor("combo reply for the non-matching conversation", async () => {
    const message = await prisma.message.findFirst({
      where: { conversationId: convSunday.id, direction: "OUTBOUND" },
    });
    return message ?? null;
  });
  const strayPriceReply = await prisma.message.findFirst({
    where: {
      conversationId: convSunday.id,
      direction: "OUTBOUND",
      body: { contains: "Price list" },
    },
  });
  assert("keywords: a non-matching message gets no auto-reply", strayPriceReply === null);
  const convUpper = await ingestText("cust-22", "a", "PRICE please");
  const upperReply = await waitFor("uppercase keyword auto-reply SENT", async () => {
    const message = await prisma.message.findFirst({
      where: {
        conversationId: convUpper.id,
        direction: "OUTBOUND",
        body: { contains: "Price list" },
      },
    });
    return message?.status === "SENT" ? message : null;
  });
  assert("keywords: matching is case-insensitive", upperReply !== null);
  const resolvedKeywordRule = await automationService.createRule(userA.id, wa.id, {
    name: "Resolved keyword (must never fire)",
    trigger: "conversation.resolved",
    conditions: { keywords: ["price"] },
    actions: [{ type: "set_priority", priority: "URGENT" }],
  });
  await conversationService.resolveConversation(userA.id, wa.id, convPrice.id);
  const resolvedRuns = await prisma.automationRun.count({
    where: { ruleId: resolvedKeywordRule.id },
  });
  assert(
    "keywords: events without a message body can never match",
    resolvedRuns === 0,
    `runs=${resolvedRuns}`,
  );

  // ── 15. AI auto-reply action ───────────────────────────────────────
  const aiRule = await automationService.createRule(userA.id, wa.id, {
    name: "AI shop assistant",
    trigger: "message.created",
    actions: [{ type: "ai_reply" }],
  });

  // (a) No key configured: the run records the failure, nothing is sent.
  delete process.env.AI_API_KEY;
  const convAiOff = await ingestText("cust-30", "a", "Do you have running shoes?");
  const offRun = await waitFor("ai-reply unconfigured run", async () => {
    const run = await prisma.automationRun.findFirst({
      where: { ruleId: aiRule.id, conversationId: convAiOff.id },
    });
    return run ?? null;
  });
  assert(
    "ai-reply: without a key the run fails honestly as not-configured",
    JSON.stringify(offRun.results ?? []).includes("not configured"),
    JSON.stringify(offRun.results),
  );
  const offOutbound = await prisma.message.findMany({
    where: { conversationId: convAiOff.id, direction: "OUTBOUND" },
    select: { metadata: true },
  });
  assert(
    "ai-reply: nothing AI-generated is sent while unconfigured",
    !offOutbound.some(
      (m) => (m.metadata as { aiGenerated?: boolean } | null)?.aiGenerated,
    ),
  );

  // (b) Configured (stubbed provider): the AI reply is generated + sent.
  process.env.AI_API_KEY = "test-key-not-real";
  const originalFetchAi = globalThis.fetch;
  const aiText =
    "Yes, we have running shoes in size 42 — Rs 3,499 to Rs 5,999. Want me to reserve a pair?";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: aiText } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  try {
    // The spawned worker child reads env only at boot, so its own
    // ai_reply attempt for these ingests records "not configured"
    // (ignored below). The configured path is exercised by driving the
    // engine in this process, where the key + stub live — the same
    // code production runs in the worker once AI_API_KEY is in its env.
    const convAi = await ingestText("cust-31", "a", "Do you have running shoes in size 42?");
    await automationEngine.handleEvent(wa.id, "message.created", {
      conversationId: convAi.id,
      messageBody: "Do you have running shoes in size 42?",
    });
    const aiSent = await waitFor("AI auto-reply SENT", async () => {
      const message = await prisma.message.findFirst({
        where: {
          conversationId: convAi.id,
          direction: "OUTBOUND",
          body: { contains: "reserve a pair" },
        },
      });
      return message?.status === "SENT" ? message : null;
    });
    const aiMeta = aiSent.metadata as {
      aiGenerated?: boolean;
      viaAutomation?: string;
    } | null;
    assert(
      "ai-reply: generated reply sent and marked as automation + AI",
      aiMeta?.aiGenerated === true && aiMeta?.viaAutomation === aiRule.id,
      JSON.stringify(aiSent.metadata),
    );

    // (c) The AI continues the conversation (its own sends, and the
    // welcome combo's marked send, do not trip the takeover guard).
    await ingestText("cust-31", "b", "And what colours do they come in?");
    await automationEngine.handleEvent(wa.id, "message.created", {
      conversationId: convAi.id,
      messageBody: "And what colours do they come in?",
    });
    await waitFor("second AI auto-reply", async () => {
      const count = await prisma.message.count({
        where: { conversationId: convAi.id, direction: "OUTBOUND" },
      });
      const aiMessages = await prisma.message.findMany({
        where: { conversationId: convAi.id, direction: "OUTBOUND" },
        select: { metadata: true },
      });
      const aiCount = aiMessages.filter(
        (m) => (m.metadata as { aiGenerated?: boolean } | null)?.aiGenerated,
      ).length;
      return count >= 3 && aiCount >= 2 ? aiCount : null;
    });
    assert("ai-reply: AI keeps replying while no human has joined", true);

    // (d) Human takeover: an agent's own reply silences the AI here.
    await messagingService.sendOutboundMessage(userA.id, wa.id, convAi.id, {
      content: "Hi, a human agent is taking over this one.",
      type: "TEXT",
    });
    await ingestText("cust-31", "c", "Oh nice, are you a real person?");
    await automationEngine.handleEvent(wa.id, "message.created", {
      conversationId: convAi.id,
      messageBody: "Oh nice, are you a real person?",
    });
    const takeoverRun = await waitFor("takeover skip run", async () => {
      const runs = await prisma.automationRun.findMany({
        where: { ruleId: aiRule.id, conversationId: convAi.id },
      });
      const skip = runs.find((run) => JSON.stringify(run.results).includes("human agent"));
      return skip ?? null;
    });
    assert(
      "ai-reply: after a human replies, the AI steps aside (run says skipped)",
      takeoverRun !== null,
    );
    const aiAfterTakeover = await prisma.message.findMany({
      where: { conversationId: convAi.id, direction: "OUTBOUND" },
      select: { metadata: true },
    });
    assert(
      "ai-reply: no further AI message after takeover",
      aiAfterTakeover.filter(
        (m) => (m.metadata as { aiGenerated?: boolean } | null)?.aiGenerated,
      ).length === 2,
    );
  } finally {
    globalThis.fetch = originalFetchAi;
    delete process.env.AI_API_KEY;
  }

  // ── 16. Store connection + live product lookup ─────────────────────
  let agentStoreBlocked = false;
  try {
    await storeConnectionService.upsert(userC.id, wa.id, {
      baseUrl: "https://ecommerce-api.jeetdeula.com.np",
    });
  } catch {
    agentStoreBlocked = true;
  }
  assert("store: an AGENT cannot connect a store (workspace.update)", agentStoreBlocked);

  const connection = await storeConnectionService.upsert(userA.id, wa.id, {
    baseUrl: "https://ecommerce-api.jeetdeula.com.np/",
    name: "Test Store",
  });
  assert(
    "store: connection saved, base URL normalized",
    connection.baseUrl === "https://ecommerce-api.jeetdeula.com.np" &&
      connection.name === "Test Store",
  );

  process.env.AI_API_KEY = "test-key-not-real";
  const originalFetchStore = globalThis.fetch;
  const storePayload = {
    success: true,
    data: [
      {
        id: "p1",
        name: "Adidas Grand Court 2.0 Shoes",
        images: [
          { url: "https://images.example.test/shoe.jpg", isPrimary: true, sortOrder: 0 },
        ],
        variants: [
          { price: 11999, stockQuantity: 16, isActive: true, allowBackorder: false, attributes: [] },
          {
            price: 12499,
            stockQuantity: 0,
            isActive: true,
            allowBackorder: false,
            attributes: [{ name: "Size", value: "UK 10" }],
          },
        ],
      },
    ],
  };
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("ecommerce-api.jeetdeula.com.np")) {
      return new Response(JSON.stringify(storePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("images.example.test")) {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    if (url.includes("api.groq.com")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "Yes! The Adidas Grand Court 2.0 Shoes are in stock at Rs 11,999. Want me to reserve a pair?",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in store test: ${url}`);
  }) as typeof fetch;
  try {
    const found = await storeProductService.searchForMessage(wa.id, "Do you have adidas shoes?");
    assert(
      "store: live search returns the product, normalized",
      found.length === 1 &&
        found[0]?.priceMin === 11999 &&
        found[0]?.priceMax === 12499 &&
        found[0]?.totalStock === 16 &&
        found[0]?.inStock === true,
      JSON.stringify(found),
    );
    assert(
      "store: primary image + variant label picked",
      found[0]?.imageUrl === "https://images.example.test/shoe.jpg" &&
        (found[0]?.variantLabels ?? []).includes("UK 10"),
      JSON.stringify(found[0]),
    );

    const convStore = await ingestText("cust-32", "a", "Do you have adidas shoes?");
    const suggestion = await aiAssistantService.suggestReply(userA.id, wa.id, convStore.id);
    assert(
      "store: AI suggestion carries the live product",
      suggestion.products.length === 1 &&
        (suggestion.products[0]?.name ?? "").includes("Adidas"),
    );

    // AI auto-reply: text + the product photo (engine driven in this
    // process, like section 15 — the worker child has no key/stub).
    await automationEngine.handleEvent(wa.id, "message.created", {
      conversationId: convStore.id,
      messageBody: "Do you have adidas shoes?",
    });
    const photoMessage = await waitFor("AI product photo SENT", async () => {
      const message = await prisma.message.findFirst({
        where: { conversationId: convStore.id, direction: "OUTBOUND", type: "IMAGE" },
      });
      return message?.status === "SENT" ? message : null;
    });
    assert("store: AI auto-reply sent the product photo", photoMessage !== null);
    const storedPhoto = await prisma.storedMedia.findFirst({
      where: { attachment: { messageId: photoMessage.id } },
    });
    assert("store: photo bytes stored for the inbox preview", storedPhoto !== null);
    const storeRuns = await prisma.automationRun.findMany({
      where: { ruleId: aiRule.id, conversationId: convStore.id },
    });
    assert(
      "store: the run records the photo",
      storeRuns.some((run) => JSON.stringify(run.results).includes("photo")),
      JSON.stringify(storeRuns.map((run) => run.results)),
    );
  } finally {
    globalThis.fetch = originalFetchStore;
    delete process.env.AI_API_KEY;
  }

  await storeConnectionService.remove(userA.id, wa.id);
  const afterRemove = await storeProductService.searchProducts(wa.id, "adidas");
  assert("store: after disconnect, no live products", afterRemove.length === 0);

  // ── 17. Per-workspace AI config (Dograh-style BYOK) ────────────────
  delete process.env.AI_API_KEY;
  let modelsStatus = 200;
  let lastChatAuth: string | null = null;
  const originalFetchAiConfig = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return new Response("{}", {
        status: modelsStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.groq.com")) {
      lastChatAuth = init?.headers?.Authorization ?? null;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Workspace-key reply." } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in ai-config test: ${url}`);
  }) as typeof fetch;
  try {
    let agentAiBlocked = false;
    try {
      await aiConfigService.upsert(userC.id, wa.id, {
        provider: "groq",
        model: "openai/gpt-oss-120b",
        apiKey: "agent-key",
      });
    } catch {
      agentAiBlocked = true;
    }
    assert("ai-config: an AGENT cannot save AI settings (workspace.update)", agentAiBlocked);

    // Dograh rule: a provider-rejected key leaves nothing saved.
    modelsStatus = 401;
    let rejectedThrew = false;
    try {
      await aiConfigService.upsert(userA.id, wa.id, {
        provider: "custom",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "openai/gpt-oss-120b",
        apiKey: "bad-key",
      });
    } catch {
      rejectedThrew = true;
    }
    const afterReject = await aiConfigService.get(userA.id, wa.id);
    assert(
      "ai-config: a rejected key is not saved",
      rejectedThrew && afterReject === null,
    );

    // Ingest BEFORE any config exists, so the worker child processes
    // this conversation with no key anywhere (instant not-configured)
    // instead of making a real provider call with the fake test key.
    const convAi = await ingestText("cust-33", "a", "Hello, do you deliver to Pokhara?");

    modelsStatus = 200;
    const saved = await aiConfigService.upsert(userA.id, wa.id, {
      provider: "custom",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      apiKey: "workspace-key-123",
    });
    assert(
      "ai-config: saved with hasKey, and the key itself is never exposed",
      saved.config.hasKey &&
        saved.config.model === "openai/gpt-oss-120b" &&
        !JSON.stringify(saved).includes("workspace-key-123"),
    );

    // No env key anywhere: the workspace key alone powers the AI.
    const wsSuggestion = await aiAssistantService.suggestReply(userA.id, wa.id, convAi.id);
    assert(
      "ai-config: AI runs on the workspace's own key",
      wsSuggestion.text === "Workspace-key reply." &&
        lastChatAuth === "Bearer workspace-key-123",
      `auth=${lastChatAuth}`,
    );

    // Keep-or-replace: changing the model without a key keeps the key.
    const replaced = await aiConfigService.upsert(userA.id, wa.id, {
      provider: "custom",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-20b",
    });
    const wsSuggestion2 = await aiAssistantService.suggestReply(userA.id, wa.id, convAi.id);
    assert(
      "ai-config: model change without a key keeps the saved key",
      replaced.config.model === "openai/gpt-oss-20b" &&
        wsSuggestion2.text === "Workspace-key reply." &&
        lastChatAuth === "Bearer workspace-key-123",
    );
  } finally {
    globalThis.fetch = originalFetchAiConfig;
  }

  await aiConfigService.remove(userA.id, wa.id);
  const afterRemoveAi = await aiConfigService.get(userA.id, wa.id);
  assert("ai-config: after removal, no workspace config", afterRemoveAi === null);
  await expectThrows("ai-config: with no key anywhere, AI reports not configured", () =>
    aiAssistantService.suggestReply(userA.id, wa.id, conv1.id),
  );

  // ── 18. Knowledge documents (Dograh-style KB, Full Document) ─────
  await expectThrows("kb-docs: an AGENT cannot upload documents", () =>
    knowledgeDocumentService.upload(userC.id, wa.id, {
      fileName: "agent.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("hello"),
    }),
  );
  await expectThrows("kb-docs: unsupported file type is rejected", () =>
    knowledgeDocumentService.upload(userA.id, wa.id, {
      fileName: "photo.png",
      mimeType: "image/png",
      bytes: Buffer.from("png-bytes"),
    }),
  );
  await expectThrows("kb-docs: files over 5 MB are rejected", () =>
    knowledgeDocumentService.upload(userA.id, wa.id, {
      fileName: "big.txt",
      mimeType: "text/plain",
      bytes: Buffer.alloc(MAX_KNOWLEDGE_FILE_BYTES + 1, 97),
    }),
  );

  const txtDoc = await knowledgeDocumentService.upload(userA.id, wa.id, {
    fileName: "delivery-notes.txt",
    mimeType: "text/plain",
    bytes: Buffer.from(
      "Zorawar delivery promise: orders reach Pokhara within two days via the Zorawar courier desk.",
    ),
  });
  assert("kb-docs: an upload starts as PROCESSING", txtDoc.status === "PROCESSING");
  const readyDoc = await waitFor("knowledge document ready", async () => {
    const row = await prisma.knowledgeDocument.findUnique({ where: { id: txtDoc.id } });
    return row?.status === "READY" ? row : null;
  });
  assert(
    "kb-docs: the worker extracts the text and marks it READY",
    (readyDoc.extractedText ?? "").includes("Zorawar courier desk") &&
      (readyDoc.charCount ?? 0) > 0,
  );

  // A minimal valid PDF built byte-by-byte (correct xref offsets).
  function buildMinimalPdf(text: string): Buffer {
    const stream = `BT /F1 12 Tf 20 700 Td (${text}) Tj ET`;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
  }
  const pdfDoc = await knowledgeDocumentService.upload(userA.id, wa.id, {
    fileName: "handbook.pdf",
    mimeType: "application/pdf",
    bytes: buildMinimalPdf("Karnali handbook"),
  });
  const readyPdf = await waitFor("knowledge pdf ready", async () => {
    const row = await prisma.knowledgeDocument.findUnique({ where: { id: pdfDoc.id } });
    return row?.status === "READY" ? row : null;
  });
  assert(
    "kb-docs: PDF text is extracted",
    (readyPdf.extractedText ?? "").includes("Karnali handbook"),
    readyPdf.extractedText ?? "(no text)",
  );

  const badPdf = await knowledgeDocumentService.upload(userA.id, wa.id, {
    fileName: "broken.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("this is not really a pdf file at all"),
  });
  const failedDoc = await waitFor("knowledge pdf failed", async () => {
    const row = await prisma.knowledgeDocument.findUnique({ where: { id: badPdf.id } });
    return row?.status === "FAILED" ? row : null;
  });
  assert(
    "kb-docs: a corrupt PDF settles as FAILED with a reason",
    typeof failedDoc.error === "string" && failedDoc.error.length > 0,
  );

  // Grounding: the suggestion prompt carries the document's full text
  // and the audit line names the file.
  let lastKbPrompt = "";
  const originalFetchKb = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.includes("/chat/completions")) {
      lastKbPrompt = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Doc-grounded reply." } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in kb-docs test: ${url}`);
  }) as typeof fetch;
  try {
    process.env.AI_API_KEY = "<MASKED_SECRET_001>";
    const convKb = await ingestText(
      "cust-40",
      "a",
      "Tell me about Zorawar delivery to Pokhara please",
    );
    const kbSuggestion = await aiAssistantService.suggestReply(userA.id, wa.id, convKb.id);
    assert(
      "kb-docs: suggestions are grounded in the uploaded document",
      kbSuggestion.text === "Doc-grounded reply." &&
        lastKbPrompt.includes("Zorawar courier desk") &&
        kbSuggestion.knowledgeUsed.includes("delivery-notes.txt"),
      `knowledgeUsed=${JSON.stringify(kbSuggestion.knowledgeUsed)}`,
    );
  } finally {
    globalThis.fetch = originalFetchKb;
    delete process.env.AI_API_KEY;
  }

  await knowledgeDocumentService.remove(userA.id, wa.id, txtDoc.id);
  const docsAfterDelete = await knowledgeDocumentService.list(userA.id, wa.id);
  assert(
    "kb-docs: delete removes the document and views never expose its text",
    !docsAfterDelete.some((doc) => doc.id === txtDoc.id) &&
      !JSON.stringify(docsAfterDelete).includes("Zorawar") &&
      !JSON.stringify(docsAfterDelete).includes("extractedText"),
  );

  // ── 19. Stuck webhook recovery sweep ─────────────────────────────
  // Simulates the 2026-11-24 Upstash outage: the event row persisted
  // but its queue job was never added (the enqueue threw).
  const stuckEventId = `test13-${runId}-stuck-1`;
  const stuckEvent = await prisma.webhookEvent.create({
    data: {
      provider: "MOCK",
      channelId: channel.id,
      externalEventId: stuckEventId,
      receivedAt: new Date(Date.now() - 15 * 60_000),
      payload: {
        eventId: stuckEventId,
        channelId: channel.id,
        events: [
          {
            externalMessageId: `ext13-${runId}-stuck-1`,
            senderExternalId: "cust-stuck",
            senderName: "Customer cust-stuck",
            text: "Did my message survive the outage?",
            type: "TEXT",
            sentAt: new Date().toISOString(),
          },
        ],
      },
    },
  });
  const beforeSweep = await prisma.message.findFirst({
    where: { externalMessageId: `ext13-${runId}-stuck-1` },
  });
  assert("recovery: a stuck event sits unprocessed", beforeSweep === null);
  const requeued = await webhookService.requeueStuckEvents();
  assert("recovery: the sweep requeues stuck events", requeued >= 1, `requeued=${requeued}`);
  await waitEventProcessed(stuckEvent.id);
  const stuckMessage = await prisma.message.findFirst({
    where: { externalMessageId: `ext13-${runId}-stuck-1` },
  });
  assert("recovery: the stuck message is ingested after the sweep", stuckMessage !== null);

  // ── 20. Store API shape — custom store APIs ──────────────────────
  const customShape = {
    productsPath: "/items",
    searchParam: "q",
    limitParam: "limit",
    responsePath: "catalog.items",
    nameField: "title",
    priceField: "cost",
    stockField: "qty",
    imageField: "pic",
  };
  const customConnection = await storeConnectionService.upsert(userA.id, wa.id, {
    baseUrl: "https://custom-shop.example.test",
    ...customShape,
  });
  assert(
    "shape: custom API shape saved on the connection",
    customConnection.shape.productsPath === "/items" &&
      customConnection.shape.responsePath === "catalog.items" &&
      customConnection.shape.nameField === "title",
    JSON.stringify(customConnection.shape),
  );

  const originalFetchShape = globalThis.fetch;
  let lastStoreUrl = "";
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    lastStoreUrl = url;
    if (url.includes("custom-shop.example.test")) {
      return new Response(
        JSON.stringify({
          catalog: {
            items: [
              {
                id: "b1",
                title: "Trail Boot X",
                cost: "4999",
                qty: 3,
                pic: "https://img.example.test/boot.jpg",
              },
              {
                id: "b2",
                title: "Trail Sock",
                cost: 499,
                pic: "https://img.example.test/sock.jpg",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in shape test: ${url}`);
  }) as typeof fetch;
  try {
    const foundCustom = await storeProductService.searchProducts(wa.id, "boot");
    assert(
      "shape: request uses the custom endpoint + params",
      lastStoreUrl.includes("/items?") &&
        lastStoreUrl.includes("limit=5") &&
        lastStoreUrl.includes("q=boot"),
      lastStoreUrl,
    );
    assert(
      "shape: custom fields normalized (string price, flat stock, string image)",
      foundCustom.length === 2 &&
        foundCustom[0]?.name === "Trail Boot X" &&
        foundCustom[0]?.priceMin === 4999 &&
        foundCustom[0]?.totalStock === 3 &&
        foundCustom[0]?.inStock === true &&
        foundCustom[0]?.stockKnown === true &&
        foundCustom[0]?.imageUrl === "https://img.example.test/boot.jpg",
      JSON.stringify(foundCustom),
    );
    assert(
      "shape: a missing stock field reads as unknown, not out-of-stock",
      foundCustom[1]?.stockKnown === false && foundCustom[1]?.inStock === false,
      JSON.stringify(foundCustom[1]),
    );

    const shapeTest = await storeConnectionService.test(userA.id, wa.id, {
      baseUrl: "https://custom-shop.example.test",
      ...customShape,
    });
    assert(
      "shape: test names the first product as parsed",
      shapeTest.ok && shapeTest.message.includes("Trail Boot X"),
      shapeTest.message,
    );
  } finally {
    globalThis.fetch = originalFetchShape;
  }

  let badShapeBlocked = false;
  try {
    await storeConnectionService.upsert(userA.id, wa.id, {
      baseUrl: "https://custom-shop.example.test",
      productsPath: "products",
    });
  } catch {
    badShapeBlocked = true;
  }
  assert("shape: an endpoint without a leading / is rejected", badShapeBlocked);

  await storeConnectionService.remove(userA.id, wa.id);

  // ── 21. Automation channel scoping (channelIds condition) ────────
  const channelB = await prisma.channel.create({
    data: {
      workspaceId: wa.id,
      provider: "MOCK",
      externalAccountId: `mock-b-${runId}`,
      displayName: "Second mock channel",
      status: "CONNECTED",
    },
  });
  const contactB = await prisma.contact.create({
    data: { workspaceId: wa.id, displayName: "Channel B Customer" },
  });
  const convB = await prisma.conversation.create({
    data: {
      workspaceId: wa.id,
      channelId: channelB.id,
      contactId: contactB.id,
      status: "OPEN",
    },
  });
  const scopedRule = await automationService.createRule(userA.id, wa.id, {
    name: "Channel B only",
    trigger: "message.created",
    conditions: { channelIds: [channelB.id] },
    actions: [{ type: "add_tag", name: "channel-b" }],
  });
  assert(
    "channels: the rule view carries its channelIds",
    (scopedRule.conditions?.channelIds ?? []).join() === channelB.id,
    JSON.stringify(scopedRule.conditions),
  );

  const convMain = await ingestText("cust-41", "a", "hello from the main channel");
  await automationEngine.handleEvent(wa.id, "message.created", {
    conversationId: convMain.id,
    messageBody: "hello from the main channel",
  });
  const runsMain = await prisma.automationRun.findMany({
    where: { ruleId: scopedRule.id, conversationId: convMain.id },
  });
  assert(
    "channels: a rule scoped to channel B does not fire on the main channel",
    runsMain.length === 0,
  );

  await automationEngine.handleEvent(wa.id, "message.created", {
    conversationId: convB.id,
    messageBody: "hello from channel B",
  });
  const runsB = await prisma.automationRun.findMany({
    where: { ruleId: scopedRule.id, conversationId: convB.id },
  });
  assert(
    "channels: the rule fires on its own channel",
    runsB.length === 1 && JSON.stringify(runsB[0]?.results).includes('"ok":true'),
    JSON.stringify(runsB),
  );

  await automationService.deleteRule(userA.id, wa.id, scopedRule.id).catch(() => null);
  await prisma.channel.delete({ where: { id: channelB.id } }).catch(() => null);
  await prisma.contact.delete({ where: { id: contactB.id } }).catch(() => null);

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
