import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Terms of Service — Unified Inbox" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

export default function TermsPage() {
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
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated: 19 November 2026</p>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <p className="text-[15px] leading-relaxed">
          These terms govern your use of Unified Inbox (&quot;the Service&quot;), an
          omnichannel inbox for business messaging. By creating an account or using the
          Service you agree to them.
        </p>

        <Section title="The Service">
          <p>
            The Service lets a business connect its messaging channels (such as Facebook
            Messenger, Instagram, WhatsApp, TikTok and X) into workspaces where its team can
            read and reply to customer conversations. Channel availability depends on each
            platform&apos;s APIs, approvals and policies.
          </p>
        </Section>

        <Section title="Accounts and workspaces">
          <p>
            You are responsible for your account credentials and for everything done under
            your account. Workspace owners and admins control who joins their workspace and
            what each member can do; you are responsible for the members you invite and the
            channels you connect. You may connect only channels and accounts you own or are
            authorised to manage.
          </p>
        </Section>

        <Section title="Connected platforms">
          <p>
            Your use of each connected platform through the Service is also governed by that
            platform&apos;s terms and policies, including its messaging rules (for example
            reply windows and template requirements). We are not responsible for a
            platform&apos;s availability, policy changes, or approval decisions, and a channel
            may stop working if the platform withdraws access.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>
            You agree not to use the Service to send spam or unlawful, deceptive or harmful
            content; to message people without a lawful basis; to violate any platform&apos;s
            policies; or to attempt to access another workspace&apos;s data. We may suspend
            accounts or workspaces that break these terms.
          </p>
        </Section>

        <Section title="Availability and liability">
          <p>
            The Service is provided &quot;as is&quot; without warranties of any kind and
            without a guaranteed level of availability. To the maximum extent permitted by
            law, we are not liable for indirect or consequential loss, including messages
            delayed or not delivered because of a platform&apos;s systems or policies.
          </p>
        </Section>

        <Section title="Termination">
          <p>
            You may stop using the Service at any time and may disconnect channels or delete
            your workspace data as described in the{" "}
            <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            . We may terminate access for breach of these terms.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            If these terms change, the updated version will be posted on this page with a new
            &quot;last updated&quot; date. Questions about these terms can be sent to{" "}
            <a className="text-primary underline-offset-4 hover:underline" href="mailto:jetdeula@gmail.com">
              jetdeula@gmail.com
            </a>
            .
          </p>
        </Section>

        <footer className="text-muted-foreground flex gap-4 border-t pt-6 text-sm">
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          <Link href="/login" className="underline-offset-4 hover:underline">
            Sign in
          </Link>
        </footer>
      </main>
    </div>
  );
}
