/**
 * Nearby ZIP chips for "Use my location".
 *
 * The old list pushed the census code even when it was nowhere near the
 * phone, then preferred a different ZIP3 prefix over a closer code in the
 * same prefix. That is how 45102, 16885, 45244, and 45103 showed up together:
 * 16885 is Julian, Pennsylvania, and its ZIP3 center is about 350 miles from
 * Cincinnati. Chips are now the closest codes within about 15 miles, nearest
 * first. A short list stays short. Nothing farther is added to fill it out.
 */

import { milesBetween, pointForZip } from "./nearbyStores.js";
import { ZIP5_POINTS } from "./zipCentroids.js";

export const NEARBY_ZIP_MILES = 15;
export const NEARBY_ZIP_CAP = 4;

function digits(value) {
  const zip = String(value || "").replace(/\D/g, "");
  return zip.length >= 5 ? zip.slice(0, 5) : "";
}

function roundMiles(miles) {
  return Math.round(miles * 10) / 10;
}

/**
 * @param {{ lat?: number, lng?: number, zip?: string, approximate?: boolean, points?: Record<string, [number, number]> }} input
 */
export function nearbyZipChoices(input = {}) {
  const detected = digits(input.zip);
  const approximate = input.approximate !== false;
  const latitude = Number(input.lat);
  const longitude = Number(input.lng);
  const empty = { zip: "", detected, approximate, choices: [], miles: null };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return empty;
  const points = input.points || ZIP5_POINTS;
  /** @type {{ zip: string, miles: number }[]} */
  const rows = [];
  const seen = new Set();
  const pushPoint = (zip, point) => {
    if (!zip || seen.has(zip) || !point) return;
    const miles = roundMiles(milesBetween([latitude, longitude], point));
    if (!Number.isFinite(miles) || miles > NEARBY_ZIP_MILES) return;
    seen.add(zip);
    rows.push({ zip, miles });
  };
  for (const [zip, point] of Object.entries(points || {})) pushPoint(zip, point);
  if (detected && !seen.has(detected)) pushPoint(detected, pointForZip(detected));
  rows.sort((a, b) => a.miles - b.miles || a.zip.localeCompare(b.zip));
  const choices = rows.slice(0, NEARBY_ZIP_CAP).map((row) => row.zip);
  return {
    zip: choices[0] || "",
    detected,
    approximate,
    choices,
    miles: rows[0]?.miles ?? null,
  };
}
