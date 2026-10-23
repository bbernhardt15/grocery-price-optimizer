import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { authStatus } from "./config";

const NAMES = [
  "AUTH_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_BUNDLE_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "RESEND_API_KEY",
  "AUTH_EMAIL_FROM",
] as const;

describe("auth provider flags", () => {
  const previous = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

  after(() => {
    for (const name of NAMES) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("stays off when the secret or every provider is unset", () => {
    for (const name of NAMES) delete process.env[name];
    assert.equal(authStatus().enabled, false);
    process.env.AUTH_SECRET = "secret-secret-secret-secret";
    assert.equal(authStatus().enabled, false);
    assert.equal(authStatus().providers.apple.enabled, false);
    assert.equal(authStatus().providers.google.enabled, false);
    assert.equal(authStatus().providers.email.enabled, false);
  });

  it("turns on only the providers that have their variables", () => {
    process.env.AUTH_SECRET = "secret-secret-secret-secret";
    process.env.APPLE_CLIENT_ID = "app.grocerygitter.service";
    process.env.GOOGLE_CLIENT_ID = "google-web.apps.googleusercontent.com";
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    const status = authStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.providers.apple.enabled, true);
    assert.equal(status.providers.apple.redirect, true);
    assert.equal(status.providers.apple.clientId, "app.grocerygitter.service");
    assert.equal(status.providers.google.enabled, true);
    assert.equal(status.providers.google.redirect, false);
    assert.equal(status.providers.email.enabled, false);
  });
});
