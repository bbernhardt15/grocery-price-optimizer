import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { authSecret } from "./config";

function key(): Buffer {
  return createHmac("sha256", authSecret()).update("account-secret-seal").digest();
}

/** Seals a share token so account deletion can find collaborator watches. */
export function sealSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function unsealSecret(sealed: string): string | undefined {
  if (!authSecret()) return undefined;
  try {
    const buf = Buffer.from(sealed, "base64url");
    if (buf.length < 29) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    const value = plain.toString("utf8");
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
