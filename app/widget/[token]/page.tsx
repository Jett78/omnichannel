import { WidgetChat } from "@/features/widget/widget-chat";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * The live-chat widget panel (Phase 11) — a public page loaded in an
 * iframe on the customer's website by public/widget.js. It is NOT
 * behind the dashboard login; visitors authenticate with the signed
 * visitor token issued by the widget API (services/widget.service).
 */
export default async function WidgetPage({ params }: PageProps) {
  const { token } = await params;
  return (
    <main className="h-dvh w-full bg-white font-sans text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-50">
      <WidgetChat websiteToken={token} />
    </main>
  );
}
