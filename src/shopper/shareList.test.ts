import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apiUrl,
  attributionLine,
  deliverShare,
  isShareCancel,
  listTokenFromPath,
  mergeSnapshot,
  sharePageUrl,
  shareTransport,
  visibleItems,
} from "../../public/shopper/shareList.js";

const TOKEN = "A".repeat(43);

describe("share links and apiUrl", () => {
  it("reads a list token from /list/:token and ignores other paths", () => {
    assert.equal(listTokenFromPath(`/list/${TOKEN}`), TOKEN);
    assert.equal(listTokenFromPath(`/list/${TOKEN}/`), TOKEN);
    assert.equal(listTokenFromPath("/list/short"), null);
    assert.equal(listTokenFromPath("/list/../admin"), null);
    assert.equal(listTokenFromPath(`/aisle/${TOKEN}`), null);
  });

  it("builds the share link from apiUrl so a Capacitor origin is not copied", () => {
    const hosted = sharePageUrl(TOKEN, {
      apiUrl: "https://grocery.example/",
      locationHref: "capacitor://localhost/index.html",
    });
    assert.equal(hosted, `https://grocery.example/list/${TOKEN}`);

    const fromFunction = sharePageUrl(TOKEN, {
      apiUrl: (path: string) => `https://grocery.example${path}`,
      locationHref: "https://localhost/index.html",
    });
    assert.equal(fromFunction, `https://grocery.example/list/${TOKEN}`);

    assert.equal(apiUrl("/api/lists", { apiUrl: "https://grocery.example" }), "https://grocery.example/api/lists");
    assert.equal(
      sharePageUrl(TOKEN, { apiUrl: "", locationHref: "https://shop.example/aisle" }),
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
