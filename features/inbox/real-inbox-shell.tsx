"use client";

import {
  AlarmClock,
  ArrowLeft,
  ArrowUpDown,
  Bookmark,
  Check,
  CheckCheck,
  Copy,
  FileText,
  Flag,
  ListFilter,
  Lock,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Reply,
  RotateCcw,
  Search,
  Smile,
  Sparkles,
  Loader2,
  Send,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AvatarWithBadge } from "@/components/avatar-with-badge";
import { PROVIDER_META } from "@/components/channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  CannedResponseView,
  ConversationPriority,
  RealConversationItem,
  RealInboxData,
  RealMessageItem,
  WhatsAppTemplateView,
} from "@/features/inbox/real-data";
import { connectSocket, disconnectSocket } from "@/lib/socket-client";
import { cn } from "@/lib/utils";

type SocketStatus = "connecting" | "connected" | "disconnected";
type ComposerMode = "reply" | "note" | "template";

/** Renders a template body with {{n}} placeholders substituted. */
function renderTemplatePreview(bodyText: string | null, params: string[]): string {
  if (!bodyText) return "";
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => {
    const value = params[Number(index) - 1]?.trim();
    return value ? value : `{{${index}}}`;
  });
}

/** Delivery error recorded in message metadata (e.g. WhatsApp 131047). */
function messageErrorText(message: RealMessageItem): string | null {
  const error = message.metadata?.error;
  return typeof error === "string" && error ? error : null;
}

/** True when the latest inbound message is older than 24 hours (or absent). */
function isWindowClosed(latestInboundAt: string | null): boolean {
  if (!latestInboundAt) return true;
  return Date.now() - new Date(latestInboundAt).getTime() > 24 * 60 * 60 * 1000;
}

interface MessageCreatedPayload {
  conversationId?: string;
  message?: RealMessageItem;
}

interface StatusUpdatedPayload {
  conversationId?: string;
  messageId?: string;
  status?: string;
  externalMessageId?: string | null;
}

function formatListTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Curated emoji set for the composer picker (most-used chat emojis). */
const COMPOSER_EMOJIS = [
  "😀", "😁", "😂", "🤣", "😅", "😊", "🙂", "😉",
  "😍", "🥰", "😘", "😎", "🤩", "😇", "🤗", "🤔",
  "🙄", "😬", "😴", "😢", "😭", "🥺", "😱", "😡",
  "🙏", "👍", "👎", "👏", "🙌", "👋", "👌", "✌️",
  "🤞", "🤝", "💪", "👀", "💬", "💡", "📌", "🔔",
  "❤️", "💔", "💯", "🔥", "⭐", "🚀", "🎉", "🎂",
  "🎁", "✅", "❌", "📦", "🚚", "💰", "💵", "📞",
  "📱", "📍", "⏰", "📅", "🎵", "😌", "😷", "🤒",
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Where an attachment can be previewed from, if anywhere: public URLs
 * directly; platform references through our media route — WhatsApp
 * media ids are downloaded live with the channel credential, and
 * Meta/mock references are served from the copy we stored at send
 * time (Meta attachment ids cannot be fetched back from Meta).
 */
function attachmentPreviewSrc(
  workspaceId: string,
  message: RealMessageItem,
  attachment: NonNullable<RealMessageItem["attachments"]>[number],
  index: number,
): string | null {
  const url = attachment.url;
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (
    url.startsWith("whatsapp-media:") ||
    url.startsWith("meta-attachment:") ||
    url.startsWith("gmail-attachment:") ||
    url.startsWith("telegram-file:") ||
    url.startsWith("telegram-pending:") ||
    url.startsWith("website-file:") ||
    url.startsWith("mock-media:")
  ) {
    return `/api/workspaces/${workspaceId}/conversations/${message.conversationId}/messages/${message.id}/media/${index}`;
  }
  return null;
}

type RealAttachment = NonNullable<RealMessageItem["attachments"]>[number];

function AttachmentChip({
  attachment,
  href,
}: {
  attachment: RealAttachment;
  href?: string | null;
}) {
  const content = (
    <>
      <Paperclip className="size-3 shrink-0" />
      <span className="max-w-48 truncate">{attachment.fileName ?? "Attachment"}</span>
      {attachment.size ? <span>· {formatFileSize(attachment.size)}</span> : null}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={`Open ${attachment.fileName ?? "attachment"}`}
        className="inline-flex items-center gap-1.5 self-start rounded-md bg-black/5 px-2 py-1 text-xs transition-colors hover:bg-black/10 hover:underline dark:bg-white/10 dark:hover:bg-white/20"
      >
        {content}
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-md bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
      {content}
    </span>
  );
}

/** Image preview that falls back to a file chip if the bytes can't load
 *  (e.g. media sent before stored copies existed). Clicking opens a
 *  fullscreen lightbox, like Messenger. */
function AttachmentPreviewImage({
  src,
  attachment,
}: {
  src: string;
  attachment: RealAttachment;
}) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  if (failed) return <AttachmentChip attachment={attachment} href={src} />;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block cursor-zoom-in self-start transition-opacity hover:opacity-90"
        aria-label="View image full screen"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={attachment.fileName ?? "Image attachment"}
          className="max-h-64 w-auto rounded-lg object-contain"
          onError={() => setFailed(true)}
        />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={attachment.fileName ?? "Image attachment"}
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={attachment.fileName ?? "Image attachment"}
            className="max-h-[92vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            aria-label="Close full screen view"
            className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
            onClick={() => setOpen(false)}
          >
            <X className="size-5" />
          </button>
          {attachment.fileName ? (
            <p className="absolute bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 truncate text-xs text-white/70">
              {attachment.fileName}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function MessageAttachments({
  workspaceId,
  message,
}: {
  workspaceId: string;
  message: RealMessageItem;
}) {
  if (!message.attachments?.length) return null;
  return (
    <div className="flex flex-col gap-1.5 pb-1.5">
      {message.attachments.map((attachment, index) => {
        const src = attachmentPreviewSrc(workspaceId, message, attachment, index);
        if (src && attachment.mimeType?.startsWith("image/")) {
          return (
            <AttachmentPreviewImage key={attachment.id} src={src} attachment={attachment} />
          );
        }
        if (src && attachment.mimeType?.startsWith("video/")) {
          return (
            <video
              key={attachment.id}
              src={src}
              controls
              className="max-h-64 w-auto rounded-lg"
            />
          );
        }
        return <AttachmentChip key={attachment.id} attachment={attachment} href={src} />;
      })}
    </div>
  );
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Day-divider label for the thread: "Today, Nov 24, 2026" style. */
function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const rest = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (isSameDay(date, now)) return `Today, ${rest}`;
  if (isSameDay(date, yesterday)) return `Yesterday, ${rest}`;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const PRIORITY_META: Record<ConversationPriority, { label: string; className: string }> = {
  URGENT: { label: "Urgent", className: "text-red-600" },
  HIGH: { label: "High", className: "text-orange-600" },
  MEDIUM: { label: "Medium", className: "text-amber-600" },
  LOW: { label: "Low", className: "text-zinc-500" },
};

/** Compact "how long the customer has been waiting" label. */
function formatWaiting(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

type AssigneeTab = "all" | "mine" | "unassigned" | "mentions";
type StatusFilter = "ALL" | "OPEN" | "PENDING" | "RESOLVED" | "SNOOZED";
type SortMode = "latest" | "waiting" | "priority";

/** Filter-bar design: statuses as one-tap tinted chips, sort +
 *  channel as two compact selects. The assignee views (All / Mine /
 *  Unassigned / Mentions) live in the sidebar's Inbox dropdown and
 *  arrive here as the ?view= initial tab — no in-inbox switcher. */

/* Active filter chip = one solid primary pill (the reference design);
 * the per-status tint lives on the rows' status badges instead. */
const STATUS_CHIP_ACTIVE = "border-transparent bg-primary font-semibold text-primary-foreground";

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string; activeClass: string }> = [
  { value: "ALL", label: "All", activeClass: STATUS_CHIP_ACTIVE },
  { value: "OPEN", label: "Open", activeClass: STATUS_CHIP_ACTIVE },
  { value: "PENDING", label: "Pending", activeClass: STATUS_CHIP_ACTIVE },
  { value: "SNOOZED", label: "Snoozed", activeClass: STATUS_CHIP_ACTIVE },
  { value: "RESOLVED", label: "Resolved", activeClass: STATUS_CHIP_ACTIVE },
];

const DRAFTS_KEY = "uoi.inbox.drafts.v1";

function readDrafts(): Record<string, { draft: string; mode: "reply" | "note" }> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, { draft: string; mode: "reply" | "note" }>) : {};
  } catch {
    return {};
  }
}

/** Hover action menu for a message bubble (copy / retry / delete). */
function MessageActions({
  message,
  side,
  onCopy,
  onRetry,
  onDelete,
}: {
  message: RealMessageItem;
  side: "left" | "right";
  onCopy: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "absolute top-0 size-7 opacity-0 group-hover:opacity-100",
            side === "left" ? "-left-9" : "-right-9",
          )}
          aria-label="Message actions"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {message.content ? (
          <DropdownMenuItem onSelect={onCopy}>
            <Copy className="size-4" /> Copy text
          </DropdownMenuItem>
        ) : null}
        {onRetry ? (
          <DropdownMenuItem onSelect={onRetry}>
            <RotateCcw className="size-4" /> Retry sending
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600" onSelect={onDelete}>
              <Trash2 className="size-4" /> Delete from inbox
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * REAL inbox (Phase 4) — rendered when the active workspace has real
 * conversations in the database. Data comes from the conversations
 * API; sending goes through the outbound queue + provider; live
 * updates arrive over Socket.IO. The Phase 3 sample shell is used
 * only when a workspace has no real conversations yet.
 */
export function RealInboxShell({
  currentUserName,
  data,
}: {
  currentUserName: string;
  data: RealInboxData;
}) {
  const { workspaceId, currentUserId } = data;
  const apiBase = `/api/workspaces/${workspaceId}`;

  const [conversations, setConversations] = useState<RealConversationItem[]>(data.conversations);
  const [selectedId, setSelectedId] = useState<string>(data.conversations[0]?.id ?? "");
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, RealMessageItem[]>
  >({ [data.initialMessages.conversationId]: data.initialMessages.messages });
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string>(() => {
    const firstId = data.conversations[0]?.id;
    return firstId ? (readDrafts()[firstId]?.draft ?? "") : "";
  });
  const [composerMode, setComposerMode] = useState<ComposerMode>(() => {
    const firstId = data.conversations[0]?.id;
    return firstId ? (readDrafts()[firstId]?.mode ?? "reply") : "reply";
  });
  // Chatwoot-style list controls. The sidebar's inbox views
  // (?view=…) choose the opening tab; changing the prop (navigating
  // between sidebar views) re-syncs the tab.
  const [assigneeTab, setAssigneeTab] = useState<AssigneeTab>(() => data.initialView ?? "all");
  useEffect(() => {
    // Syncing the tab to the sidebar view (?view=…) is an external
    // navigation change, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data.initialView) setAssigneeTab(data.initialView);
  }, [data.initialView]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [knownChannels, setKnownChannels] = useState<
    Array<{ id: string; provider: RealConversationItem["channel"]["provider"]; displayName: string }>
  >(() => {
    const seen = new Map<string, RealConversationItem["channel"]>();
    for (const c of data.conversations) seen.set(c.channel.id, c.channel);
    return [...seen.values()];
  });
  const filtersRef = useRef({ assigneeTab, statusFilter, sortMode, channelFilter });
  // Canned responses (saved replies).
  const [cannedItems, setCannedItems] = useState<CannedResponseView[]>([]);
  const [cannedManageOpen, setCannedManageOpen] = useState(false);
  // Phase 13G — AI assistant panel state.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{
    kind: string;
    text?: string;
    sentiment?: string;
    reason?: string;
    knowledgeUsed?: string[];
    products?: { name: string }[];
  } | null>(null);
  const [aiTone, setAiTone] = useState("professional");
  const [aiTarget, setAiTarget] = useState("English");

  // Render-adjustment (not an effect): reset the AI panel when the
  // agent switches conversations so a draft can't leak across threads.
  const [prevAiSelectedId, setPrevAiSelectedId] = useState(selectedId);
  if (prevAiSelectedId !== selectedId) {
    setPrevAiSelectedId(selectedId);
    setAiOpen(false);
    setAiResult(null);
    setAiError(null);
  }
  const [cannedTitle, setCannedTitle] = useState("");
  const [cannedShortcut, setCannedShortcut] = useState("");
  const [cannedBody, setCannedBody] = useState("");
  const [cannedCategory, setCannedCategory] = useState("");
  const [cannedEditingId, setCannedEditingId] = useState<string | null>(null);
  const [cannedSearch, setCannedSearch] = useState("");
  const [cannedCategoryFilter, setCannedCategoryFilter] = useState<string | null>(null);
  // Previous conversations with the selected contact.
  const [previousConversations, setPreviousConversations] = useState<RealConversationItem[]>([]);
  // Destructive-action confirmations.
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<RealMessageItem | null>(null);
  const [confirmDeleteConversation, setConfirmDeleteConversation] = useState(false);
  // WhatsApp template composer state (Phase 6).
  const [templatesByChannel, setTemplatesByChannel] = useState<
    Record<string, WhatsAppTemplateView[]>
  >({});
  const [templateSelection, setTemplateSelection] = useState<string>("");
  const [templateParams, setTemplateParams] = useState<string[]>([]);
  const [templateOptInConfirmed, setTemplateOptInConfirmed] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [contactEditing, setContactEditing] = useState(false);
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  // Switching conversations closes the contact editor, drops any
  // pending attachment and closes the emoji picker (render-pattern
  // state adjustment, per this codebase's lint rules).
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    setContactEditing(false);
    setPendingFile(null);
    setEmojiOpen(false);
  }
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileThread, setMobileThread] = useState(false);

  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const messages = selected ? (messagesByConversation[selected.id] ?? []) : [];

  // Chat threads open at the BOTTOM (latest message), like every
  // messaging app: scroll there when a conversation is opened, and
  // follow new messages only while the reader is already near the
  // bottom (or sent the message themselves) so reading history is
  // never interrupted.
  const threadEndRef = useRef<HTMLDivElement>(null);
  const prevThreadRef = useRef<{ selectedId: string | null; lastMessageId: string | null }>({
    selectedId: null,
    lastMessageId: null,
  });
  const lastMessageId = messages.at(-1)?.id ?? null;
  const lastMessageDirection = messages.at(-1)?.direction ?? null;
  const selectedThreadId = selected?.id ?? null;
  useEffect(() => {
    const anchor = threadEndRef.current;
    if (!anchor || !selectedThreadId) return;
    const switched = prevThreadRef.current.selectedId !== selectedThreadId;
    const viewport = anchor.closest("[data-radix-scroll-area-viewport]");
    const nearBottom = viewport
      ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 200
      : true;
    const lastIsOwn = lastMessageDirection === "OUTBOUND";
    if (switched || nearBottom || lastIsOwn) {
      anchor.scrollIntoView({ block: "end" });
      if (switched) {
        // Images still loading grow the thread after the first jump.
        const timer = setTimeout(() => anchor.scrollIntoView({ block: "end" }), 350);
        prevThreadRef.current = { selectedId: selectedThreadId, lastMessageId };
        return () => clearTimeout(timer);
      }
    }
    prevThreadRef.current = { selectedId: selectedThreadId, lastMessageId };
  }, [selectedThreadId, lastMessageId, lastMessageDirection]);

  const isWhatsApp = selected?.channel.provider === "WHATSAPP";
  const channelTemplates = selected ? templatesByChannel[selected.channel.id] : undefined;
  const selectedTemplate = (channelTemplates ?? []).find(
    (template) => `${template.name}|${template.language}` === templateSelection,
  );
  const latestInbound = [...messages].reverse().find((m) => m.direction === "INBOUND");
  // Advisory only — the server enforces WhatsApp's 24-hour window.
  const whatsappWindowClosed = isWhatsApp && isWindowClosed(latestInbound?.createdAt ?? null);

  // Load APPROVED templates when the template composer opens.
  useEffect(() => {
    if (composerMode !== "template" || !selected || !isWhatsApp) return;
    const channelId = selected.channel.id;
    if (templatesByChannel[channelId]) return;
    let cancelled = false;
    void (async () => {
      setTemplatesLoading(true);
      setTemplatesError(null);
      try {
        const res = await fetch(`${apiBase}/channels/${channelId}/templates`);
        const body = (await res.json().catch(() => null)) as {
          templates?: WhatsAppTemplateView[];
          error?: { message?: string };
        } | null;
        if (cancelled) return;
        if (!res.ok || !body?.templates) {
          throw new Error(body?.error?.message ?? `Could not load templates (${res.status})`);
        }
        setTemplatesByChannel((prev) => ({ ...prev, [channelId]: body.templates ?? [] }));
        const first = body.templates[0];
        if (first) {
          setTemplateSelection(`${first.name}|${first.language}`);
          setTemplateParams(Array.from({ length: first.paramsCount }, () => ""));
        }
      } catch (error) {
        if (!cancelled) {
          setTemplatesError(error instanceof Error ? error.message : "Could not load templates");
        }
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [composerMode, selected, isWhatsApp, apiBase, templatesByChannel]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.contact.displayName.toLowerCase().includes(q) ||
        (c.preview ?? "").toLowerCase().includes(q),
    );
  }, [conversations, query]);

  useEffect(() => {
    filtersRef.current = { assigneeTab, statusFilter, sortMode, channelFilter };
  }, [assigneeTab, statusFilter, sortMode, channelFilter]);

  const fetchConversations = useCallback(async () => {
    try {
      const f = filtersRef.current;
      const params = new URLSearchParams({ limit: "30", sort: f.sortMode });
      if (f.statusFilter !== "ALL") params.set("status", f.statusFilter);
      if (f.assigneeTab === "mine") params.set("assigneeId", currentUserId);
      if (f.assigneeTab === "unassigned") params.set("unassigned", "true");
      if (f.assigneeTab === "mentions") params.set("mentions", "me");
      if (f.channelFilter !== "ALL") params.set("channelId", f.channelFilter);
      const res = await fetch(`${apiBase}/conversations?${params.toString()}`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: RealConversationItem[] };
      setConversations(body.items);
      setKnownChannels((prev) => {
        const seen = new Map(prev.map((c) => [c.id, c]));
        for (const item of body.items) seen.set(item.channel.id, item.channel);
        return [...seen.values()];
      });
    } catch {
      // Realtime/list refresh is best-effort; DB state re-syncs on next event.
    }
  }, [apiBase, currentUserId]);

  // Refetch when the list controls change.
  useEffect(() => {
    void fetchConversations();
  }, [assigneeTab, statusFilter, sortMode, channelFilter, fetchConversations]);

  const fetchCanned = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/canned-responses`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: CannedResponseView[] };
      setCannedItems(body.items);
    } catch {
      // best-effort
    }
  }, [apiBase]);

  useEffect(() => {
    // fetchCanned only setStates inside promise callbacks (async load).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCanned();
  }, [fetchCanned]);

  // Persist the composer draft per conversation (Chatwoot keeps
  // drafts across navigation); cleared automatically when sent.
  useEffect(() => {
    if (!selectedId) return;
    try {
      const all = readDrafts();
      if (draft.trim()) {
        all[selectedId] = { draft, mode: composerMode === "note" ? "note" : "reply" };
      } else {
        delete all[selectedId];
      }
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
    } catch {
      // storage unavailable — drafts just won't persist
    }
  }, [draft, composerMode, selectedId]);

  const fetchMessages = useCallback(
    async (conversationId: string) => {
      try {
        const res = await fetch(`${apiBase}/conversations/${conversationId}/messages?limit=100`);
        if (!res.ok) return;
        const body = (await res.json()) as { items: RealMessageItem[] };
        setMessagesByConversation((prev) => ({ ...prev, [conversationId]: body.items }));
      } catch {
        // best-effort
      }
    },
    [apiBase],
  );

  // ── Realtime ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/realtime/token");
        if (!res.ok) {
          setSocketStatus("disconnected");
          return;
        }
        const { token, socketUrl } = (await res.json()) as { token: string; socketUrl: string };
        if (cancelled) return;
        const socket = connectSocket(token, socketUrl);
        socket.on("connect", () => {
          setSocketStatus("connected");
          socket.emit("join:workspace", { workspaceId });
          const current = selectedIdRef.current;
          if (current) socket.emit("join:conversation", { workspaceId, conversationId: current });
          // Catch up on anything missed while the socket was down
          // (gateway sleep/redeploy): resync the list and the open
          // thread instead of waiting for the next live event.
          void fetchConversations();
          if (current) void fetchMessages(current);
        });
        socket.on("disconnect", () => setSocketStatus("disconnected"));
        socket.on("message.created", (payload: unknown) => {
          const event = payload as MessageCreatedPayload;
          if (event.message && event.conversationId) {
            const incoming = event.message;
            const conversationId = event.conversationId;
            setMessagesByConversation((prev) => {
              const existing = prev[conversationId];
              if (!existing || existing.some((m) => m.id === incoming.id)) return prev;
              return { ...prev, [conversationId]: [...existing, incoming] };
            });
          }
          void fetchConversations();
        });
        socket.on("message.status_updated", (payload: unknown) => {
          const event = payload as StatusUpdatedPayload;
          if (!event.conversationId || !event.messageId || !event.status) return;
          const { conversationId, messageId, status } = event;
          setMessagesByConversation((prev) => {
            const existing = prev[conversationId];
            if (!existing) return prev;
            return {
              ...prev,
              [conversationId]: existing.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      status,
                      externalMessageId: event.externalMessageId ?? m.externalMessageId,
                    }
                  : m,
              ),
            };
          });
        });
        socket.on("conversation.updated", () => void fetchConversations());
        socket.on("conversation.created", () => void fetchConversations());
        socket.on("message.deleted", (payload: unknown) => {
          const event = payload as { conversationId?: string; messageId?: string };
          const { conversationId, messageId } = event;
          if (!conversationId || !messageId) return;
          setMessagesByConversation((prev) => {
            const existing = prev[conversationId];
            if (!existing) return prev;
            return {
              ...prev,
              [conversationId]: existing.filter((m) => m.id !== messageId),
            };
          });
        });
        socket.on("conversation.deleted", (payload: unknown) => {
          const event = payload as { conversationId?: string };
          if (!event.conversationId) return;
          const deletedId = event.conversationId;
          setConversations((prev) => prev.filter((c) => c.id !== deletedId));
        });
      } catch {
        setSocketStatus("disconnected");
      }
    })();
    return () => {
      cancelled = true;
      disconnectSocket();
    };
  }, [workspaceId, fetchConversations, fetchMessages]);

  // Join the selected conversation's room + load its messages.
  useEffect(() => {
    if (!selected) return;
    if (!messagesByConversation[selected.id]) {
      // fetchMessages only setStates inside promise callbacks (async load).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchMessages(selected.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Previous conversations with the selected contact (sidebar panel).
  const [previousForId, setPreviousForId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/conversations/${selectedId}/previous`);
        if (!res.ok) return;
        const body = (await res.json()) as { items: RealConversationItem[] };
        if (!cancelled) {
          setPreviousConversations(body.items);
          setPreviousForId(selectedId);
        }
      } catch {
        // best-effort panel
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, apiBase]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    setMobileThread(true);
    // Restore this conversation's saved draft, if any.
    const saved = readDrafts()[id];
    setDraft(saved?.draft ?? "");
    setComposerMode(saved?.mode ?? "reply");
    // Reset the WhatsApp template composer for the new conversation.
    setTemplateSelection("");
    setTemplateParams([]);
    setTemplateOptInConfirmed(false);
    setTemplatesError(null);
    const conversation = conversations.find((c) => c.id === id);
    if (!conversation) {
      // Not in the current (filtered) list — e.g. opened from Previous
      // conversations. Load it and prepend so it can be selected.
      try {
        const res = await fetch(`${apiBase}/conversations/${id}`);
        if (res.ok) {
          const body = (await res.json()) as { conversation: RealConversationItem };
          setConversations((prev) => [
            body.conversation,
            ...prev.filter((c) => c.id !== id),
          ]);
        }
      } catch {
        // ignore — selection just won't change
      }
    }
    if (conversation && conversation.unreadCount > 0) {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      await fetch(`${apiBase}/conversations/${id}/read`, { method: "POST" }).catch(() => null);
    }
  }

  async function sendTemplate() {
    if (!selected || !selectedTemplate) return;
    const params = Array.from({ length: selectedTemplate.paramsCount }, (_, index) =>
      (templateParams[index] ?? "").trim(),
    );
    const previewText = renderTemplatePreview(selectedTemplate.bodyText, params);
    try {
      const res = await fetch(`${apiBase}/conversations/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language,
          templateParams: params,
          previewText,
          optInConfirmed: templateOptInConfirmed,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        message?: RealMessageItem;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.message) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const sent = body.message;
      setMessagesByConversation((prev) => {
        const existing = prev[selected.id] ?? [];
        if (existing.some((m) => m.id === sent.id)) return prev;
        return { ...prev, [selected.id]: [...existing, sent] };
      });
      setTemplateParams(Array.from({ length: selectedTemplate.paramsCount }, () => ""));
      setTemplateOptInConfirmed(false);
      void fetchConversations();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to send template");
    }
  }

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.length;
    const end = textarea?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      textarea?.focus();
      const position = start + emoji.length;
      textarea?.setSelectionRange(position, position);
    });
  }

  async function sendMedia() {
    if (!selected || !pendingFile) return;
    const file = pendingFile;
    const caption = draft.trim();
    setPendingFile(null);
    setDraft("");
    try {
      const form = new FormData();
      form.set("file", file);
      if (caption) form.set("caption", caption);
      const res = await fetch(`${apiBase}/conversations/${selected.id}/messages/media`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as {
        message?: RealMessageItem;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.message) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const sent = body.message;
      setMessagesByConversation((prev) => {
        const existing = prev[selected.id] ?? [];
        if (existing.some((m) => m.id === sent.id)) return prev;
        return { ...prev, [selected.id]: [...existing, sent] };
      });
      void fetchConversations();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to send the file");
      setPendingFile(file);
      setDraft(caption);
    }
  }

  async function send() {
    if (composerMode === "template") {
      await sendTemplate();
      return;
    }
    if (composerMode === "reply" && pendingFile) {
      await sendMedia();
      return;
    }
    const content = draft.trim();
    if (!content || !selected) return;
    setDraft("");
    try {
      const path =
        composerMode === "note"
          ? `${apiBase}/conversations/${selected.id}/notes`
          : `${apiBase}/conversations/${selected.id}/messages`;
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = (await res.json()) as { message: RealMessageItem };
      setMessagesByConversation((prev) => {
        const existing = prev[selected.id] ?? [];
        if (existing.some((m) => m.id === body.message.id)) return prev;
        return { ...prev, [selected.id]: [...existing, body.message] };
      });
      void fetchConversations();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to send");
      setDraft(content);
    }
  }

  async function changeStatus(action: "resolve" | "reopen") {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/${action}`, {
      method: "POST",
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { conversation: RealConversationItem };
      setConversations((prev) =>
        prev.map((c) => (c.id === body.conversation.id ? { ...c, ...body.conversation } : c)),
      );
    } else {
      setNotice(`Could not ${action} this conversation.`);
    }
  }

  async function assign(assigneeId: string | null) {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { conversation: RealConversationItem };
      setConversations((prev) =>
        prev.map((c) => (c.id === body.conversation.id ? { ...c, ...body.conversation } : c)),
      );
    } else {
      setNotice("Could not update the assignment.");
    }
  }

  async function addTag() {
    const name = tagInput.trim();
    if (!name || !selected) return;
    setTagInput("");
    const res = await fetch(`${apiBase}/conversations/${selected.id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { tags: Array<{ id: string; name: string }> };
      setConversations((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, tags: body.tags } : c)),
      );
    }
  }

  function startContactEdit() {
    if (!selected) return;
    setContactPhone(selected.contact.phone ?? "");
    setContactEmail(selected.contact.email ?? "");
    setContactError(null);
    setContactEditing(true);
  }

  async function saveContactDetails() {
    if (!selected) return;
    setContactSaving(true);
    setContactError(null);
    const res = await fetch(`${apiBase}/conversations/${selected.id}/contact`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: contactPhone, email: contactEmail }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as {
        contact: { phone: string | null; email: string | null };
      };
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selected.id
            ? { ...c, contact: { ...c.contact, phone: body.contact.phone, email: body.contact.email } }
            : c,
        ),
      );
      setContactEditing(false);
    } else {
      const body = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setContactError(body?.error?.message ?? "Could not save the customer details.");
    }
    setContactSaving(false);
  }

  async function removeTag(name: string) {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { tags: Array<{ id: string; name: string }> };
      setConversations((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, tags: body.tags } : c)),
      );
    }
  }

  async function setPriority(priority: ConversationPriority | null) {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/priority`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { conversation: RealConversationItem };
      setConversations((prev) =>
        prev.map((c) => (c.id === body.conversation.id ? { ...c, ...body.conversation } : c)),
      );
      void fetchMessages(selected.id);
    } else {
      setNotice("Could not update the priority.");
    }
  }

  async function snooze(until: Date | null) {
    if (!selected) return;
    const res = await fetch(`${apiBase}/conversations/${selected.id}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ until: until ? until.toISOString() : null }),
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { conversation: RealConversationItem };
      setConversations((prev) =>
        prev.map((c) => (c.id === body.conversation.id ? { ...c, ...body.conversation } : c)),
      );
      void fetchMessages(selected.id);
    } else {
      setNotice("Could not snooze this conversation.");
    }
  }

  async function deleteConversation() {
    if (!selected) return;
    const id = selected.id;
    const res = await fetch(`${apiBase}/conversations/${id}`, { method: "DELETE" }).catch(
      () => null,
    );
    setConfirmDeleteConversation(false);
    if (res?.ok) {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setSelectedId("");
    } else {
      setNotice("Could not delete this conversation.");
    }
  }

  async function deleteMessage(message: RealMessageItem) {
    const res = await fetch(
      `${apiBase}/conversations/${message.conversationId}/messages/${message.id}`,
      { method: "DELETE" },
    ).catch(() => null);
    setPendingDeleteMessage(null);
    if (res?.ok) {
      setMessagesByConversation((prev) => {
        const existing = prev[message.conversationId];
        if (!existing) return prev;
        return {
          ...prev,
          [message.conversationId]: existing.filter((m) => m.id !== message.id),
        };
      });
    } else {
      setNotice("Could not delete that message.");
    }
  }

  async function retryMessage(message: RealMessageItem) {
    const res = await fetch(
      `${apiBase}/conversations/${message.conversationId}/messages/${message.id}/retry`,
      { method: "POST" },
    ).catch(() => null);
    if (res?.ok) {
      setMessagesByConversation((prev) => {
        const existing = prev[message.conversationId];
        if (!existing) return prev;
        return {
          ...prev,
          [message.conversationId]: existing.map((m) =>
            m.id === message.id ? { ...m, status: "QUEUED" } : m,
          ),
        };
      });
    } else {
      const body = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setNotice(body?.error?.message ?? "Could not retry that message.");
    }
  }

  function copyMessage(message: RealMessageItem) {
    if (message.content) void navigator.clipboard.writeText(message.content).catch(() => null);
  }

  /** Canned picker: draft "/greet" → matching saved replies. */
  const cannedQuery =
    composerMode !== "template" && draft.startsWith("/")
      ? (draft.slice(1).split(/\s/)[0]?.toLowerCase() ?? "")
      : null;
  const cannedMatches =
    cannedQuery === null
      ? []
      : cannedItems
          .filter(
            (item) =>
              item.title.toLowerCase().includes(cannedQuery) ||
              (item.shortcut ?? "").toLowerCase().includes(cannedQuery),
          )
          .slice(0, 6);

  // Manager dialog (Phase 13A): distinct categories + search/category filter.
  const cannedCategories = Array.from(
    new Set(cannedItems.map((item) => item.category).filter((c): c is string => Boolean(c))),
  ).sort((a, b) => a.localeCompare(b));
  const cannedVisible = cannedItems.filter((item) => {
    if (cannedCategoryFilter && item.category !== cannedCategoryFilter) return false;
    const query = cannedSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      item.title.toLowerCase().includes(query) ||
      item.body.toLowerCase().includes(query) ||
      (item.shortcut ?? "").toLowerCase().includes(query) ||
      (item.category ?? "").toLowerCase().includes(query)
    );
  });

  async function runAi(action: string) {
    if (!selected || aiBusy) return;
    setAiBusy(action);
    setAiError(null);
    const payload: Record<string, unknown> = { action };
    if (action === "rewrite") {
      payload.text = draft;
      payload.tone = aiTone;
    }
    if (action === "translate") {
      const lastInbound = [...messages]
        .reverse()
        .find((m) => m.direction === "INBOUND" && m.content);
      payload.text = draft.trim() ? draft : (lastInbound?.content ?? "");
      payload.target = aiTarget;
    }
    const res = await fetch(`${apiBase}/conversations/${selected.id}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setAiBusy(null);
    if (!res) {
      setAiError("Could not reach the AI service.");
      return;
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      setAiError(
        (body?.error as { message?: string } | undefined)?.message ??
          "The AI request failed — try again.",
      );
      return;
    }
    setAiResult({ kind: action, ...(body ?? {}) });
  }

  function insertAiResult() {
    if (!aiResult?.text) return;
    setDraft(aiResult.text);
    setAiOpen(false);
    setAiResult(null);
    textareaRef.current?.focus();
  }

  function insertCanned(item: CannedResponseView) {
    if (!selected) return;
    const body = item.body.replace(/\{\{\s*contact\.name\s*\}\}/g, selected.contact.displayName);
    setDraft(body);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function resetCannedForm() {
    setCannedTitle("");
    setCannedShortcut("");
    setCannedBody("");
    setCannedCategory("");
    setCannedEditingId(null);
  }

  function startEditCanned(item: CannedResponseView) {
    setCannedEditingId(item.id);
    setCannedTitle(item.title);
    setCannedShortcut(item.shortcut ?? "");
    setCannedBody(item.body);
    setCannedCategory(item.category ?? "");
  }

  async function saveCanned() {
    const title = cannedTitle.trim();
    const body = cannedBody.trim();
    if (!title || !body) return;
    const res = cannedEditingId
      ? await fetch(`${apiBase}/canned-responses/${cannedEditingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // PATCH accepts nulls — they clear the field.
          body: JSON.stringify({
            title,
            body,
            shortcut: cannedShortcut.trim() ? cannedShortcut.trim() : null,
            category: cannedCategory.trim() ? cannedCategory.trim() : null,
          }),
        }).catch(() => null)
      : await fetch(`${apiBase}/canned-responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body,
            ...(cannedShortcut.trim() ? { shortcut: cannedShortcut.trim() } : {}),
            ...(cannedCategory.trim() ? { category: cannedCategory.trim() } : {}),
          }),
        }).catch(() => null);
    if (res?.ok) {
      resetCannedForm();
      void fetchCanned();
    } else {
      setNotice("Could not save that canned response.");
    }
  }

  async function deleteCanned(id: string) {
    const res = await fetch(`${apiBase}/canned-responses/${id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (res?.ok) void fetchCanned();
  }

  // Keyboard shortcuts (Chatwoot-style): Alt+J / Alt+K move through
  // the list, Alt+E resolves or reopens the open conversation.
  const navRef = useRef({ visible, selected, changeStatus, selectConversation });
  useEffect(() => {
    navRef.current = { visible, selected, changeStatus, selectConversation };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.altKey) return;
      const nav = navRef.current;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        if (!nav.selected || nav.visible.length === 0) return;
        const index = nav.visible.findIndex((c) => c.id === nav.selected?.id);
        const next = event.key === "j" ? nav.visible[index + 1] : nav.visible[index - 1];
        if (next) void nav.selectConversation(next.id);
      }
      if (event.key === "e") {
        event.preventDefault();
        if (!nav.selected) return;
        void nav.changeStatus(nav.selected.status === "RESOLVED" ? "reopen" : "resolve");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full">
      {/* ─── LEFT: conversation list ─────────────────────────────────── */}
      <section
        className={cn(
          "bg-card w-full shrink-0 flex-col border-r md:flex md:w-[22.5rem]",
          mobileThread ? "hidden" : "flex",
        )}
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h2 className="text-lg font-semibold tracking-tight">Inbox</h2>
          <span
            className="flex items-center gap-1.5 text-xs"
            title={`Realtime: ${socketStatus}`}
            aria-label={`Realtime status: ${socketStatus}`}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                socketStatus === "connected"
                  ? "bg-emerald-500"
                  : socketStatus === "connecting"
                    ? "bg-amber-400"
                    : "bg-zinc-300",
              )}
            />
            <span className="text-muted-foreground">
              {socketStatus === "connected"
                ? "Live"
                : socketStatus === "connecting"
                  ? "Connecting…"
                  : "Offline"}
            </span>
          </span>
        </div>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search conversations"
              className="rounded-full border-transparent bg-muted/70 pl-9 focus-visible:bg-card"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search conversations"
            />
          </div>
        </div>
        <div className="space-y-2.5 px-4 pb-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {STATUS_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                aria-pressed={statusFilter === chip.value}
                onClick={() => setStatusFilter(chip.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  statusFilter === chip.value
                    ? chip.activeClass
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger
                className="h-9 min-w-0 flex-1 gap-1.5 rounded-full bg-card px-3.5 text-xs [&>span]:truncate"
                aria-label="Sort conversations"
              >
                <ArrowUpDown className="text-muted-foreground size-3.5 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">Latest activity</SelectItem>
                <SelectItem value="waiting">Waiting longest</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
              </SelectContent>
            </Select>
            {knownChannels.length > 1 ? (
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger
                  className="h-9 min-w-0 flex-1 gap-1.5 rounded-full bg-card px-3.5 text-xs [&>span]:truncate"
                  aria-label="Filter by channel"
                >
                  <ListFilter className="text-muted-foreground size-3.5 shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All channels</SelectItem>
                  {knownChannels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-1.5 px-3 pb-3">
            {visible.map((conversation) => {
              const isActive = selected?.id === conversation.id;
              return (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      "relative flex w-full cursor-pointer gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-muted/70",
                      isActive && "bg-accent hover:bg-accent",
                    )}
                    onClick={() => void selectConversation(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void selectConversation(conversation.id);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Conversation with ${conversation.contact.displayName}`}
                  >
                    <AvatarWithBadge
                      name={conversation.contact.displayName}
                      image={conversation.contact.avatarUrl}
                      provider={conversation.channel.provider}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            conversation.unreadCount > 0 ? "font-semibold" : "font-medium",
                          )}
                        >
                          {conversation.contact.displayName}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-[11px]">
                          {formatListTime(conversation.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-xs",
                            conversation.unreadCount > 0
                              ? "text-foreground font-medium"
                              : "text-muted-foreground",
                          )}
                        >
                          {conversation.preview ?? "No messages yet"}
                        </span>
                        {conversation.unreadCount > 0 ? (
                          <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                            {conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        {conversation.priority ? (
                          <span
                            className={cn(
                              "inline-flex items-center",
                              PRIORITY_META[conversation.priority].className,
                            )}
                            title={`Priority: ${PRIORITY_META[conversation.priority].label}`}
                          >
                            <Flag className="size-3 fill-current" />
                          </span>
                        ) : null}
                        <Badge variant="muted" className="px-1.5 text-[10px]">
                          {conversation.status}
                        </Badge>
                        <Badge variant="muted" className="px-1.5 text-[10px]">
                          {PROVIDER_META[conversation.channel.provider].label}
                        </Badge>
                        {conversation.awaitingReply && conversation.status === "OPEN" ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600">
                            <AlarmClock className="size-3" /> Waiting{" "}
                            {formatWaiting(conversation.lastMessageAt)}
                          </span>
                        ) : null}
                        {conversation.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag.id} variant="outline" className="px-1.5 text-[10px]">
                            {tag.name}
                          </Badge>
                        ))}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="text-muted-foreground px-3 py-10 text-center text-sm">
                No conversations match this search.
              </li>
            ) : null}
          </ul>
        </ScrollArea>
      </section>

      {/* ─── MIDDLE: thread ──────────────────────────────────────────── */}
      <section
        className={cn("min-w-0 flex-1 flex-col", mobileThread ? "flex" : "hidden md:flex")}
        aria-label="Conversation thread"
      >
        {selected ? (
          <>
            <div className="bg-card flex h-16 shrink-0 items-center gap-3 border-b px-4">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 md:hidden"
                aria-label="Back to conversation list"
                onClick={() => setMobileThread(false)}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <AvatarWithBadge
                name={selected.contact.displayName}
                image={selected.contact.avatarUrl}
                provider={selected.channel.provider}
              />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[15px] font-bold">{selected.contact.displayName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  via {PROVIDER_META[selected.channel.provider].label}
                  {selected.contact.phone ? ` · ${selected.contact.phone}` : ""} ·{" "}
                  {selected.status}
                </p>
              </div>
              {selected.status === "OPEN" || selected.status === "PENDING" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20"
                    >
                      <AlarmClock className="size-3.5" /> Snooze
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => void snooze(new Date(Date.now() + 60 * 60 * 1000))}
                    >
                      For 1 hour
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => void snooze(new Date(Date.now() + 24 * 60 * 60 * 1000))}
                    >
                      Until tomorrow
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => void snooze(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))}
                    >
                      Until next week
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void snooze(null)}>
                      Until next reply
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {selected.status === "RESOLVED" || selected.status === "SNOOZED" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:bg-sky-500/20"
                  onClick={() => void changeStatus("reopen")}
                >
                  {selected.status === "SNOOZED" ? "Unsnooze" : "Reopen"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="rounded-full border border-amber-300 bg-amber-100 font-semibold text-amber-900 hover:bg-amber-200 hover:text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25"
                  onClick={() => void changeStatus("resolve")}
                >
                  <Check className="size-3.5" /> Resolve
                </Button>
              )}
              <Button
                size="sm"
                className="rounded-full bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
                onClick={() => textareaRef.current?.focus()}
              >
                <Reply className="size-3.5" /> Reply
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-full" aria-label="More actions">
                    <MoreHorizontal className="size-4" /> More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-red-600"
                    onSelect={() => setConfirmDeleteConversation(true)}
                  >
                    <Trash2 className="size-4" /> Delete conversation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex w-full flex-col gap-4 px-4 py-5">
                {messages.map((message, index) => {
                  const previousMessage = messages[index - 1];
                  const showDayDivider =
                    !previousMessage ||
                    !isSameDay(new Date(previousMessage.createdAt), new Date(message.createdAt));
                  const node =
                    message.messageType === "SYSTEM" || message.senderType === "SYSTEM" ? (
                    <div key={message.id} className="flex justify-center">
                      <p className="text-muted-foreground max-w-[85%] text-center text-xs">
                        {message.content} · {formatMessageTime(message.createdAt)}
                      </p>
                    </div>
                  ) : message.isPrivateNote ? (
                    <div key={message.id} className="flex justify-center">
                      <div className="group relative w-full max-w-[85%] rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                        <MessageActions
                          message={message}
                          side="left"
                          onCopy={() => copyMessage(message)}
                          onDelete={() => setPendingDeleteMessage(message)}
                        />
                        <p className="flex items-center gap-1.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                          <Lock className="size-3" /> Private note ·{" "}
                          {formatMessageTime(message.createdAt)}
                        </p>
                        {message.content}
                      </div>
                    </div>
                  ) : message.direction === "INBOUND" ? (
                    <div key={message.id} className="flex items-end gap-2">
                      <AvatarWithBadge
                        name={selected.contact.displayName}
                        image={selected.contact.avatarUrl}
                        size="sm"
                      />
                      <div className="group relative max-w-[75%]">
                        <MessageActions
                          message={message}
                          side="right"
                          onCopy={() => copyMessage(message)}
                        />
                        <div className="bg-card rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap">
                          <MessageAttachments workspaceId={workspaceId} message={message} />
                          {message.content}
                        </div>
                        <p className="text-muted-foreground mt-1 pl-1 text-[11px]">
                          {formatMessageTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div key={message.id} className="flex flex-col items-end">
                      <div className="group relative max-w-[75%]">
                        <MessageActions
                          message={message}
                          side="left"
                          onCopy={() => copyMessage(message)}
                          onRetry={
                            message.status === "FAILED"
                              ? () => void retryMessage(message)
                              : undefined
                          }
                          onDelete={() => setPendingDeleteMessage(message)}
                        />
                        <div className="rounded-2xl rounded-br-md bg-indigo-100 px-3.5 py-2.5 text-sm text-indigo-950 dark:bg-indigo-500/20 dark:text-indigo-50">
                          {message.messageType === "TEMPLATE" ? (
                            <span className="mb-1 inline-flex items-center gap-1 rounded bg-indigo-200/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase dark:bg-indigo-400/20">
                              <FileText className="size-3" /> Template
                            </span>
                          ) : null}
                          <MessageAttachments workspaceId={workspaceId} message={message} />
                          <div className="break-words whitespace-pre-wrap">{message.content}</div>
                        </div>
                        <p className="text-muted-foreground mt-1 flex items-center justify-end gap-1 pr-1 text-[11px]">
                          {formatMessageTime(message.createdAt)} · {message.status.toLowerCase()}
                          {message.status === "READ" || message.status === "DELIVERED" ? (
                            <CheckCheck className="size-3.5 text-indigo-500" />
                          ) : null}
                        </p>
                        {message.status === "FAILED" && messageErrorText(message) ? (
                          <p className="mt-0.5 max-w-full pr-1 text-right text-[11px] text-red-600">
                            {messageErrorText(message)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                  return (
                    <Fragment key={message.id}>
                      {showDayDivider ? (
                        <div className="flex justify-center">
                          <span className="bg-card text-muted-foreground rounded-full border px-3 py-1 text-[11px] font-medium">
                            {formatDayLabel(message.createdAt)}
                          </span>
                        </div>
                      ) : null}
                      {node}
                    </Fragment>
                  );
                })}
                {messages.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    No messages in this conversation yet.
                  </p>
                ) : null}
                <div ref={threadEndRef} aria-hidden="true" />
              </div>
            </ScrollArea>

            <div className="shrink-0 px-4 pt-1 pb-4">
              <div className="w-full">
                {isWhatsApp && composerMode === "reply" && whatsappWindowClosed ? (
                  <p className="mb-2 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    The 24-hour WhatsApp window is closed — free-form replies will fail. Switch to
                    Template mode to message this customer.
                  </p>
                ) : null}
                <div
                  className={cn(
                    "relative rounded-2xl border bg-card focus-within:ring-ring/40 focus-within:ring-[3px]",
                    composerMode === "note" && "border-amber-300 bg-amber-50/50",
                  )}
                >
                  {aiOpen && composerMode === "reply" ? (
                    <div className="bg-background absolute bottom-full left-2 z-10 mb-2 w-96 max-w-[calc(100vw-2rem)] rounded-xl border p-3 shadow-lg">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-fuchsia-600" />
                        <p className="text-sm font-medium">AI assistant</p>
                        <span className="text-muted-foreground text-[11px]">
                          Drafts only — nothing sends without you
                        </span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground ml-auto"
                          aria-label="Close AI assistant"
                          onClick={() => setAiOpen(false)}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      {!data.aiConfigured ? (
                        <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
                          AI is not configured yet. Add a free Groq API key as{" "}
                          <span className="font-mono">AI_API_KEY</span> in the Vercel project env
                          and redeploy — steps are in Settings → AI assistant &amp; knowledge
                          base.
                        </p>
                      ) : (
                        <>
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={aiBusy !== null}
                              onClick={() => void runAi("suggest")}
                            >
                              Suggest reply
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={aiBusy !== null || !draft.trim()}
                              title={draft.trim() ? "Rewrite your draft" : "Write a draft first"}
                              onClick={() => void runAi("rewrite")}
                            >
                              Rewrite
                            </Button>
                            <select
                              value={aiTone}
                              onChange={(event) => setAiTone(event.target.value)}
                              aria-label="Rewrite tone"
                              className="border-input bg-background h-8 rounded-md border px-1.5 text-xs"
                            >
                              <option value="professional">Professional</option>
                              <option value="friendly">Friendly</option>
                              <option value="shorter">Shorter</option>
                              <option value="empathetic">Empathetic</option>
                            </select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={aiBusy !== null}
                              onClick={() => void runAi("summarize")}
                            >
                              Summarize
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={aiBusy !== null}
                              onClick={() => void runAi("sentiment")}
                            >
                              Sentiment
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={aiBusy !== null}
                              onClick={() => void runAi("translate")}
                            >
                              Translate
                            </Button>
                            <select
                              value={aiTarget}
                              onChange={(event) => setAiTarget(event.target.value)}
                              aria-label="Translate into"
                              className="border-input bg-background h-8 rounded-md border px-1.5 text-xs"
                            >
                              <option>English</option>
                              <option>Nepali</option>
                              <option>Hindi</option>
                              <option>Spanish</option>
                              <option>French</option>
                              <option>German</option>
                              <option>Arabic</option>
                              <option>Chinese</option>
                            </select>
                          </div>
                          <p className="text-muted-foreground mt-1.5 text-[11px]">
                            Translate uses your draft, or the customer&apos;s last message when
                            the box is empty.
                          </p>
                          {aiBusy ? (
                            <p className="text-muted-foreground mt-2 flex items-center gap-2 text-[13px]">
                              <Loader2 className="size-3.5 animate-spin" /> Thinking…
                            </p>
                          ) : null}
                          {aiError ? (
                            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[13px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                              {aiError}
                            </p>
                          ) : null}
                          {aiResult?.kind === "sentiment" ? (
                            <div className="mt-2 flex items-center gap-2 text-[13px]">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                                  aiResult.sentiment === "positive" &&
                                    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                                  aiResult.sentiment === "negative" &&
                                    "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
                                  aiResult.sentiment === "neutral" &&
                                    "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
                                )}
                              >
                                {aiResult.sentiment}
                              </span>
                              <span className="text-muted-foreground">{aiResult.reason}</span>
                            </div>
                          ) : aiResult?.text ? (
                            <div className="mt-2">
                              <div className="bg-muted/50 max-h-44 overflow-y-auto rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
                                {aiResult.text}
                              </div>
                              {aiResult.knowledgeUsed?.length ? (
                                <p className="text-muted-foreground mt-1 text-[11px]">
                                  Used knowledge: {aiResult.knowledgeUsed.join(", ")}
                                </p>
                              ) : null}
                              {aiResult.products?.length ? (
                                <p className="text-muted-foreground mt-1 text-[11px]">
                                  Live from your store:{" "}
                                  {aiResult.products.map((product) => product.name).join(", ")}
                                </p>
                              ) : null}
                              {aiResult.kind !== "summarize" ? (
                                <div className="mt-2 flex justify-end">
                                  <Button size="sm" onClick={insertAiResult}>
                                    Insert into composer
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                  {emojiOpen && composerMode !== "template" ? (
                    <div className="bg-background absolute bottom-full left-2 z-10 mb-2 w-72 rounded-xl border p-2 shadow-lg">
                      <div className="grid grid-cols-8 gap-0.5">
                        {COMPOSER_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="rounded-md p-1 text-lg leading-none hover:bg-accent"
                            onClick={() => insertEmoji(emoji)}
                            aria-label={`Insert emoji ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {cannedMatches.length > 0 ? (
                    <div className="bg-background absolute bottom-full left-2 z-10 mb-2 w-80 rounded-xl border p-1.5 shadow-lg">
                      <p className="text-muted-foreground px-2 py-1 text-[11px] font-medium tracking-wide uppercase">
                        Saved replies — Enter inserts the first
                      </p>
                      {cannedMatches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="hover:bg-accent flex w-full flex-col rounded-md px-2 py-1.5 text-left"
                          onClick={() => insertCanned(item)}
                        >
                          <span className="text-sm font-medium">
                            {item.title}
                            {item.shortcut ? (
                              <span className="text-muted-foreground ml-1.5 text-xs">
                                /{item.shortcut}
                              </span>
                            ) : null}
                            {item.category ? (
                              <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                                {item.category}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground line-clamp-2 text-xs">
                            {item.body}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1 px-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setComposerMode("reply")}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium",
                        composerMode === "reply"
                          ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-100"
                          : "text-muted-foreground hover:text-indigo-700",
                      )}
                    >
                      <Send className="size-3.5" /> Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposerMode("note")}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium",
                        composerMode === "note"
                          ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100"
                          : "text-muted-foreground hover:text-amber-700",
                      )}
                    >
                      <StickyNote className="size-3.5" /> Private note
                    </button>
                    {isWhatsApp ? (
                      <button
                        type="button"
                        onClick={() => setComposerMode("template")}
                        className={cn(
                          "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium",
                          composerMode === "template"
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100"
                            : "text-muted-foreground hover:text-emerald-700",
                        )}
                      >
                        <FileText className="size-3.5" /> Template
                      </button>
                    ) : null}
                  </div>
                  {composerMode === "template" ? (
                    <div className="flex flex-col gap-2 px-3 py-2">
                      {templatesLoading ? (
                        <p className="text-muted-foreground text-sm">Loading templates…</p>
                      ) : templatesError ? (
                        <p className="text-sm text-red-600">{templatesError}</p>
                      ) : (channelTemplates ?? []).length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          No APPROVED templates were returned for this WhatsApp account. Create and
                          approve templates in WhatsApp Manager first.
                        </p>
                      ) : (
                        <>
                          <Select
                            value={templateSelection}
                            onValueChange={(value) => {
                              setTemplateSelection(value);
                              const template = (channelTemplates ?? []).find(
                                (t) => `${t.name}|${t.language}` === value,
                              );
                              setTemplateParams(
                                Array.from({ length: template?.paramsCount ?? 0 }, () => ""),
                              );
                            }}
                          >
                            <SelectTrigger aria-label="WhatsApp template">
                              <SelectValue placeholder="Choose a template" />
                            </SelectTrigger>
                            <SelectContent>
                              {(channelTemplates ?? []).map((template) => (
                                <SelectItem
                                  key={`${template.name}|${template.language}`}
                                  value={`${template.name}|${template.language}`}
                                >
                                  {template.name} ({template.language})
                                  {template.category ? ` · ${template.category}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {selectedTemplate ? (
                            <>
                              <div className="bg-muted/60 rounded-md px-3 py-2 text-sm whitespace-pre-wrap">
                                {renderTemplatePreview(selectedTemplate.bodyText, templateParams) ||
                                  "(this template has no body text)"}
                              </div>
                              {Array.from({ length: selectedTemplate.paramsCount }, (_, index) => (
                                <Input
                                  key={index}
                                  value={templateParams[index] ?? ""}
                                  onChange={(event) =>
                                    setTemplateParams((prev) =>
                                      prev.map((value, i) =>
                                        i === index ? event.target.value : value,
                                      ),
                                    )
                                  }
                                  placeholder={`Value for {{${index + 1}}}`}
                                  aria-label={`Template parameter ${index + 1}`}
                                  className="h-8"
                                />
                              ))}
                              <label className="flex cursor-pointer items-start gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={templateOptInConfirmed}
                                  onChange={(event) =>
                                    setTemplateOptInConfirmed(event.target.checked)
                                  }
                                  className="mt-0.5"
                                />
                                The customer has opted in to receive WhatsApp messages from this
                                business.
                              </label>
                            </>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                  {composerMode !== "template" ? (
                  <Textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        // With the saved-replies picker open, Enter
                        // inserts the top match instead of sending.
                        const firstCanned = cannedMatches[0];
                        if (firstCanned) {
                          insertCanned(firstCanned);
                          return;
                        }
                        void send();
                      }
                    }}
                    placeholder={
                      composerMode === "note"
                        ? "Write an internal note — only your team can see this…"
                        : `Reply to ${selected.contact.displayName}…`
                    }
                    aria-label="Message composer"
                    className="min-h-11 resize-none border-0 shadow-none focus-visible:ring-0"
                    rows={2}
                  />
                  ) : null}
                  {composerMode === "reply" ? (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*,video/mp4,audio/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
                        onChange={(event) => {
                          setPendingFile(event.target.files?.[0] ?? null);
                          event.target.value = "";
                        }}
                      />
                      {pendingFile ? (
                        <div className="px-3 pb-1">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-100">
                            <Paperclip className="size-3 shrink-0" />
                            <span className="max-w-56 truncate">{pendingFile.name}</span>
                            <span>· {formatFileSize(pendingFile.size)}</span>
                            <button
                              type="button"
                              aria-label="Remove attachment"
                              onClick={() => setPendingFile(null)}
                            >
                              <X className="size-3.5" />
                            </button>
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex items-center px-2 pb-2">
                    {composerMode === "reply" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
                        aria-label="Attach a file"
                        title="Attach an image or file (max 16 MB)"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="size-4" />
                      </Button>
                    ) : null}
                    {composerMode !== "template" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-500/15 dark:hover:text-amber-300"
                        aria-label="Insert emoji"
                        title="Insert emoji"
                        onClick={() => setEmojiOpen((open) => !open)}
                      >
                        <Smile className="size-4" />
                      </Button>
                    ) : null}
                    {composerMode !== "template" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-500/15 dark:hover:text-violet-300"
                        aria-label="Saved replies"
                        title="Saved replies — or type / in the message box"
                        onClick={() => setCannedManageOpen(true)}
                      >
                        <Bookmark className="size-4" />
                      </Button>
                    ) : null}
                    {composerMode === "reply" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 hover:bg-fuchsia-50 hover:text-fuchsia-600 dark:hover:bg-fuchsia-500/15 dark:hover:text-fuchsia-300"
                        aria-label="AI assistant"
                        title="AI assistant — suggest, rewrite, summarize, translate"
                        onClick={() => setAiOpen((open) => !open)}
                      >
                        <Sparkles className="size-4" />
                      </Button>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {composerMode === "note"
                        ? "Notes are never sent to the customer."
                        : composerMode === "template"
                          ? "Templates can be sent outside the 24-hour window."
                          : `Sending as ${currentUserName}`}
                    </span>
                    <Button
                      className={cn(
                        "ml-auto rounded-full px-4 text-white",
                        composerMode === "note"
                          ? "bg-amber-500 hover:bg-amber-600"
                          : composerMode === "template"
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : "bg-indigo-600 hover:bg-indigo-700",
                      )}
                      onClick={() => void send()}
                      disabled={
                        composerMode === "template"
                          ? !selectedTemplate ||
                            !templateOptInConfirmed ||
                            Array.from({ length: selectedTemplate.paramsCount }, (_, index) =>
                              (templateParams[index] ?? "").trim(),
                            ).some((value) => !value)
                          : !draft.trim() && !pendingFile
                      }
                    >
                      {composerMode === "note"
                        ? "Add note"
                        : composerMode === "template"
                          ? "Send template"
                          : "Send"}
                      <Send className="size-4" />
                    </Button>
                  </div>
                </div>
                {notice ? <p className="mt-2 text-xs text-red-600">{notice}</p> : null}
              </div>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground p-6 text-sm">Select a conversation.</p>
        )}
      </section>

      {/* ─── RIGHT: contact panel ────────────────────────────────────── */}
      {selected ? (
        <aside
          className="bg-card hidden w-[330px] shrink-0 overflow-y-auto border-l xl:block"
          aria-label="Contact details"
        >
          <div className="flex flex-col items-center gap-1.5 px-4 pt-6 pb-4 text-center">
            <AvatarWithBadge
              name={selected.contact.displayName}
              image={selected.contact.avatarUrl}
              provider={selected.channel.provider}
              size="lg"
            />
            <p className="text-base font-bold">{selected.contact.displayName}</p>
            {selected.contact.phone ? (
              <p className="text-muted-foreground text-xs">{selected.contact.phone}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              via {PROVIDER_META[selected.channel.provider].label}
            </p>
          </div>

          <div className="space-y-5 px-4 pb-6">
            <section>
              <h3 className="pb-2 text-xs font-semibold tracking-wide uppercase">Conversation</h3>
              <label className="text-muted-foreground block pb-1 text-xs">Priority</label>
              <Select
                value={selected.priority ?? "none"}
                onValueChange={(value) =>
                  void setPriority(value === "none" ? null : (value as ConversationPriority))
                }
              >
                <SelectTrigger aria-label="Set priority" className="rounded-xl border-transparent bg-muted/60">
                  <SelectValue placeholder="No priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No priority</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
              {selected.status === "SNOOZED" ? (
                <p className="text-muted-foreground pt-2 text-xs">
                  Snoozed{" "}
                  {selected.snoozedUntil
                    ? `until ${new Date(selected.snoozedUntil).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : "until the next reply"}
                  . A customer reply reopens it automatically.
                </p>
              ) : null}
            </section>

            <section>
              <h3 className="pb-2 text-xs font-semibold tracking-wide uppercase">Assignment</h3>
              <Select
                value={selected.assignee?.id ?? "unassigned"}
                onValueChange={(value) => void assign(value === "unassigned" ? null : value)}
              >
                <SelectTrigger aria-label="Assign conversation" className="rounded-xl border-transparent bg-muted/60">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {data.members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                      {member.id === currentUserId ? " (you)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full rounded-full border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 hover:text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
                onClick={() => void assign(currentUserId)}
              >
                Assign to me
              </Button>
            </section>

            <section>
              <h3 className="flex items-center gap-1.5 pb-2 text-xs font-semibold tracking-wide uppercase">
                <TagIcon className="size-3.5" /> Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {selected.tags.map((tag) => (
                  <Badge key={tag.id} variant="secondary" className="gap-1 rounded-full pr-1">
                    {tag.name}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag.name}`}
                      onClick={() => void removeTag(tag.name)}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
                {selected.tags.length === 0 ? (
                  <span className="text-muted-foreground text-xs">No tags yet.</span>
                ) : null}
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addTag();
                    }
                  }}
                  placeholder="Add a tag…"
                  aria-label="Add a tag"
                  className="h-8 rounded-full px-3.5"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 hover:text-indigo-900 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20"
                  onClick={() => void addTag()}
                  disabled={!tagInput.trim()}
                >
                  Add
                </Button>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between pb-2">
                <h3 className="text-xs font-semibold tracking-wide uppercase">Customer details</h3>
                {!contactEditing ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-500/15"
                    onClick={startContactEdit}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
              {contactEditing ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="contact-phone" className="text-muted-foreground text-xs">
                      Phone
                    </label>
                    <Input
                      id="contact-phone"
                      value={contactPhone}
                      onChange={(event) => setContactPhone(event.target.value)}
                      placeholder="e.g. +977 970-0000000"
                      className="h-8"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="contact-email" className="text-muted-foreground text-xs">
                      Email
                    </label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={contactEmail}
                      onChange={(event) => setContactEmail(event.target.value)}
                      placeholder="customer@example.com"
                      className="h-8"
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Saved to this contact for all their conversations. Leave a field empty to
                    clear it. WhatsApp fills the phone automatically; Messenger shares neither
                    phone nor email.
                  </p>
                  {contactError ? <p className="text-xs text-red-600">{contactError}</p> : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void saveContactDetails()}
                      disabled={contactSaving}
                    >
                      {contactSaving ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setContactEditing(false)}
                      disabled={contactSaving}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd className="rounded-md bg-muted/60 px-2 py-0.5 font-medium">
                      {selected.contact.phone ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="truncate rounded-md bg-muted/60 px-2 py-0.5 font-medium">
                      {selected.contact.email ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Channel</dt>
                    <dd className="rounded-md bg-muted/60 px-2 py-0.5 font-medium">
                      {PROVIDER_META[selected.channel.provider].shortLabel}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <Badge variant="muted" className="rounded-full px-2">
                        {selected.status}
                      </Badge>
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            {previousForId === selected.id && previousConversations.length > 0 ? (
              <section>
                <h3 className="pb-2 text-xs font-semibold tracking-wide uppercase">
                  Previous conversations
                </h3>
                <div className="flex flex-col gap-1.5">
                  {previousConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => void selectConversation(conversation.id)}
                      className="hover:bg-accent rounded-lg border px-2.5 py-2 text-left"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">
                          {PROVIDER_META[conversation.channel.provider].label}
                        </span>
                        <Badge variant="muted" className="px-1.5 text-[10px]">
                          {conversation.status}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                        {conversation.preview ?? "No messages"}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {formatListTime(conversation.lastMessageAt)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* Delete message confirmation */}
      <Dialog
        open={pendingDeleteMessage !== null}
        onOpenChange={(open) => !open && setPendingDeleteMessage(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>
              It will be removed from this inbox only. If it was already delivered to the
              customer&apos;s app, they will still have their copy — this cannot unsend it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteMessage(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDeleteMessage && void deleteMessage(pendingDeleteMessage)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete conversation confirmation */}
      <Dialog open={confirmDeleteConversation} onOpenChange={setConfirmDeleteConversation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              The conversation and all its messages will be permanently deleted from this
              workspace. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteConversation(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteConversation()}>
              Delete conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Saved replies manager */}
      <Dialog
        open={cannedManageOpen}
        onOpenChange={(open) => {
          setCannedManageOpen(open);
          if (!open) {
            resetCannedForm();
            setCannedSearch("");
            setCannedCategoryFilter(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Saved replies</DialogTitle>
            <DialogDescription>
              Shared with the whole workspace. In the message box, type / to insert one. Use{" "}
              {"{{contact.name}}"} for the customer&apos;s name.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={cannedSearch}
                onChange={(event) => setCannedSearch(event.target.value)}
                placeholder="Search saved replies…"
                aria-label="Search saved replies"
                className="pl-8"
              />
            </div>
            {cannedCategories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setCannedCategoryFilter(null)}
                  className={
                    cannedCategoryFilter === null
                      ? "rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-xs font-medium"
                  }
                >
                  All
                </button>
                {cannedCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() =>
                      setCannedCategoryFilter(cannedCategoryFilter === category ? null : category)
                    }
                    className={
                      cannedCategoryFilter === category
                        ? "rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                        : "bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-xs font-medium"
                    }
                  >
                    {category}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {cannedVisible.map((item) => (
              <div key={item.id} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {item.title}
                    {item.shortcut ? (
                      <span className="text-muted-foreground ml-1.5 text-xs">/{item.shortcut}</span>
                    ) : null}
                    {item.category ? (
                      <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                        {item.category}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground line-clamp-2 text-xs">{item.body}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground size-7 shrink-0"
                  aria-label={`Edit saved reply ${item.title}`}
                  onClick={() => startEditCanned(item)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-red-600"
                  aria-label={`Delete saved reply ${item.title}`}
                  onClick={() => void deleteCanned(item.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {cannedVisible.length === 0 ? (
              <p className="text-muted-foreground py-3 text-center text-sm">
                {cannedItems.length === 0
                  ? "No saved replies yet. Add your first one below."
                  : "No saved replies match your search."}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 border-t pt-3">
            <div className="flex gap-2">
              <Input
                value={cannedTitle}
                onChange={(event) => setCannedTitle(event.target.value)}
                placeholder="Title, e.g. Greeting"
                aria-label="Saved reply title"
              />
              <Input
                value={cannedShortcut}
                onChange={(event) => setCannedShortcut(event.target.value)}
                placeholder="Shortcut"
                aria-label="Saved reply shortcut"
                className="w-32"
              />
            </div>
            <Input
              value={cannedCategory}
              onChange={(event) => setCannedCategory(event.target.value)}
              placeholder="Category (optional), e.g. Billing"
              aria-label="Saved reply category"
              list="canned-category-options"
            />
            <datalist id="canned-category-options">
              {cannedCategories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <Textarea
              value={cannedBody}
              onChange={(event) => setCannedBody(event.target.value)}
              placeholder="Reply text…"
              aria-label="Saved reply text"
              rows={3}
            />
            <div className="flex items-center justify-end gap-2">
              {cannedEditingId ? (
                <Button variant="ghost" onClick={() => resetCannedForm()}>
                  Cancel edit
                </Button>
              ) : null}
              <Button
                onClick={() => void saveCanned()}
                disabled={!cannedTitle.trim() || !cannedBody.trim()}
              >
                {cannedEditingId ? "Save changes" : "Add saved reply"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
