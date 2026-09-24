import path from "node:path";
import express from "express";
import cors from "cors";
import optimizeListRouter from "./routes/optimizeList";
import catalogRouter from "./routes/catalog";
import krogerCartRouter from "./routes/krogerCart";
import instacartShoppingListRouter from "./routes/instacartShoppingList";

const app = express();
const publicDir = path.join(__dirname, "..", "public");

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
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
      "POST /api/optimize-list":
        "Accepts groceryList or verified product objects, zipCode, and optional stores; prices Kroger (Products API), Walmart (Affiliate API when configured), Target (licensed partner feed when configured), env-gated partner feeds (SHELF_FEED / INSTACART_PARTNER / PUBLIX_PARTNER / HEB_PARTNER / MEIJER_PARTNER), and Flipp weekly-ad deals when FLIPP_ENABLED or FLIPP_ACCESS_TOKEN is set; returns a tripPlan, per-store checkout handoff, and pricingByStore freshness/source.",
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
    },
  });
});

app.use("/api", catalogRouter);
app.use("/api", optimizeListRouter);
app.use("/api", krogerCartRouter);
app.use("/api", instacartShoppingListRouter);
app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
