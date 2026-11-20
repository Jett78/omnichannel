/**
 * Phase 12 verification suite — Outgoing webhooks.
 *
 * Exercises the SSRF URL guard, webhook CRUD + permissions, event
 * dispatch from the real flows (website widget ingest, resolve,
 * reopen), the delivery processor against a real local HTTP
 * receiver (signature verification, success + failure recording),
 * the test ping, enable/disable, and the guarantee that private
 * notes never leave the system.
 *
 * The receiver is a local http server on 127.0.0.1 — allowed by the
 * SSRF guard only outside production, which is exactly how this
 * suite runs. Everything runs against the real database + Redis.
 *
 * Run with:  npm run test:phase12
 */

process.env.DATABASE_URL ??= "postgresql://uoi@localhost:5432/uoi";
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-phase12-suite";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 12).toString("base64");

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface ReceivedRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const { auth } = await import("@/lib/auth");
  const { getQueues } = await import("@/lib/queue");
  const { validateOutgoingWebhookUrl } = await import("@/lib/webhook-url");
  const { outgoingWebhookService } = await import("@/services/outgoing-webhook.service");
  const { processOutgoingWebhookJob } = await import(
    "@/workers/processors/outgoing-webhook.processor"
  );
  const { websiteChannelService } = await import("@/services/website-channel.service");
  const { widgetService } = await import("@/services/widget.service");
  const { conversationService } = await import("@/services/conversation.service");

  // ── Local receiver ──────────────────────────────────────────────
  const received: ReceivedRequest[] = [];
  let receiverStatus = 200;
  const receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        headers: request.headers,
        rawBody: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(receiverStatus, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const receiverPort = (receiver.address() as AddressInfo).port;
  const receiverUrl = `http://127.0.0.1:${receiverPort}/hook`;

  const stamp = Date.now();
  const ownerSignUp = await auth.api.signUpEmail({
    body: {
      name: "P12 Owner",
      email: `p12-owner-${stamp}@test.local`,
      password: "password-123456",
    },
  });
  const agentSignUp = await auth.api.signUpEmail({
    body: {
      name: "P12 Agent",
      email: `p12-agent-${stamp}@test.local`,
      password: "password-123456",
    },
  });
  const owner = ownerSignUp.user;
  const agent = agentSignUp.user;
  const workspace = await prisma.workspace.create({
    data: {
      name: "P12 Workspace",
      slug: `p12-${stamp}`,
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: agent.id, role: "AGENT" },
        ],
      },
    },
  });

  const queue = getQueues().outgoingWebhook;
  async function jobsFor(webhookId: string) {
    const jobs = await queue.getWaiting();
    return jobs.filter((job) => job.data.webhookId === webhookId);
  }
  async function takeJob(webhookId: string, event: string) {
    const jobs = await jobsFor(webhookId);
    const job = jobs.find((candidate) => candidate.data.event === event);
    assert.ok(job, `expected a queued ${event} job for webhook ${webhookId}`);
    return job;
  }

  let webhook1Id = "";
  let webhook1Secret = "";
  let webhook2Id = "";
  let conversationId = "";

  try {
    console.log("\n── SSRF URL guard ──");
    await check("loopback http is allowed outside production (local receivers)", async () => {
      const url = await validateOutgoingWebhookUrl(receiverUrl);
      assert.equal(url.port, String(receiverPort));
    });
    await check("cloud metadata address is rejected", async () => {
      await assert.rejects(() => validateOutgoingWebhookUrl("http://169.254.169.254/latest/meta-data"));
    });
    await check("private LAN addresses are rejected", async () => {
      await assert.rejects(() => validateOutgoingWebhookUrl("http://192.168.1.10/hook"));
      await assert.rejects(() => validateOutgoingWebhookUrl("https://10.0.0.5/hook"));
      await assert.rejects(() => validateOutgoingWebhookUrl("http://172.16.0.9/hook"));
    });
    await check("non-http schemes and garbage are rejected", async () => {
      await assert.rejects(() => validateOutgoingWebhookUrl("ftp://example.com/hook"));
      await assert.rejects(() => validateOutgoingWebhookUrl("not a url"));
    });
    await check("localhost hostnames are allowed only outside production", async () => {
      const url = await validateOutgoingWebhookUrl(`http://localhost:${receiverPort}/hook`);
      assert.equal(url.hostname, "localhost");
    });

    console.log("\n── Webhook CRUD ──");
    await check("an AGENT cannot create a webhook", async () => {
      await assert.rejects(() =>
        outgoingWebhookService.createWebhook(agent.id, workspace.id, {
          name: "Agent hook",
          url: receiverUrl,
          events: ["message.created"],
        }),
      );
    });
    await check("creating with a private URL is rejected", async () => {
      await assert.rejects(() =>
        outgoingWebhookService.createWebhook(owner.id, workspace.id, {
          name: "Bad hook",
          url: "http://192.168.0.20/hook",
          events: ["message.created"],
        }),
      );
    });
    await check("the owner creates webhooks; a signing secret is generated", async () => {
      const first = await outgoingWebhookService.createWebhook(owner.id, workspace.id, {
        name: "Receiver one",
        url: receiverUrl,
        events: ["conversation.created", "message.created"],
      });
      webhook1Id = first.id;
      webhook1Secret = first.secret;
      assert.ok(first.secret.length >= 32);
      assert.equal(first.enabled, true);
      const second = await outgoingWebhookService.createWebhook(owner.id, workspace.id, {
        name: "Receiver two",
        url: receiverUrl,
        events: ["conversation.resolved", "conversation.reopened"],
      });
      webhook2Id = second.id;
      const list = await outgoingWebhookService.listWebhooks(owner.id, workspace.id);
      assert.equal(list.length, 2);
      assert.equal(list[0]?.lastDelivery, null);
    });

    console.log("\n── Dispatch from real flows ──");
    const channel = await websiteChannelService.createWebsiteChannel(owner.id, workspace.id, {
      name: "P12 Site",
    });
    const websiteToken = channel.externalAccountId;
    const { visitorToken } = await widgetService.startConversation(websiteToken, {
      name: "Hook Tester",
    });

    await check("a visitor's first message dispatches conversation.created + message.created", async () => {
      await widgetService.sendTextMessage(websiteToken, visitorToken, "Hello webhooks");
      const jobs = await jobsFor(webhook1Id);
      assert.deepEqual(
        jobs.map((job) => job.data.event).sort(),
        ["conversation.created", "message.created"],
      );
      assert.equal((await jobsFor(webhook2Id)).length, 0);
      const conversations = await prisma.conversation.findMany({
        where: { workspaceId: workspace.id },
      });
      assert.equal(conversations.length, 1);
      conversationId = conversations[0]?.id ?? "";
      assert.ok(conversationId);
    });

    console.log("\n── Delivery ──");
    await check("delivery POSTs the envelope with a verifiable HMAC signature", async () => {
      const job = await takeJob(webhook1Id, "message.created");
      await processOutgoingWebhookJob(job as never);
      await job.remove();
      assert.equal(received.length, 1);
      const request = received[0];
      assert.ok(request);
      assert.equal(request.headers["x-uoi-event"], "message.created");
      const expected = createHmac("sha256", webhook1Secret).update(request.rawBody).digest("hex");
      assert.equal(request.headers["x-uoi-signature"], expected);
      const body = JSON.parse(request.rawBody) as {
        event: string;
        data: {
          conversation: { channel: { provider: string } };
          message: { body: string; direction: string };
        };
      };
      assert.equal(body.event, "message.created");
      assert.equal(body.data.conversation.channel.provider, "website");
      assert.equal(body.data.message.body, "Hello webhooks");
      assert.equal(body.data.message.direction, "INBOUND");
      const delivery = await prisma.webhookDelivery.findFirst({
        where: { webhookId: webhook1Id, event: "message.created" },
      });
      assert.equal(delivery?.success, true);
      assert.equal(delivery?.statusCode, 200);
    });
    await check("a 500 from the receiver is recorded and fails the job (for retry)", async () => {
      receiverStatus = 500;
      const job = await takeJob(webhook1Id, "conversation.created");
      await assert.rejects(() => processOutgoingWebhookJob(job as never));
      await job.remove();
      receiverStatus = 200;
      const delivery = await prisma.webhookDelivery.findFirst({
        where: { webhookId: webhook1Id, event: "conversation.created" },
      });
      assert.equal(delivery?.success, false);
      assert.equal(delivery?.statusCode, 500);
    });
    await check("the test ping delivers a webhook.test event", async () => {
      await outgoingWebhookService.sendTestPing(owner.id, workspace.id, webhook1Id);
      const job = await takeJob(webhook1Id, "webhook.test");
      const before = received.length;
      await processOutgoingWebhookJob(job as never);
      await job.remove();
      assert.equal(received.length, before + 1);
      const body = JSON.parse(received[received.length - 1]?.rawBody ?? "{}") as {
        event: string;
      };
      assert.equal(body.event, "webhook.test");
    });

    console.log("\n── Resolve / reopen routing ──");
    await check("resolving dispatches conversation.resolved only to its subscribers", async () => {
      await conversationService.resolveConversation(owner.id, workspace.id, conversationId);
      const jobs = await jobsFor(webhook2Id);
      assert.deepEqual(
        jobs.map((job) => job.data.event),
        ["conversation.resolved"],
      );
      assert.equal((await jobsFor(webhook1Id)).length, 0);
      await jobs[0]?.remove();
    });
    await check("a customer reply on a resolved conversation dispatches conversation.reopened", async () => {
      await widgetService.sendTextMessage(websiteToken, visitorToken, "Are you still there?");
      const reopened = await jobsFor(webhook2Id);
      assert.deepEqual(
        reopened.map((job) => job.data.event),
        ["conversation.reopened"],
      );
      await reopened[0]?.remove();
      const messageJobs = await jobsFor(webhook1Id);
      assert.deepEqual(
        messageJobs.map((job) => job.data.event),
        ["message.created"],
      );
      await messageJobs[0]?.remove();
    });

    console.log("\n── Privacy + enable/disable + delete ──");
    await check("private notes are never dispatched", async () => {
      const before = (await queue.getWaiting()).length;
      await conversationService.addInternalNote(
        owner.id,
        workspace.id,
        conversationId,
        "Internal: do not send this out",
      );
      assert.equal((await queue.getWaiting()).length, before);
    });
    await check("a disabled webhook receives nothing", async () => {
      await outgoingWebhookService.updateWebhook(owner.id, workspace.id, webhook1Id, {
        enabled: false,
      });
      await widgetService.sendTextMessage(websiteToken, visitorToken, "While disabled");
      assert.equal((await jobsFor(webhook1Id)).length, 0);
    });
    await check("deleting a webhook removes it and its delivery history", async () => {
      await outgoingWebhookService.deleteWebhook(owner.id, workspace.id, webhook2Id);
      const list = await outgoingWebhookService.listWebhooks(owner.id, workspace.id);
      assert.deepEqual(
        list.map((item) => item.id),
        [webhook1Id],
      );
      const deliveries = await prisma.webhookDelivery.count({ where: { webhookId: webhook2Id } });
      assert.equal(deliveries, 0);
    });
  } finally {
    receiver.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: agent.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(`\nPhase 12 suite: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
