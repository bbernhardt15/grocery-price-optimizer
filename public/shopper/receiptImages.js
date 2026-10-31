/**
 * Shrink a screenshot before upload.
 * A tall receipt stays readable: the width is capped and the height is cut
 * into overlapping JPEG bands instead of squashing the long side to 1600px.
 */

export const MAX_WIDTH = 1200;
export const CHUNK_HEIGHT = 1500;
export const OVERLAP = 180;

/**
 * @param {number} width
 * @param {number} height
 */
export function sliceWindows(width, height) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  const scale = Math.min(1, MAX_WIDTH / safeWidth);
  const w = Math.max(1, Math.round(safeWidth * scale));
  const h = Math.max(1, Math.round(safeHeight * scale));
  if (h <= CHUNK_HEIGHT) return [{ x: 0, y: 0, width: w, height: h, scale }];
  const windows = [];
  const step = CHUNK_HEIGHT - OVERLAP;
  for (let y = 0; y < h; y += step) {
    const band = Math.min(CHUNK_HEIGHT, h - y);
    windows.push({ x: 0, y, width: w, height: band, scale });
    if (y + band >= h) break;
  }
  return windows;
}

function heicName(file) {
  const type = String(file?.type || "");
  const name = String(file?.name || "");
  return /heic|heif/i.test(type) || /\.hei[cf]$/i.test(name);
}

/**
 * @param {Blob} file
 * @returns {Promise<Blob[]>}
 */
export async function imageBlobs(file) {
  if (!file || !String(file.type || "").startsWith("image/") && !heicName(file)) return [file];
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return [file];
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (heicName(file)) throw new Error("That photo format didn't open. Take a screenshot, or paste the text.");
    return [file];
  }
  try {
    const windows = sliceWindows(bitmap.width, bitmap.height);
    const blobs = [];
    for (const window of windows) {
      const canvas = document.createElement("canvas");
      canvas.width = window.width;
      canvas.height = window.height;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        bitmap,
        window.x / window.scale,
        window.y / window.scale,
        window.width / window.scale,
        window.height / window.scale,
        0,
        0,
        window.width,
        window.height
      );
      let quality = 0.82;
      let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size > 1_200_000) {
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.68));
      }
      if (blob) blobs.push(blob);
    }
    return blobs.length ? blobs : [file];
  } finally {
    bitmap.close?.();
  }
}
