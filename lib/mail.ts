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
  /** Label for the HTML call-to-action button (default "Open link"). */
  buttonLabel?: string;
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
    ? `<p style="margin:28px 0 20px"><a href="${escape(message.url)}" style="background:#4f46e5;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">${escape(message.buttonLabel ?? "Open link")}</a></p>
       <p style="color:#6b7280;font-size:13px">Or paste this URL into your browser:<br><a href="${escape(message.url)}" style="color:#4f46e5">${escape(message.url)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8f9ff;padding:32px 16px">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
    <div style="background:#312e81;padding:20px 28px">
      <span style="color:#ffffff;font-size:17px;font-weight:700">Unified Inbox</span>
      <span style="color:#c7d2fe;font-size:12px;display:block;margin-top:2px">Unified Omnichannel Inbox</span>
    </div>
    <div style="padding:28px;font-size:15px;line-height:1.6;color:#111827">
      <p style="margin:0">${escape(message.text)}</p>
      ${button}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #eef0f4;color:#6b7280;font-size:12px">
      Unified Inbox — every customer conversation, in one place.
    </div>
  </div>
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
    subject: "Verify your email — Unified Inbox",
    url,
    buttonLabel: "Verify my email",
    text: "Welcome to Unified Inbox. Please confirm this is your email address by opening the link below — it expires in 1 hour. Your account becomes active as soon as you verify.",
  });
}

export async function sendResetPasswordEmail(to: string, url: string): Promise<void> {
  await sendMail({
    to,
    subject: "Reset your password — Unified Inbox",
    url,
    buttonLabel: "Reset my password",
    text: "We received a request to reset the password for your Unified Inbox account. Open the link below to choose a new password — it expires in 1 hour. If you didn't request this, ignore this email and your password stays unchanged.",
  });
}

export async function sendInvitationEmail(
  to: string,
  url: string,
  workspaceName: string,
): Promise<void> {
  await sendMail({
    to,
    subject: `You've been invited to ${workspaceName} — Unified Inbox`,
    url,
    buttonLabel: "Accept invitation",
    text: `You've been invited to join the workspace "${workspaceName}". Open the link below to accept your invitation. The link expires in 7 days.`,
  });
}
