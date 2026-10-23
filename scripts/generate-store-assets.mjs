/**
 * Rebuild store icons and splash screens from assets/logo.svg.
 *
 * The SVG is the only source mark. This writes assets/logo.png, then
 * @capacitor/assets fills ios/ and android/ (including Android adaptive
 * icons). PWA icons in public/icons/ are resized from the same PNG.
 *
 *   npm run assets:generate
 */
import { spawnSync } from "node:child_process";
import { readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const canvas = "#1c221e";

const logoPng = path.join(root, "assets", "logo.png");
await sharp(path.join(root, "assets", "logo.svg"), { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile(logoPng);

const result = spawnSync(
  "npx",
  [
    "@capacitor/assets",
    "generate",
    "--ios",
    "--android",
    "--iconBackgroundColor",
    canvas,
    "--iconBackgroundColorDark",
    canvas,
    "--splashBackgroundColor",
    canvas,
    "--splashBackgroundColorDark",
    canvas,
    "--logoSplashScale",
    "0.42",
  ],
  { cwd: root, stdio: "inherit" }
);

if (result.status !== 0) {
  process.exit(result.status === null ? 1 : result.status);
}

const resDir = path.join(root, "android", "app", "src", "main", "res");
const densities = await readdir(resDir, { withFileTypes: true });
for (const entry of densities) {
  if (!entry.isDirectory() || !entry.name.startsWith("mipmap-")) continue;
  const iconPath = path.join(resDir, entry.name, "ic_launcher.png");
  try {
    const source = sharp(iconPath);
    const meta = await source.metadata();
    if (!meta.width || !meta.height) continue;
    const tmp = `${iconPath}.tmp.png`;
    await sharp({
      create: {
        width: meta.width,
        height: meta.height,
        channels: 4,
        background: canvas,
      },
    })
      .composite([{ input: await sharp(iconPath).ensureAlpha().png().toBuffer() }])
      .png()
      .toFile(tmp);
    await unlink(iconPath);
    await rename(tmp, iconPath);
  } catch {
    // Adaptive-only densities have no legacy ic_launcher.png.
  }
}

const publicIcons = path.join(root, "public", "icons");
await sharp(logoPng).resize(192, 192).png().toFile(path.join(publicIcons, "icon-192.png"));
await sharp(logoPng).resize(512, 512).png().toFile(path.join(publicIcons, "icon-512.png"));
await sharp(logoPng).resize(180, 180).png().toFile(path.join(publicIcons, "apple-touch-icon.png"));

console.log("Store icons and splash screens regenerated from assets/logo.svg.");
