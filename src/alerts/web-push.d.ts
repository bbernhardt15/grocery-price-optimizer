declare module "web-push" {
  export class WebPushError extends Error {
    statusCode: number;
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;

  export function sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload?: string | Buffer | null,
    options?: { TTL?: number }
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
}
