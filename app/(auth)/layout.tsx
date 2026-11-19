import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-gradient-to-br from-indigo-100 via-slate-50 to-violet-100 p-6 dark:from-indigo-950 dark:via-neutral-950 dark:to-violet-950">
      <div
        aria-hidden
        className="absolute -top-24 -left-24 size-72 rounded-full bg-indigo-400/20 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -right-24 -bottom-24 size-72 rounded-full bg-violet-400/20 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-bold text-white shadow-md">
          U
        </span>
        <span className="text-lg font-semibold">Unified Inbox</span>
        <span className="text-muted-foreground -mt-1 text-sm">
          Every customer conversation, in one place.
        </span>
      </div>
      <div className="relative w-full max-w-md">{children}</div>
      <p className="text-muted-foreground relative flex gap-4 text-xs">
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          Privacy Policy
        </Link>
        <Link href="/terms" className="underline-offset-4 hover:underline">
          Terms of Service
        </Link>
      </p>
    </div>
  );
}
