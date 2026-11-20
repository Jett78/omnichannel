import { lookup } from "node:dns/promises";

import { AppError } from "@/lib/errors";

/**
 * SSRF guard for outgoing webhook URLs (Phase 12). Workspace admins
 * supply the URLs and OUR server POSTs to them, so a URL pointing
 * at a private/loopback/link-local address could reach internal
 * services or cloud metadata endpoints. Rules:
 *
 *  - http/https only; production additionally requires https.
 *  - The hostname must not be localhost-ish, and every IP it
 *    resolves to must be a public address (checked at save time
 *    AND again at delivery time in the worker).
 *  - Outside production only, literal loopback targets
 *    (127.0.0.1 / ::1 / localhost) are allowed so developers can
 *    test against a local receiver.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inRange(ipInt: number, base: string, prefixBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT shared space
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation TEST-NET-2
  ["203.0.113.0", 24], // documentation TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

export function isPublicIp(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) {
    return !PRIVATE_IPV4_RANGES.some(([base, bits]) => inRange(v4, base, bits));
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return false;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return false; // fe80::/10 link-local
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false; // fc00::/7 unique-local
  if (lower.startsWith("ff")) return false; // multicast
  if (lower.startsWith("2001:db8")) return false; // documentation
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIp(mapped[1] as string);
  return true;
}

export function isLoopbackIp(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return inRange(v4, "127.0.0.0", 8);
  return ip.toLowerCase() === "::1";
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Validate a webhook URL and return it parsed. Throws AppError
 * (400) with a plain-language reason when the URL is not allowed.
 */
export async function validateOutgoingWebhookUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw AppError.badRequest("That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw AppError.badRequest("Webhook URLs must start with http:// or https://");
  }
  if (isProduction() && url.protocol !== "https:") {
    throw AppError.badRequest("Webhook URLs must use HTTPS.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw AppError.badRequest("The URL has no host.");
  if (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    throw AppError.badRequest("Webhook URLs must point at a public address.");
  }
  const devLoopbackAllowed = !isProduction();
  if (hostname === "localhost") {
    if (devLoopbackAllowed) return url;
    throw AppError.badRequest("Webhook URLs must point at a public address.");
  }

  let addresses: string[];
  if (ipv4ToInt(hostname) !== null || hostname.includes(":")) {
    addresses = [hostname.replace(/^\[|\]$/g, "")];
  } else {
    try {
      const records = await lookup(hostname, { all: true, verbatim: true });
      addresses = records.map((record) => record.address);
    } catch {
      throw AppError.badRequest(`Could not resolve the host "${hostname}".`);
    }
    if (addresses.length === 0) {
      throw AppError.badRequest(`Could not resolve the host "${hostname}".`);
    }
  }

  for (const address of addresses) {
    if (devLoopbackAllowed && isLoopbackIp(address)) continue;
    if (!isPublicIp(address)) {
      throw AppError.badRequest(
        "Webhook URLs must point at a public address — private, loopback and link-local targets are not allowed.",
      );
    }
  }
  return url;
}
