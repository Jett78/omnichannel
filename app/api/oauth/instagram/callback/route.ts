import { handleMetaOAuthCallback } from "@/app/api/oauth/callback-shared";

/**
 * GET /api/oauth/instagram/callback — Instagram Login redirect target.
 * Register this exact URL in the Instagram product's OAuth redirect URIs.
 */
export async function GET(request: Request) {
  return handleMetaOAuthCallback(request, "instagram");
}
