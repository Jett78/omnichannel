import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { workspaceService } from "@/services/workspace.service";

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(request);
    const { token } = bodySchema.parse(await parseJsonBody(request));
    const result = await workspaceService.acceptInvitation(user.id, token);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
