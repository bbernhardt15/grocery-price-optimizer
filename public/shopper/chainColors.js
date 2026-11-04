/**
 * One brand color per chain. Sam's Club and Whole Foods used to share the
 * app's blue-green accent. Each background is far enough from the others to
 * read as its own tile, and the lettering clears WCAG AA on that fill.
 */

export const CHAIN_COLORS = {
  kroger: ["#16A34A", "#1A1208"],
  walmart: ["#0071CE", "#FFFFFF"],
  target: ["#CC0000", "#FFFFFF"],
  aldi: ["#FF5A1F", "#1A1208"],
  publix: ["#86EFAC", "#1A1208"],
  "h-e-b": ["#3F0D12", "#FFFFFF"],
  meijer: ["#BE185D", "#FFFFFF"],
  safeway: ["#EF4444", "#1A1208"],
  albertsons: ["#93C5FD", "#1A1208"],
  vons: ["#5EEAD4", "#1A1208"],
  "jewel-osco": ["#A16207", "#FFFFFF"],
  acme: ["#1E1B4B", "#FFFFFF"],
  "tom-thumb": ["#86198F", "#FFFFFF"],
  randalls: ["#C084FC", "#1A1208"],
  pavilions: ["#D9F99D", "#1A1208"],
  "food-lion": ["#FDE047", "#1A1208"],
  giant: ["#818CF8", "#1A1208"],
  "stop-and-shop": ["#0EA5E9", "#1A1208"],
  sprouts: ["#65A30D", "#1A1208"],
  "winn-dixie": ["#FECDD3", "#1A1208"],
  costco: ["#7F1D1D", "#FFFFFF"],
  "sam-s-club": ["#005F99", "#FFFFFF"],
  "whole-foods": ["#064E3B", "#FFFFFF"],
  "amazon-fresh": ["#FF9900", "#1A1208"],
  "giant-eagle": ["#F0ABFC", "#1A1208"],
};

function channel(value) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const n = parseInt(String(hex || "").replace("#", ""), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. */
export function contrastRatio(background, foreground) {
  const lighter = Math.max(relativeLuminance(background), relativeLuminance(foreground));
  const darker = Math.min(relativeLuminance(background), relativeLuminance(foreground));
  return (lighter + 0.05) / (darker + 0.05);
}

export function colorDistance(a, b) {
  const left = parseInt(String(a).replace("#", ""), 16);
  const right = parseInt(String(b).replace("#", ""), 16);
  const dr = ((left >> 16) & 255) - ((right >> 16) & 255);
  const dg = ((left >> 8) & 255) - ((right >> 8) & 255);
  const db = (left & 255) - (right & 255);
  return Math.hypot(dr, dg, db);
}

export function chainColorCss() {
  return Object.entries(CHAIN_COLORS)
    .map(([slug, [background, foreground]]) => {
      const rule = `.store-mark[data-chain="${slug}"] { background: ${background}; color: ${foreground}; }`;
      return `:root ${rule}\n:root[data-resolved="dark"] ${rule}`;
    })
    .join("\n");
}

/** @param {Document | null | undefined} doc */
export function installChainColors(doc) {
  const root = doc || (typeof document !== "undefined" ? document : null);
  if (!root?.getElementById || !root.head || root.getElementById("chain-colors")) return;
  const style = root.createElement("style");
  style.id = "chain-colors";
  style.textContent = chainColorCss();
  root.head.appendChild(style);
}
