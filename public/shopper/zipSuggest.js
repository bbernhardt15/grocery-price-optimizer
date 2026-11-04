/**
 * A located ZIP is a suggestion. Census returns one code, and a coarse
 * iOS fix can be a city center, so the shopper picks from the nearest codes.
 */

import { milesBetween } from "./nearbyStores.js";
import { ZIP5_POINTS } from "./zipCentroids.js";
import { nearbyZipChoices } from "./zipNearby.js";

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} [limit]
 * @param {Record<string, [number, number]>} [points]
 */
export function nearestZipCodes(lat, lng, limit = 4, points = ZIP5_POINTS) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  return Object.entries(points || {})
    .map(([zip, point]) => ({
      zip,
      miles: Math.round(milesBetween([latitude, longitude], point) * 10) / 10,
    }))
    .filter((row) => Number.isFinite(row.miles))
    .sort((a, b) => a.miles - b.miles || a.zip.localeCompare(b.zip))
    .slice(0, Math.max(1, limit));
}

/**
 * Closest ZIPs within about 15 miles. A census code that is not near the
 * coordinates is left out, including a far ZIP3 such as 16885.
 * @param {{ lat?: number, lng?: number, zip?: string, approximate?: boolean }} input
 */
export function suggestZipChoices(input = {}) {
  return nearbyZipChoices(input);
}
