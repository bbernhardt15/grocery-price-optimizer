import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEARCH_QUERY_MAX,
  buildStoreReadyList,
  cleanSearchQuery,
  csvFilename,
  escapeCsvField,
  formatStoreReadyCsv,
  formatStoreReadyText,
  shareStoreList,
  storeReadyHint,
  storeSearchLinkTarget,
  storeSearchUrl,
  stripSearchSymbols,
  usesStoreReadyList,
} from "../../public/shopper/storeReadyList.js";

const milk = {
  query: "whole milk",
  lineId: "0:milk",
  name: "Friendly Farms Vitamin D Whole Milk Gallon Jug, 128 fl oz, Plastic",
  familyName: "Whole Milk",
  brand: "Friendly Farms",
  size: "1 gal",
  quantity: 2,
  price: 2.19,
  itemTotal: 4.38,
  department: "Dairy & Eggs",
  aisle: "Milk",
};

const bread = {
  query: "bread",
  lineId: "1:bread",
  name: "L'oven Fresh White Bread, 20 oz",
  familyName: "White Bread",
  brand: "L'oven Fresh",
  size: "20 oz",
  quantity: 1,
  price: 1.79,
  itemTotal: 1.79,
  department: "Bakery",
  aisle: "Bread",
};

const chips = {
  query: "chips",
  lineId: "2:chips",
  name: "Clancy's Potato Chips",
  familyName: "Potato Chips",
  brand: "Clancy's",
  size: "8 oz",
  quantity: 3,
  price: 1.49,
  itemTotal: 4.47,
  department: "Snacks",
  aisle: "Chips",
};

const target = {
  storeName: "Target",
  subtotal: 10.64,
  items: [chips, bread, milk],
};

