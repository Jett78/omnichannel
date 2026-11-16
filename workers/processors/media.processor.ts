import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Job } from "bullmq";

import { prisma } from "@/lib/prisma";
import { getProvider } from "@/integrations/registry";
import { WHATSAPP_MEDIA_PREFIX } from "@/integrations/whatsapp/whatsapp-provider";
import { channelCredentialService } from "@/services/channel-credential.service";
import type { ChannelContext } from "@/integrations/types";
import type { MediaJobData } from "@/types/queue";

/**
 * Media processor.
 *
 * WhatsApp (Phase 6): attachments arrive as `whatsapp-media:<id>`
 * refs (the Cloud API never hands out public URLs). The processor
 * resolves the message's channel, decrypts its credential, downloads
 * the bytes through the provider's two-step media API, and — when S3
 * storage is configured (S3_BUCKET + access keys) — uploads them to
 * `whatsapp/{messageId}/{attachmentId}` and records the storage key.
 * When S3 is NOT configured the bytes are still fetched (proving the
 * media path works) but nothing is persisted and storageKey stays
 * null — the log line says so plainly; we never fake-store.
 *
 * Other providers (Facebook/Instagram URL attachments): their media
 * URLs are fetched by the providers' own downloadMedia where needed;
 * this queue job remains a logged no-op for them until per-provider
 * storage lands.
 */
export async function processMediaJob(job: Job<MediaJobData>): Promise<void> {
  const { messageId, attachmentUrl } = job.data;

  if (!attachmentUrl.startsWith(WHATSAPP_MEDIA_PREFIX)) {
    console.log(
      `[worker:media] job ${job.id} for message ${messageId} attachment ${attachmentUrl} — non-WhatsApp media: no download performed by this processor`,
    );
    return;
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      attachments: true,
      conversation: { include: { channel: true } },
    },
  });
  if (!message) {
    console.warn(`[worker:media] message ${messageId} not found — skipping`);
    return;
  }
  const attachment = message.attachments.find((a) => a.originalUrl === attachmentUrl);
  if (!attachment) {
    console.warn(`[worker:media] attachment ${attachmentUrl} not found on message ${messageId}`);
    return;
  }
  if (attachment.storageKey) {
    console.log(`[worker:media] attachment ${attachment.id} already stored — skipping`);
    return;
  }
  const channel = message.conversation.channel;
  if (channel.provider !== "WHATSAPP") {
    console.warn(
      `[worker:media] whatsapp-media ref on non-WhatsApp channel ${channel.id} — skipping`,
    );
    return;
  }

  const credential = await channelCredentialService.getDecryptedChannelCredentialForServer(
    channel.id,
  );
  if (!credential?.accessToken) {
    throw new Error(`No stored credential for WhatsApp channel ${channel.id}`);
  }
  const provider = getProvider("whatsapp");
  if (!provider.downloadMedia) {
    throw new Error("WhatsApp provider does not implement downloadMedia");
  }
  const context: ChannelContext = {
    channelId: channel.id,
    workspaceId: message.conversation.workspaceId,
    provider: "whatsapp",
    externalAccountId: channel.externalAccountId,
    credentials: {
      accessToken: credential.accessToken,
      scopes: credential.scopes,
    },
    ...(channel.config &&
    typeof channel.config === "object" &&
    !Array.isArray(channel.config)
      ? { config: channel.config as Record<string, unknown> }
      : {}),
  };

  const bytes = await provider.downloadMedia(attachmentUrl, context);

  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) {
    console.warn(
      `[worker:media] downloaded ${bytes.length} bytes for attachment ${attachment.id}, but S3 storage is NOT configured (S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY) — bytes discarded, storageKey left null`,
    );
    return;
  }

  const storageKey = `whatsapp/${messageId}/${attachment.id}`;
  const s3 = new S3Client({
    region: process.env.S3_REGION?.trim() || "us-east-1",
    ...(process.env.S3_ENDPOINT?.trim() ? { endpoint: process.env.S3_ENDPOINT.trim() } : {}),
    credentials: { accessKeyId, secretAccessKey },
  });
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: attachment.mimeType ?? "application/octet-stream",
      }),
    );
  } finally {
    s3.destroy();
  }
  await prisma.messageAttachment.update({
    where: { id: attachment.id },
    data: { storageKey, size: bytes.length },
  });
  console.log(
    `[worker:media] stored attachment ${attachment.id} (${bytes.length} bytes) at ${storageKey}`,
  );
}
