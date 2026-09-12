import express from "express";
import cors from "cors";
import optimizeListRouter from "./routes/optimizeList";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Grocery List Optimizer API",
    status: "ok",
    routes: {
      "POST /api/optimize-list":
        "Accepts groceryList and stores; returns items grouped by the cheapest store for each product.",
    },
  });
});

app.use("/api", optimizeListRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