describe("store-ready list formatting", () => {
  it("groups by aisle, keeps quantities, and totals the store", () => {
    const text = formatStoreReadyText(target);
    const milkAt = text.indexOf("Dairy & Eggs · Milk");
    const breadAt = text.indexOf("Bakery · Bread");
    const chipsAt = text.indexOf("Snacks · Chips");
    assert.ok(milkAt >= 0 && breadAt > milkAt && chipsAt > breadAt);
    assert.match(text, /2 × Friendly Farms Vitamin D Whole Milk Gallon Jug, 128 fl oz, Plastic, 1 gal — \$4\.38/);
    assert.match(text, /1 × L'oven Fresh White Bread, 20 oz — \$1\.79/);
    assert.match(text, /3 × Clancy's Potato Chips, 8 oz — \$4\.47/);
    assert.match(text, /Subtotal \$10\.64/);
    const milkLine = buildStoreReadyList(target).groups.find((group) => group.aisle === "Milk")?.items[0];
    assert.equal(milkLine?.searchQuery, "Whole Milk 1 gal");
    assert.doesNotMatch(milkLine?.searchQuery || "", /Plastic/);

    const model = buildStoreReadyList({
      storeName: "Aldi",
      items: [chips, { ...milk, itemTotal: undefined, price: 2.19 }],
    });
    assert.equal(model.groups[0]?.department, "Dairy & Eggs");
    assert.equal(model.groups[0]?.items[0]?.quantity, 2);
    assert.equal(model.subtotalLabel, "$8.85");
  });

  it("leaves the price off a line when it is not known", () => {
    const text = formatStoreReadyText({
      storeName: "Aldi",
      items: [{ ...bread, price: undefined, itemTotal: undefined, department: "Bakery", aisle: "" }],
    });
    assert.match(text, /1 × L'oven Fresh White Bread, 20 oz$/m);
    assert.doesNotMatch(text, /Subtotal/);
  });

  it("uses the trip subtotal when the plan already has one", () => {
    const model = buildStoreReadyList({ storeName: "Costco", subtotal: 12, items: [bread] });
    assert.equal(model.subtotalLabel, "$12.00");
  });
});

describe("store search links", () => {
  it("strips symbols, keeps the short name and size, and caps the length", () => {
    assert.equal(stripSearchSymbols("Ben & Jerry's®"), "Ben and Jerrys");
    const short = cleanSearchQuery(milk);
    assert.equal(short, "Whole Milk 1 gal");
    assert.ok(short.length <= SEARCH_QUERY_MAX);
    assert.doesNotMatch(short, /Plastic|Gallon Jug|®/);

    const titled = cleanSearchQuery({
      name: "Coca-Cola® Zero Sugar Soda Pop Bottles, 16.9 fl oz, 6 Pack",
      query: "coke zero",
      size: "16.9 fl oz, 6 Pack",
    });
    assert.equal(titled, "coke zero 16.9 fl oz 6 Pack");
    assert.doesNotMatch(titled, /Bottles|Soda Pop|®/);

    const noisy = cleanSearchQuery({
      name: "Half & Half!",
      size: "1 qt",
    });
    assert.equal(noisy, "Half and Half 1 qt");

    const longName = Array.from({ length: 30 }, () => "oatmeal").join(" ");
    const capped = cleanSearchQuery({ name: longName });
    assert.ok(capped.length <= SEARCH_QUERY_MAX);
    assert.doesNotMatch(capped, /oatmealoatmeal/);
    assert.match(capped, /^oatmeal( oatmeal)*$/);
  });

  it("builds universal https search links for Target, Costco, Sam's Club, and Aldi", () => {
    const item = {
      name: "Kirkland® Organic Eggs, 24 count, cage free!!!",
      familyName: "Organic Eggs",
      size: "24 ct",
    };
    const phrase = "Organic Eggs 24 ct";
    const targetUrl = new URL(storeSearchUrl("Target", item));
    assert.equal(targetUrl.origin + targetUrl.pathname, "https://www.target.com/s");
    assert.equal(targetUrl.searchParams.get("searchTerm"), phrase);

    const costcoUrl = new URL(storeSearchUrl("Costco", item));
    assert.equal(costcoUrl.origin + costcoUrl.pathname, "https://www.costco.com/CatalogSearch");
    assert.equal(costcoUrl.searchParams.get("keyword"), phrase);

    const sams = storeSearchUrl("Sam's Club", item);
    assert.equal(decodeURIComponent(new URL(sams).pathname.replace(/^\/s\//, "")), phrase);
    assert.match(sams, /^https:\/\/www\.samsclub\.com\/s\//);

    const aldiUrl = new URL(storeSearchUrl("Aldi", item));
    assert.equal(aldiUrl.origin + aldiUrl.pathname, "https://www.aldi.us/store/aldi/s");
    assert.equal(aldiUrl.searchParams.get("k"), phrase);

    assert.equal(storeSearchUrl("Giant Eagle", item), "");
    assert.equal(storeSearchUrl("Kroger", item), "");
    assert.equal(storeSearchUrl("Walmart", item), "");
    assert.equal(usesStoreReadyList("Target"), true);
    assert.equal(usesStoreReadyList("Costco"), true);
    assert.equal(usesStoreReadyList("Kroger"), false);
    assert.equal(usesStoreReadyList("Walmart"), false);
  });

  it("keeps the phone on the same tab so the store app can open", () => {
    assert.equal(
      storeSearchLinkTarget({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }),
      ""
    );
    assert.equal(storeSearchLinkTarget({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }), "");
    assert.equal(storeSearchLinkTarget({ platform: "MacIntel", maxTouchPoints: 5 }), "");
    assert.equal(storeSearchLinkTarget({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), "_blank");
  });
});

describe("store-ready CSV", () => {
  it("escapes commas, quotes, and line breaks", () => {
    assert.equal(escapeCsvField("plain"), "plain");
    assert.equal(escapeCsvField('Milk, "Whole"'), '"Milk, ""Whole"""');
    assert.equal(escapeCsvField("1 gal\njug"), '"1 gal\njug"');

    const csv = formatStoreReadyCsv({
      storeName: "Aldi",
      items: [
        {
          ...milk,
          name: 'Friendly "Farms", Milk',
          familyName: "Whole Milk",
          size: "1 gal\njug",
          department: "Dairy & Eggs",
          aisle: "Milk, back",
        },
      ],
    });
    assert.match(csv, /^Department,Aisle,Quantity,Product,Size,Expected price/);
    assert.match(csv, /"Milk, back",2,"Friendly ""Farms"", Milk","1 gal\njug",\$4\.38/);
    assert.match(csv, /Subtotal,,\$4\.38$/);
    assert.equal(csvFilename("Sam's Club"), "sams-club-list.csv");
  });
});

describe("how to get the list into the store", () => {
  it("tells the truth for clubs, Aldi, Target, and a store with no search page", () => {
    assert.match(storeReadyHint("Costco"), /search links/i);
    assert.match(storeReadyHint("Sam's Club"), /no cart connection/i);
    assert.match(storeReadyHint("Target"), /aisle order/i);
    assert.match(storeReadyHint("Aldi"), /Search/i);
    assert.match(storeReadyHint("Giant Eagle"), /no search link/i);
    for (const name of ["Costco", "Sam's Club", "Target", "Aldi", "Publix", "Giant Eagle"]) {
      const hint = storeReadyHint(name);
      assert.doesNotMatch(hint, /Instacart|import your cart|connected|PowerShell|OAuth/i);
    }
  });
});

describe("share falls back to copy", () => {
  it("uses the share sheet, then copies the list text", async () => {
    const calls: string[] = [];
    const copied = await shareStoreList(
      { title: "Aldi list", text: "2 × Whole Milk" },
      { copy: async (text: string) => calls.push(`copy:${text}`) }
    );
    assert.equal(copied, "copy");
    assert.equal(calls[0], "copy:2 × Whole Milk");

    const shared = await shareStoreList(
      { title: "Target list", text: "1 × Bread" },
      {
        navigatorShare: async (payload: { title?: string; text?: string }) => {
          calls.push(`web:${payload.title}:${payload.text}`);
        },
        copy: async () => calls.push("copy"),
      }
    );
    assert.equal(shared, "web-share");
    assert.equal(calls[1], "web:Target list:1 × Bread");

    const fallback = await shareStoreList(
      { title: "Costco list", text: "eggs" },
      {
        navigatorShare: async () => {
          throw new Error("share sheet missing");
        },
        copy: async (text: string) => calls.push(`fallback:${text}`),
      }
    );
    assert.equal(fallback, "copy");
    assert.equal(calls[2], "fallback:eggs");

    let aborted = false;
    await assert.rejects(
      () =>
        shareStoreList(
          { title: "Aldi list", text: "milk" },
          {
            navigatorShare: async () => {
              const error = new Error("The user aborted a request.");
              error.name = "AbortError";
              throw error;
            },
            copy: async () => {
              aborted = true;
            },
          }
        )
    );
    assert.equal(aborted, false);

    const native = await shareStoreList(
      { title: "Aldi list", text: "milk" },
      {
        capacitorShare: {
          share: async (payload: { text?: string }) => calls.push(`cap:${payload.text}`),
        },
        navigatorShare: async () => calls.push("web"),
        copy: async () => calls.push("copy"),
      }
    );
    assert.equal(native, "capacitor");
    assert.equal(calls[3], "cap:milk");
  });
});
