import { randomUUID } from "node:crypto";

import { getQueues } from "@/lib/queue";
import { prisma } from "@/lib/prisma";

/**
 * Simulate an inbound customer message through the MOCK provider
 * (dev/test only — nothing here is a real social media message).
 *
 *   npm run simulate:inbound [-- --text "Hello" --from mock-user-9 --name "Asha" --channelId <id>]
 *
 * It takes the same path a real webhook delivery takes from the point
 * the event is persisted: a WebhookEvent row is inserted and the
 * webhook queue job is enqueued. The worker (`npm run worker`) then
 * parses + ingests it; the realtime gateway (`npm run realtime`)
 * pushes it to open inboxes. Start web + worker + realtime first for
 * the full loop.
 */
function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const channelIdArg = argValue("--channelId");
  const channel = channelIdArg
    ? await prisma.channel.findUnique({ where: { id: channelIdArg } })
    : await prisma.channel.findFirst({
        where: { provider: "MOCK" },
        orderBy: { createdAt: "asc" },
      });
  if (!channel || channel.provider !== "MOCK") {
    console.error(
      "No MOCK channel found. Connect one first (Channels page → “Connect mock channel (dev only)”) — the mock provider is dev/test only.",
    );
    process.exit(1);
  }

  const senderExternalId = argValue("--from") ?? "mock-user-1";
  const senderName = argValue("--name") ?? "Simulated Customer";
  const text = argValue("--text") ?? "Hello! This is a simulated inbound message (mock provider).";
  const externalMessageId = `mock-in-${randomUUID()}`;
  const eventId = `sim-${randomUUID()}`;

  const payload = {
    eventId,
    channelId: channel.id,
    events: [
      {
        externalMessageId,
        senderExternalId,
        senderName,
        text,
        type: "TEXT",
        sentAt: new Date().toISOString(),
      },
    ],
  };

  const event = await prisma.webhookEvent.create({
    data: { provider: "MOCK", channelId: channel.id, externalEventId: eventId, payload },
  });
  await getQueues().webhook.add("webhook", { webhookEventId: event.id, provider: "mock" });

  console.log(`Simulated inbound queued:`);
  console.log(`  channel:   ${channel.displayName} (${channel.id})`);
  console.log(`  from:      ${senderName} <${senderExternalId}>`);
  console.log(`  messageId: ${externalMessageId}`);
  console.log(`  eventId:   ${event.id}`);
  console.log("Make sure `npm run worker` is running so the webhook job gets processed.");
}

main()
  .catch((error: unknown) => {
    console.error("simulate:inbound failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
