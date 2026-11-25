import { connection, NextResponse } from "next/server";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { createWhatsAppTemplateSchema } from "@/lib/validations";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * GET /api/workspaces/[workspaceId]/channels/[channelId]/templates
 * APPROVED WhatsApp message templates for the channel's WABA, shaped
 * for the inbox template composer (body text + placeholder count).
 * Requires the conversations.reply permission (agents sending).
 *
 * GET …?view=manage — template management (Phase 14): EVERY template
 * on the WABA with its review status. Requires channels.manage.
 */
export async function GET(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    if (new URL(request.url).searchParams.get("view") === "manage") {
      const templates = await whatsappConnectionService.listAllTemplates(
        user.id,
        workspaceId,
        channelId,
      );
      return NextResponse.json({ templates });
    }
    const templates = await whatsappConnectionService.listApprovedTemplates(
      user.id,
      workspaceId,
      channelId,
    );
    return NextResponse.json({ templates });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * POST — create a template on the WABA (Phase 14). Meta reviews it;
 * the response carries its initial status (normally PENDING).
 * Requires channels.manage.
 */
export async function POST(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    const input = createWhatsAppTemplateSchema.parse(await parseJsonBody(request));
    const created = await whatsappConnectionService.createTemplate(
      user.id,
      workspaceId,
      channelId,
      input,
    );
    return NextResponse.json({ template: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE ?name=<template_name> — delete a template and all its
 * language variants from the WABA (Phase 14). Requires
 * channels.manage.
 */
export async function DELETE(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
    const name = new URL(request.url).searchParams.get("name");
    if (!name) throw AppError.badRequest("A template name is required.");
    await whatsappConnectionService.deleteTemplate(user.id, workspaceId, channelId, name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
