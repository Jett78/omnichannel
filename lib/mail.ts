import nodemailer, { type Transporter } from "nodemailer";

import { getEnv } from "@/lib/env";

/**
 * Mailer — the single place email leaves the app.
 *
 * When SMTP_* env vars are configured, mail is sent for real through
 * nodemailer (invitations, email verification, password resets).
 * When they are absent (local dev), every message is logged to the
 * server console with its URL clearly visible so auth flows can still
 * be completed — and it is never silently pretended to be sent.
 */
export interface MailMessage {
  to: string;
  subject: string;
  url?: string;
  text: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const env = getEnv();
  const port = env.SMTP_PORT ?? 587;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    ...(env.SMTP_USER
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } }
      : {}),
  });
  return transporter;
}

function htmlBody(message: MailMessage): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const button = message.url
    ? `<p style="margin:24px 0"><a href="${escape(message.url)}" style="background:#4f46e5;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open link</a></p>
       <p style="color:#6b7280;font-size:13px">Or paste this URL into your browser:<br>${escape(message.url)}</p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#111827">
  <p>${escape(message.text)}</p>
  ${button}
  <p style="color:#6b7280;font-size:13px">— Unified Omnichannel Inbox</p>
</div>`;
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
  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.url ? `${message.text}\n\n${message.url}` : message.text,
    html: htmlBody(message),
  });
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

export async function sendInvitationEmail(
  to: string,
  url: string,
  workspaceName: string,
): Promise<void> {
  await sendMail({
    to,
    subject: `You've been invited to ${workspaceName} — Unified Omnichannel Inbox`,
    url,
    text: `You've been invited to join the workspace "${workspaceName}". Open the URL above to accept your invitation. The link expires in 7 days.`,
  });
}
