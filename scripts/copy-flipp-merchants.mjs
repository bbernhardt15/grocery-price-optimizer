/**
 * Copy the Flipp merchant config next to the compiled module.
 * tsc does not emit JSON, and the server loads merchants.json from __dirname.
 */
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/pricing/flipp/merchants.json");
const destDir = path.join(root, "dist/pricing/flipp");

mkdirSync(destDir, { recursive: true });
cpSync(src, path.join(destDir, "merchants.json"));

const couponSrc = path.join(root, "src/coupons/pages.json");
const couponDest = path.join(root, "dist/coupons");
mkdirSync(couponDest, { recursive: true });
cpSync(couponSrc, path.join(couponDest, "pages.json"));
