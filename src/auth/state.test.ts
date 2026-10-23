import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { returnWithSession, safeReturnTo, signAuthState, verifyAuthState, type AuthState } from "./state";

describe("auth return urls", () => {
  const previous = process.env.AUTH_SECRET;

  before(() => {
    process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  });

  after(() => {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  });

  it("allows this site and the Capacitor origins, and drops open redirects", () => {
    assert.equal(safeReturnTo("/lists"), "/lists");
    assert.equal(safeReturnTo("https://localhost/"), "https://localhost/");
    assert.equal(safeReturnTo("capacitor://localhost/settings"), "capacitor://localhost/");
    assert.equal(safeReturnTo("https://evil.example/steal"), "/");
    assert.equal(safeReturnTo("//evil.example"), "/");
  });

  it("round-trips a signed state and appends the session token", () => {
    const state: AuthState = {
      v: 1,
      provider: "apple",
      exp: Date.now() + 60_000,
      returnTo: "/?from=apple",
      nonce: "abc",
    };
    const token = signAuthState(state);
    assert.equal(verifyAuthState(token)?.nonce, "abc");
    assert.equal(verifyAuthState(`${token}x`), null);
    assert.equal(returnWithSession("/?from=apple", "session-token"), "/?from=apple&session=session-token");
    assert.equal(returnWithSession("https://localhost/", "session-token"), "https://localhost/?session=session-token");
  });
});
