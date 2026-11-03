/**
 * A located ZIP is a suggestion. Census returns one code, and a coarse
 * iOS fix can be a city center, so the shopper picks from the nearest codes.
 */

import { milesBetween, pointForZip } from "./nearbyStores.js";
import { ZIP5_POINTS } from "./zipCentroids.js";

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

function digits(value) {
  const zip = String(value || "").replace(/\D/g, "");
  return zip.length >= 5 ? zip.slice(0, 5) : "";
}

/**
 * Prefer the ZIP whose centroid is actually near the coordinates.
 * A lone census ZIP stays available as a chip, and it is not the only choice.
 * @param {{ lat?: number, lng?: number, zip?: string, approximate?: boolean }} input
 */
export function suggestZipChoices(input = {}) {
  const detected = digits(input.zip);
  const approximate = input.approximate !== false;
  const ranked = nearestZipCodes(input.lat, input.lng, 8);
  const close = ranked.filter((row) => row.miles <= 25);
  const nearest = close[0]?.zip || "";
  const suggestion = approximate && nearest ? nearest : detected || nearest;
  /** @type {string[]} */
  const choices = [];
  const seen = new Set();
  const push = (zip) => {
    const code = digits(zip);
    if (!code || seen.has(code) || choices.length >= 4) return;
    seen.add(code);
    choices.push(code);
  };
  push(suggestion);
  push(detected);
  const prefixes = new Set();
  for (const row of close) {
    const prefix = row.zip.slice(0, 3);
    if (prefixes.has(prefix)) continue;
    prefixes.add(prefix);
    push(row.zip);
    if (prefixes.size >= 3) break;
  }
  for (const row of close) push(row.zip);
  const miles = suggestion ? close.find((row) => row.zip === suggestion)?.miles ?? pointMiles(input.lat, input.lng, suggestion) : null;
  return {
    zip: suggestion,
    detected,
    approximate,
    choices,
    miles,
  };
}

function pointMiles(lat, lng, zip) {
  const point = pointForZip(zip);
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!point || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return Math.round(milesBetween([latitude, longitude], point) * 10) / 10;
}
