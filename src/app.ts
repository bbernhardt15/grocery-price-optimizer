import path from "node:path";
import express from "express";
import cors from "cors";
import optimizeListRouter from "./routes/optimizeList";
import catalogRouter from "./routes/catalog";
import krogerCartRouter from "./routes/krogerCart";
import instacartShoppingListRouter from "./routes/instacartShoppingList";
import browseCatalogRouter from "./routes/browseCatalog";
import adminCatalogRouter from "./routes/adminCatalog";
import priceAlertsRouter from "./routes/priceAlerts";
import sharedListsRouter from "./routes/sharedLists";
import deleteMyDataRouter from "./routes/deleteMyData";

const app = express();
const publicDir = path.join(__dirname, "..", "public");

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    const durable =
      req.path === "/sw.js" ||
      req.path === "/manifest.webmanifest" ||
      req.path.startsWith("/icons/");
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
        "Browse the unified catalog by department, search, sort, and filters. Groups offers by UPC. Weekly-ad rows appear for a ZIP when Flipp is enabled. Demo catalog otherwise.",
      "GET /api/catalog/suggest":
        "Typeahead over the cached and demo catalog. Does not call retailer APIs.",
      "GET /api/catalog/departments":
        "Shared department tree.",
      "GET /api/catalog/coverage":
        "Honest per-store catalog coverage (taxonomy sample, search-seeded, weekly ad, or demo).",
      "GET /api/catalog/products/:id":
        "One grouped product plus substitute suggestions for stores that do not carry its UPC.",
      "GET /api/admin/catalog/status":
        "Catalog ingestion progress, including the cross-store lookup queue, the stale-offer refresh queue, how many offers were refreshed today, and recategorize job progress. Requires Authorization: Bearer $ADMIN_TOKEN (or x-admin-token). 503 when ADMIN_TOKEN is unset.",
      "POST /api/admin/catalog/recategorize":
        'Starts a background remap from stored category paths and returns a jobId immediately. Body { "confirm": "recategorize-catalog" }. Progress is on the status route. A product that leaves Other has refresh exclusion cleared. Nothing is deleted.',
      "GET /api/admin/catalog/other-breakdown":
        "Top stored category paths in Other, with counts, three example names, and how many Other products have a Kroger id. Same admin token as status.",
      "GET /api/admin/catalog/match-queue":
        "Dry run of the next cross-store lookup batch. Does not call Walmart or Kroger and does not mark masters. Same admin token as status.",
      "POST /api/admin/catalog/exclude-nongrocery-refresh":
        'Marks offers for Other products that are still general merchandise so refresh skips them. Body { "confirm": "exclude-nongrocery-refresh" }. Nothing is deleted.',
      "POST /api/optimize-list":
        "Accepts groceryList or verified product objects (optional catalogId/upc from browse), zipCode, optional stores, and allowSubstitutes. Prices Kroger, Walmart, Target, partner feeds, and Flipp as before. Browse selections are pinned so the chosen product is priced; substitutes are labeled and used only when allowSubstitutes is true.",
      "GET /api/kroger/auth-status":
        "Whether authorization-code OAuth for Kroger Cart API is configured (requires KROGER_REDIRECT_URI registered on the Kroger developer app and Railway).",
      "POST /api/kroger/cart/start":
        "Starts shopper OAuth for PUT /v1/cart/add, or reuses a shopper cookie. Does nothing without KROGER_REDIRECT_URI and a UPC. Success is only claimed after Kroger HTTP 2xx.",
      "GET /api/kroger/oauth/callback":
        "Kroger redirect: exchanges the authorization code, then PUT /v1/cart/add. Falls back to Open at Kroger search links on cancel or API rejection.",
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
      "DELETE /api/me/data":
        "Deletes this device's price watches, alert records, and push subscriptions, and any shared list whose owner token is included. Revokes and clears the Kroger shopper cookie when it is sent. Idempotent. ZIP totals and catalog-demand phrases are not tied to a device and are left in place.",
      "GET /api/kroger/logout":
        "Revokes and clears the Kroger shopper cookie in this browser. Used by the iOS and Android shells, where that cookie lives in the system browser. Idempotent.",
    },
  });
});

app.use("/api", catalogRouter);
app.use("/api", browseCatalogRouter);
app.use("/api", adminCatalogRouter);
app.use("/api", optimizeListRouter);
app.use("/api", krogerCartRouter);
app.use("/api", instacartShoppingListRouter);
app.use("/api", priceAlertsRouter);
app.use("/api", sharedListsRouter);
app.use("/api", deleteMyDataRouter);
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

export default app;
