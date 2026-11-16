"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LogoutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onLogout() {
    setPending(true);
    try {
      await authClient.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (iconOnly) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => void onLogout()}
        disabled={pending}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </Button>
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={() => void onLogout()} disabled={pending}>
      <LogOut className="size-4" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
