import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/** Better Auth handler — sign-up, sign-in, session, reset, verification, sign-out. */
export const { GET, POST } = toNextJsHandler(auth.handler);
