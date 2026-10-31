import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { observabilityResponse } from "./observability/config";
import { scrubString } from "./observability/scrub";
import { initSentry, setupSentryExpress } from "./observability/sentry";
import optimizeListRouter from "./routes/optimizeList";
import catalogRouter from "./routes/catalog";
import krogerCartRouter from "./routes/krogerCart";
import instacartShoppingListRouter from "./routes/instacartShoppingList";
import browseCatalogRouter from "./routes/browseCatalog";
import adminCatalogRouter from "./routes/adminCatalog";
import priceAlertsRouter from "./routes/priceAlerts";
import sharedListsRouter from "./routes/sharedLists";
import geoZipRouter from "./routes/geoZip";
import authRouter from "./routes/auth";
import billingRouter from "./routes/billing";
import { attachAccount } from "./auth/middleware";
import deleteMyDataRouter from "./routes/deleteMyData";
import importListRouter from "./routes/importList";

initSentry();

const app = express();
const publicDir = path.join(__dirname, "..", "public");

app.use(cors());
const jsonSmall = express.json({ limit: "100kb" });
const jsonMedia = express.json({ limit: "8mb" });
app.use((req, res, next) => {
  const media =
    req.method === "POST" &&
    (req.path === "/api/import/photo" || req.path === "/api/import/audio" || req.path === "/api/import/pdf");
  return (media ? jsonMedia : jsonSmall)(req, res, next);
});
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  if (req.path === "/sw.js") {
    // The shell worker must revalidate. A heuristic cache here keeps an old app open.
    res.setHeader("Cache-Control", "no-cache");
  } else if (!req.path.startsWith("/api")) {
    const durable = req.path === "/manifest.webmanifest" || req.path.startsWith("/icons/");
    if (!durable) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
    }
  }
  next();
});

