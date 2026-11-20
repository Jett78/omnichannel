/**
 * Phase 11 verification suite — Website live-chat widget.
 *
 * Exercises the channel service (create/update/permissions), the
 * HMAC visitor tokens, the full visitor flow (start → message →
 * agent reply → media) through the real messaging engine, visitor
 * isolation, the rate limiter, and disconnect behaviour. The
 * website provider is our own channel — there is no external API
 * to fake; everything runs against the real database + Redis.
 *
 * Run with:  npm run test:phase11
 */

process.env.DATABASE_URL ??= "postgresql://uoi:uoi-password@localhost:5432/uoi";
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-phase11-suite";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 11).toString("base64");

import assert from "node:assert/strict";

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

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const { auth } = await import("@/lib/auth");
  const { getProvider } = await import("@/integrations/registry");
  const { websiteChannelService } = await import("@/services/website-channel.service");
  const {
    widgetService,
    getWidgetChannel,
    publicConfigOf,
    signVisitorToken,
    verifyVisitorToken,
    hitRateLimit,
  } = await import("@/services/widget.service");
  const { messagingService } = await import("@/services/messaging.service");
  const { metaConnectionService } = await import("@/services/meta-connection.service");

  const stamp = Date.now();
  const ownerSignUp = await auth.api.signUpEmail({
    body: {
      name: "P11 Owner",
      email: `p11-owner-${stamp}@test.local`,
      password: "phase11-password-123",
    },
  });
  const agentSignUp = await auth.api.signUpEmail({
    body: {
      name: "P11 Agent",
      email: `p11-agent-${stamp}@test.local`,
      password: "phase11-password-123",
    },
  });
  const owner = ownerSignUp.user;
  const agent = agentSignUp.user;
  const workspace = await prisma.workspace.create({
    data: {
      name: "P11 Workspace",
      slug: `p11-${stamp}`,
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: agent.id, role: "AGENT" },
        ],
      },
    },
  });

  try {
    console.log("\n── Website provider ──");
    await check("registry resolves the website provider", () => {
      assert.equal(getProvider("website").id, "website");
    });
    await check("provider: webhook verification fails closed, parse is empty", async () => {
      const provider = getProvider("website");
      assert.equal(
        provider.verifyWebhook({
          headers: new Headers(),
          rawBody: "{}",
          searchParams: new URLSearchParams(),
        }),
        false,
      );
      assert.deepEqual(provider.parseWebhook({}), []);
    });
    const fakeContext = {
      channelId: "test-channel",
      workspaceId: workspace.id,
      provider: "website" as const,
      externalAccountId: "wt_test",
      credentials: { accessToken: "", scopes: [] },
    };
    await check("provider: sendMessage returns a website- delivery id", async () => {
      const provider = getProvider("website");
      const result = await provider.sendMessage({
        channel: fakeContext,
        toExternalId: "visitor_x",
        message: { type: "TEXT", body: "hi" },
      });
      assert.ok(result.externalMessageId.startsWith("website-"));
    });
    await check("provider: uploadMedia returns a website-file: reference", async () => {
      const provider = getProvider("website");
      assert.ok(provider.uploadMedia);
      const result = await provider.uploadMedia({
        channel: fakeContext,
        media: { bytes: Buffer.from("x"), mimeType: "image/png", fileName: "x.png" },
      });
      assert.ok(result.ref.startsWith("website-file:"));
    });

    console.log("\n── Channel service ──");
    let websiteToken = "";
    let channelId = "";
    await check("owner creates a website channel with defaults", async () => {
      const channel = await websiteChannelService.createWebsiteChannel(owner.id, workspace.id, {
        name: "Test Store",
        websiteUrl: "https://store.example.com",
      });
      channelId = channel.id;
      websiteToken = channel.externalAccountId;
      assert.equal(channel.provider, "WEBSITE");
      assert.equal(channel.status, "CONNECTED");
      assert.ok(websiteToken.startsWith("wt_"));
      const config = channel.config as Record<string, unknown>;
      assert.equal(config.widgetColor, "#4f46e5");
      assert.equal(config.preChatForm, true);
      assert.equal(config.welcomeTitle, "Chat with us");
    });
    await check("a workspace can run a second website channel", async () => {
      const second = await websiteChannelService.createWebsiteChannel(owner.id, workspace.id, {
        name: "Blog",
      });
      assert.notEqual(second.externalAccountId, websiteToken);
    });
    await check("an AGENT cannot create a website channel", async () => {
      await assert.rejects(() =>
        websiteChannelService.createWebsiteChannel(agent.id, workspace.id, { name: "Nope" }),
      );
    });
    await check("settings update changes name + color + pre-chat", async () => {
      const updated = await websiteChannelService.updateWebsiteChannel(
        owner.id,
        workspace.id,
        channelId,
        { name: "Test Store 2", widgetColor: "#059669", preChatForm: false },
      );
      assert.equal(updated.displayName, "Test Store 2");
      const config = updated.config as Record<string, unknown>;
      assert.equal(config.widgetColor, "#059669");
      assert.equal(config.preChatForm, false);
    });

    console.log("\n── Visitor tokens ──");
    await check("sign/verify round-trips channel + visitor", () => {
      const token = signVisitorToken(channelId, "visitor_abc");
      const verified = verifyVisitorToken(token);
      assert.deepEqual(verified, { channelId, externalUserId: "visitor_abc" });
    });
    await check("tampered and garbage tokens are rejected", () => {
      const token = signVisitorToken(channelId, "visitor_abc");
      const parts = token.split(".");
      const forgedPayload = Buffer.from(
        JSON.stringify({ c: channelId, u: "visitor_evil" }),
      ).toString("base64url");
      assert.equal(verifyVisitorToken(`v1.${forgedPayload}.${parts[2]}`), null);
      assert.equal(verifyVisitorToken("not-a-token"), null);
      assert.equal(verifyVisitorToken(""), null);
    });

    console.log("\n── Public config ──");
    await check("public config reflects the channel settings", async () => {
      const channel = await getWidgetChannel(websiteToken);
      const config = publicConfigOf(channel);
      assert.equal(config.displayName, "Test Store 2");
      assert.equal(config.widgetColor, "#059669");
      assert.equal(config.preChatForm, false);
    });
    await check("an unknown website token 404s", async () => {
      await assert.rejects(() => getWidgetChannel("wt_doesnotexist"));
    });

    console.log("\n── Visitor flow ──");
    let visitorToken = "";
    let conversationId = "";
    await check("a visitor starts a conversation and gets a token", async () => {
      const result = await widgetService.startConversation(websiteToken, {
        name: "Sita Sharma",
        email: "sita@example.com",
      });
      visitorToken = result.visitorToken;
      assert.ok(verifyVisitorToken(visitorToken));
      const contact = await prisma.contact.findFirst({
        where: { workspaceId: workspace.id, email: "sita@example.com" },
      });
      assert.equal(contact?.displayName, "Sita Sharma");
    });
    await check("the history is empty before the first message", async () => {
      const list = await widgetService.listMessages(websiteToken, visitorToken);
      assert.equal(list.conversationId, null);
      assert.equal(list.messages.length, 0);
    });
    await check("the visitor's first message lands in the inbox", async () => {
      const sent = await widgetService.sendTextMessage(
        websiteToken,
        visitorToken,
        "Hello, do you deliver to Pokhara?",
      );
      conversationId = sent.conversationId;
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      assert.equal(conversation?.status, "OPEN");
      assert.equal(conversation?.unreadCount, 1);
      const list = await widgetService.listMessages(websiteToken, visitorToken);
      assert.equal(list.messages.length, 1);
      assert.equal(list.messages[0]?.fromVisitor, true);
      assert.equal(list.messages[0]?.body, "Hello, do you deliver to Pokhara?");
    });
    await check("an agent reply is delivered and visible to the visitor", async () => {
      const outbound = await messagingService.sendOutboundMessage(
        owner.id,
        workspace.id,
        conversationId,
        { content: "Yes, we deliver to Pokhara in 2 days." },
      );
      // Website delivery is the persisted row itself: the message
      // must be SENT immediately, never QUEUED behind the worker.
      assert.equal(outbound.status, "SENT");
      const delivered = await messagingService.deliverOutboundMessage(outbound.id, {
        isFinalAttempt: true,
      });
      assert.equal(delivered.status, "SENT");
      const list = await widgetService.listMessages(websiteToken, visitorToken);
      assert.equal(list.messages.length, 2);
      assert.equal(list.messages[1]?.fromVisitor, false);
      assert.equal(list.messages[1]?.body, "Yes, we deliver to Pokhara in 2 days.");
    });
    await check("the visitor can send a photo; bytes are stored and served back", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
      const sent = await widgetService.sendMediaMessage(websiteToken, visitorToken, {
        bytes: png,
        fileName: "photo.png",
        mimeType: "image/png",
        caption: "This one please",
      });
      const attachment = await prisma.messageAttachment.findFirst({
        where: { messageId: sent.messageId },
        include: { storedMedia: true },
      });
      assert.ok(attachment?.storedMedia);
      const served = await widgetService.getMediaBytes(
        websiteToken,
        visitorToken,
        sent.messageId,
        0,
      );
      assert.deepEqual(Buffer.from(served.bytes), png);
      assert.equal(served.mimeType, "image/png");
      const list = await widgetService.listMessages(websiteToken, visitorToken);
      const mediaMessage = list.messages.find((m) => m.id === sent.messageId);
      assert.equal(mediaMessage?.attachments.length, 1);
      assert.ok(mediaMessage?.attachments[0]?.url.includes("/media/"));
    });
    await check("an agent-sent photo is SENT immediately too", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
      const outbound = await messagingService.sendOutboundMedia(
        owner.id,
        workspace.id,
        conversationId,
        { bytes: png, fileName: "agent.png", mimeType: "image/png", caption: "Agent photo" },
      );
      assert.equal(outbound.status, "SENT");
      const list = await widgetService.listMessages(websiteToken, visitorToken);
      const seen = list.messages.find((m) => m.id === outbound.id);
      assert.equal(seen?.fromVisitor, false);
      assert.equal(seen?.attachments.length, 1);
    });
    await check("an unsupported file type is rejected honestly", async () => {
      await assert.rejects(() =>
        widgetService.sendMediaMessage(websiteToken, visitorToken, {
          bytes: Buffer.from("MZ"),
          fileName: "evil.exe",
          mimeType: "application/x-msdownload",
        }),
      );
    });

    console.log("\n── Visitor isolation ──");
    await check("a second visitor sees only their own (empty) history", async () => {
      const other = await widgetService.startConversation(websiteToken, { name: "Other" });
      const list = await widgetService.listMessages(websiteToken, other.visitorToken);
      assert.equal(list.messages.length, 0);
      const firstMessage = await prisma.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
      });
      await assert.rejects(() =>
        widgetService.getMediaBytes(websiteToken, other.visitorToken, firstMessage!.id, 0),
      );
    });
    await check("a token from another channel is rejected for this site", async () => {
      const second = await websiteChannelService.createWebsiteChannel(owner.id, workspace.id, {
        name: "Other Site",
      });
      const foreign = await widgetService.startConversation(second.externalAccountId, {});
      await assert.rejects(() => widgetService.listMessages(websiteToken, foreign.visitorToken));
    });

    console.log("\n── Rate limiting ──");
    await check("the fixed-window limiter blocks past the limit", async () => {
      const key = `p11-test-${stamp}`;
      assert.equal(await hitRateLimit(key, 3, 60), true);
      assert.equal(await hitRateLimit(key, 3, 60), true);
      assert.equal(await hitRateLimit(key, 3, 60), true);
      assert.equal(await hitRateLimit(key, 3, 60), false);
    });

    console.log("\n── Disconnect ──");
    await check("disconnecting the channel takes the widget offline", async () => {
      await metaConnectionService.disconnectChannel(owner.id, workspace.id, channelId);
      await assert.rejects(() => getWidgetChannel(websiteToken));
    });
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: agent.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(`\nPhase 11 suite: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
