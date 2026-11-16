import { getEnv } from "@/lib/env";

/**
 * Dev mailer.
 *
 * There is deliberately NO real email sending yet: when SMTP_* env vars
 * are absent, every message is logged to the server console with its URL
 * clearly visible so auth flows (verification, password reset,
 * invitations) can be completed in development. When SMTP is configured
 * this module is the single place to plug a real transport in — callers
 * never change.
 */
export interface MailMessage {
  to: string;
  subject: string;
  url?: string;
  text: string;
}

export async function sendMail(message: MailMessage): Promise<void> {
  const env = getEnv();
  if (!env.SMTP_HOST) {
    console.log(
      [
        "",
        "┌─ DEV MAIL (no SMTP configured — logged, not sent) ─────────────",
        `│ From:    ${env.MAIL_FROM}`,
        `│ To:      ${message.to}`,
        `│ Subject: ${message.subject}`,
        message.url ? `│ URL:     ${message.url}` : null,
        `│ ${message.text}`,
        "└─────────────────────────────────────────────────────────────────",
        "",
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    );
    return;
  }
  // SMTP transport plugs in here (nodemailer) when SMTP_HOST is set.
  // Until then, fail loudly rather than pretending mail was sent.
  throw new Error("SMTP_HOST is set but no SMTP transport is installed yet (Phase 2 dev mailer)");
}

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await sendMail({
    to,
    subject: "Verify your email — Unified Omnichannel Inbox",
    url,
    text: "Open the URL above to verify your email address.",
  });
}

export async function sendResetPasswordEmail(to: string, url: string): Promise<void> {
  await sendMail({
    to,
    subject: "Reset your password — Unified Omnichannel Inbox",
    url,
    text: "Open the URL above to reset your password. The link expires soon.",
  });
}

export async function sendInvitationEmail(to: string, url: string, workspaceName: string): Promise<void> {
  await sendMail({
    to,
    subject: `You've been invited to ${workspaceName} — Unified Omnichannel Inbox`,
    url,
    text: `Open the URL above to accept your invitation to ${workspaceName}.`,
  });
}
