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
        "Accepts a grocery list (string array) and will return optimized store picks. Currently returns [].",
    },
  });
});

app.use("/api", optimizeListRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
