import { Router } from "express";
import { censusCoordinatesUrl, parseLatLng, zipFromCensus } from "../geo/zipFromPoint";

const router = Router();

/**
 * One-shot ZIP lookup for the phone shells. The coordinates are not stored.
 * The website does not call this unless the shopper is in a native shell.
 */
router.get("/geo/zip", async (req, res) => {
  const point = parseLatLng(req.query.lat, req.query.lng);
  if (!point) {
    res.status(400).json({
      error: "lat and lng must be numbers. lat is -90 to 90. lng is -180 to 180.",
    });
    return;
  }

  try {
    const response = await fetch(censusCoordinatesUrl(point.lat, point.lng), {
      headers: { Accept: "application/json", "User-Agent": "GroceryGitter/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      res.status(502).json({ error: "Could not look up a ZIP from that location." });
      return;
    }
    const zip = zipFromCensus(await response.json().catch(() => null));
    if (!zip) {
      res.status(404).json({ error: "No ZIP for that location. Type one instead." });
      return;
    }
    res.json({ zip });
  } catch {
    res.status(502).json({ error: "Could not look up a ZIP from that location." });
  }
});

export default router;
