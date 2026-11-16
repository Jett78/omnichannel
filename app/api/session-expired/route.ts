import { connection, NextResponse, type NextRequest } from "next/server";

/**
 * Loop breaker for stale sessions.
 *
 * The proxy only checks that a Better Auth session cookie EXISTS, while
 * the dashboard layout verifies it for real. With an expired or invalid
 * cookie (e.g. after a secret rotation) the two bounced the browser
 * forever: /dashboard → /login → /dashboard → …
 *
 * This route sits outside the proxy matcher: it deletes every
 * better-auth cookie and only then sends the browser to /login, which
 * now renders normally because no session cookie remains.
 */
export async function GET(request: NextRequest) {
  await connection();
  const response = NextResponse.redirect(new URL("/login", request.url));
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.includes("better-auth")) {
      response.cookies.set(cookie.name, "", { expires: new Date(0), path: "/" });
    }
  }
  return response;
}
