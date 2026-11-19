import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Privacy Policy — Unified Inbox" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <header className="bg-gradient-to-br from-indigo-100 via-slate-50 to-violet-100 dark:from-indigo-950 dark:via-neutral-950 dark:to-violet-950">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 pt-10 pb-8">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-md">
            U
          </span>
          <span className="text-lg font-semibold">Unified Inbox</span>
        </div>
        <div className="mx-auto max-w-3xl px-6 pb-10">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated: 19 November 2026</p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <p className="text-[15px] leading-relaxed">
          Unified Inbox (&quot;the Service&quot;) is an omnichannel inbox that lets a business
          read and reply to customer conversations from its connected messaging channels —
          such as Facebook Messenger, Instagram, WhatsApp, TikTok and X — in one place. This
          policy explains what data the Service processes and why.
        </p>

        <Section title="Who operates the Service">
          <p>
            The Service is operated by its developer (&quot;we&quot;, &quot;us&quot;). Privacy
            questions and data requests can be sent to{" "}
            <a className="text-primary underline-offset-4 hover:underline" href="mailto:jetdeula@gmail.com">
              jetdeula@gmail.com
            </a>
            .
          </p>
        </Section>

        <Section title="Data we process">
          <p>
            <strong className="text-foreground">Account data.</strong> When you register we
            store your name, email address and a securely hashed password, plus the workspaces
            and team memberships you create or accept.
          </p>
          <p>
            <strong className="text-foreground">Connected channel data.</strong> When a
            workspace connects a messaging channel, we store the channel&apos;s name and
            platform identifier and the access credentials needed to operate it. Credentials
            are encrypted at rest (AES-256-GCM) and are never shown in the product or shared
            with other workspaces.
          </p>
          <p>
            <strong className="text-foreground">Conversation data.</strong> Messages sent to a
            connected channel are received from the platform, stored, and shown to the
            workspace&apos;s members so they can reply. This includes message text, media
            attachments, delivery/read status, and the sender&apos;s platform profile details
            that the platform provides (such as display name, avatar and platform user id; for
            WhatsApp, the sender&apos;s phone number).
          </p>
          <p>
            <strong className="text-foreground">Technical data.</strong> We keep operational
            logs needed to run and secure the Service (for example webhook delivery records
            and error logs).
          </p>
        </Section>

        <Section title="How we use data">
          <p>
            Data is processed only to provide the Service to the workspace that owns it:
            receiving, displaying, organising and sending messages; managing team access; and
            keeping the Service secure and reliable. We do not sell personal data, we do not
            use conversation content for advertising, and we do not train AI models on your
            messages.
          </p>
        </Section>

        <Section title="Platforms and processors">
          <p>
            Conversation data flows between the Service and the messaging platforms the
            workspace connects (Meta for Facebook, Instagram and WhatsApp; TikTok; X), under
            those platforms&apos; own terms and privacy policies. The Service runs on
            infrastructure providers (hosting, database and queue providers) who process data
            only on our behalf.
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            Data is kept while the workspace it belongs to exists. Disconnecting a channel
            deletes its stored credentials. You may request access to, correction of, or
            deletion of your personal data at any time via the contact email above; deletion
            requests originating from a connected platform (for example Meta&apos;s data
            deletion requests) are honoured. When a workspace is deleted, its channels,
            contacts and conversations are removed.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            The Service uses only the session cookies required to keep you signed in. It does
            not use advertising or cross-site tracking cookies.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If this policy changes, the updated version will be posted on this page with a new
            &quot;last updated&quot; date.
          </p>
        </Section>

        <footer className="text-muted-foreground flex gap-4 border-t pt-6 text-sm">
          <Link href="/terms" className="underline-offset-4 hover:underline">
            Terms of Service
          </Link>
          <Link href="/login" className="underline-offset-4 hover:underline">
            Sign in
          </Link>
        </footer>
      </main>
    </div>
  );
}
