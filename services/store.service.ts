import { isIP } from "node:net";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isLoopbackIp, isPublicIp } from "@/lib/webhook-url";
import { requireWorkspacePermission } from "@/lib/workspace-auth";

/**
 * Store connection + live product lookup.
 *
 * A workspace can connect ONE store (its ecommerce API). The AI
 * assistant uses it to answer product questions from LIVE data
 * (names, prices, stock) instead of static knowledge entries, and the
 * AI auto-reply action can send the product's photo after its text.
 *
 * Store API contract (verified live 2026-11-24 against Jeet's
 * Multi-Ecommerce API, a common storefront shape):
 *   GET {baseUrl}/products?take=N&search=QUERY
 *   → { data: [{ id, name, slug,
 *                images: [{ url, isPrimary, sortOrder }],
 *                variants: [{ price, stockQuantity, isActive,
 *                             allowBackorder, attributes }] }] }
 * A bare array response is also accepted. Prices are in the store's
 * own currency units (rupees for Jeet's store).
 */

export interface StoreConnectionView {
  baseUrl: string;
  name: string | null;
  enabled: boolean;
  updatedAt: string;
}

export interface StoreProduct {
  id: string;
  name: string;
  priceMin: number | null;
  priceMax: number | null;
  totalStock: number;
  inStock: boolean;
  variantLabels: string[];
  imageUrl: string | null;
}

const STORE_FETCH_TIMEOUT_MS = 10_000;
const MAX_PRODUCTS = 5;

const PRODUCT_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "you", "your", "we", "i", "it", "this",
  "that", "for", "and", "or", "of", "to", "in", "on", "have", "has", "do",
  "does", "did", "what", "when", "where", "how", "much", "many", "can",
  "could", "please", "yes", "no", "ok", "hello", "hi", "hey", "mero",
  "malai", "cha", "ho", "hola", "huncha", "hunchha", "hunxa", "kati",
  "kata", "kun", "tyo", "yo", "ani", "ra", "ta", "ni", "le", "lai", "ko",
  "ma", "available", "availability", "stock", "price", "cost",
]);

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Store URL validation. Deliberately lighter than the outgoing-webhook
 * guard (no DNS resolution — resolver behaviour differs per hosting
 * environment): the URL is configured by the workspace's own admin,
 * and the checks below still block internal targets — non-http(s)
 * schemes, localhost/.local/.internal hosts, and literal private or
 * loopback IPs (loopback allowed outside production for local dev).
 */
async function validateStoreBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw AppError.badRequest("That store address is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw AppError.badRequest("The store address must start with http:// or https://.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw AppError.badRequest("The store address must use https in production.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw AppError.badRequest("The store address must be a public address.");
  }
  if (isIP(host) !== 0) {
    const loopbackAllowed = isLoopbackIp(host) && process.env.NODE_ENV !== "production";
    if (!loopbackAllowed && !isPublicIp(host)) {
      throw AppError.badRequest("The store address must point at a public address.");
    }
  }
  return normalizeBaseUrl(url.toString());
}

