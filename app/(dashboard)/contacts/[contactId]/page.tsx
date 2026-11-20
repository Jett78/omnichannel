import { notFound, redirect } from "next/navigation";

import { ContactProfile } from "@/features/contacts/contact-profile";
import { getActiveWorkspace } from "@/lib/active-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contactProfileService } from "@/services/contact-profile.service";

interface ContactProfilePageProps {
  params: Promise<{ contactId: string }>;
}

/**
 * Unified customer profile (Phase 13D) — one contact across every
 * channel: identities, conversation history, tags, internal notes and
 * attributes. Identities are shown as they are; nothing is merged.
 */
export default async function ContactProfilePage({ params }: ContactProfilePageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/session-expired");

  const active = await getActiveWorkspace(user.id);
  if (!active) redirect("/onboarding");

  const { contactId } = await params;
  let profile;
  try {
    profile = await contactProfileService.getProfile(user.id, active.id, contactId);
  } catch {
    notFound();
  }

  const me = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: active.id, userId: user.id } },
    select: { role: true },
  });
  const canEdit = me?.role === "OWNER" || me?.role === "ADMIN" || me?.role === "AGENT";

  return <ContactProfile workspaceId={active.id} initialProfile={profile} canEdit={canEdit} />;
}
