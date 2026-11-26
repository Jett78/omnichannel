import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const querySchema = z.object({ email: z.email().max(254) });

/**
 * Verification watch for the "check your inbox" page. The page that
 * started a sign-up has no session yet, so this endpoint is public by
 * design: it answers ONE boolean for an address the caller already
 * knows (verified or not). Unknown addresses return the same shape
 * with verified=false, so it cannot be used to enumerate accounts.
 * The page polls it and continues automatically once the email link
 * has been clicked — on any device.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    email: request.nextUrl.searchParams.get("email") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ verified: false }, { status: 400 });
  }
  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { emailVerified: true },
  });
  return NextResponse.json(
    { verified: user?.emailVerified ?? false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