function toView(row: {
  baseUrl: string;
  name: string | null;
  enabled: boolean;
  updatedAt: Date;
}): StoreConnectionView {
  return {
    baseUrl: row.baseUrl,
    name: row.name,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface RawVariant {
  price?: unknown;
  stockQuantity?: unknown;
  isActive?: unknown;
  allowBackorder?: unknown;
  attributes?: unknown;
}

interface RawImage {
  url?: unknown;
  isPrimary?: unknown;
  sortOrder?: unknown;
}

interface RawProduct {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  images?: unknown;
  variants?: unknown;
}

function variantLabel(attributes: unknown): string {
  if (Array.isArray(attributes)) {
    return attributes
      .map((attr) => {
        if (typeof attr === "string") return attr;
        if (attr && typeof attr === "object") {
          const record = attr as Record<string, unknown>;
          const value = record.value ?? record.name ?? record.label;
          return typeof value === "string" ? value : "";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (attributes && typeof attributes === "object") {
    return Object.values(attributes as Record<string, unknown>)
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return "";
}

function normalizeProduct(raw: RawProduct): StoreProduct | null {
  if (typeof raw.name !== "string" || raw.name.trim() === "") return null;
  const variants = Array.isArray(raw.variants) ? (raw.variants as RawVariant[]) : [];
  const active = variants.filter((variant) => variant.isActive !== false);
  const prices = active
    .map((variant) => (typeof variant.price === "number" ? variant.price : null))
    .filter((price): price is number => price !== null);
  const fallbackPrice = typeof raw.price === "number" ? raw.price : null;
  const totalStock = active.reduce(
    (sum, variant) =>
      sum + (typeof variant.stockQuantity === "number" ? variant.stockQuantity : 0),
    0,
  );
  const backorder = active.some((variant) => variant.allowBackorder === true);
  const labels = [
    ...new Set(active.map((variant) => variantLabel(variant.attributes)).filter(Boolean)),
  ].slice(0, 8);
  const images = Array.isArray(raw.images) ? (raw.images as RawImage[]) : [];
  const sorted = [...images].sort((a, b) => {
    const primary = Number(b.isPrimary === true) - Number(a.isPrimary === true);
    if (primary !== 0) return primary;
    const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : 0;
    const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : 0;
    return aOrder - bOrder;
  });
  const imageUrl =
    sorted
      .map((image) => (typeof image.url === "string" ? image.url : null))
      .find((url) => url?.startsWith("http")) ?? null;
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: raw.name,
    priceMin: prices.length ? Math.min(...prices) : fallbackPrice,
    priceMax: prices.length ? Math.max(...prices) : fallbackPrice,
    totalStock,
    inStock: totalStock > 0 || backorder,
    variantLabels: labels,
    imageUrl,
  };
}

async function fetchStoreProducts(
  baseUrl: string,
  query: string,
  limit: number,
): Promise<StoreProduct[]> {
  const url = `${baseUrl}/products?take=${limit}&search=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(STORE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Store API returned HTTP ${response.status}`);
  const json = (await response.json()) as unknown;
  const rows = Array.isArray(json) ? json : (json as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => normalizeProduct(row as RawProduct))
    .filter((product): product is StoreProduct => product !== null)
    .slice(0, limit);
}

export const storeConnectionService = {
  async get(
    actorUserId: string,
    workspaceId: string,
  ): Promise<StoreConnectionView | null> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const row = await prisma.storeConnection.findUnique({ where: { workspaceId } });
    return row ? toView(row) : null;
  },

  async upsert(
    actorUserId: string,
    workspaceId: string,
    input: { baseUrl: string; name?: string },
  ): Promise<StoreConnectionView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const baseUrl = await validateStoreBaseUrl(input.baseUrl);
    const name = input.name?.trim() || null;
    const row = await prisma.storeConnection.upsert({
      where: { workspaceId },
      create: { workspaceId, baseUrl, name, createdById: actorUserId },
      update: { baseUrl, name, enabled: true },
    });
    return toView(row);
  },

  async remove(actorUserId: string, workspaceId: string): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    await prisma.storeConnection.deleteMany({ where: { workspaceId } });
  },

  /** Reachability check for the Settings "Test" button. Never throws. */
  async test(
    actorUserId: string,
    workspaceId: string,
    rawBaseUrl: string,
  ): Promise<{ ok: boolean; message: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    try {
      const baseUrl = await validateStoreBaseUrl(rawBaseUrl);
      const products = await fetchStoreProducts(baseUrl, "", 1);
      return {
        ok: true,
        message: products.length
          ? "Store reached — products are visible."
          : "Store reached, but it returned no products.",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Could not reach that store.",
      };
    }
  },
};

export const storeProductService = {
  /** Live product search for the AI. Self-catching: any failure → []. */
  async searchProducts(
    workspaceId: string,
    query: string,
    limit: number = MAX_PRODUCTS,
  ): Promise<StoreProduct[]> {
    try {
      if (query.trim() === "") return [];
      const connection = await prisma.storeConnection.findUnique({
        where: { workspaceId },
      });
      if (!connection || !connection.enabled) return [];
      return await fetchStoreProducts(connection.baseUrl, query.trim(), limit);
    } catch {
      return [];
    }
  },

  /**
   * Search using a customer's message: try the significant words as a
   * phrase first, then the single longest word (store search is a
   * substring match, so a long phrase often matches nothing).
   */
  async searchForMessage(
    workspaceId: string,
    messageText: string,
  ): Promise<StoreProduct[]> {
    const words = messageText
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !PRODUCT_STOPWORDS.has(word));
    if (words.length === 0) return [];
    const phrase = words.slice(0, 4).join(" ");
    const byPhrase = await storeProductService.searchProducts(workspaceId, phrase);
    if (byPhrase.length > 0) return byPhrase;
    const longest = [...words].sort((a, b) => b.length - a.length)[0];
    if (longest && longest !== phrase) {
      return storeProductService.searchProducts(workspaceId, longest);
    }
    return [];
  },
};
