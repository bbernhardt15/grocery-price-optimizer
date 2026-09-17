import { createSign, randomUUID } from "node:crypto";

export const WALMART_AFFILIATE_BASE =
  "https://developer.api.walmart.com/api-proxy/service/affil/product/v2";

export type WalmartCredentials = {
  consumerId: string;
  privateKeyPem: string;
  keyVersion: string;
  publisherId?: string;
};

/**
 * Walmart IO Affiliate auth: RSA-SHA256 over
 * `{consumerId}\\n{timestampMs}\\n{keyVersion}\\n`, then Base64.
 * Docs: https://walmart.io/apidocs/affiliates/quickstart
 */
export function normalizeWalmartPrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const unescaped = trimmed.replace(/\\n/g, "\n");
  if (unescaped.includes("BEGIN")) {
    return unescaped;
  }

  const body = unescaped.replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

export function readWalmartCredentials(): WalmartCredentials | null {
  const consumerId = process.env.WALMART_CONSUMER_ID?.trim() ?? "";
  const privateKey = normalizeWalmartPrivateKey(
    process.env.WALMART_PRIVATE_KEY ?? ""
  );
  const publisherId = process.env.WALMART_PUBLISHER_ID?.trim() || undefined;
  const keyVersion = process.env.WALMART_KEY_VERSION?.trim() || "1";

  if (!consumerId || !privateKey) {
    return null;
  }

  return { consumerId, privateKeyPem: privateKey, keyVersion, publisherId };
}

export function walmartAuthHeaders(
  credentials: WalmartCredentials,
  options: { timestampMs?: number; correlationId?: string } = {}
): Record<string, string> {
  const timestamp = String(options.timestampMs ?? Date.now());
  const canonical = `${credentials.consumerId}\n${timestamp}\n${credentials.keyVersion}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(canonical);
  signer.end();
  const signature = signer.sign(credentials.privateKeyPem, "base64");

  return {
    "WM_CONSUMER.ID": credentials.consumerId,
    "WM_CONSUMER.INTIMESTAMP": timestamp,
    "WM_SEC.KEY_VERSION": credentials.keyVersion,
    "WM_SEC.AUTH_SIGNATURE": signature,
    "WM_QOS.CORRELATION_ID": options.correlationId ?? randomUUID(),
    Accept: "application/json",
  };
}
