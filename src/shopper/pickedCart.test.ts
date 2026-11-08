import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickedLineHtml, placePickedLine } from "../../public/shopper/pickedCart.js";

function element(html: string) {
  const node = {
    html,
    attrs: {} as Record<string, string>,
    children: [] as ReturnType<typeof element>[],
    getAttribute(name: string) {
      return this.attrs[name] || null;
    },
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
    querySelector(selector: string) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector: string): Array<ReturnType<typeof element>> {
      const walk = (node: ReturnType<typeof element>): Array<ReturnType<typeof element>> => [node, ...node.children.flatMap((child) => walk(child))];
      const all = walk(this);
      if (selector === "*") return this.children;
      if (selector === "[data-store]") return all.filter((row) => row.attrs["data-store"]);
      if (selector === ".review-lines") return all.filter((row) => row.className === "review-lines");
      if (selector === ".review-store-meta span") return all.filter((row) => row.tag === "span");
      if (selector === ".review-store-meta strong") return all.filter((row) => row.tag === "strong");
      if (selector === "[data-review-line]") return all.filter((row) => row.attrs["data-review-line"]);
      return [];
    },
    insertAdjacentHTML(_where: string, markup: string) {
      const line = element("");
      const id = markup.match(/data-review-line="([^"]+)"/);
      line.attrs["data-review-line"] = id?.[1] || "";
      line.className = "review-line";
      this.children.push(line);
    },
    className: "",
    tag: "",
    textContent: "",
  };
  return node;
}

describe("picked cart line", () => {
  it("prints the catalog price the shopper picked and no price when there is none", () => {
    assert.match(pickedLineHtml({ title: "Kroger Large Eggs", lineId: "pref-egg", price: 2.19, quantity: 1, itemTotal: 2.19 }), /\$2\.19/);
    assert.match(pickedLineHtml({ title: "Kroger Large Eggs", lineId: "pref-egg", price: 2.19, quantity: 1, itemTotal: 2.19 }), /data-picked-line="1"/);
    assert.equal(pickedLineHtml({ title: "Eggs", lineId: "pref-egg" }).includes("$"), false);
  });

  it("adds the line to that store and leaves the other cart alone", () => {
    const krogerList = element("");
    krogerList.className = "review-lines";
    const walmartList = element("");
    walmartList.className = "review-lines";
    const count = element("");
    count.tag = "span";
    count.textContent = "1 line";
    const total = element("");
    total.tag = "strong";
    total.textContent = "$3.20";
    const kroger = element("");
    kroger.attrs["data-store"] = "Kroger";
    kroger.children.push(krogerList, count, total);
    const walmart = element("");
    walmart.attrs["data-store"] = "Walmart";
    walmart.children.push(walmartList);
    const root = element("");
    root.children.push(kroger, walmart);
    const placed = placePickedLine(root, { storeName: "Kroger", lineId: "pref-egg", title: "Kroger Large Eggs", price: 2.19, quantity: 1 });
    assert.equal(placed.placed, true);
    assert.equal(placed.reason, "added");
    assert.equal(krogerList.children.length, 1);
    assert.equal(walmartList.children.length, 0);
    assert.equal(count.textContent, "2 lines");
    assert.equal(total.textContent, "$5.39");
    const again = placePickedLine(root, { storeName: "Kroger", lineId: "pref-egg", title: "Kroger Large Eggs", price: 2.19 });
    assert.equal(again.reason, "already");
    assert.equal(krogerList.children.length, 1);
    const missing = placePickedLine(root, { storeName: "Target", lineId: "x", title: "Bread", price: 1 });
    assert.equal(missing.placed, false);
  });
});
