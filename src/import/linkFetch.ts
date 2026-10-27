import { BlockList, isIP } from "node:net";
import { getFetch, getLookup } from "./runtime";

const ALLOWED = new Set([
  "instacart.com",
  "www.instacart.com",
  "walmart.com",
  "www.walmart.com",
  "amazon.com",
  "www.amazon.com",
  "smile.amazon.com",
  "target.com",
  "www.target.com",
  "kroger.com",
  "www.kroger.com",
]);

const block = new BlockList();
block.addSubnet("0.0.0.0", 8, "ipv4");
block.addSubnet("10.0.0.0", 8, "ipv4");
block.addSubnet("100.64.0.0", 10, "ipv4");
block.addSubnet("127.0.0.0", 8, "ipv4");
block.addSubnet("169.254.0.0", 16, "ipv4");
block.addSubnet("172.16.0.0", 12, "ipv4");
block.addSubnet("192.168.0.0", 16, "ipv4");
block.addSubnet("224.0.0.0", 4, "ipv4");
block.addAddress("255.255.255.255", "ipv4");
block.addAddress("::1", "ipv6");
block.addSubnet("fc00::", 7, "ipv6");
block.addSubnet("fe80::", 10, "ipv6");
block.addSubnet("ff00::", 8, "ipv6");

export type LinkRead = { ok: true; text: string } | { ok: false; code: "unread" | "signin" };

function privateAddress(address: string): boolean {
  const mapped = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  const kind = isIP(mapped);
  if (kind === 4) return block.check(mapped, "ipv4");
  if (kind === 6) return block.check(address, "ipv6");
  return true;
}

export function publicListUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!ALLOWED.has(host) || isIP(host)) return null;
  return url;
}

async function hostIsPublic(url: URL): Promise<boolean> {
  let addresses: string[];
  try {
    addresses = await getLookup()(url.hostname);
  } catch {
    return false;
  }
  if (!addresses.length) return false;
  return addresses.every((address) => !privateAddress(address));
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeLogin(html: string, text: string): boolean {
  const grocery = (text.match(/\b(?:milk|bread|eggs?|banana|chicken|oz|gal|gallon|pack)\b/gi) || []).length;
  if (/type\s*=\s*["']password["']/i.test(html) && grocery < 2) return true;
  return /sign in to (?:view|see)|log in to view|this list is private|sign in to your/i.test(text) && grocery < 2;
}

async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (text.length > max) throw new Error("too-big");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("too-big");
    }
    chunks.push(step.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export async function readSharedLink(input: string): Promise<LinkRead> {
  let current = publicListUrl(input);
  if (!current) return { ok: false, code: "unread" };
  const fetchImpl = getFetch();
  for (let hop = 0; hop < 3; hop += 1) {
    if (!(await hostIsPublic(current))) return { ok: false, code: "unread" };
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
          "user-agent": "GroceryGitter/1.0 (list import)",
        },
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      return { ok: false, code: "unread" };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, code: "unread" };
      current = publicListUrl(new URL(location, current).toString());
      if (!current) return { ok: false, code: "unread" };
      continue;
    }
    if (!response.ok) return { ok: false, code: "unread" };
    const type = response.headers.get("content-type") || "";
    if (type && !/text\/|application\/xhtml|application\/json/i.test(type)) return { ok: false, code: "unread" };
    let body = "";
    try {
      body = await readLimited(response, 400_000);
    } catch {
      return { ok: false, code: "unread" };
    }
    const text = /json/i.test(type) ? body : htmlToText(body);
    if (looksLikeLogin(body, text)) return { ok: false, code: "signin" };
    if (!text.trim()) return { ok: false, code: "unread" };
    return { ok: true, text };
  }
  return { ok: false, code: "unread" };
}
