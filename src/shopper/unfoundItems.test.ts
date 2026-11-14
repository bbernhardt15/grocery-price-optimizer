import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  krogerNameSearchUrl,
  notInCartSection,
  toFindRecords,
  unmatchedItemNames,
  unfoundCopyText,
  unfoundSectionHtml,
  unfoundShopSectionHtml,
  walmartNameSearchUrl,
} from "../../public/shopper/unfoundItems.js";

describe("unfound items", () => {
  it("links a name search and does not invent a cart add", () => {
    const kroger = new URL(krogerNameSearchUrl("Oat milk"));
    const walmart = new URL(walmartNameSearchUrl("Oat milk"));
    assert.equal(kroger.origin + kroger.pathname, "https://www.kroger.com/search");
    assert.equal(kroger.searchParams.get("query"), "Oat milk");
    assert.equal(walmart.origin + walmart.pathname, "https://www.walmart.com/search");
    assert.equal(walmart.searchParams.get("q"), "Oat milk");
    assert.doesNotMatch(kroger.href, /cart\/add|addToCart/i);
    assert.doesNotMatch(walmart.href, /addToCart|\/ip\//i);
    const html = unfoundSectionHtml(["Oat milk", "Saffron"]);
    assert.match(html, />Search</);
    assert.match(html, /data-match-search="Oat milk"/);
    assert.match(html, /Shop in store/);
    assert.doesNotMatch(html, /href="https:\/\/www\.kroger\.com/);
    assert.doesNotMatch(html, /Search at Walmart/);
    assert.match(html, /Copy list of unfound items/);
    assert.match(html, /To find in store/);
    assert.equal(unfoundCopyText(["Oat milk", "Saffron"]), "Oat milk\nSaffron");
    assert.equal(toFindRecords(["Oat milk"])[0].status, "to find in store");
    const section = notInCartSection(["Oat milk"]);
    assert.equal(section.groups[0].label, "Not in a cart");
    assert.match(unfoundShopSectionHtml(section), /Not in a cart/);
    assert.match(unfoundShopSectionHtml(section), />Search</);
    const names = unmatchedItemNames({
      toFindInStore: [{ name: "Parmesan Shredded Cheese" }],
      unavailable: ["Something else"],
    });
    assert.deepEqual(names, ["Parmesan Shredded Cheese"]);
    assert.match(unfoundSectionHtml(names), /Parmesan Shredded Cheese/);
    assert.match(unfoundShopSectionHtml(notInCartSection(names)), /Parmesan Shredded Cheese/);
  });
});
