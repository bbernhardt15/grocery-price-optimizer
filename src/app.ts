import path from "node:path";
import express from "express";
import cors from "cors";
import optimizeListRouter from "./routes/optimizeList";

const app = express();
const publicDir = path.join(__dirname, "..", "public");

app.use(cors());
app.use(express.json());

app.get("/api", (_req, res) => {
  res.json({
    name: "Grocery List Optimizer API",
    status: "ok",
    routes: {
      "POST /api/optimize-list":
        "Accepts groceryList, zipCode, and optional stores; looks up the nearest Kroger and returns items grouped by the cheapest store for each product.",
    },
  });
});

app.use("/api", optimizeListRouter);
app.use(express.static(publicDir));

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
