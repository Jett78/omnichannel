import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import { xConnectionService } from "@/services/x-connection.service";

/**
 * GET /api/oauth/x/callback — X OAuth 2.0 redirect target.
 * Register this exact URL as a Callback URI in the X app's User
 * authentication settings (X requires an exact match).
 *
 * X redirects here with ?code&state (or ?error). We verify the state
 * against the httpOnly cookie set by the connect route, then let the
 * X connection service exchange the code immediately (X authorization
 * codes expire in 30 seconds) and finalize the channel — one
 * authorization is exactly one X account, so there is no picker step.
 * Every outcome lands back on /channels with either an `x_connected`
 * notice (plus any subscription warning) or an `x_error` banner.
 */
export async function GET(request: Request) {
  await connection();
  const appUrl = getEnv().APP_URL.replace(/\/+$/, "");
  const channelsUrl = (query: string) => NextResponse.redirect(`${appUrl}/channels?${query}`);

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError) {
    return channelsUrl(`x_error=${encodeURIComponent(providerError)}`);
  }

  const cookieStore = await cookies();
  const cookieState = cookieStore.get("uoi_oauth_state_x")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return channelsUrl("x_error=state_mismatch");
  }
  if (!code) {
    return channelsUrl("x_error=missing_code");
  }

  let userId: string;
  try {
    const user = await requireApiUser(request);
    userId = user.id;
  } catch {
    return NextResponse.redirect(`${appUrl}/login`);
  }

  try {
    const result = await xConnectionService.handleXCallback(userId, state, code);
    const query = result.subscriptionWarning
      ? `x_connected=${encodeURIComponent(result.channel.displayName)}&x_warning=${encodeURIComponent(result.subscriptionWarning)}`
      : `x_connected=${encodeURIComponent(result.channel.displayName)}`;
    const response = channelsUrl(query);
    // One-shot cookie — clear it now that the callback is consumed.
    response.cookies.set("uoi_oauth_state_x", "", {
      httpOnly: true,
      path: "/api/oauth",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return channelsUrl(`x_error=${encodeURIComponent(getErrorMessage(error))}`);
  }
}
