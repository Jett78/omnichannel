"use client";

import {
  BarChart3,
  Bell,
  Bot,
  Cable,
  ChevronDown,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { LogoutButton } from "@/components/layout/logout-button";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "inbox" as const },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/channels", label: "Channels", icon: Cable },
  { href: "/automation", label: "Automation", icon: Bot },
  { href: "/team", label: "Team", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({
  workspaces = [],
  activeWorkspaceId = null,
  user,
  inboxOpenCount = 0,
  className,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  workspaces?: WorkspaceOption[];
  activeWorkspaceId?: string | null;
  user?: { name: string; email: string };
  /** Real count of OPEN conversations in the active workspace. */
  inboxOpenCount?: number;
  className?: string;
  onNavigate?: () => void;
  /** Icon-rail mode (desktop only): icons with tooltips, no labels. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  return (
    <aside
      className={cn(
        "bg-sidebar text-sidebar-foreground flex shrink-0 flex-col overflow-x-hidden border-r transition-[width] duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-sm">
          U
        </span>
        <div
          className={cn(
            "min-w-0 flex-1 leading-tight transition-opacity duration-150",
            collapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
          aria-hidden={collapsed}
        >
          <p className="truncate text-sm font-semibold">Unified Inbox</p>
          <p className="text-muted-foreground truncate text-xs">Omnichannel workspace</p>
        </div>
        {onNavigate ? (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close menu"
            className="hover:bg-accent rounded-md p-1.5 lg:hidden"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="border-b px-3 py-3">
        <p
          className={cn(
            "text-muted-foreground px-1 pb-1.5 text-[11px] font-medium tracking-wide whitespace-nowrap uppercase transition-opacity duration-150",
            collapsed ? "opacity-0" : "opacity-100",
          )}
          aria-hidden={collapsed}
        >
          Workspace
        </p>
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={activeWorkspace ? `Workspace: ${activeWorkspace.name} — expand to switch` : "Expand sidebar"}
            aria-label="Expand sidebar to switch workspace"
            className="bg-sidebar-accent text-sidebar-accent-foreground flex h-[30px] w-full items-center justify-center rounded-md text-xs font-bold"
          >
            {activeWorkspace ? activeWorkspace.name.charAt(0).toUpperCase() : "W"}
          </button>
        ) : (
          <WorkspaceSwitcher workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />
        )}
      </div>

      <nav className="flex flex-col gap-0.5 overflow-y-auto p-3" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const isInbox = "badge" in item && item.badge === "inbox";
          if (isInbox && !collapsed) {
            return (
              <InboxNavGroup
                key={item.href}
                active={active}
                openCount={inboxOpenCount}
                onNavigate={onNavigate}
              />
            );
          }
          return (
            <Link
              key={item.href}
              href={isInbox ? "/inbox?view=all" : item.href}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span
                className={cn(
                  "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-150",
                  collapsed ? "opacity-0" : "opacity-100",
                )}
                aria-hidden={collapsed}
              >
                {item.label}
              </span>
              {isInbox && collapsed && inboxOpenCount > 0 ? (
                <span
                  className="bg-brand text-brand-foreground absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                  title={`${inboxOpenCount} open conversations`}
                >
                  {inboxOpenCount > 99 ? "99+" : inboxOpenCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t p-3">
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" />
            )}
            <span
              className={cn(
                "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-150",
                collapsed ? "opacity-0" : "opacity-100",
              )}
              aria-hidden={collapsed}
            >
              {collapsed ? "Expand" : "Collapse"}
            </span>
          </button>
        ) : null}
        <Link
          href="/settings"
          onClick={onNavigate}
          title="Help & docs"
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
        >
          <CircleHelp className="size-4 shrink-0" />
          <span
            className={cn(
              "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-150",
              collapsed ? "opacity-0" : "opacity-100",
            )}
            aria-hidden={collapsed}
          >
            Help &amp; docs
          </span>
        </Link>
        {user ? (
          collapsed ? (
            <div className="flex flex-col items-start gap-2 px-2 pt-3">
              <span title={`${user.name} (${user.email})`}>
                <AvatarWithBadge name={user.name || user.email} size="sm" />
              </span>
              <LogoutButton iconOnly />
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-2 pt-3">
              <AvatarWithBadge name={user.name || user.email} size="sm" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="text-muted-foreground truncate text-xs">{user.email}</p>
              </div>
              <LogoutButton iconOnly />
            </div>
          )
        ) : null}
      </div>
    </aside>
  );
}

const INBOX_VIEWS = [
  { view: "all", label: "All" },
  { view: "mine", label: "Mine" },
  { view: "unassigned", label: "Unassigned" },
  { view: "mentions", label: "Mentions" },
] as const;

/**
 * Inbox nav group: the Inbox link plus an expandable list of the
 * inbox's assignee views (All / Mine / Unassigned / Mentions). Open
 * by default, with "All" as the default view; the chevron collapses
 * it. The views are the inbox's real filters (?view=…), the same ones
 * the inbox's own segmented control switches.
 */
function InboxNavGroup({
  active,
  openCount,
  onNavigate,
}: {
  active: boolean;
  openCount: number;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        className={cn(
          "relative flex items-center rounded-lg pr-1 transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Link
          href="/inbox?view=all"
          onClick={onNavigate}
          className={cn(
            "flex flex-1 items-center gap-3 px-3 py-2 text-sm font-medium",
            active && "font-semibold",
          )}
        >
          <Inbox className="size-4 shrink-0" />
          <span className="flex-1">Inbox</span>
          {openCount > 0 ? (
            <Badge variant="info" className="px-1.5" title="Open conversations">
              {openCount}
            </Badge>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Collapse inbox views" : "Expand inbox views"}
          aria-expanded={open}
          className="hover:bg-background/60 rounded-md p-1"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", open ? "" : "-rotate-90")}
          />
        </button>
      </div>
      {open ? (
        <Suspense fallback={<InboxSubList currentView="all" onNavigate={onNavigate} />}>
          <InboxSubNav onNavigate={onNavigate} />
        </Suspense>
      ) : null}
    </div>
  );
}

function InboxSubNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");
  const currentView = onInbox ? (searchParams.get("view") ?? "all") : "all";
  return <InboxSubList currentView={currentView} onNavigate={onNavigate} />;
}

function InboxSubList({
  currentView,
  onNavigate,
}: {
  currentView: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      {INBOX_VIEWS.map((item) => {
        const isActive = currentView === item.view;
        return (
          <Link
            key={item.view}
            href={`/inbox?view=${item.view}`}
            onClick={onNavigate}
            className={cn(
              "rounded-lg py-1.5 pr-3 pl-10 text-[13px] transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
