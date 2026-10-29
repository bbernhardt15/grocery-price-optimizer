/**
 * My products, in the menu drawer. Locked means they said always.
 * Learned means the app noticed a repeat. Nothing here shows a price.
 */

import { getUserProfile, saveUserProfile } from "./profile.js";
import { familyLabel, forgetPreference, unblockProduct } from "./productPreference.js";
import { modeLabel } from "./categoryPreference.js";

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ storage?: Storage, onEditProfile?: () => void, onChange?: () => void }} deps
 */
export function mountMyProducts(deps = {}) {
  const dialog = document.getElementById("products-dialog");
  if (!dialog) return { open() {} };
  const storage = deps.storage || localStorage;
  const body = document.getElementById("products-body");

  function paint() {
    if (!body) return;
    const profile = getUserProfile(storage);
    const categories = Object.values(profile.categoryPreferences || {})
      .filter((row) => row?.mode && row.mode !== "skip")
      .sort((a, b) => a.family.localeCompare(b.family));
    const prefs = Object.values(profile.productPreferences || {}).sort((a, b) => a.family.localeCompare(b.family));
    const blocked = profile.neverProducts || [];
    const rows = prefs.length
      ? prefs
          .map((pref) => {
            const image = pref.imageUrl ? `<img src="${escapeText(pref.imageUrl)}" alt="" />` : `<span class="staple-fallback" aria-hidden="true"></span>`;
            const meta = [pref.brand, pref.sizeLabel].filter(Boolean).join(" · ");
            return `<li class="my-product">
              ${image}
              <div>
                <strong>${escapeText(familyLabel(pref.family) || pref.family)}</strong>
                <p>${escapeText(pref.name)}</p>
                <p class="muted">${escapeText(meta)} · ${pref.locked ? "Locked" : "Learned"}</p>
              </div>
              <button type="button" class="text-btn" data-forget="${escapeText(pref.family)}">Remove</button>
            </li>`;
          })
          .join("")
      : categories.length
        ? ""
        : `<p class="muted">No go-to products yet. Set them in your taste profile, and they'll show up here.</p>`;
    const blocks = blocked.length
      ? `<h3>Never this product</h3><ul class="my-product-list">${blocked
          .map(
            (row) => `<li class="my-product"><div><strong>${escapeText(row.name || "Product")}</strong><p class="muted">${escapeText(row.brand || "")}</p></div>
            <button type="button" class="text-btn" data-unblock="${escapeText(row.catalogId)}">Allow</button></li>`
          )
          .join("")}</ul>`
      : "";
    const how = categories.length
      ? `<h3>How you buy</h3><ul class="my-product-list">${categories
          .map(
            (row) => `<li class="my-product"><div><strong>${escapeText(familyLabel(row.family) || row.family)}</strong><p>${escapeText(modeLabel(row.mode))}${row.brand ? ` · ${escapeText(row.brand)}` : ""}</p></div>
            <button type="button" class="text-btn" data-edit-category="${escapeText(row.family)}">Change</button></li>`
          )
          .join("")}</ul>`
      : "";
    body.innerHTML = `${how}<ul class="my-product-list">${rows}</ul>${blocks}`;
  }

  function open() {
    paint();
    if (!dialog.open) dialog.showModal();
    document.getElementById("products-title")?.focus();
  }

  document.getElementById("products-close")?.addEventListener("click", () => dialog.close());
  document.getElementById("products-edit-profile")?.addEventListener("click", () => {
    dialog.close();
    deps.onEditProfile?.();
  });
  body?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    const profile = getUserProfile(storage);
    if (target.dataset.editCategory) {
      dialog.close();
      deps.onEditCategory?.(target.dataset.editCategory);
      return;
    }
    if (target.dataset.forget) saveUserProfile(storage, forgetPreference(profile, target.dataset.forget));
    if (target.dataset.unblock) saveUserProfile(storage, unblockProduct(profile, target.dataset.unblock));
    deps.onChange?.();
    paint();
  });

  return { open, paint };
}

/**
 * Gentle confirm after a single add. Bulk adds stay quiet.
 * @param {{ storage?: Storage, onAnswer?: (profile: object) => void }} deps
 */
export function mountAlwaysPrompt(deps = {}) {
  const dialog = document.getElementById("always-prompt");
  if (!dialog) return { ask() {} };
  const storage = deps.storage || localStorage;
  let pending = null;

  function ask(product, familyLabelText) {
    pending = product;
    const title = document.getElementById("always-title");
    const body = document.getElementById("always-body");
    const name = familyLabelText || "this";
    if (title) title.textContent = `Always use this ${name.toLowerCase()}?`;
    if (body) body.textContent = "We'll use it the next time you ask. Just this time leaves it as a one-off.";
    if (!dialog.open) dialog.showModal();
  }

  document.getElementById("always-yes")?.addEventListener("click", () => {
    if (pending) deps.onAnswer?.("always", pending);
    pending = null;
    dialog.close();
  });
  document.getElementById("always-once")?.addEventListener("click", () => {
    if (pending) deps.onAnswer?.("once", pending);
    pending = null;
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    pending = null;
  });

  return { ask, storage };
}
