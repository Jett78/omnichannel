"use client";

import { Paperclip, SendHorizonal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The visitor-facing chat panel (Phase 11), rendered inside an
 * iframe on the customer's website. Flow: load the public config →
 * (optional pre-chat form) → start a conversation, which returns a
 * signed visitor token kept in localStorage so returning visitors
 * continue the same conversation → poll the message list every
 * 2.5 s (the agent side of the product is fully realtime; the
 * visitor side polls — a deliberate v1 trade-off).
 */

interface WidgetConfig {
  displayName: string;
  widgetColor: string;
  welcomeTitle: string;
  welcomeTagline: string;
  preChatForm: boolean;
}

interface WidgetAttachment {
  fileName: string | null;
  mimeType: string | null;
  url: string;
}

interface WidgetMessage {
  id: string;
  fromVisitor: boolean;
  type: string;
  body: string | null;
  createdAt: string;
  attachments: WidgetAttachment[];
}

const POLL_MS = 2500;

export function WidgetChat({ websiteToken }: { websiteToken: string }) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [needsPreChat, setNeedsPreChat] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `uoi.widget.visitor.${websiteToken}`;

  const loadMessages = useCallback(
    async (token: string) => {
      try {
        const res = await fetch(`/api/widget/${websiteToken}/messages`, {
          headers: { "x-visitor-token": token },
        });
        if (!res.ok) return;
        const body = (await res.json()) as { messages: WidgetMessage[] };
        setMessages(body.messages);
      } catch {
        // Transient network failure — the next poll retries.
      }
    },
    [websiteToken],
  );

  // Initial load: config + any stored visitor token.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/widget/${websiteToken}`);
        if (!res.ok) throw new Error("unavailable");
        const body = (await res.json()) as { config: WidgetConfig };
        if (cancelled) return;
        setConfig(body.config);
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          setVisitorToken(stored);
          void loadMessages(stored);
        } else if (body.config.preChatForm) {
          setNeedsPreChat(true);
        } else {
          // No pre-chat form: start an anonymous conversation now.
          const startRes = await fetch(`/api/widget/${websiteToken}/conversations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!startRes.ok) throw new Error("start failed");
          const startBody = (await startRes.json()) as { visitorToken: string };
          if (cancelled) return;
          window.localStorage.setItem(storageKey, startBody.visitorToken);
          setVisitorToken(startBody.visitorToken);
        }
      } catch {
        if (!cancelled) setConfigError("This chat is not available right now.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [websiteToken, storageKey, loadMessages]);

  // Poll for agent replies while the panel is open.
  useEffect(() => {
    if (!visitorToken) return;
    const timer = window.setInterval(() => void loadMessages(visitorToken), POLL_MS);
    return () => window.clearInterval(timer);
  }, [visitorToken, loadMessages]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function startChat(event: React.FormEvent) {
    event.preventDefault();
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/widget/${websiteToken}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, email: email.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as {
        visitorToken?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.visitorToken) {
        throw new Error(body?.error?.message ?? "Could not start the chat.");
      }
      window.localStorage.setItem(storageKey, body.visitorToken);
      setVisitorToken(body.visitorToken);
      setNeedsPreChat(false);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start the chat.");
    } finally {
      setStarting(false);
    }
  }

  async function sendText(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !visitorToken || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/widget/${websiteToken}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-visitor-token": visitorToken },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setDraft("");
        await loadMessages(visitorToken);
      }
    } finally {
      setSending(false);
    }
  }

  async function sendFile(file: File) {
    if (!visitorToken) return;
    const form = new FormData();
    form.set("file", file);
    const caption = draft.trim();
    if (caption) form.set("caption", caption);
    setSending(true);
    try {
      const res = await fetch(`/api/widget/${websiteToken}/messages/media`, {
        method: "POST",
        headers: { "x-visitor-token": visitorToken },
        body: form,
      });
      if (res.ok) {
        setDraft("");
        await loadMessages(visitorToken);
      }
    } finally {
      setSending(false);
    }
  }

  if (configError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
        {configError}
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-zinc-400">
        Loading chat…
      </div>
    );
  }

  const color = config.widgetColor;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-5 py-4 text-white" style={{ backgroundColor: color }}>
        <p className="text-[15px] font-semibold">{config.welcomeTitle}</p>
        <p className="text-[13px] opacity-85">{config.welcomeTagline}</p>
        <p className="mt-0.5 text-[11px] opacity-70">{config.displayName}</p>
      </header>

      {needsPreChat ? (
        <form onSubmit={(e) => void startChat(e)} className="flex flex-1 flex-col gap-3 p-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Tell us who you are and we&apos;ll start chatting.
          </p>
          <label className="text-xs font-medium text-zinc-500">
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Sita Sharma"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Email (optional)
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          {startError ? <p className="text-sm text-red-600">{startError}</p> : null}
          <button
            type="submit"
            disabled={starting}
            className="mt-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: color }}
          >
            {starting ? "Starting…" : "Start chat"}
          </button>
        </form>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-3">
              {messages.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-zinc-400">
                  Say hello — we&apos;re here to help.
                </p>
              ) : null}
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.fromVisitor ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      message.fromVisitor
                        ? "rounded-br-md text-white"
                        : "rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    }`}
                    style={message.fromVisitor ? { backgroundColor: color } : undefined}
                  >
                    {message.attachments.map((attachment, i) =>
                      attachment.mimeType?.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={attachment.url}
                          alt={attachment.fileName ?? "Image"}
                          className="mb-1 max-h-52 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <a
                          key={i}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mb-1 block underline underline-offset-2"
                        >
                          {attachment.fileName ?? "File"}
                        </a>
                      ),
                    )}
                    {message.body ? (
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    ) : null}
                    <p
                      className={`mt-1 text-right text-[10px] ${message.fromVisitor ? "text-white/70" : "text-zinc-400"}`}
                    >
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => void sendText(e)}
            className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void sendFile(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach a file"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Paperclip className="size-4.5" />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your message…"
              maxLength={4000}
              className="min-w-0 flex-1 rounded-full border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={sending || !draft.trim()}
              className="rounded-full p-2.5 text-white disabled:opacity-50"
              style={{ backgroundColor: color }}
            >
              <SendHorizonal className="size-4" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
