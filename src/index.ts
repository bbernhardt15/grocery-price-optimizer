import "dotenv/config";
import app from "./app";
import { connectDatabase } from "./db";

const PORT = Number(process.env.PORT) || 43141;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Grocery List Optimizer API listening on http://0.0.0.0:${PORT}`);
});

connectDatabase().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    `MongoDB is unavailable (${message}). The API will still serve routes; Product queries will fail until a database is running.`
  );
});
