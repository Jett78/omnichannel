import { createHmac } from "node:crypto";

import type { Job } from "bullmq";

import { prisma } from "@/lib/prisma";
import { validateOutgoingWebhookUrl } from "@/lib/webhook-url";
import type { OutgoingWebhookJobData } from "@/types/queue";

/**
 * Outgoing webhook delivery (Phase 12). POSTs the event envelope
 * { id, event, timestamp, data } as JSON with an HMAC-SHA256
 * signature (hex, over the exact raw body) in the
 * `x-uoi-signature` header, so receivers can verify authenticity
 * with the webhook's secret. The URL is re-validated at delivery
 * time (DNS may have changed since it was saved). Every attempt is
 * recorded in WebhookDelivery; a non-2xx response or a network
 * error fails the job so BullMQ retries (3 attempts, exponential
 * backoff). Redirects are NOT followed — a 3xx counts as a failed
 * delivery, which keeps the SSRF guard meaningful.
 */
export async function processOutgoingWebhookJob(job: Job<OutgoingWebhookJobData>): Promise<void> {
  const { webhookId, event, payload, deliveryId } = job.data;
  const webhook = await prisma.outgoingWebhook.findUnique({ where: { id: webhookId } });
  if (!webhook) return; // Deleted since dispatch — nothing to do.
  if (!webhook.enabled && event !== "webhook.test") return;

  const rawBody = JSON.stringify({
    id: deliveryId,
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });
  const signature = createHmac("sha256", webhook.secret).update(rawBody).digest("hex");

  let statusCode: number | null = null;
  let error: string | null = null;
  let success = false;
  try {
    await validateOutgoingWebhookUrl(webhook.url);
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-uoi-event": event,
        "x-uoi-delivery": deliveryId,
        "x-uoi-signature": signature,
      },
      body: rawBody,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = response.status;
    success = response.status >= 200 && response.status < 300;
    if (!success) error = `Receiver responded with HTTP ${response.status}`;
  } catch (deliveryError) {
    error =
      deliveryError instanceof Error ? deliveryError.message.slice(0, 300) : "Delivery failed";
  }

  await prisma.webhookDelivery.create({
    data: { webhookId, event, success, statusCode, error },
  });

  if (!success) {
    throw new Error(error ?? "Outgoing webhook delivery failed");
  }
}
