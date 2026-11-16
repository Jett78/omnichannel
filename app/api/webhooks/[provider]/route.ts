import { NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { getProvider } from "@/integrations/registry";
import { webhookService } from "@/services/webhook.service";
import { isProviderId, providerIdToEnum, type ProviderId } from "@/types/messaging";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

function resolveProvider(param: string): ProviderId {
  const id = param.toLowerCase();
  if (!isProviderId(id)) throw AppError.notFound(`Unknown provider "${param}"`);
  return id;
}

function extractExternalEventId(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.eventId === "string") return record.eventId;
    if (typeof record.externalEventId === "string") return record.externalEventId;
  }
  return null;
}

/**
 * POST /api/webhooks/[provider] — ingress ONLY (Phase 0 §6):
 * verify signature → persist the raw event → enqueue → ACK 200 fast.
 * All parsing/resolution happens in the webhook worker.
 *
 * Providers whose adapter is not implemented yet return an honest 501
 * (via the registry); unknown provider names return 404.
 */
export async function POST(request: Request, context: RouteContext) {
  const { provider: providerParam } = await context.params;

  let providerId: ProviderId;
  try {
    providerId = resolveProvider(providerParam);
  } catch {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Unknown provider "${providerParam}"` } },
      { status: 404 },
    );
  }

  let provider;
  try {
    provider = getProvider(providerId);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }

  const rawBody = await request.text();
  const url = new URL(request.url);
  const verified = provider.verifyWebhook({
    headers: request.headers,
    rawBody,
    searchParams: url.searchParams,
  });
  if (!verified) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Webhook signature verification failed" } },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Webhook body must be valid JSON" } },
      { status: 400 },
    );
  }

  const { duplicate } = await webhookService.recordAndEnqueue(
    providerIdToEnum(providerId),
    payload,
    { externalEventId: extractExternalEventId(payload) },
  );
  return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}) });
}

/**
 * GET /api/webhooks/[provider] — verification handshake stub.
 * Meta-style: echoes hub.challenge when hub.mode=subscribe and the
 * verify token matches META_WEBHOOK_VERIFY_TOKEN (when configured).
 * Other providers get a plain liveness response.
 */
export async function GET(request: Request, context: RouteContext) {
  const { provider: providerParam } = await context.params;
  const url = new URL(request.url);

  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.challenge")) {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (expected && url.searchParams.get("hub.verify_token") !== expected) {
      return new Response("Verification token mismatch", { status: 403 });
    }
    return new Response(url.searchParams.get("hub.challenge"), { status: 200 });
  }

  return NextResponse.json({ ok: true, provider: providerParam.toLowerCase() });
}
