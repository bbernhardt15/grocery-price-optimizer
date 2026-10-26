const CENSUS_COORDINATES =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";

const ZIP_KEYS = ["ZCTA5CE20", "ZCTA5CE10", "ZCTA5", "BASENAME", "GEOID"] as const;

export function parseLatLng(
  latRaw: unknown,
  lngRaw: unknown
): { lat: number; lng: number } | null {
  if (latRaw === undefined || latRaw === null || lngRaw === undefined || lngRaw === null) return null;
  if (typeof latRaw === "string" && latRaw.trim() === "") return null;
  if (typeof lngRaw === "string" && lngRaw.trim() === "") return null;
  const lat = typeof latRaw === "number" ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === "number" ? lngRaw : Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Pull a 5-digit ZIP from a Census coordinates response. Coordinates are not kept. */
export function zipFromCensus(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const geographies = (body as { result?: { geographies?: unknown } }).result?.geographies;
  if (!geographies || typeof geographies !== "object") return "";
  for (const rows of Object.values(geographies as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      for (const key of ZIP_KEYS) {
        const match = String(record[key] ?? "").match(/\b(\d{5})\b/);
        if (match) return match[1];
      }
    }
  }
  return "";
}

export function censusCoordinatesUrl(lat: number, lng: number): string {
  const url = new URL(CENSUS_COORDINATES);
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");
  return url.toString();
}
