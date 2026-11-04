/**
 * Unfound lines stay on the trip so the shopper can look them up.
 * Kroger's cart API needs a product UPC. Walmart's add-to-cart link needs
 * an item id. A name alone cannot be added, so these are search links.
 */

export const UNFOUND_STATUS = "to find in store";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeText(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Public Kroger search for a name. Not a cart add. */
export function krogerNameSearchUrl(name) {
  const query = clean(name);
  if (!query) return "";
  return `https://www.kroger.com/search?${new URLSearchParams({ query }).toString()}`;
}

/** Public Walmart search for a name. Not an add-to-cart link. */
export function walmartNameSearchUrl(name) {
  const query = clean(name);
  if (!query) return "";
  return `https://www.walmart.com/search?${new URLSearchParams({ q: query }).toString()}`;
}

/** @param {string} name */
export function unfoundSearchLinks(name) {
  const label = clean(name);
  return {
    name: label,
    kroger: { label: "Search at Kroger", url: krogerNameSearchUrl(label) },
    walmart: { label: "Search at Walmart", url: walmartNameSearchUrl(label) },
  };
}

/** @param {string[] | null | undefined} names */
export function unfoundCopyText(names) {
  return (names || []).map((name) => clean(name)).filter(Boolean).join("\n");
}

/** @param {string[] | null | undefined} names */
export function toFindRecords(names) {
  return (names || [])
    .map((name) => clean(name))
    .filter(Boolean)
    .map((name) => ({ name, status: UNFOUND_STATUS }));
}

function linkHtml(link, name, escapeHtml) {
  if (!link?.url) return "";
  return `<a class="text-btn" href="${escapeHtml(link.url)}" data-external-link="${escapeHtml(link.url)}">${escapeHtml(link.label)}<span class="sr-only"> for ${escapeHtml(name)}</span></a>`;
}

/**
 * @param {string[] | null | undefined} names
 */
export function unfoundSectionHtml(names, escapeHtml = escapeText) {
  const list = (names || []).map((name) => clean(name)).filter(Boolean);
  if (!list.length) return "";
  const rows = list
    .map((name) => {
      const links = unfoundSearchLinks(name);
      return `<li class="missing-row">
        <p>${escapeHtml(name)}</p>
        <p class="muted">To find in store. A name can't be added to the Kroger or Walmart cart from here.</p>
        <div class="unfound-links">${linkHtml(links.kroger, name, escapeHtml)}${linkHtml(links.walmart, name, escapeHtml)}</div>
      </li>`;
    })
    .join("");
  const heading = list.length === 1 ? "1 item to find in store" : `${list.length} items to find in store`;
  return `<section class="missing-fold" data-unfound="1">
    <h3>${escapeHtml(heading)}</h3>
    <p class="missing-line">These didn't match a product we can price. Search the store, or find them on the shelf. They are not in a cart.</p>
    <ul class="missing-list">${rows}</ul>
    <button type="button" class="ghost" data-copy-unfound="1">Copy list of unfound items</button>
  </section>`;
}

/**
 * In-store group for lines that are not in any store cart.
 * @param {string[] | Array<{ name?: string }> | null | undefined} names
 */
export function notInCartSection(names) {
  const list = (names || [])
    .map((row) => clean(typeof row === "string" ? row : row?.name))
    .filter(Boolean);
  if (!list.length) return null;
  return {
    storeName: "Not in a cart",
    subtotal: 0,
    known: false,
    note: "Not in a store cart. Search Kroger or Walmart, or find them on the shelf.",
    unfound: true,
    groups: [
      {
        label: "Not in a cart",
        items: list.map((name, index) => ({
          name,
          query: name,
          quantity: 1,
          lineId: "",
          toFind: true,
          routeNumber: index + 1,
          status: UNFOUND_STATUS,
        })),
      },
    ],
    cart: [],
    left: list.length,
  };
}

/** @param {ReturnType<typeof notInCartSection>} section */
export function unfoundShopSectionHtml(section, escapeHtml = escapeText) {
  if (!section?.groups?.length) return "";
  const rows = section.groups
    .flatMap((group) => group.items || [])
    .map((item) => {
      const links = unfoundSearchLinks(item.name);
      return `<div class="shop-line">
        <p class="shop-name">${escapeHtml(item.name)}</p>
        <p class="muted">To find in store</p>
        <div class="unfound-links">${linkHtml(links.kroger, item.name, escapeHtml)}${linkHtml(links.walmart, item.name, escapeHtml)}</div>
      </div>`;
    })
    .join("");
  return `<section class="shop-store" data-not-in-cart="1"><h2>Not in a cart</h2><p class="muted">${escapeHtml(section.note || "")}</p><h3 class="shop-aisle">Not in a cart</h3>${rows}</section>`;
}
