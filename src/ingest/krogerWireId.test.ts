import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { KROGER_LOOKUP_FORMATS, krogerLookupCodes, krogerWireId, type KrogerLookupFormat } from "../catalog/normalize";
import { KrogerService } from "../krogerService";
import { krogerProductIdList } from "./krogerBatch";
import { krogerRefreshCode } from "./refresh";

const UPC = "049000042566";
const STORED = "0004900004256";
const WIRE: Record<Exclude<KrogerLookupFormat, "plu">, string> = {
  "no-check": "0004900004256",
  "with-check": "0049000042566",
  "upc-a": "049000042566",
  "gtin-14": "00049000042566",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KROGER_LOOKUP_FORMAT;
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
});

function productFetch(urls: string[]): void {
  process.env.KROGER_CLIENT_ID = "client-id";
  process.env.KROGER_CLIENT_SECRET = "client-secret";
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/connect/oauth2/token")) {
      return Response.json({ access_token: "test-token", expires_in: 1800 });
    }
    return Response.json({ data: [] });
  };
}

describe("Kroger lookup format is the wire id", () => {
  for (const format of KROGER_LOOKUP_FORMATS) {
    if (format === "plu") continue;
    it(`sends ${format} verbatim for match and refresh`, async () => {
      const wire = WIRE[format];
      process.env.KROGER_LOOKUP_FORMAT = format;
      assert.equal(krogerWireId(UPC), wire);
      assert.equal(krogerWireId(STORED), wire);
      assert.deepEqual(krogerLookupCodes(UPC), [wire]);
      assert.deepEqual(krogerProductIdList([STORED]), [wire]);
      assert.equal(krogerRefreshCode({ krogerProductId: STORED, upc: UPC, key: UPC }), wire);
      delete process.env.KROGER_LOOKUP_FORMAT;

      const urls: string[] = [];
      productFetch(urls);
      const service = new KrogerService();
      await service.productsByWireId(wire, "01400902");
      await service.productsByWireIds([wire], "01400902");
      process.env.KROGER_LOOKUP_FORMAT = format;
      await service.productsByIds([STORED], "01400902");
      delete process.env.KROGER_LOOKUP_FORMAT;

      const sent = urls.filter((url) => url.includes("/products?"));
      assert.equal(sent.length, 3);
      for (const url of sent) {
        assert.equal(new URL(url).searchParams.get("filter.productId"), wire);
      }
    });
  }

  it("sends nothing for plu on a normal UPC and only the padded PLU for a produce code", async () => {
    process.env.KROGER_LOOKUP_FORMAT = "plu";
    assert.equal(krogerWireId(UPC), null);
    assert.deepEqual(krogerLookupCodes(UPC), []);
    assert.deepEqual(krogerProductIdList([UPC]), []);
    assert.equal(krogerRefreshCode({ krogerProductId: STORED, upc: UPC, key: UPC }), null);
    assert.equal(krogerWireId("0000000004011"), "0000000004011");
    assert.deepEqual(krogerProductIdList(["4011"]), ["0000000004011"]);
    assert.equal(krogerRefreshCode({ krogerProductId: "0000000004011", upc: "4011", key: "4011" }), "0000000004011");

    const urls: string[] = [];
    productFetch(urls);
    const service = new KrogerService();
    const empty = await service.productsByIds([UPC]);
    assert.equal(empty.returned, 0);
    assert.equal(urls.some((url) => url.includes("/products?")), false);
    delete process.env.KROGER_LOOKUP_FORMAT;
    await service.productsByWireId("0000000004011");
    await service.probeProducts({ productId: "049000042566" });
    await service.probeProducts({ productId: "00049000042566" });
    const sent = urls.filter((url) => url.includes("/products?")).map((url) => new URL(url).searchParams.get("filter.productId"));
    assert.deepEqual(sent, ["0000000004011", "049000042566", "00049000042566"]);
    const rewritten = await service.productsById("049000042566");
    assert.equal(rewritten.returned, 0);
    const shopper = urls.filter((url) => url.includes("/products?")).at(-1) ?? "";
    assert.match(shopper, /filter\.productId=0004900004256(?:&|$)/);
  });
});
