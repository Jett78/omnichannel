import { handleMetaOAuthCallback } from "@/app/api/oauth/callback-shared";

/**
 * GET /api/oauth/facebook/callback — Facebook Login redirect target.
 * Register this exact URL in the Meta app's Valid OAuth Redirect URIs.
 */
export async function GET(request: Request) {
  return handleMetaOAuthCallback(request, "facebook");
}
