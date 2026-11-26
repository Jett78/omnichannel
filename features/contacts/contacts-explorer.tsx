"use client";

import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  MoreVertical,
  Search,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { PROVIDER_META, ProviderGlyph } from "@/components/channel-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatLastActive, type RealContact } from "@/features/contacts/real-data";
import { cn } from "@/lib/utils";
import type { Provider } from "@/generated/prisma/client";

type SortMode = "recent" | "name";

export function ContactsExplorer({ contacts }: { contacts: RealContact[] }) {
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<SortMode>("recent");
  const [selected, setSelected] = useState<RealContact | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = contacts.filter((contact) => {
      if (channelFilter !== "ALL" && !contact.providers.includes(channelFilter as Provider))
        return false;
      if (
        q &&
        !contact.name.toLowerCase().includes(q) &&
        !(contact.email ?? "").toLowerCase().includes(q) &&
        !(contact.phone ?? "").replace(/\s/g, "").includes(q.replace(/\s/g, ""))
      )
        return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      // Most recently active first; contacts without activity last.
      if (a.lastActiveAt === b.lastActiveAt) return 0;
      if (!a.lastActiveAt) return 1;
      if (!b.lastActiveAt) return -1;
      return b.lastActiveAt.localeCompare(a.lastActiveAt);
    });
  }, [contacts, query, channelFilter, sort]);

  // Pagination: 20 contacts per page (the page clamps when filters
  // shrink the list).
  const PER_PAGE = 20;
  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageContacts = visible.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  // Numbered pagination (reference style): all pages when few, else a
  // window around the current page with first/last pinned.
  const pageList = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set([
      1,
      2,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      pageCount - 1,
      pageCount,
    ]);
    return [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  }, [pageCount, currentPage]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        description="Customers unified across channels by identity. Contacts are created automatically when messages arrive on a connected channel."
        actions={
          <Button className="rounded-full px-4" onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" /> Add contact
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2 pb-4">
            <div className="relative min-w-56 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                placeholder="Search by name, email or phone…"
                className="rounded-full border-transparent bg-muted/70 pl-9 focus-visible:bg-card"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search contacts"
              />
            </div>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger
                className="w-full rounded-full bg-card px-3.5 min-[480px]:w-[170px]"
                aria-label="Filter by channel"
              >
                <Layers className="text-muted-foreground size-4 shrink-0" />
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All channels</SelectItem>
                {(Object.keys(PROVIDER_META) as Provider[]).map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {PROVIDER_META[provider].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
              <SelectTrigger
                className="w-full rounded-full bg-card px-3.5 min-[480px]:w-[180px]"
                aria-label="Sort contacts"
              >
                <ArrowUpDown className="text-muted-foreground size-4 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Sort by: Newest first</SelectItem>
                <SelectItem value="name">Sort by: Name A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b bg-muted/40 text-left text-[11px] tracking-wider uppercase">
                  <th className="px-3 py-3 font-semibold">Contact</th>
                  <th className="px-3 py-3 font-semibold">Channels</th>
                  <th className="px-3 py-3 font-semibold">Tags</th>
                  <th className="px-3 py-3 font-semibold">Conversations</th>
                  <th className="px-3 py-3 font-semibold">Last activity</th>
                  <th className="px-3 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageContacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="hover:bg-accent/50 cursor-pointer"
                    onClick={() => setSelected(contact)}
                  >
                    <td className="px-3 py-3.5">
                      <span className="flex items-center gap-2.5">
                        <AvatarWithBadge name={contact.name} image={contact.avatarUrl} size="sm" />
                        <span className="leading-tight">
                          <span className="block font-semibold">{contact.name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {[contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex items-center gap-2">
                        {contact.providers.map((provider) => (
                          <span
                            key={provider}
                            className="inline-flex"
                            title={PROVIDER_META[provider].label}
                          >
                            <ProviderGlyph provider={provider} className="size-5" />
                          </span>
                        ))}
                        {contact.providers.length === 0 ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="rounded-full text-[11px]">
                            {tag}
                          </Badge>
                        ))}
                        {contact.tags.length === 0 ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 font-medium">{contact.conversationsCount}</td>
                    <td className="text-muted-foreground px-3 py-3.5 whitespace-nowrap">
                      {formatLastActive(contact.lastActiveAt)}
                    </td>
                    <td className="px-3 py-3.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-full"
                            aria-label={`Actions for ${contact.name}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setSelected(contact)}>
                            View summary
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/contacts/${contact.id}`}>Open full profile</Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground py-10 text-center">
                      {contacts.length === 0
                        ? "No contacts yet. Contacts appear here automatically when a customer messages one of your connected channels."
                        : "No contacts match your filters."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {visible.length > 0 ? (
            <div className="flex flex-col gap-2.5 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <p className="text-muted-foreground text-xs sm:flex-1">
                Showing {(currentPage - 1) * PER_PAGE + 1}–
                {Math.min(currentPage * PER_PAGE, visible.length)} of {visible.length}{" "}
                contacts
              </p>
              {pageCount > 1 ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 rounded-full"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  {pageList.map((n, idx) => (
                    <Fragment key={n}>
                      {idx > 0 && n - (pageList[idx - 1] ?? n) > 1 ? (
                        <span className="text-muted-foreground px-0.5 text-xs">…</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setPage(n)}
                        aria-current={n === currentPage ? "page" : undefined}
                        aria-label={`Page ${n}`}
                        className={cn(
                          "size-8 rounded-full border text-xs font-medium transition-colors",
                          n === currentPage
                            ? "bg-primary border-transparent text-primary-foreground"
                            : "bg-card hover:border-primary/40",
                        )}
                      >
                        {n}
                      </button>
                    </Fragment>
                  ))}
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 rounded-full"
                    disabled={currentPage >= pageCount}
                    onClick={() => setPage(currentPage + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <AvatarWithBadge name={selected.name} image={selected.avatarUrl} />
                  {selected.name}
                </DialogTitle>
                <DialogDescription>
                  Built from this customer&apos;s channel identities.
                </DialogDescription>
              </DialogHeader>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-medium">{selected.email ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium">{selected.phone ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Channels</dt>
                  <dd className="font-medium">
                    {selected.providers.map((p) => PROVIDER_META[p].shortLabel).join(", ") || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Conversations</dt>
                  <dd className="font-medium">{selected.conversationsCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Last active</dt>
                  <dd className="font-medium">{formatLastActive(selected.lastActiveAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Tags</dt>
                  <dd className="flex gap-1">
                    {selected.tags.length > 0 ? (
                      selected.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="font-medium">—</span>
                    )}
                  </dd>
                </div>
              </dl>
              <div className="flex justify-end pt-1">
                <Button asChild size="sm">
                  <Link href={`/contacts/${selected.id}`}>Open full profile</Link>
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add contact</DialogTitle>
            <DialogDescription>
              Contacts are created automatically when a customer first messages one of your
              connected channels, so there is nothing to add by hand. To edit a contact&apos;s
              phone or email, open their conversation in the Inbox and use Edit in Customer
              details.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
