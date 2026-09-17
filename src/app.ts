import path from "node:path";
import express from "express";
import cors from "cors";
import optimizeListRouter from "./routes/optimizeList";
import catalogRouter from "./routes/catalog";
import krogerCartRouter from "./routes/krogerCart";

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
        "Accepts groceryList or verified product objects, zipCode, and optional stores; prices Kroger (Products API), Walmart (Affiliate API when configured), and Target (licensed partner feed when configured); returns a tripPlan, per-store checkout handoff, and pricingByStore freshness/source.",
      "GET /api/kroger/auth-status":
        "Whether authorization-code OAuth for Kroger Cart API is configured (requires KROGER_REDIRECT_URI).",
      "POST /api/kroger/cart/start":
        "Starts shopper OAuth for PUT /v1/cart/add. Does nothing without KROGER_REDIRECT_URI and a UPC.",
    },
  });
});

app.use("/api", catalogRouter);
app.use("/api", optimizeListRouter);
app.use("/api", krogerCartRouter);
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
