export type ScraperErrorCode =
  | "TIMEOUT"
  | "MISSING_ELEMENT"
  | "NETWORK"
  | "INVALID_KEYWORD"
  | "BROWSER";

export class GroceryScraperError extends Error {
  readonly code: ScraperErrorCode;

  constructor(message: string, code: ScraperErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GroceryScraperError";
    this.code = code;
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("Timeout") ||
    message.includes("Navigation timeout")
  );
}

export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = "message" in error ? String(error.message) : "";
  return (
    message.includes("ERR_") ||
    message.includes("net::") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("failed to find") ||
    message.includes("NS_ERROR")
  );
}
