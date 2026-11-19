import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import { gmailConnectionService } from "@/services/gmail-connection.service";

/**
 * GET /api/oauth/gmail/callback — Google OAuth 2.0 redirect target.
 * Register this exact URL as an Authorized redirect URI on the Google
 * Cloud OAuth client (it must match exactly).
 *
 * Google redirects here with ?code&state (or ?error). We verify the
 * state against the httpOnly cookie set by the connect route, then let
 * the Gmail connection service exchange the code and finalize the
 * channel — one authorization is exactly one mailbox, so there is no
 * picker step. Every outcome lands back on /channels with either a
 * `gmail_connected` notice or a `gmail_error` banner.
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
    return channelsUrl(`gmail_error=${encodeURIComponent(providerError)}`);
  }

  const cookieStore = await cookies();
  const cookieState = cookieStore.get("uoi_oauth_state_gmail")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return channelsUrl("gmail_error=state_mismatch");
  }
  if (!code) {
    return channelsUrl("gmail_error=missing_code");
  }

  let userId: string;
  try {
    const user = await requireApiUser(request);
    userId = user.id;
  } catch {
    return NextResponse.redirect(`${appUrl}/login`);
  }

  try {
    const result = await gmailConnectionService.handleGmailCallback(userId, state, code);
    const response = channelsUrl(
      `gmail_connected=${encodeURIComponent(result.channel.displayName)}`,
    );
    response.cookies.set("uoi_oauth_state_gmail", "", {
      httpOnly: true,
      path: "/api/oauth",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return channelsUrl(`gmail_error=${encodeURIComponent(getErrorMessage(error))}`);
  }
}
