import { NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { AiNotConfiguredError, AiProviderError } from "@/lib/ai";
import { aiActionSchema } from "@/lib/validations";
import { aiAssistantService } from "@/services/ai.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}

/**
 * POST /api/workspaces/[workspaceId]/conversations/[conversationId]/ai
 * Phase 13G — AI assistant actions. Every result is a draft for the
 * agent; this endpoint never sends a message.
 * 503 = AI not configured, 502 = provider failure (both surfaced
 * honestly to the agent, never replaced with fake output).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireApiUser(request);
    const { workspaceId, conversationId } = await context.params;
    const input = aiActionSchema.parse(await parseJsonBody(request));

    switch (input.action) {
      case "suggest":
        return NextResponse.json(
          await aiAssistantService.suggestReply(user.id, workspaceId, conversationId),
        );
      case "summarize":
        return NextResponse.json(
          await aiAssistantService.summarize(user.id, workspaceId, conversationId),
        );
      case "sentiment":
        return NextResponse.json(
          await aiAssistantService.sentiment(user.id, workspaceId, conversationId),
        );
      case "rewrite": {
        if (!input.text?.trim()) {
          return NextResponse.json(
            { error: { message: "Write a draft first, then rewrite it" } },
            { status: 400 },
          );
        }
        return NextResponse.json(
          await aiAssistantService.rewrite(user.id, workspaceId, conversationId, {
            text: input.text,
            tone: input.tone ?? "professional",
          }),
        );
      }
      case "translate": {
        if (!input.text?.trim() || !input.target?.trim()) {
          return NextResponse.json(
            { error: { message: "Nothing to translate" } },
            { status: 400 },
          );
        }
        return NextResponse.json(
          await aiAssistantService.translate(user.id, workspaceId, conversationId, {
            text: input.text,
            target: input.target,
          }),
        );
      }
    }
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: { message: error.message } }, { status: 503 });
    }
    if (error instanceof AiProviderError) {
      return NextResponse.json({ error: { message: error.message } }, { status: 502 });
    }
    return apiError(error);
  }
}
