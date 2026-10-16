import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  attributionLine,
  deliverShare,
  isShareCancel,
  listTokenFromPath,
  mergeSnapshot,
  sharePageUrl,
  shareTransport,
  visibleItems,
} from "../../public/shopper/shareList.js";

const require = createRequire(import.meta.url);
const { resolveApiOrigin } = require("../../public/native-shell.js") as {
  resolveApiOrigin: (input: {
    native?: boolean;
    location?: { protocol?: string; hostname?: string };
    configured?: string;
  }) => string;
};

const TOKEN = "A".repeat(43);
const PRODUCTION = "https://grocery-price-optimizer-production.up.railway.app";

describe("share links and apiUrl", () => {
  it("reads a list token from /list/:token and ignores other paths", () => {
    assert.equal(listTokenFromPath(`/list/${TOKEN}`), TOKEN);
    assert.equal(listTokenFromPath(`/list/${TOKEN}/`), TOKEN);
    assert.equal(listTokenFromPath("/list/short"), null);
    assert.equal(listTokenFromPath("/list/../admin"), null);
    assert.equal(listTokenFromPath(`/aisle/${TOKEN}`), null);
  });

  it("builds the share link from the hosted origin apiUrl() uses", () => {
    const bundled = resolveApiOrigin({
      native: true,
      location: { protocol: "capacitor:", hostname: "localhost" },
      configured: "",
    });
    assert.equal(
      sharePageUrl(TOKEN, { apiOrigin: bundled, locationHref: "capacitor://localhost/index.html" }),
      `${PRODUCTION}/list/${TOKEN}`
    );

    const staging = resolveApiOrigin({
      native: true,
      location: { protocol: "https:", hostname: "localhost" },
      configured: "https://staging.example/",
    });
    assert.equal(
      sharePageUrl(TOKEN, { apiOrigin: staging, locationHref: "https://localhost/index.html" }),
      `https://staging.example/list/${TOKEN}`
    );

    const website = resolveApiOrigin({
      native: false,
      location: { protocol: "https:", hostname: "shop.example" },
      configured: PRODUCTION,
    });
    assert.equal(website, "");
    assert.equal(
      sharePageUrl(TOKEN, { apiOrigin: website, locationHref: "https://shop.example/aisle" }),
      `https://shop.example/list/${TOKEN}`
    );
  });
});

describe("share sheet choice", () => {
  it("prefers the Capacitor share plugin, then the browser sheet, then copy", async () => {
    const calls: string[] = [];
    assert.equal(
      shareTransport({
        capacitorShare: { share: async () => calls.push("capacitor") },
        navigatorShare: async () => calls.push("web"),
      }),
      "capacitor"
    );
    assert.equal(shareTransport({ navigatorShare: async () => undefined }), "web-share");
    assert.equal(shareTransport({}), "copy");

    const how = await deliverShare(
      { title: "List", text: "Shop this list", url: "https://grocery.example/list/abc" },
      {
        capacitorShare: {
          share: async (payload: { url?: string; dialogTitle?: string }) => {
            calls.push(`capacitor:${payload.url}:${payload.dialogTitle}`);
          },
        },
        navigatorShare: async () => calls.push("web"),
        copy: async () => calls.push("copy"),
      }
    );
    assert.equal(how, "capacitor");
    assert.equal(calls[0], "capacitor:https://grocery.example/list/abc:Share list");

    const copied = await deliverShare(
      { title: "List", text: "Shop", url: "https://grocery.example/list/abc" },
      { copy: async (url: string) => calls.push(`copy:${url}`) }
    );
    assert.equal(copied, "copy");
    assert.equal(isShareCancel({ name: "AbortError" }), true);
    assert.equal(isShareCancel(new Error("nope")), false);
  });
});

describe("shared list sync on the device", () => {
  it("shows who added or checked an item only when a name exists", () => {
    assert.equal(attributionLine({ addedBy: "Sam", checked: true, checkedBy: "Alex" }), "Added by Sam · Checked off by Alex");
    assert.equal(attributionLine({ checked: true }), "");
    assert.equal(attributionLine({ addedBy: "Sam", checked: false, checkedBy: "Alex" }), "Added by Sam");
  });

  it("keeps a newer pending edit and a remote delete with a later timestamp", () => {
    const remote = [
      { itemId: "milk", name: "Milk", quantity: 1, writtenAt: 10, deleted: false },
      { itemId: "bread", name: "Bread", quantity: 1, writtenAt: 30, deleted: true },
    ];
    const local = [
      { itemId: "milk", name: "Milk", quantity: 4, writtenAt: 20, deleted: false },
      { itemId: "bread", name: "Bread", quantity: 2, writtenAt: 15, deleted: false },
      { itemId: "eggs", name: "Eggs", quantity: 1, writtenAt: 25, deleted: false },
    ];
    const merged = mergeSnapshot(local, remote, new Set(["milk", "bread", "eggs"]));
    const byId = Object.fromEntries(merged.map((item) => [item.itemId, item]));
    assert.equal(byId.milk.quantity, 4);
    assert.equal(byId.bread.deleted, true);
    assert.equal(byId.eggs.name, "Eggs");
    assert.deepEqual(
      visibleItems(merged).map((item) => item.itemId),
      ["milk", "eggs"]
    );

    const remoteWins = mergeSnapshot(
      [{ itemId: "milk", quantity: 1, writtenAt: 5 }],
      [{ itemId: "milk", quantity: 3, writtenAt: 9 }],
      ["milk"]
    );
    assert.equal(remoteWins[0]?.quantity, 3);
  });
});
