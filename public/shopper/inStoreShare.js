/**
 * In-store share. A plain text list grouped by aisle, then the system
 * share sheet. Copy and an sms: link are the fallback. Print is the PDF path.
 */

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function checkboxLine(item, done) {
  const name = clean(item?.name) || "Item";
  const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
  const suffix = qty > 1 ? ` x${qty}` : "";
  return `${done ? "[x]" : "[ ]"} ${name}${suffix}`;
}

/**
 * @param {Array<{ storeName?: string, groups?: Array<{ label?: string, items?: object[] }>, cart?: object[] }> | null | undefined} sections
 */
export function inStoreShareText(sections) {
  const lines = [];
  for (const section of sections || []) {
    const store = clean(section?.storeName) || "Store";
    lines.push(store);
    for (const group of section?.groups || []) {
      const label = clean(group?.label);
      if (label && !(section?.unfound && label === store)) lines.push(label);
      for (const item of group?.items || []) lines.push(checkboxLine(item, false));
    }
    const cart = section?.cart || [];
    if (cart.length) {
      lines.push("In cart");
      for (const item of cart) lines.push(checkboxLine(item, true));
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/g, "");
}

export function inStoreShareActionsHtml() {
  return `<div class="instore-share"><button type="button" class="primary" data-share-list>Share list</button><button type="button" class="ghost" data-save-pdf>Save as PDF</button></div>`;
}

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ hidden?: boolean, innerHTML?: string } | null | undefined} root
 * @param {string} text
 */
export function fillPrintRoot(root, text) {
  if (!root) return false;
  root.hidden = false;
  root.innerHTML = `<h1>Shopping list</h1><pre class="print-list">${escapeText(text)}</pre>`;
  return true;
}

/**
 * navigator.share when the phone has it. Otherwise copy, and an sms: link.
 * A cancelled share sheet stays cancelled.
 * @param {string} text
 * @param {{ share?: (data: { title?: string, text?: string }) => Promise<void>, writeText?: (value: string) => Promise<void> }} [env]
 */
export async function shareInStoreList(text, env = {}) {
  const body = String(text || "");
  const payload = { title: "Shopping list", text: body };
  if (typeof env.share === "function") {
    try {
      await env.share(payload);
      return { method: "share", copied: false, sms: "" };
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
      if (name === "AbortError") return { method: "dismissed", copied: false, sms: "" };
    }
  }
  let copied = false;
  if (typeof env.writeText === "function") {
    try {
      await env.writeText(body);
      copied = true;
    } catch {
      copied = false;
    }
  }
  const sms = `sms:?&body=${encodeURIComponent(body).slice(0, 1800)}`;
  return { method: "fallback", copied, sms };
}
