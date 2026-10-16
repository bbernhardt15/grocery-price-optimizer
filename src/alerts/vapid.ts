export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

const DEFAULT_SUBJECT = "mailto:price-alerts@grocerygitter.app";

/** Web Push stays off until both keys are set. The private key never leaves the server. */
export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) {
    return null;
  }
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT;
  return { publicKey, privateKey, subject };
}

export function webPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return vapidConfig(env) != null;
}
