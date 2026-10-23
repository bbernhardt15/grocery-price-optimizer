import type { Request } from "express";
import { randomBytes } from "node:crypto";
import { emailAuthConfigured } from "./config";
import { MagicLink } from "./models";
import { sha256 } from "./seal";
import { safeReturnTo } from "./state";

const MAGIC_TTL_MS = 20 * 60 * 1000;

export type AuthMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type Mailer = (message: AuthMail) => Promise<void>;

let mailerOverride: Mailer | null = null;

/** Tests capture the message instead of calling Resend. */
export function setAuthMailer(mailer: Mailer | null): void {
  mailerOverride = mailer;
}

export function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function publicOrigin(req: Request): string {
  const configured = process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "") ?? "";
  if (configured) return configured;
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0]?.trim() || "https";
  const host = (req.get("x-forwarded-host") || req.get("host") || "localhost").split(",")[0]?.trim();
  return `${proto}://${host}`;
}

async function sendWithResend(message: AuthMail): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.AUTH_EMAIL_FROM?.trim() ?? "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email provider rejected the message (${response.status}). ${detail.slice(0, 180)}`);
  }
}

export async function sendAuthMail(message: AuthMail): Promise<void> {
  if (mailerOverride) {
    await mailerOverride(message);
    return;
  }
  if (!emailAuthConfigured()) {
    throw new Error("Email sign-in is not configured.");
  }
  await sendWithResend(message);
}

export async function issueMagicLink(email: string, returnTo: string, origin: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await MagicLink.create({
    tokenHash: sha256(token),
    email,
    returnTo: safeReturnTo(returnTo),
    expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
    usedAt: null,
  });
  const link = `${origin}/api/auth/email/callback?token=${encodeURIComponent(token)}`;
  const text = `Sign in to Grocery Gitter\n\n${link}\n\nThis link works once and expires in 20 minutes. If you did not ask for it, you can ignore this email.`;
  const html = `<p>Sign in to Grocery Gitter.</p><p><a href="${link}">Sign in</a></p><p>This link works once and expires in 20 minutes. If you did not ask for it, you can ignore this email.</p>`;
  try {
    await sendAuthMail({ to: email, subject: "Sign in to Grocery Gitter", text, html });
  } catch (error) {
    await MagicLink.deleteOne({ tokenHash: sha256(token) });
    throw error;
  }
}

export async function consumeMagicLink(token: string): Promise<{ email: string; returnTo: string } | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const doc = await MagicLink.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  ).lean();
  if (!doc) return null;
  return { email: String(doc.email), returnTo: safeReturnTo(doc.returnTo) };
}
