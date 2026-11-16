"use client";

import { ArrowUpDown, Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { ChannelBadge, PROVIDER_META } from "@/components/channel-icon";
import { PageHeader } from "@/components/layout/page-header";
import { SampleBadge } from "@/components/sample-badge";
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
import { SAMPLE_CONTACTS, type SampleContact } from "@/features/contacts/sample-data";
import type { Provider } from "@/generated/prisma/client";

type SortMode = "recent" | "name";

export function ContactsExplorer() {
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<SortMode>("recent");
  const [selected, setSelected] = useState<SampleContact | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = SAMPLE_CONTACTS.filter((contact) => {
      if (channelFilter !== "ALL" && !contact.providers.includes(channelFilter as Provider))
        return false;
      if (
        q &&
        !contact.name.toLowerCase().includes(q) &&
        !contact.email.toLowerCase().includes(q) &&
        !contact.phone.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
      )
        return false;
      return true;
    });
    return [...filtered].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : a.lastActiveMinutes - b.lastActiveMinutes,
    );
  }, [query, channelFilter, sort]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        description="Customers unified across channels by identity. Real contacts appear automatically when messages arrive."
        actions={
          <>
            <SampleBadge />
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="size-4" /> Add contact
            </Button>
          </>
        }
      />

      <Card className="shadow-none">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2 pb-4">
            <div className="relative min-w-56 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                placeholder="Search by name, email or phone…"
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search contacts"
              />
            </div>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-[160px]" aria-label="Filter by channel">
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
              <SelectTrigger className="w-[170px]" aria-label="Sort contacts">
                <ArrowUpDown className="size-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently active</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="pb-2 font-medium">Contact</th>
                  <th className="pb-2 font-medium">Channels</th>
                  <th className="pb-2 font-medium">Tags</th>
                  <th className="pb-2 font-medium">Conversations</th>
                  <th className="pb-2 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((contact) => (
                  <tr
                    key={contact.id}
                    className="hover:bg-accent/50 cursor-pointer"
                    onClick={() => setSelected(contact)}
                  >
                    <td className="py-3 pr-3">
                      <span className="flex items-center gap-2.5">
                        <AvatarWithBadge name={contact.name} size="sm" />
                        <span className="leading-tight">
                          <span className="block font-medium">{contact.name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {contact.email} · {contact.phone}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <span className="flex gap-1.5">
                        {contact.providers.map((provider) => (
                          <span key={provider} className="relative inline-flex">
                            <ChannelBadge
                              provider={provider}
                              className="ring-0 static size-5 [&_svg]:size-3"
                            />
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <span className="flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[11px]">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="py-3 pr-3">{contact.conversationsCount}</td>
                    <td className="text-muted-foreground py-3">{contact.lastActiveLabel}</td>
                  </tr>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground py-10 text-center">
                      No sample contacts match your filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <AvatarWithBadge name={selected.name} />
                  {selected.name}
                </DialogTitle>
                <DialogDescription>
                  Sample contact — {selected.location}. Real contact profiles are built from channel
                  identities.
                </DialogDescription>
              </DialogHeader>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-medium">{selected.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium">{selected.phone}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Channels</dt>
                  <dd className="font-medium">
                    {selected.providers.map((p) => PROVIDER_META[p].shortLabel).join(", ")}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Conversations</dt>
                  <dd className="font-medium">{selected.conversationsCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Last active</dt>
                  <dd className="font-medium">{selected.lastActiveLabel}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Tags</dt>
                  <dd className="flex gap-1">
                    {selected.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </dd>
                </div>
              </dl>
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
              connected channels, so there is nothing to add by hand yet. Manual contact creation
              becomes available when the first channel is connected.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}
