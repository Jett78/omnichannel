"use client";

import { ArrowLeft, Flag, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { ChannelIcon, PROVIDER_META } from "@/components/channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ContactProfileView } from "@/features/contacts/real-data";
import type { Provider } from "@/generated/prisma/client";

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  PENDING: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  SNOOZED: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  RESOLVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
};

interface ContactProfileProps {
  workspaceId: string;
  initialProfile: ContactProfileView;
  canEdit: boolean;
}

export function ContactProfile({ workspaceId, initialProfile, canEdit }: ContactProfileProps) {
  const [profile, setProfile] = useState(initialProfile);
  const [notice, setNotice] = useState<string | null>(null);

  // Details editing.
  const [editingDetails, setEditingDetails] = useState(false);
  const [name, setName] = useState(profile.displayName);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [savingDetails, setSavingDetails] = useState(false);

  // Attributes editing (array of pairs for stable row editing).
  const [editingAttrs, setEditingAttrs] = useState(false);
  const [attrRows, setAttrRows] = useState<Array<{ key: string; value: string }>>([]);
  const [savingAttrs, setSavingAttrs] = useState(false);

  const apiBase = `/api/workspaces/${workspaceId}/contacts/${profile.id}`;

  async function patchProfile(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(apiBase, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { profile: ContactProfileView };
      setProfile(body.profile);
      return true;
    }
    setNotice("Could not save those changes.");
    return false;
  }

  async function saveDetails() {
    if (!name.trim() || savingDetails) return;
    setSavingDetails(true);
    const ok = await patchProfile({
      displayName: name.trim(),
      phone: phone.trim() ? phone.trim() : null,
      email: email.trim() ? email.trim() : null,
    });
    setSavingDetails(false);
    if (ok) setEditingDetails(false);
  }

  function startEditAttrs() {
    setAttrRows(
      Object.entries(profile.customAttrs).map(([key, value]) => ({ key, value })),
    );
    setEditingAttrs(true);
  }

  async function saveAttrs() {
    if (savingAttrs) return;
    setSavingAttrs(true);
    const customAttrs: Record<string, string> = {};
    for (const row of attrRows) {
      const key = row.key.trim();
      if (key) customAttrs[key] = row.value;
    }
    const ok = await patchProfile({ customAttrs });
    setSavingAttrs(false);
    if (ok) setEditingAttrs(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/contacts"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> All contacts
        </Link>
      </div>

      {notice ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {notice}
        </p>
      ) : null}

      {/* Header */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-5">
          <AvatarWithBadge name={profile.displayName} image={profile.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold">{profile.displayName}</h1>
            <p className="text-muted-foreground text-sm">
              Customer since {new Date(profile.createdAt).toLocaleDateString()} ·{" "}
              {profile.stats.conversations} conversation
              {profile.stats.conversations === 1 ? "" : "s"} ({profile.stats.open} open) ·{" "}
              {profile.stats.messages} messages
            </p>
            {profile.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Details */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Details</CardTitle>
              {canEdit && !editingDetails ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setName(profile.displayName);
                    setPhone(profile.phone ?? "");
                    setEmail(profile.email ?? "");
                    setEditingDetails(true);
                  }}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {editingDetails ? (
              <div className="flex flex-col gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" placeholder="Name" />
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" placeholder="Phone" />
                <Input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" placeholder="Email" />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingDetails(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void saveDetails()} disabled={!name.trim() || savingDetails}>
                    {savingDetails ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium">{profile.phone ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-medium">{profile.email ?? "—"}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Connected identities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Connected channels</CardTitle>
            <CardDescription>
              The identities this customer is known by — grouped as recorded, never merged
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profile.identities.length === 0 ? (
              <p className="text-muted-foreground text-sm">No channel identities recorded.</p>
            ) : (
              <div className="flex flex-col divide-y">
                {profile.identities.map((identity) => (
                  <div key={identity.id} className="flex items-center gap-3 py-2.5">
                    <ChannelIcon provider={identity.provider as Provider} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {PROVIDER_META[identity.provider as Provider]?.label ?? identity.provider}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {identity.channelDisplayName}
                        </span>
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {identity.username ? `@${identity.username} · ` : ""}
                        {identity.externalUserId}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attributes */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Attributes</CardTitle>
              {canEdit && !editingAttrs ? (
                <Button variant="outline" size="sm" onClick={startEditAttrs}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              ) : null}
            </div>
            <CardDescription>Free-form facts your team keeps about this customer.</CardDescription>
          </CardHeader>
          <CardContent>
            {editingAttrs ? (
              <div className="flex flex-col gap-2">
                {attrRows.map((row, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) =>
                        setAttrRows((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)),
                        )
                      }
                      placeholder="Key, e.g. City"
                      aria-label="Attribute key"
                      className="w-36"
                    />
                    <Input
                      value={row.value}
                      onChange={(e) =>
                        setAttrRows((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)),
                        )
                      }
                      placeholder="Value"
                      aria-label="Attribute value"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-red-600"
                      onClick={() => setAttrRows((prev) => prev.filter((_, i) => i !== index))}
                      aria-label="Remove attribute"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAttrRows((prev) => [...prev, { key: "", value: "" }])}
                  >
                    <Plus className="size-3.5" /> Add attribute
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingAttrs(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveAttrs()} disabled={savingAttrs}>
                      {savingAttrs ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : Object.keys(profile.customAttrs).length === 0 ? (
              <p className="text-muted-foreground text-sm">No attributes yet.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {Object.entries(profile.customAttrs).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Internal notes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="size-4 text-amber-500" /> Internal notes
            </CardTitle>
            <CardDescription>
              Private notes agents left in this customer&apos;s conversations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profile.notes.length === 0 ? (
              <p className="text-muted-foreground text-sm">No internal notes yet.</p>
            ) : (
              <div className="flex flex-col divide-y">
                {profile.notes.map((note) => (
                  <div key={note.id} className="py-2.5">
                    <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {note.senderName ?? "Team member"} · {relativeTime(note.createdAt)} ·{" "}
                      <Link
                        href={`/inbox?c=${note.conversationId}`}
                        className="text-indigo-600 hover:underline"
                      >
                        Open conversation
                      </Link>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conversation history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Conversation history</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.conversations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No conversations yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {profile.conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/inbox?c=${conversation.id}`}
                  className="hover:bg-accent/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
                >
                  <ChannelIcon provider={conversation.provider as Provider} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{conversation.preview ?? "—"}</p>
                    <p className="text-muted-foreground text-xs">
                      {conversation.channelDisplayName} · {relativeTime(conversation.lastMessageAt)}
                      {conversation.unreadCount > 0
                        ? ` · ${conversation.unreadCount} unread`
                        : ""}
                    </p>
                  </div>
                  {conversation.priority ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                      <Flag className="size-3" /> {conversation.priority.toLowerCase()}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[conversation.status] ?? "bg-muted"}`}
                  >
                    {conversation.status.toLowerCase()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
