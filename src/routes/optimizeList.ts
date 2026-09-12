import { Router, Request, Response } from "express";

const router = Router();

function parseGroceryItems(body: unknown): string[] | null {
  if (Array.isArray(body)) {
    return body.every((item) => typeof item === "string") ? body : null;
  }

  if (
    body !== null &&
    typeof body === "object" &&
    "items" in body &&
    Array.isArray((body as { items: unknown }).items)
  ) {
    const items = (body as { items: unknown[] }).items;
    return items.every((item) => typeof item === "string") ? items : null;
  }

  return null;
}

router.post("/optimize-list", (req: Request, res: Response) => {
  const items = parseGroceryItems(req.body);

  if (items === null) {
    res.status(400).json({
      error:
        "Request body must be an array of strings, or an object with an `items` string array.",
    });
    return;
  }

  // Placeholder: later this will match items to Product documents and pick the cheapest store mix.
  void items;
  res.json([]);
});

export default router;
