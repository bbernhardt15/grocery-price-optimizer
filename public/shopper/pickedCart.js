/**
 * Put a picked match into the store cart that is already on screen.
 * This does not rebuild Review, so a held scroll stays where it is.
 * The price is the catalog offer the shopper tapped. A missing price
 * is left blank.
 */

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.round(value * 100) / 100);
}

export function pickedLineHtml(line) {
  const title = String(line?.title || line?.name || "").replace(/\s+/g, " ").trim();
  const qty = Math.max(1, Math.floor(Number(line?.quantity) || 1));
  const qtyLabel = qty > 1 ? ` x${qty}` : "";
  const amount = Number(line?.itemTotal ?? line?.price);
  const priced = Number.isFinite(amount) && amount > 0;
  const key = String(line?.lineId || title).replace(/"/g, "");
  const price = priced ? `<strong>${escapeText(money(amount))}</strong><span class="price-source" title="Catalog price from the match you picked. Not a new live check.">est.</span>` : "";
  return `<li class="review-line" data-review-line="${escapeText(key)}" data-picked-line="1"><span>${escapeText(title)}${escapeText(qtyLabel)}</span>${price}</li>`;
}

function sameStore(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

/**
 * @param {ParentNode} root
 * @param {{ storeName: string, lineId: string, title: string, price?: number, quantity?: number }} line
 */
export function placePickedLine(root, line) {
  if (!root || typeof root.querySelectorAll !== "function") return { placed: false, reason: "no-root" };
  const storeName = String(line?.storeName || "").trim();
  const title = String(line?.title || line?.name || "").trim();
  if (!storeName || !title) return { placed: false, reason: "missing" };
  const store = [...root.querySelectorAll("[data-store]")].find((node) => sameStore(node.getAttribute("data-store"), storeName));
  if (!store || typeof store.querySelector !== "function") return { placed: false, reason: "no-store" };
  const list = store.querySelector(".review-lines");
  if (!list || typeof list.insertAdjacentHTML !== "function") return { placed: false, reason: "no-list" };
  const key = String(line.lineId || title);
  const existing = [...list.querySelectorAll("[data-review-line]")].find((node) => node.getAttribute("data-review-line") === key);
  if (existing) return { placed: true, reason: "already" };
  const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
  const price = Number(line.price);
  const itemTotal = Number.isFinite(price) && price > 0 ? Math.round(price * qty * 100) / 100 : undefined;
  list.insertAdjacentHTML("beforeend", pickedLineHtml({ ...line, title, quantity: qty, itemTotal, lineId: key }));
  const count = store.querySelector(".review-store-meta span");
  if (count) {
    const match = String(count.textContent || "").match(/^(\d+) lines?/);
    if (match) {
      const lines = Number(match[1]) + 1;
      const units = (String(count.textContent).match(/(\d+) units/) || [])[1];
      const nextUnits = units ? Number(units) + qty : 0;
      count.textContent = nextUnits > lines ? `${lines} lines · ${nextUnits} units` : `${lines} ${lines === 1 ? "line" : "lines"}`;
    }
  }
  const total = store.querySelector(".review-store-meta strong");
  if (total && itemTotal) {
    const current = Number(String(total.textContent || "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(current)) total.textContent = money(current + itemTotal);
  }
  return { placed: true, reason: "added" };
}
