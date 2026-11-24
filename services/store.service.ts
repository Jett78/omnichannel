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
 * Default store API contract (verified live 2026-11-24 against
 * Jeet's Multi-Ecommerce API, a common storefront shape):
 *   GET {baseUrl}/products?take=N&search=QUERY
 *   → { data: [{ id, name, slug,
 *                images: [{ url, isPrimary, sortOrder }],
 *                variants: [{ price, stockQuantity, isActive,
 *                             allowBackorder, attributes }] }] }
 *
 * The contract is CONFIGURABLE per connection (StoreApiShape): a
 * custom store API with a different endpoint path, parameter names,
 * response envelope or field names can connect by setting the shape
 * in Settings — no code change. The defaults above stay the built-in
 * preset, so existing connections behave exactly as before. Prices
 * are in the store's own currency units (rupees for Jeet's store).
 */

/** How the workspace's store API is shaped. All fields effective (never undefined). */
export interface StoreApiShape {
  /** Endpoint path appended to the base URL, e.g. "/products". */
  productsPath: string;
  /** Query parameter carrying the search text; null = the API has none (list-only). */
  searchParam: string | null;
  /** Query parameter carrying the page size; null = don't send one. */
  limitParam: string | null;
  /** Dot path to the product array inside the JSON; null = the response IS the array. */
  responsePath: string | null;
  /** Product field holding the display name. */
  nameField: string;
  /** Product field holding the price (used when the product has no variants). */
  priceField: string;
  /** Product field holding the stock count (or an in-stock boolean). */
  stockField: string;
  /** Product field holding the image: a URL string, an array, or an object with a url. */
  imageField: string;
}

export const DEFAULT_STORE_API_SHAPE: StoreApiShape = {
  productsPath: "/products",
  searchParam: "search",
  limitParam: "take",
  responsePath: "data",
  nameField: "name",
  priceField: "price",
  stockField: "stock",
  imageField: "images",
};

export type StoreApiShapeInput = Partial<{
  [K in keyof StoreApiShape]: string | null | undefined;
}>;

const PARAM_NAME = /^[A-Za-z0-9_-]+$/;
const FIELD_NAME = /^[A-Za-z0-9_]+$/;
const RESPONSE_PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/**
 * Resolve a full shape from partial input over a base shape. Empty
 * strings clear the nullable knobs (search/limit/response path) and
 * fall back to the base for the required ones. Invalid values are a
 * clear 400, never a silent surprise at fetch time.
 */
