import { connection, NextResponse } from "next/server";

import { apiError, requireApiUser } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";

/**
 * GET /api/realtime/token — returns the signed-in user's Better Auth
 * session token + the Socket.IO gateway URL, so the browser client can
 * authenticate its socket handshake. The gateway validates the token
 * against the Session table; it is the user's own session credential,
 * equivalent to their session cookie.
 */
export async function GET(request: Request) {
  // Opt out of static prerendering (Cache Components): the token is per-request.
  await connection();
  try {
    await requireApiUser(request);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.session) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "You must be signed in" } },
        { status: 401 },
      );
    }
    return NextResponse.json({
      token: session.session.token,
      socketUrl: getEnv().NEXT_PUBLIC_SOCKET_URL,
    });
  } catch (error) {
    return apiError(error);
  }
}
