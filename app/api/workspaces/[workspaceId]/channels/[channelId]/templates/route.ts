import { connection, NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { whatsappConnectionService } from "@/services/whatsapp-connection.service";

interface RouteContext {
  params: Promise<{ workspaceId: string; channelId: string }>;
}

/**
 * GET /api/workspaces/[workspaceId]/channels/[channelId]/templates
 * APPROVED WhatsApp message templates for the channel's WABA, shaped
 * for the inbox template composer (body text + placeholder count).
 * Requires the conversations.reply permission (agents sending).
 */
export async function GET(request: Request, context: RouteContext) {
  await connection();
  try {
    const user = await requireApiUser(request);
    const { workspaceId, channelId } = await context.params;
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
