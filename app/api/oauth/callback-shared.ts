import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import { metaConnectionService } from "@/services/meta-connection.service";

/**
 * Shared Meta OAuth callback handling (Phase 5).
 *
 * The provider redirects the browser back here with ?code&state (or
 * ?error). We verify the state against the httpOnly cookie set by the
 * connect route, then let the meta connection service exchange the
 * code (it re-validates the session server-side by state hash and
 * signed-in user). Every outcome lands back on /channels with either
 * a `meta_session` to pick an account from, or a `meta_error` banner.
 */
export async function handleMetaOAuthCallback(
  request: Request,
  provider: "facebook" | "instagram",
): Promise<NextResponse> {
  await connection();
  const appUrl = getEnv().APP_URL.replace(/\/+$/, "");
  const channelsUrl = (query: string) => NextResponse.redirect(`${appUrl}/channels?${query}`);

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError) {
    return channelsUrl(`meta_error=${encodeURIComponent(providerError)}`);
  }

  const cookieStore = await cookies();
  const cookieState = cookieStore.get(`uoi_oauth_state_${provider}`)?.value;
  if (!state || !cookieState || state !== cookieState) {
    return channelsUrl("meta_error=state_mismatch");
  }
  if (!code) {
    return channelsUrl("meta_error=missing_code");
  }

  let userId: string;
  try {
    const user = await requireApiUser(request);
    userId = user.id;
  } catch {
    return NextResponse.redirect(`${appUrl}/login`);
  }

  try {
    const result =
      provider === "facebook"
        ? await metaConnectionService.handleFacebookCallback(userId, state, code)
        : await metaConnectionService.handleInstagramCallback(userId, state, code);
    const response = channelsUrl(
      `meta_session=${encodeURIComponent(result.sessionId)}&meta_provider=${provider}`,
    );
    // One-shot cookie — clear it now that the callback is consumed.
    response.cookies.set(`uoi_oauth_state_${provider}`, "", {
      httpOnly: true,
      path: "/api/oauth",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return channelsUrl(`meta_error=${encodeURIComponent(getErrorMessage(error))}`);
  }
}
