import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 proxy (formerly middleware) — OPTIMISTIC route protection
 * only: it checks for the presence of a Better Auth session cookie,
 * not its validity. The real gate is the server-side session check in
 * app/(dashboard)/layout.tsx and in every API route.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/contacts",
  "/channels",
  "/automation",
  "/team",
  "/analytics",
  "/settings",
  "/onboarding",
];
const AUTH_PREFIXES = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (isProtected && !sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAuthPage = AUTH_PREFIXES.some((prefix) => pathname === prefix);
  if (isAuthPage && sessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/inbox/:path*",
    "/contacts/:path*",
    "/channels/:path*",
    "/automation/:path*",
    "/team/:path*",
    "/analytics/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/login",
    "/register",
  ],
};