app.get("/api", (_req, res) => {
  res.json({
    name: "Grocery Gitter API",
    status: "ok",
    routes: {
      "GET /api/search-catalog":
        "Accepts query and returns FatSecret catalog matches (id, name, brand).",
      "GET /api/catalog/browse":
        "Browse the unified catalog by department, search, sort, and filters. Offers that share a UPC are one product. Products that share a brand and flavor are one tile, with pack, size, and container in variants[]. Weekly-ad rows appear for a ZIP when Flipp is enabled. Demo catalog otherwise.",
      "GET /api/catalog/suggest":
        "Typeahead over the cached and demo catalog, one row per product family. The id is the default variant. Does not call retailer APIs.",
      "GET /api/catalog/departments":
        "Shared department tree.",
      "GET /api/catalog/coverage":
        "Honest per-store catalog coverage (taxonomy sample, search-seeded, weekly ad, or demo).",
      "GET /api/catalog/products/:id":
        "One grouped product plus substitute suggestions for stores that do not carry its UPC.",
      "GET /api/admin/catalog/family-sample":
        "How master products group into families (brand + flavor). Reports the share that collapsed into a multi-size tile and a few example groups. Same admin token as status. Optional department, q, limit, and scan.",
      "GET /api/admin/catalog/status":
        "Catalog ingestion progress, including the cross-store lookup queue, the stale-offer refresh queue, how many offers were refreshed today, refresh calls and offers attempted per source, calls used per source, the stale ratio, the effective refresh, match, and crawl shares, and recategorize job progress. Requires Authorization: Bearer $ADMIN_TOKEN (or x-admin-token). 503 when ADMIN_TOKEN is unset.",
      "GET /api/admin/catalog/suspicious":
        "Read-only audit of grocery departments for names that look like pet apparel, costumes, sweaters, dresses, toys, or decor. Returns a count per department plus examples. Same admin token as status. Nothing is deleted.",
      "POST /api/admin/catalog/recategorize":
        'Starts a background remap from stored category paths and returns a jobId immediately. Body { "confirm": "recategorize-catalog" }. Progress is on the status route (`clearedExclusions` and `setExclusions`). A grocery department clears refresh exclusion. Other sets it, including auto, tire, and RV rows that had been filed as household. Nothing is deleted.',
      "GET /api/admin/catalog/other-breakdown":
        "Top stored category paths in Other, with counts, three example names, and how many Other products have a Kroger id. Same admin token as status.",
      "GET /api/admin/catalog/match-queue":
        "Dry run of the next cross-store lookup batch. Does not call Walmart or Kroger and does not mark masters. Same admin token as status.",
      "POST /api/admin/catalog/exclude-nongrocery-refresh":
        'Marks offers for Other products that are still general merchandise so refresh skips them. Body { "confirm": "exclude-nongrocery-refresh" }. Nothing is deleted.',
      "POST /api/optimize-list":
        "Accepts groceryList or verified product objects (optional catalogId/upc from browse), zipCode, optional stores, and allowSubstitutes. Prices Kroger, Walmart, Target, partner feeds, and Flipp as before. Browse selections are pinned so the chosen product is priced; substitutes are labeled and used only when allowSubstitutes is true.",
      "GET /api/kroger/auth-status":
        "Whether authorization-code OAuth for Kroger Cart API is configured (requires KROGER_REDIRECT_URI registered on the Kroger developer app and Railway), and whether this browser’s shopper cookie is still signed in.",
      "POST /api/kroger/connect":
        "Optional Kroger sign-in with no cart items. Returns an authorize URL, or status connected when the shopper cookie is still valid. Does not call the Cart API.",
      "GET /api/geo/zip":
        "Looks up a 5-digit ZIP from lat and lng for the phone shells. Coordinates are not stored.",
      "POST /api/kroger/cart/start":
        "Starts shopper OAuth for PUT /v1/cart/add, or reuses a shopper cookie. Does nothing without KROGER_REDIRECT_URI and a UPC. Success is only claimed after Kroger HTTP 2xx.",
      "GET /api/kroger/oauth/callback":
        "Kroger redirect: exchanges the authorization code, then PUT /v1/cart/add, then sends the shopper back to the app with a success or error message. Cancel and API rejection pages also include Open at Kroger search links.",
      "GET /api/instacart/status":
        "Whether INSTACART_API_KEY and INSTACART_API_BASE_URL are set. Does not return the key. Separate from INSTACART_PARTNER_* price-feed stubs.",
      "POST /api/instacart/shopping-list":
        "Creates an Instacart Developer Platform shopping list (POST /idp/v1/products/products_link) and returns productsLinkUrl. Hidden in the UI when the key or base URL is unset.",
      "GET /api/price-alerts/status":
        "Whether browser notifications are on. Web Push is off until VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set. nativePush stays false until a phone transport is registered.",
      "PUT /api/price-alerts/watches":
        "Saves one shopping list's price-drop opt-in: list switch, optional per-item watch, the price when the item was saved, and an optional target. listId is the device list or a shared-list token.",
      "GET /api/price-alerts":
        "In-app alerts for a device: item, store, old price, new price, and savings. unread is the badge count.",
      "POST /api/price-alerts/seen":
        "Clears the badge for this device.",
      "POST /api/price-alerts/push":
        "Stores a Web Push subscription. 503 when VAPID keys are unset.",
      "DELETE /api/price-alerts/push":
        "Removes a Web Push subscription for this device.",
      "POST /api/lists":
        "Creates a shared shopping list, or resumes the one tied to a saved owner token. Returns the share token and owner token. There is no list of other people's lists.",
      "GET /api/lists/:shareToken":
        "Reads one shared list. ?since=seq returns changed:false when nothing is new. Owner header x-list-owner can still read a revoked link.",
      "GET /api/lists/:shareToken/events":
        "Server-sent events for one list. Polling the GET route is the fallback.",
      "PATCH /api/lists/:shareToken/items":
        "Edits items. Last write wins per item. View-only guests are refused. Rate limited.",
      "POST /api/lists/:shareToken/settings":
        "Owner only. mode view or edit, revoke, or rotate the link.",
      "GET /api/auth/status":
        "Which sign-in providers are configured. Enabled is false until AUTH_SECRET and at least one of Apple, Google, or email are set.",
      "POST /api/auth/apple":
        "Verifies a Sign in with Apple identity token, opens a session, and merges this device's list, watches, shared lists, and Kroger link.",
      "POST /api/auth/google":
        "Verifies a Google ID token and does the same merge.",
      "POST /api/auth/email/start":
        "Sends a one-time email link when RESEND_API_KEY and AUTH_EMAIL_FROM are set. 503 when they are not.",
      "GET /api/auth/me":
        "The signed-in account, or account null. Guest mode does not need this.",
      "PUT /api/me/list":
        "Saves the signed-in shopper's list. A newer revision from another device is merged per item.",
      "GET /api/billing/status":
        "Whether subscriptions are enforced, the current plan, the free and Pro limits, and the public RevenueCat SDK keys. Enforced is false until REVENUECAT_WEBHOOK_SECRET is set, and every feature stays available until then.",
      "POST /api/billing/revenuecat":
        "RevenueCat webhook. Stores entitlement pro on the account. 503 until the webhook secret is set. Unknown app user ids return stored false.",
      "POST /api/billing/refresh":
        "Signed-in only. Asks RevenueCat for this account when REVENUECAT_SECRET_API_KEY is set. Otherwise returns the stored plan.",
      "DELETE /api/me/data":
        "Deletes this device's price watches, alert records, and push subscriptions, and any shared list whose owner token is included. When a session is sent, also deletes that account and the other devices on it. Revokes and clears the Kroger shopper cookie when it is sent. Idempotent. ZIP totals, catalog-demand phrases, and Sentry crash reports are not tied to a device or account and are left in place.",
      "GET /api/kroger/logout":
        "Revokes and clears the Kroger shopper cookie in this browser. Used by the iOS and Android shells, where that cookie lives in the system browser. Idempotent.",
      "POST /api/import/text":
        "Parses a pasted list into catalog matches. Photo, voice, and suggestions stay off until IMPORT_VISION_PROVIDER / IMPORT_SPEECH_PROVIDER / IMPORT_AI_PROVIDER and a key are set. See docs/IMPORT.md.",
      "GET /api/observability":
        "Crash-reporting config for the website and the native shells. enabled is false when SENTRY_DSN is unset, and the body then has no DSN. The auth token is never returned.",
    },
  });
});

