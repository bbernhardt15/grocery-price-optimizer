export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

const DEFAULT_SUBJECT = "mailto:price-alerts@grocerygitter.app";
const MAILTO_SUBJECT = /^mailto:[^\s@]+@[^\s@]+$/i;
const HTTPS_SUBJECT = /^https:\/\/[^\s]+$/i;

/**
 * Web Push requires a mailto: or https: subject. A missing or unusable
 * VAPID_SUBJECT falls back to the default so a bad value does not turn sends off.
 */
function vapidSubject(raw: string | undefined): string {
  const subject = raw?.trim() ?? "";
  if (MAILTO_SUBJECT.test(subject) || HTTPS_SUBJECT.test(subject)) {
    return subject;
  }
  return DEFAULT_SUBJECT;
}

/** Web Push stays off until both keys are set. The private key never leaves the server. */
export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) {
    return null;
  }
  return { publicKey, privateKey, subject: vapidSubject(env.VAPID_SUBJECT) };
}

export function webPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return vapidConfig(env) != null;
}
