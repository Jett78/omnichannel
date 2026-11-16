import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getEnv } from "@/lib/env";

/**
 * AES-256-GCM encryption for secrets at rest (channel OAuth tokens).
 *
 * Key: ENCRYPTION_KEY as 64 hex chars (32 bytes). Dev default is all
 * zeros — acceptable locally only; production must set a real key.
 *
 * Stored format: base64(iv) : base64(authTag) : base64(ciphertext)
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getKey(): Buffer {
  const raw = getEnv().ENCRYPTION_KEY.trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const asBase64 = Buffer.from(raw, "base64");
  if (asBase64.length === 32) return asBase64;
  throw new Error("ENCRYPTION_KEY must be 64 hex chars or base64 encoding 32 bytes");
}

export function encryptText(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptText(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload format");
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
