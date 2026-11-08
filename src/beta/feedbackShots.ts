/**
 * Screenshot bytes stored with a feedback note.
 * The image is kept so a reviewer can open it. The note text stays separate.
 * Size and file type are checked here. The bytes are not logged.
 */

export const FEEDBACK_SHOT_MAX_BYTES = 1_200_000;
export const FEEDBACK_SHOT_MAX_COUNT = 3;

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ShotType = (typeof TYPES)[number];

export type StoredShot = {
  name: string;
  mimeType: ShotType;
  data: Buffer;
};

function cleanName(value: unknown): string {
  const base = String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .split(/[/\\]/)
    .pop()
    ?.trim() || "";
  return base.slice(0, 80) || "screenshot";
}

function looksLike(bytes: Buffer, mime: ShotType): boolean {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/gif") return bytes.length >= 6 && bytes.subarray(0, 4).toString("ascii") === "GIF8";
  if (mime === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

export function parseFeedbackShots(value: unknown): { ok: true; shots: StoredShot[] } | { ok: false; error: string } {
  if (value == null) return { ok: true, shots: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Screenshots must be a list of images." };
  if (value.length > FEEDBACK_SHOT_MAX_COUNT) {
    return { ok: false, error: `Send at most ${FEEDBACK_SHOT_MAX_COUNT} screenshots.` };
  }
  const shots: StoredShot[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: "One of those screenshots was not an image." };
    }
    const record = row as { name?: unknown; mimeType?: unknown; data?: unknown };
    const mimeType = String(record.mimeType || "").toLowerCase();
    if (!TYPES.includes(mimeType as ShotType)) {
      return { ok: false, error: "Use a JPEG, PNG, WebP, or GIF." };
    }
    const raw = typeof record.data === "string" ? record.data.replace(/\s/g, "") : "";
    if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      return { ok: false, error: "One screenshot could not be read. Choose the image again." };
    }
    const data = Buffer.from(raw, "base64");
    if (!data.length || data.length > FEEDBACK_SHOT_MAX_BYTES) {
      return { ok: false, error: "Each screenshot must be under 1.2 MB." };
    }
    if (!looksLike(data, mimeType as ShotType)) {
      return { ok: false, error: "That file is not the image type it claims." };
    }
    shots.push({ name: cleanName(record.name), mimeType: mimeType as ShotType, data });
  }
  return { ok: true, shots };
}
