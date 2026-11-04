/**
 * The ZIP box starts empty. 45202 is a Cincinnati example that used to sit in
 * the placeholder and looked typed on iPhone Chrome. A saved ZIP the shopper
 * already entered is the only value that may appear.
 */

export const ZIP_PLACEHOLDER = "5-digit ZIP";

/** Five digits from storage, or "" when nothing was saved. */
export function fieldZip(saved) {
  const digits = String(saved ?? "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}
