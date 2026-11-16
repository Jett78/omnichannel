import { NextResponse } from "next/server";

import { auth, type SessionUser } from "@/lib/auth";
import { AppError, toErrorResponse } from "@/lib/errors";

/** Session user for an API request, or throws 401. Use in every protected route. */
export async function requireApiUser(request: Request): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw AppError.unauthorized("You must be signed in");
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
    image: session.user.image ?? null,
  };
}

export function apiError(error: unknown): NextResponse {
  const { status, body } = toErrorResponse(error);
  return NextResponse.json(body, { status });
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw AppError.badRequest("Request body must be valid JSON");
  }
}
