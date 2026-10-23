import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrubBreadcrumb, scrubHeaders, scrubSentryEvent, scrubString } from "./scrub";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";

describe("scrubString", () => {
  it("removes emails, bearer and basic tokens, JWTs, and Kroger cookies on every call", () => {
    const raw = `shopper@example.com Bearer abc.def Basic dG9rZW4= ${JWT} kroger_shopper=sealed-token`;
    const once = scrubString(raw);
    const twice = scrubString(raw);
    assert.equal(once, twice);
    assert.equal(once.includes("shopper@example.com"), false);
    assert.equal(once.includes("abc.def"), false);
    assert.equal(once.includes("dG9rZW4"), false);
    assert.equal(once.includes(JWT), false);
    assert.equal(once.includes("sealed-token"), false);
    assert.match(once, /\[email\]/);
    assert.match(once, /Bearer \[token\]/);
    assert.match(once, /Basic \[token\]/);
    assert.match(once, /kroger_shopper=\[filtered\]/);
  });

  it("redacts OAuth code, state, and access_token in a callback URL", () => {
    const url =
      "https://grocery.example/api/kroger/oauth/callback?code=auth-code&state=signed-cart&access_token=raw-token";
    const scrubbed = scrubString(url);
    assert.equal(scrubbed.includes("auth-code"), false);
    assert.equal(scrubbed.includes("signed-cart"), false);
    assert.equal(scrubbed.includes("raw-token"), false);
    assert.match(scrubbed, /code=\[token\]/);
    assert.match(scrubbed, /state=\[token\]/);
    assert.match(scrubbed, /access_token=\[token\]/);
  });

  it("redacts a percent-encoded email", () => {
    assert.equal(scrubString("user%40example.com"), "[email]");
  });
});

describe("scrubSentryEvent", () => {
  it("drops Kroger auth headers, cookies, and the user identity", () => {
    const event = {
      message: "Cart failed for shopper@example.com",
      user: { email: "shopper@example.com", ip_address: "203.0.113.5", id: "gg-device" },
      request: {
        url: "https://grocery.example/api/kroger/oauth/callback?code=auth-code&state=signed",
        headers: {
          Authorization: `Bearer ${JWT}`,
          Cookie: "kroger_shopper=sealed; other=1",
          "X-Admin-Token": "admin-secret",
          "X-List-Owner": "owner-secret",
          "User-Agent": "GroceryGitter/1.0",
        },
        cookies: { kroger_shopper: "sealed" },
        query_string: { code: "auth-code", zip: "45202" },
        data: { note: "Reach me at shopper@example.com", access_token: "raw-token" },
      },
      extra: { detail: `Authorization: Bearer ${JWT}` },
    };

    const scrubbed = scrubSentryEvent(event);
    const serialized = JSON.stringify(scrubbed);
    assert.equal("user" in scrubbed, false);
    assert.equal(serialized.includes("shopper@example.com"), false);
    assert.equal(serialized.includes("203.0.113.5"), false);
    assert.equal(serialized.includes("gg-device"), false);
    assert.equal(serialized.includes(JWT), false);
    assert.equal(serialized.includes("sealed"), false);
    assert.equal(serialized.includes("admin-secret"), false);
    assert.equal(serialized.includes("owner-secret"), false);
    assert.equal(serialized.includes("auth-code"), false);
    assert.equal(serialized.includes("raw-token"), false);
    assert.equal(scrubbed.request.headers["User-Agent"], "GroceryGitter/1.0");
    assert.equal("Authorization" in scrubbed.request.headers, false);
    assert.equal("Cookie" in scrubbed.request.headers, false);
    assert.equal("cookies" in scrubbed.request, false);
    assert.equal(scrubbed.request.query_string.code, "[token]");
    assert.equal(scrubbed.request.query_string.zip, "45202");
    assert.match(scrubbed.message, /\[email\]/);
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs a fetch breadcrumb URL without dropping the breadcrumb", () => {
    const breadcrumb = scrubBreadcrumb({
      category: "fetch",
      message: "Failed for shopper@example.com",
      data: {
        url: "https://api.kroger.com/v1/cart/add?access_token=raw-token",
        method: "PUT",
      },
    });
    assert.equal(breadcrumb.category, "fetch");
    assert.match(breadcrumb.message, /\[email\]/);
    assert.equal(String(breadcrumb.data && (breadcrumb.data as { url: string }).url).includes("raw-token"), false);
  });
});

describe("scrubHeaders", () => {
  it("returns undefined for a non-object", () => {
    assert.equal(scrubHeaders("kroger_shopper=sealed"), undefined);
  });
});
