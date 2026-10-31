/**
 * Pick a vision detail level from the picture itself.
 * Low detail is a small view and is enough for a short screenshot.
 * A tall receipt band needs the full image so UPC digits survive.
 */

export type ImageSize = { width: number; height: number };

export function visionDetailFor(width: number, height: number): "low" | "high" {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "low";
  return Math.max(width, height) <= 900 ? "low" : "high";
}

function jpegSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function pngSize(buffer: Buffer): ImageSize | null {
  const png = buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (!png) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

export function imageSize(buffer: Buffer): ImageSize | null {
  if (!buffer?.length) return null;
  return jpegSize(buffer) || pngSize(buffer);
}

export function visionDetail(buffer: Buffer): "low" | "high" {
  const size = imageSize(buffer);
  if (size) return visionDetailFor(size.width, size.height);
  return buffer.length > 180_000 ? "high" : "low";
}
