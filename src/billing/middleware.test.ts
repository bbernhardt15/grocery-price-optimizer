import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { requirePro } from "./middleware";

function mockResponse(): Response & { statusCode: number; body: unknown } {
  const res = {
    locals: {} as Record<string, unknown>,
    statusCode: 0,
    body: null as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      this.headersSent = true;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("requirePro", () => {
  it("fails open while the webhook secret is unset", async () => {
    const previous = process.env.REVENUECAT_WEBHOOK_SECRET;
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    try {
      const res = mockResponse();
      let nexted = false;
      await requirePro({} as Request, res, () => {
        nexted = true;
      });
      assert.equal(nexted, true);
      assert.equal(res.statusCode, 0);
    } finally {
      if (previous === undefined) delete process.env.REVENUECAT_WEBHOOK_SECRET;
      else process.env.REVENUECAT_WEBHOOK_SECRET = previous;
    }
  });

  it("returns 402 for a guest once billing is enforced", async () => {
    const previous = process.env.REVENUECAT_WEBHOOK_SECRET;
    process.env.REVENUECAT_WEBHOOK_SECRET = "webhook-secret";
    try {
      const res = mockResponse();
      let nexted = false;
      await requirePro({} as Request, res, () => {
        nexted = true;
      });
      assert.equal(nexted, false);
      assert.equal(res.statusCode, 402);
      assert.equal((res.body as { code?: string }).code, "pro_required");
    } finally {
      if (previous === undefined) delete process.env.REVENUECAT_WEBHOOK_SECRET;
      else process.env.REVENUECAT_WEBHOOK_SECRET = previous;
    }
  });
});
