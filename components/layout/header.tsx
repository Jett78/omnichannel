"use client";

import { Bell, CircleHelp, LogOut, Menu, Search, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export interface HeaderNotification {
  id: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAtLabel: string;
}

/** Real rows for the ⌘K search, loaded server-side by the layout. */
export interface HeaderSearchContact {
  id: string;
  name: string;
  email: string | null;
}

export interface HeaderSearchConversation {
  id: string;
  contactName: string;
  snippet: string;
}

const TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/inbox": "Inbox",
  "/contacts": "Contacts",
  "/channels": "Channels",
  "/automation": "Automation",
  "/team": "Team",
  "/analytics": "Analytics",
  "/settings": "Settings",
  "/onboarding": "Onboarding",
};

const NAV_PAGES = Object.entries(TITLES).map(([href, label]) => ({ href, label }));

export function Header({
  user,
  notifications = [],
  searchContacts = [],
  searchConversations = [],
  onMenuClick,
}: {
  user?: { name: string; email: string };
  notifications?: HeaderNotification[];
  searchContacts?: HeaderSearchContact[];
  searchConversations?: HeaderSearchConversation[];
  onMenuClick?: () => void;
}) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [query, setQuery] = useState("");
  const unread = notifications.filter((n) => !n.isRead).length;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { pages: NAV_PAGES, conversations: [], contacts: [] };
    return {
      pages: NAV_PAGES.filter((p) => p.label.toLowerCase().includes(q)),
      conversations: searchConversations
        .filter(
          (c) => c.contactName.toLowerCase().includes(q) || c.snippet.toLowerCase().includes(q),
        )
        .slice(0, 5),
      contacts: searchContacts
        .filter(
          (c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q),
        )
        .slice(0, 5),
    };
  }, [query, searchContacts, searchConversations]);

  function go(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  async function onLogout() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="bg-background/95 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 lg:hidden"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className="size-4" />
      </Button>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="text-muted-foreground hover:bg-accent flex h-9 flex-1 items-center gap-2 rounded-md border bg-transparent px-3 text-sm shadow-xs transition-colors"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search conversations, contacts…</span>
        <kbd className="bg-muted pointer-events-none hidden h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium sm:flex">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-9"
              aria-label="Notifications"
            >
              <Bell className="size-4" />
              {unread > 0 ? (
                <span className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full" />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <p className="text-muted-foreground px-2 py-6 text-center text-sm">
                No new notifications. Assignments and mentions will appear here.
              </p>
            ) : (
              notifications.map((notification) => (
                <DropdownMenuItem key={notification.id} className="flex-col items-start gap-0.5">
                  <span className="flex w-full items-center gap-2 font-medium">
                    {notification.title}
                    {!notification.isRead ? <Badge variant="info">New</Badge> : null}
                  </span>
                  {notification.body ? (
                    <span className="text-muted-foreground text-xs">{notification.body}</span>
                  ) : null}
                  <span className="text-muted-foreground text-[11px]">
                    {notification.createdAtLabel}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/notifications" className="justify-center font-medium">
                View all notifications
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Help">
              <CircleHelp className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Help &amp; resources</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              Product documentation — coming with the public docs site
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="mailto:support@unifiedinbox.app">Email support</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">Workspace settings</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-full" aria-label="Account menu">
                <AvatarWithBadge name={user.name || user.email} size="sm" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="leading-tight">
                <span className="block truncate">{user.name}</span>
                <span className="text-muted-foreground block truncate text-xs font-normal">
                  {user.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <UserRound className="size-4" /> Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="size-4" /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setLogoutOpen(true)}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="top-[20%] translate-y-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>Search pages, conversations and contacts.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Type to search…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search query"
          />
          <div className="max-h-72 overflow-y-auto">
            {results.pages.length > 0 ? (
              <div className="pb-2">
                <p className="text-muted-foreground px-1 py-1.5 text-[11px] font-medium tracking-wide uppercase">
                  Pages
                </p>
                {results.pages.map((page) => (
                  <button
                    key={page.href}
                    type="button"
                    onClick={() => go(page.href)}
                    className="hover:bg-accent flex w-full rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    {page.label}
                  </button>
                ))}
              </div>
            ) : null}
            {results.conversations.length > 0 ? (
              <div className="pb-2">
                <p className="text-muted-foreground px-1 py-1.5 text-[11px] font-medium tracking-wide uppercase">
                  Conversations
                </p>
                {results.conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => go("/inbox")}
                    className="hover:bg-accent flex w-full flex-col rounded-md px-2 py-1.5 text-left"
                  >
                    <span className="text-sm font-medium">{conversation.contactName}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {conversation.snippet}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {results.contacts.length > 0 ? (
              <div>
                <p className="text-muted-foreground px-1 py-1.5 text-[11px] font-medium tracking-wide uppercase">
                  Contacts
                </p>
                {results.contacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => go("/contacts")}
                    className={cn(
                      "hover:bg-accent flex w-full flex-col rounded-md px-2 py-1.5 text-left",
                    )}
                  >
                    <span className="text-sm font-medium">{contact.name}</span>
                    {contact.email ? (
                      <span className="text-muted-foreground truncate text-xs">{contact.email}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            {query.trim() &&
            results.pages.length === 0 &&
            results.conversations.length === 0 &&
            results.contacts.length === 0 ? (
              <p className="text-muted-foreground px-1 py-4 text-sm">No results for “{query}”.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need to sign in again to keep working in this workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onLogout()}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
