/** Shopper-facing vision failures. Upstream text is scrubbed before it is logged. */

export type VisionFailure = "unauthorized" | "too_large" | "timeout" | "unreadable" | "upstream" | "unavailable";

export function scrubSecret(value: string): string {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{4,}\b/g, "sk-redacted")
    .replace(/Bearer\s+\S+/gi, "Bearer redacted")
    .slice(0, 400);
}

export function visionFailure(status: number | null, upstream: string): VisionFailure {
  const text = upstream.toLowerCase();
  if (status === 401 || status === 403 || /invalid_api_key|incorrect api key|unauthorized/.test(text)) return "unauthorized";
  if (status === 408 || status === 504 || status === 524) return "timeout";
  if (status === 413 || /too large|maximum context|image size|max(?:imum)? .*bytes|payload too large/.test(text)) return "too_large";
  if (status === 400 && /image|could not process|unsupported|invalid/.test(text)) return "unreadable";
  return "upstream";
}

export function upstreamMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const payload = JSON.parse(trimmed) as { error?: { message?: string; code?: string } | string; message?: string };
    if (typeof payload.error === "string") return payload.error;
    if (payload.error?.message) return payload.error.message;
    if (payload.message) return payload.message;
  } catch {
    /* plain text */
  }
  return trimmed;
}
