/**
 * One product image: a real photo, or the placeholder tile when the URL is missing.
 * Broken loads use the data-photo error handler.
 */

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * @param {string} url
 * @param {{ className?: string, resolve?: (url: string) => string, rest?: string[] }} [options]
 */
export function productPhotoHtml(url, options = {}) {
  const src = String(url || "").trim();
  const className = options.className ? ` class="${escapeAttr(options.className)}"` : "";
  if (!src) return `<span class="product-placeholder"${className} aria-hidden="true"></span>`;
  const resolved = typeof options.resolve === "function" ? options.resolve(src) : src;
  const rest = (options.rest || []).map((row) => String(row || "").trim()).filter(Boolean);
  const restAttr = rest.length ? ` data-rest="${escapeAttr(rest.join("\n"))}"` : "";
  return `<img data-photo="product"${className} src="${escapeAttr(resolved)}"${restAttr} alt="" />`;
}
