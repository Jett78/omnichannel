import { NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { getProvider } from "@/integrations/registry";
import { webhookVerifyToken } from "@/integrations/meta/meta-config";
import { xCrcSecret } from "@/integrations/x/x-config";
import { computeCrcResponseToken } from "@/integrations/x/x-webhook";
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
 * GET /api/webhooks/[provider] — provider verification handshakes.
 *
 * X (Phase 8): the Challenge-Response Check. When X registers or
 * re-validates the webhook it sends ?crc_token=… and expects
 * {"response_token": "sha256=" + base64(HMAC-SHA256(crc_token, app
 * secret))} — see integrations/x/x-webhook.ts. Without a configured
 * app secret we cannot answer honestly, so the route returns 503.
 *
 * Meta: echoes hub.challenge when hub.mode=subscribe and the verify
 * token matches the provider's configured token (Instagram:
 * INSTAGRAM_WEBHOOK_VERIFY_TOKEN, falling back to
 * META_WEBHOOK_VERIFY_TOKEN; everything else:
 * META_WEBHOOK_VERIFY_TOKEN). Other providers get a liveness response.
 */
export async function GET(request: Request, context: RouteContext) {
  const { provider: providerParam } = await context.params;
  const url = new URL(request.url);

  const crcToken = url.searchParams.get("crc_token");
  if (providerParam.toLowerCase() === "x" && crcToken) {
    const secret = xCrcSecret();
    if (!secret) {
      return NextResponse.json(
        {
          error: {
            code: "X_NOT_CONFIGURED",
            message:
              "Cannot answer the X CRC challenge: neither X_CLIENT_SECRET nor X_CONSUMER_SECRET is configured on this deployment.",
          },
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ response_token: computeCrcResponseToken(crcToken, secret) });
  }

  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.challenge")) {
    const providerKey = providerParam.toLowerCase();
    const expected =
      providerKey === "instagram" || providerKey === "facebook" || providerKey === "whatsapp"
        ? webhookVerifyToken(providerKey)
        : process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (expected && url.searchParams.get("hub.verify_token") !== expected) {
      return new Response("Verification token mismatch", { status: 403 });
    }
    return new Response(url.searchParams.get("hub.challenge"), { status: 200 });
  }

  return NextResponse.json({ ok: true, provider: providerParam.toLowerCase() });
}