app.get("/api/observability", (_req, res) => {
  res.json(observabilityResponse());
});

app.use("/api", attachAccount);
app.use("/api", authRouter);
app.use("/api", billingRouter);
app.use("/api", catalogRouter);
app.use("/api", browseCatalogRouter);
app.use("/api", adminCatalogRouter);
app.use("/api", optimizeListRouter);
app.use("/api", krogerCartRouter);
app.use("/api", geoZipRouter);
app.use("/api", instacartShoppingListRouter);
app.use("/api", priceAlertsRouter);
app.use("/api", sharedListsRouter);
app.use("/api", deleteMyDataRouter);
app.use("/api", importListRouter);
app.get(["/privacy", "/privacy/", "/terms", "/terms/"], (req, res) => {
  const file = req.path.startsWith("/terms") ? "terms.html" : "privacy.html";
  res.sendFile(path.join(publicDir, file));
});

app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      const durable = /\/(sw\.js|manifest\.webmanifest|icons\/)/.test(filePath);
      if (!durable) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.sendFile(path.join(publicDir, "index.html"));
});

setupSentryExpress(app);

const onError: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = httpErrorStatus(err);
  const safe = status >= 500 ? "Something went wrong" : "Request failed";
  if (status >= 500) {
    const message = err instanceof Error ? err.message : "Unhandled error";
    console.error(`Request failed: ${scrubString(message)}`);
  }
  if (req.path.startsWith("/api")) {
    res.status(status).json({ error: safe });
    return;
  }
  res.status(status).type("html").send(`<!doctype html><title>Error</title><p>${safe}.</p>`);
};

app.use(onError);

function httpErrorStatus(error: unknown): number {
  if (typeof error === "object" && error) {
    for (const key of ["status", "statusCode"] as const) {
      const value = Number((error as Record<string, unknown>)[key]);
      if (value >= 400 && value < 600) return value;
    }
  }
  return 500;
}

export default app;
