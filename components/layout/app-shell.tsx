"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  Header,
  type HeaderNotification,
  type HeaderSearchContact,
  type HeaderSearchConversation,
} from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import type { WorkspaceOption } from "@/components/layout/workspace-switcher";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  user,
  workspaces = [],
  activeWorkspaceId = null,
  notifications = [],
  inboxOpenCount = 0,
  searchContacts = [],
  searchConversations = [],
}: {
  children: ReactNode;
  user?: { name: string; email: string };
  workspaces?: WorkspaceOption[];
  activeWorkspaceId?: string | null;
  notifications?: HeaderNotification[];
  inboxOpenCount?: number;
  searchContacts?: HeaderSearchContact[];
  searchConversations?: HeaderSearchConversation[];
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fullBleed = pathname === "/inbox";

  // Desktop sidebar collapse (icon rail) persists across reloads.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("omnichannel:sidebar-collapsed") === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSidebarCollapsed(true);
      }
    } catch {
      // Storage unavailable (private mode) — sidebar just stays expanded.
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      try {
        window.localStorage.setItem("omnichannel:sidebar-collapsed", value ? "0" : "1");
      } catch {
        // Non-fatal: the choice simply won't persist.
      }
      return !value;
    });
  }

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        user={user}
        inboxOpenCount={inboxOpenCount}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        className="sticky top-0 hidden h-screen lg:flex"
      />
      {/* Mobile drawer: always mounted so it can SLIDE — the panel
          translates in/out and the backdrop fades (Jeet, 2026-11-26).
          When closed it is invisible (delayed until the slide-out
          finishes), inert, and the backdrop ignores taps. */}
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          mobileOpen ? "visible" : "invisible [transition:visibility_0s_linear_300ms]",
        )}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={mobileOpen ? 0 : -1}
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-300",
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          inert={!mobileOpen}
        >
          <Sidebar
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            user={user}
            inboxOpenCount={inboxOpenCount}
            className="h-full shadow-xl"
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      </div>
      <div className="bg-muted/40 flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          notifications={notifications}
          searchContacts={searchContacts}
          searchConversations={searchConversations}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main className={cn("min-w-0 flex-1", fullBleed ? "" : "px-4 py-5 sm:px-6 sm:py-6 lg:px-8")}>
          {children}
        </main>
      </div>
    </div>
  );
}