export function resolveStoreApiShape(
  input: StoreApiShapeInput,
  base: StoreApiShape = DEFAULT_STORE_API_SHAPE,
): StoreApiShape {
  const pick = (value: string | null | undefined, fallback: string | null): string | null => {
    if (value === undefined) return fallback;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  const shape: StoreApiShape = {
    productsPath: pick(input.productsPath, base.productsPath) ?? base.productsPath,
    searchParam: pick(input.searchParam, base.searchParam),
    limitParam: pick(input.limitParam, base.limitParam),
    responsePath: pick(input.responsePath, base.responsePath),
    nameField: pick(input.nameField, base.nameField) ?? base.nameField,
    priceField: pick(input.priceField, base.priceField) ?? base.priceField,
    stockField: pick(input.stockField, base.stockField) ?? base.stockField,
    imageField: pick(input.imageField, base.imageField) ?? base.imageField,
  };
  if (!shape.productsPath.startsWith("/") || /\s/.test(shape.productsPath) || shape.productsPath.length > 200) {
    throw AppError.badRequest("The products endpoint must be a path starting with / (e.g. /products).");
  }
  for (const [label, value] of [
    ["Search parameter", shape.searchParam],
    ["Page-size parameter", shape.limitParam],
  ] as const) {
    if (value !== null && !PARAM_NAME.test(value)) {
      throw AppError.badRequest(`${label} may only contain letters, numbers, - and _.`);
    }
  }
  if (shape.responsePath !== null && !RESPONSE_PATH.test(shape.responsePath)) {
    throw AppError.badRequest("The product-list location must be a dot path like data or data.items.");
  }
  for (const [label, value] of [
    ["Name field", shape.nameField],
    ["Price field", shape.priceField],
    ["Stock field", shape.stockField],
    ["Image field", shape.imageField],
  ] as const) {
    if (!FIELD_NAME.test(value)) {
      throw AppError.badRequest(`${label} must be a single field name (letters, numbers, _).`);
    }
  }
  return shape;
}

export interface StoreConnectionView {
  baseUrl: string;
  name: string | null;
  enabled: boolean;
  updatedAt: string;
  shape: StoreApiShape;
}

export interface StoreProduct {
  id: string;
  name: string;
  priceMin: number | null;
  priceMax: number | null;
  totalStock: number;
  inStock: boolean;
  /** False when the API doesn't report stock at all — the AI must not claim either way. */
  stockKnown: boolean;
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

interface StoreConnectionRow {
  baseUrl: string;
  name: string | null;
  enabled: boolean;
  updatedAt: Date;
  productsPath: string;
  searchParam: string | null;
  limitParam: string | null;
  responsePath: string | null;
  nameField: string;
  priceField: string;
  stockField: string;
  imageField: string;
}

function shapeFromRow(row: StoreConnectionRow): StoreApiShape {
  return {
    productsPath: row.productsPath,
    searchParam: row.searchParam,
    limitParam: row.limitParam,
    responsePath: row.responsePath,
    nameField: row.nameField,
    priceField: row.priceField,
    stockField: row.stockField,
    imageField: row.imageField,
  };
}

function toView(row: StoreConnectionRow): StoreConnectionView {
  return {
    baseUrl: row.baseUrl,
    name: row.name,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
    shape: shapeFromRow(row),
  };
}

interface RawVariant {
  price?: unknown;
  stockQuantity?: unknown;
  isActive?: unknown;
  allowBackorder?: unknown;
  attributes?: unknown;
}

type RawProduct = Record<string, unknown>;

/** Numbers arrive as numbers on some APIs and as strings ("4999") on others. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function pickImageUrl(value: unknown): string | null {
  if (typeof value === "string") return value.startsWith("http") ? value : null;
  if (Array.isArray(value)) {
    const entries = value.map((entry) => {
      if (typeof entry === "string") return { url: entry, isPrimary: false, sortOrder: 0 };
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        return {
          url: typeof record.url === "string" ? record.url : "",
          isPrimary: record.isPrimary === true,
          sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : 0,
        };
      }
      return { url: "", isPrimary: false, sortOrder: 0 };
    });
    const sorted = [...entries].sort((a, b) => {
      const primary = Number(b.isPrimary) - Number(a.isPrimary);
      if (primary !== 0) return primary;
      return a.sortOrder - b.sortOrder;
    });
    return sorted.find((entry) => entry.url.startsWith("http"))?.url ?? null;
  }
  if (value && typeof value === "object") {
    const url = (value as Record<string, unknown>).url;
    return typeof url === "string" && url.startsWith("http") ? url : null;
  }
  return null;
}

function normalizeProduct(raw: RawProduct, shape: StoreApiShape): StoreProduct | null {
  const name = raw[shape.nameField];
  if (typeof name !== "string" || name.trim() === "") return null;
  // Variant layer (Jeet's API shape): when a product carries a
  // `variants` array, prices/stock/labels come from its active
  // variants; the flat configured fields are the fallback.
  const variants = Array.isArray(raw.variants) ? (raw.variants as RawVariant[]) : [];
  const active = variants.filter((variant) => variant.isActive !== false);
  const hasVariants = active.length > 0;
  const prices = active
    .map((variant) => asNumber(variant.price))
    .filter((price): price is number => price !== null);
  const fallbackPrice = asNumber(raw[shape.priceField]);
  let totalStock = 0;
  let inStock = false;
  let stockKnown = false;
  if (hasVariants) {
    totalStock = active.reduce(
      (sum, variant) => sum + (asNumber(variant.stockQuantity) ?? 0),
      0,
    );
    inStock = totalStock > 0 || active.some((variant) => variant.allowBackorder === true);
    stockKnown = true;
  } else {
    const flat = raw[shape.stockField];
    const flatNumber = asNumber(flat);
    if (flatNumber !== null) {
      totalStock = flatNumber;
      inStock = flatNumber > 0;
      stockKnown = true;
    } else if (typeof flat === "boolean") {
      inStock = flat;
      stockKnown = true;
    }
  }
  const labels = [
    ...new Set(active.map((variant) => variantLabel(variant.attributes)).filter(Boolean)),
  ].slice(0, 8);
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name,
    priceMin: prices.length ? Math.min(...prices) : fallbackPrice,
    priceMax: prices.length ? Math.max(...prices) : fallbackPrice,
    totalStock,
    inStock,
    stockKnown,
    variantLabels: labels,
    imageUrl: pickImageUrl(raw[shape.imageField]),
  };
}

function extractRows(json: unknown, responsePath: string | null): unknown[] {
  let node: unknown = json;
  if (responsePath) {
    for (const segment of responsePath.split(".")) {
      if (!node || typeof node !== "object") return [];
      node = (node as Record<string, unknown>)[segment];
    }
  }
  return Array.isArray(node) ? node : [];
}

async function fetchStoreProducts(
  baseUrl: string,
  shape: StoreApiShape,
  query: string,
  limit: number,
): Promise<StoreProduct[]> {
  const path = shape.productsPath.startsWith("/")
    ? shape.productsPath
    : `/${shape.productsPath}`;
  const url = new URL(`${baseUrl}${path}`);
  if (shape.limitParam) url.searchParams.set(shape.limitParam, String(limit));
  if (query !== "" && shape.searchParam) url.searchParams.set(shape.searchParam, query);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(STORE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Store API returned HTTP ${response.status}`);
  const json = (await response.json()) as unknown;
  return extractRows(json, shape.responsePath)
    .map((row) =>
      row && typeof row === "object"
        ? normalizeProduct(row as RawProduct, shape)
        : null,
    )
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
    input: { baseUrl: string; name?: string } & StoreApiShapeInput,
  ): Promise<StoreConnectionView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const baseUrl = await validateStoreBaseUrl(input.baseUrl);
    const name = input.name?.trim() || null;
    const existing = await prisma.storeConnection.findUnique({ where: { workspaceId } });
    // Shape fields are written only when the caller sent at least one
    // of them; resolution runs over the saved shape (or the defaults),
    // so a partial update can't silently reset the other knobs.
    const shapeTouched = (Object.keys(DEFAULT_STORE_API_SHAPE) as (keyof StoreApiShape)[]).some(
      (key) => input[key] !== undefined,
    );
    const shape = shapeTouched
      ? resolveStoreApiShape(input, existing ? shapeFromRow(existing) : DEFAULT_STORE_API_SHAPE)
      : null;
    const row = await prisma.storeConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        baseUrl,
        name,
        createdById: actorUserId,
        ...(shape ?? DEFAULT_STORE_API_SHAPE),
      },
      update: { baseUrl, name, enabled: true, ...(shape ?? {}) },
    });
    return toView(row);
  },

  async remove(actorUserId: string, workspaceId: string): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    await prisma.storeConnection.deleteMany({ where: { workspaceId } });
  },

  /**
   * Reachability + readability check for the Settings "Test" button,
   * run against the form's (possibly unsaved) address and shape.
   * Never throws. The message names a sample product AS PARSED, so a
   * wrong field mapping is obvious before saving.
   */
  async test(
    actorUserId: string,
    workspaceId: string,
    input: { baseUrl: string } & StoreApiShapeInput,
  ): Promise<{ ok: boolean; message: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    try {
      const baseUrl = await validateStoreBaseUrl(input.baseUrl);
      const shape = resolveStoreApiShape(input);
      const products = await fetchStoreProducts(baseUrl, shape, "", 3);
      if (products.length === 0) {
        return {
          ok: true,
          message:
            "Store reached, but no products could be read — check the endpoint and field settings under Advanced.",
        };
      }
      const first = products[0];
      const price =
        first && first.priceMin !== null
          ? ` — price ${first.priceMin === first.priceMax ? first.priceMin : `${first.priceMin}–${first.priceMax}`}`
          : "";
      const stock =
        first && first.stockKnown
          ? first.inStock
            ? " — in stock"
            : " — out of stock"
          : "";
      return {
        ok: true,
        message: `Store reached — read ${products.length} product(s). First: "${first?.name}"${price}${stock}.`,
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
      return await fetchStoreProducts(
        connection.baseUrl,
        shapeFromRow(connection),
        query.trim(),
        limit,
      );
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
